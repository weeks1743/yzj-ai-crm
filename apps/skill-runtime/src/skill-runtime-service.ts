import { isAbsolute, resolve } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import type {
  AppConfig,
  CreateJobRequest,
  HealthResponse,
  JobResponse,
  ModelDescriptor,
  PresentationSessionCloseRequest,
  PresentationSessionCloseResponse,
  PresentationSessionHeartbeatRequest,
  PresentationSessionHeartbeatResponse,
  PresentationSessionHolder,
  PresentationSessionRequest,
  PresentationSessionResponse,
  SkillCatalogEntry,
  SupportedDeepseekModel,
} from './contracts.js';
import { SUPPORTED_DEEPSEEK_MODELS } from './contracts.js';
import { DocmeeClient } from './docmee-client.js';
import { createSuperPptDocmeeUid } from './super-ppt-docmee.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from './errors.js';
import { isPathWithin } from './path-utils.js';
import { JobRepository } from './job-repository.js';
import { SkillCatalogService } from './skill-catalog-service.js';
import { SkillExecutor } from './skill-executor.js';

const MODEL_FREE_SKILLS = new Set(['super-ppt']);
const PRESENTATION_SESSION_REUSE_BUFFER_MS = 60_000;
const PRESENTATION_SESSION_LEASE_MS = 90_000;

interface PresentationMetadata {
  animation: boolean;
  jobId: string;
  pptId: string;
  subject: string;
}

interface CachedPresentationSession extends PresentationMetadata {
  animation: boolean;
  clientId: string;
  clientLabel: string;
  expiresAt: string;
  expiresAtMs: number;
  lastActiveAt: string;
  lastActiveAtMs: number;
  leaseExpireAt: string;
  leaseExpireAtMs: number;
  token: string;
}

export class SkillRuntimeService {
  private readonly runningJobs = new Set<string>();
  private readonly presentationSessions = new Map<string, CachedPresentationSession>();

  constructor(
    private readonly options: {
      config: AppConfig;
      catalogService: SkillCatalogService;
      repository: JobRepository;
      artifactStore: ArtifactStore;
      executor: SkillExecutor;
      docmeeClient: DocmeeClient;
    },
  ) {}

  getHealth(): HealthResponse {
    const dependencyDetails = Object.values(this.options.catalogService.getDependencySnapshot().details);
    return {
      status: 'ok',
      service: '@yzj-ai-crm/skill-runtime',
      port: this.options.config.server.port,
      sqlitePath: this.options.config.storage.sqlitePath,
      artifactDir: this.options.config.storage.artifactDir,
      dependencySummary: {
        available: dependencyDetails.filter((detail) => detail.available).length,
        missing: dependencyDetails.filter((detail) => !detail.available).length,
      },
    };
  }

  listModels(): ModelDescriptor[] {
    return SUPPORTED_DEEPSEEK_MODELS.map((name) => ({
      name,
      label: name,
      isDefault: name === this.options.config.deepseek.defaultModel,
    }));
  }

  listSkills(): SkillCatalogEntry[] {
    return this.options.catalogService.listSkills();
  }

  private assertAllowedExternalPath(pathValue: string, label: string): string {
    if (!isAbsolute(pathValue)) {
      throw new BadRequestError(`${label} 必须是绝对路径: ${pathValue}`);
    }

    const normalized = resolve(pathValue);
    if (!this.options.config.runtime.allowedRoots.some((root) => isPathWithin(root, normalized))) {
      throw new BadRequestError(`${label} 不在允许目录内: ${pathValue}`, {
        allowedRoots: this.options.config.runtime.allowedRoots,
      });
    }

    return normalized;
  }

  private validateModel(model: string | undefined): SupportedDeepseekModel {
    const resolvedModel = (model?.trim() || this.options.config.deepseek.defaultModel) as SupportedDeepseekModel;
    if (this.options.config.deepseek.allowedModels.includes(resolvedModel)) {
      return resolvedModel;
    }

    throw new BadRequestError(
      `仅支持模型: ${this.options.config.deepseek.allowedModels.join(', ')}`,
    );
  }

