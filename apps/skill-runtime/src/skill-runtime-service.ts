import { isAbsolute, resolve } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import type {
  AppConfig,
  CreateJobRequest,
  HealthResponse,
  JobResponse,
  ModelDescriptor,
  SkillCatalogEntry,
  SupportedDeepseekModel,
} from './contracts.js';
import { SUPPORTED_DEEPSEEK_MODELS } from './contracts.js';
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

export class SkillRuntimeService {
  private readonly runningJobs = new Set<string>();

  constructor(
    private readonly options: {
      config: AppConfig;
      catalogService: SkillCatalogService;
      repository: JobRepository;
      artifactStore: ArtifactStore;
      executor: SkillExecutor;
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
    const model = this.validateModel(input.model);

    const job = this.options.repository.createJob({
      skillName,
      model,
      requestText,
      attachments,
      workingDirectory,
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