  private requiresModel(skillName: string): boolean {
    return !MODEL_FREE_SKILLS.has(skillName);
  }

  async createJob(input: CreateJobRequest): Promise<JobResponse> {
    const skillName = input.skillName?.trim();
    if (!skillName) {
      throw new BadRequestError('skillName 不能为空');
    }

    const requestText = input.requestText?.trim();
    if (!requestText) {
      throw new BadRequestError('requestText 不能为空');
    }

    const skill = this.options.catalogService.getSkill(skillName);
    const catalogEntry = this.options.catalogService.getCatalogEntry(skillName);
    if (!skill || !catalogEntry) {
      throw new NotFoundError(`未知 skill: ${skillName}`);
    }

    if (catalogEntry.status === 'unsupported_yet') {
      throw new ConflictError(`skill 尚未开放执行: ${skillName}`);
    }

    if (catalogEntry.status === 'blocked') {
      throw new ConflictError(`skill 依赖未满足，暂不可执行: ${skillName}`, {
        missingDependencies: catalogEntry.missingDependencies,
      });
    }

    const attachments = (input.attachments || []).map((item) => this.assertAllowedExternalPath(item, 'attachments'));
    const workingDirectory = input.workingDirectory
      ? this.assertAllowedExternalPath(input.workingDirectory, 'workingDirectory')
      : null;
    const model = this.requiresModel(skillName) ? this.validateModel(input.model) : null;

    const job = this.options.repository.createJob({
      skillName,
      model,
      requestText,
      attachments,
      workingDirectory,
      templateId: input.templateId?.trim() || null,
      presentationPrompt: input.presentationPrompt?.trim() || null,
    });

    this.options.repository.appendEvent(job.jobId, 'status', 'Job 已入队');
    queueMicrotask(() => {
      void this.runJob(job.jobId);
    });

    return this.options.repository.toJobResponse(job.jobId);
  }

  getJob(jobId: string): JobResponse {
    return this.options.repository.toJobResponse(jobId);
  }

  getArtifact(jobId: string, artifactId: string) {
    return this.options.artifactStore.readArtifact(jobId, artifactId);
  }

  private getPresentationMetadata(jobId: string): PresentationMetadata {
    const job = this.options.repository.getJob(jobId);
    if (job.skillName !== 'super-ppt') {
      throw new ConflictError(`当前 job 不支持 PPT 编辑会话: ${job.skillName}`);
    }

    const presentationEvent = this.options.repository
      .listEvents(jobId)
      .filter((event) => event.type === 'presentation_ready')
      .at(-1);

    if (!presentationEvent?.data || typeof presentationEvent.data !== 'object') {
      throw new ConflictError('当前 job 尚未生成可编辑的 PPT');
    }

    const payload = presentationEvent.data as {
      pptId?: unknown;
      subject?: unknown;
      animation?: unknown;
    };
    const pptId = typeof payload.pptId === 'string' ? payload.pptId : '';
    const subject = typeof payload.subject === 'string' ? payload.subject : '';
    if (!pptId || !subject) {
      throw new ConflictError('当前 job 的 PPT 元数据不完整，无法创建编辑会话');
    }

    return {
      jobId,
      pptId,
      subject,
      animation: Boolean(payload.animation),
    };
  }

  private normalizeClientId(value: string | undefined): string {
    const candidate = value?.trim();
    if (!candidate) {
      throw new BadRequestError('presentation-session 请求必须提供 clientId');
    }
    if (candidate.length > 128) {
      throw new BadRequestError('clientId 长度不能超过 128');
    }
    return candidate;
  }

  private normalizeClientLabel(clientId: string, value: string | undefined): string {
    const candidate = value?.trim();
    if (!candidate) {
      return `super-ppt-editor:${clientId.slice(0, 8)}`;
    }
    if (candidate.length > 128) {
      throw new BadRequestError('clientLabel 长度不能超过 128');
    }
    return candidate;
  }

  private buildPresentationHolder(session: CachedPresentationSession): PresentationSessionHolder {
    return {
      clientId: session.clientId,
      clientLabel: session.clientLabel,
      lastActiveAt: session.lastActiveAt,
      leaseExpireAt: session.leaseExpireAt,
    };
  }

  private toPresentationSessionResponse(session: CachedPresentationSession): PresentationSessionResponse {
    return {
      status: 'ok',
      jobId: session.jobId,
      pptId: session.pptId,
      token: session.token,
      subject: session.subject,
      animation: session.animation,
      expiresAt: session.expiresAt,
      leaseExpireAt: session.leaseExpireAt,
      clientId: session.clientId,
    };
  }

  private isSessionExpired(session: CachedPresentationSession, expectedPptId: string): boolean {
    const now = Date.now();
    return (
      session.pptId !== expectedPptId
      || session.expiresAtMs <= now
      || session.leaseExpireAtMs <= now
    );
  }

  private getActivePresentationSession(jobId: string, expectedPptId: string): CachedPresentationSession | null {
    const session = this.presentationSessions.get(jobId);
    if (!session) {
      return null;
    }

    if (this.isSessionExpired(session, expectedPptId)) {
      this.presentationSessions.delete(jobId);
      return null;
    }

    return session;
  }

  private touchPresentationSession(
    session: CachedPresentationSession,
    clientLabel?: string,
  ): CachedPresentationSession {
    const now = Date.now();
    const leaseExpireAtMs = Math.min(session.expiresAtMs, now + PRESENTATION_SESSION_LEASE_MS);
    session.lastActiveAtMs = now;
    session.lastActiveAt = new Date(now).toISOString();
    session.leaseExpireAtMs = leaseExpireAtMs;
    session.leaseExpireAt = new Date(leaseExpireAtMs).toISOString();
    if (clientLabel) {
      session.clientLabel = clientLabel;
    }
    this.presentationSessions.set(session.jobId, session);
    return session;
  }

  private async mintPresentationSession(input: {
    metadata: PresentationMetadata;
    clientId: string;
    clientLabel: string;
  }): Promise<CachedPresentationSession> {
    const tokenPayload = await this.options.docmeeClient.createApiToken({
      uid: createSuperPptDocmeeUid(input.metadata.jobId),
      limit: 200,
      timeOfHours: this.options.config.docmee.editorTokenHours,
    });
    const expiresInSeconds = Number.isFinite(tokenPayload.expireTime) && tokenPayload.expireTime > 0
      ? tokenPayload.expireTime
      : this.options.config.docmee.editorTokenHours * 3600;
    const now = Date.now();
    const expiresAtMs = now + expiresInSeconds * 1000;
    const leaseExpireAtMs = Math.min(expiresAtMs, now + PRESENTATION_SESSION_LEASE_MS);
    const session: CachedPresentationSession = {
      ...input.metadata,
      clientId: input.clientId,
      clientLabel: input.clientLabel,
      token: tokenPayload.token,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      lastActiveAt: new Date(now).toISOString(),
      lastActiveAtMs: now,
      leaseExpireAt: new Date(leaseExpireAtMs).toISOString(),
      leaseExpireAtMs,
    };
    this.presentationSessions.set(input.metadata.jobId, session);
    return session;
  }

  async openPresentationSession(
    jobId: string,
    input: PresentationSessionRequest & {
      forceRefreshToken?: boolean;
    },
  ): Promise<PresentationSessionResponse> {
    const metadata = this.getPresentationMetadata(jobId);
    const clientId = this.normalizeClientId(input.clientId);
    const clientLabel = this.normalizeClientLabel(clientId, input.clientLabel);
    const activeSession = this.getActivePresentationSession(jobId, metadata.pptId);

    if (activeSession && activeSession.clientId !== clientId && !input.takeover) {
      throw new AppError(
        409,
        'PRESENTATION_SESSION_CONFLICT',
        '当前 PPT 已被其他窗口占用',
        {
          details: {
            holder: this.buildPresentationHolder(activeSession),
            leaseExpireAt: activeSession.leaseExpireAt,
            canTakeover: true,
          },
        },
      );
    }

    if (activeSession && activeSession.clientId === clientId) {
      if (
        input.forceRefreshToken
        || activeSession.expiresAtMs - Date.now() <= PRESENTATION_SESSION_REUSE_BUFFER_MS
      ) {
        const refreshedSession = await this.mintPresentationSession({
          metadata,
          clientId,
          clientLabel,
        });
        return this.toPresentationSessionResponse(refreshedSession);
      }

      return this.toPresentationSessionResponse(
        this.touchPresentationSession(activeSession, clientLabel),
      );
    }

    const session = await this.mintPresentationSession({
      metadata,
      clientId,
      clientLabel,
    });
    return this.toPresentationSessionResponse(session);
  }

  async heartbeatPresentationSession(
    jobId: string,
    input: PresentationSessionHeartbeatRequest,
  ): Promise<PresentationSessionHeartbeatResponse> {
    const metadata = this.getPresentationMetadata(jobId);
    const clientId = this.normalizeClientId(input.clientId);
    const clientLabel = this.normalizeClientLabel(clientId, input.clientLabel);
    const activeSession = this.getActivePresentationSession(jobId, metadata.pptId);

    if (!activeSession) {
      throw new AppError(
        409,
        'PRESENTATION_SESSION_EXPIRED',
        '当前编辑会话已失效，请重新连接或重新打开',
        {
          details: {
            canTakeover: false,
          },
        },
      );
    }

    if (activeSession.clientId !== clientId) {
      throw new AppError(
        409,
        'PRESENTATION_SESSION_TAKEN_OVER',
        '当前编辑会话已被其他窗口接管',
        {
          details: {
            holder: this.buildPresentationHolder(activeSession),
            leaseExpireAt: activeSession.leaseExpireAt,
            canTakeover: true,
          },
        },
      );
    }

    const session = this.touchPresentationSession(activeSession, clientLabel);
    return {
      status: 'ok',
      jobId,
      clientId,
      expiresAt: session.expiresAt,
      leaseExpireAt: session.leaseExpireAt,
    };
  }

  async closePresentationSession(
    jobId: string,
    input: PresentationSessionCloseRequest,
  ): Promise<PresentationSessionCloseResponse> {
    this.options.repository.getJob(jobId);
    const clientId = this.normalizeClientId(input.clientId);
    const activeSession = this.presentationSessions.get(jobId);
    const released = Boolean(activeSession && activeSession.clientId === clientId);
    if (released) {
      this.presentationSessions.delete(jobId);
    }

    return {
      status: 'closed',
      jobId,
      clientId,
      released,
    };
  }

  async createPresentationSession(
    jobId: string,
    options?: {
      forceRefresh?: boolean;
    },
  ): Promise<PresentationSessionResponse> {
    return this.openPresentationSession(jobId, {
      clientId: `legacy-${jobId}`,
      clientLabel: 'legacy-presentation-session',
      takeover: Boolean(options?.forceRefresh),
      forceRefreshToken: Boolean(options?.forceRefresh),
    });
  }

  private async runJob(jobId: string): Promise<void> {
    if (this.runningJobs.has(jobId)) {
      return;
    }

    this.runningJobs.add(jobId);

    try {
      const job = this.options.repository.getJob(jobId);
      const skill = this.options.catalogService.getSkill(job.skillName);
      if (!skill) {
        throw new NotFoundError(`skill 不存在: ${job.skillName}`);
      }

      this.options.repository.markRunning(jobId);
      this.options.repository.appendEvent(jobId, 'status', 'Job 运行中');
      const result = await this.options.executor.execute(job, skill);
      this.options.repository.markSucceeded(jobId, result.finalText);
      this.options.repository.appendEvent(jobId, 'status', 'Job 已完成');
    } catch (error) {
      const payload = error instanceof AppError
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : {
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '服务内部错误',
          };

      this.options.repository.markFailed(jobId, payload);
      this.options.repository.appendEvent(jobId, 'error', payload.message, payload);
    } finally {
      this.runningJobs.delete(jobId);
    }
  }
}
