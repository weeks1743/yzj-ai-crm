import { createHash } from 'node:crypto';
import type {
  AppConfig,
  ArtifactDetailResponse,
  ArtifactReportResponse,
  ArtifactReportStatus,
  ExternalSkillJobResponse,
  MarkdownReportGenerationResponse,
} from './contracts.js';
import type {
  ArtifactReportGenerationRecord,
  ArtifactReportRepository,
} from './artifact-report-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import { BadRequestError, NotFoundError, getErrorMessage } from './errors.js';
import { writeSkillRuntimeInputFile } from './skill-runtime-inputs.js';

const REPORT_GENERATION_SKILL_CODE = 'ext.report_generation';
const LEGACY_TRANSIENT_REPORT_MESSAGE = '该报告仅保存了临时会话链接，报告会话已过期或服务已重启，请重新生成报告。';
const MARKDOWN_REPORT_WAIT_TIMEOUT_MS = 180_000;
const MARKDOWN_REPORT_POLL_INTERVAL_MS = 1_000;

interface ReportReadyEventData {
  sessionId?: string;
  transientSessionId?: string;
  subject?: string;
  openUrl?: string;
  transientOpenUrl?: string;
  artifactId?: string;
  codeArtifactId?: string;
  metadataArtifactId?: string;
  generatedAt?: string;
  codeLength?: number;
}

function normalizeArtifactReportErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return '报告生成失败，请稍后重试。';
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized.includes('报告生成服务当前不可达') ||
    normalized.includes('report canvas') ||
    normalized.includes('report-canvas')
  ) {
    return '报告生成服务当前不可达，请检查内置 report-canvas 服务是否已启动。';
  }

  if (normalized.includes('超时') || normalized.includes('timeout')) {
    return '报告生成超时，请稍后重试。';
  }

  return trimmed;
}

export class ArtifactReportService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: ArtifactReportRepository;
      artifactService: ArtifactService;
      externalSkillService: ExternalSkillService;
    },
  ) {}

  async getReport(artifactId: string): Promise<ArtifactReportResponse> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const record = await this.options.repository.getByVersion(detail.artifact.versionId);
    if (!record) {
      return this.toResponse(detail, null, 'not_started');
    }

    return this.toResponse(
      detail,
      await this.refreshIfNeeded(record),
    );
  }

  async getReportCode(artifactId: string): Promise<{
    code: string;
    fileName: string;
    mimeType: string;
    report: ArtifactReportResponse;
  }> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const record = await this.refreshIfNeededByVersion(detail.artifact.versionId);
    if (!record || record.status === 'not_started') {
      throw new NotFoundError('报告尚未生成，请先生成报告');
    }
    if (record.status !== 'succeeded') {
      throw new BadRequestError(record.errorMessage || '报告尚未生成完成');
    }
    if (!record.jobId || !record.codeArtifactId) {
      throw new NotFoundError(LEGACY_TRANSIENT_REPORT_MESSAGE);
    }

    const payload = await this.options.externalSkillService.getSkillJobArtifact(record.jobId, record.codeArtifactId);
    const code = payload.content.toString('utf8');
    if (!code.trim()) {
      throw new NotFoundError('报告源码 artifact 为空，请重新生成报告');
    }

    return {
      code,
      fileName: payload.artifact.fileName,
      mimeType: payload.artifact.mimeType,
      report: this.toResponse(detail, record),
    };
  }

  async getReportOpenUrl(artifactId: string): Promise<string> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const record = await this.refreshIfNeededByVersion(detail.artifact.versionId);
    if (!record || record.status === 'not_started') {
      throw new NotFoundError('报告尚未生成，请先生成报告');
    }
    if (record.status !== 'succeeded') {
      throw new BadRequestError(record.errorMessage || '报告尚未生成完成');
    }
    if (!record.codeArtifactId) {
      throw new NotFoundError(LEGACY_TRANSIENT_REPORT_MESSAGE);
    }

    return this.buildPersistentReportOpenUrl(detail.artifact.artifactId);
  }

  async ensureReport(artifactId: string): Promise<ArtifactReportResponse> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    this.assertCompanyResearchArtifact(detail);

    const existing = await this.options.repository.getByVersion(detail.artifact.versionId);
    if (existing && existing.status !== 'failed') {
      return this.toResponse(
        detail,
        await this.refreshIfNeeded(existing),
      );
    }

    await this.options.repository.reserve({
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
    });

    try {
      const markdownPath = this.writeMarkdownAttachment(detail);
      const job = await this.options.externalSkillService.createSkillJob(REPORT_GENERATION_SKILL_CODE, {
        requestText: `请基于「${detail.artifact.title}」生成一份可视化互动报告，适合销售和管理层在新页面查看。`,
        attachments: [markdownPath],
      });
      const attached = await this.options.repository.attachJob({
        versionId: detail.artifact.versionId,
        jobId: job.jobId,
        status: this.mapJobStatus(job.status),
      });

      return this.toResponse(
        detail,
        await this.refreshIfNeeded(attached),
      );
    } catch (error) {
      const failed = await this.options.repository.updateStatus({
        versionId: detail.artifact.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactReportErrorMessage(getErrorMessage(error)),
      });
      return this.toResponse(detail, failed);
    }
  }

  async generateMarkdownReport(input: {
    title?: string;
    markdown?: string;
  }): Promise<MarkdownReportGenerationResponse> {
    const title = input.title?.trim() || 'Markdown 报告';
    const markdown = input.markdown?.trim() ?? '';
    if (!markdown) {
      throw new BadRequestError('Markdown 内容为空，无法生成报告');
    }

    try {
      const markdownPath = this.writeStandaloneMarkdownAttachment({ title, markdown });
      const createdJob = await this.options.externalSkillService.createSkillJob(REPORT_GENERATION_SKILL_CODE, {
        requestText: `请基于「${title}」生成一份可视化互动报告，适合销售和管理层在新页面查看。`,
        attachments: [markdownPath],
      });
      const finishedJob = await this.waitForMarkdownReportJob(createdJob);
      return this.toMarkdownReportResponse(title, finishedJob);
    } catch (error) {
      return {
        title,
        status: 'failed',
        isPersistent: false,
        errorMessage: normalizeArtifactReportErrorMessage(getErrorMessage(error)),
        generatedAt: new Date().toISOString(),
      };
    }
  }

  private assertCompanyResearchArtifact(detail: ArtifactDetailResponse): void {
    if (detail.artifact.kind !== 'company_research') {
      throw new BadRequestError('当前仅支持基于公司研究 Markdown 生成报告');
    }
    if (!detail.markdown.trim()) {
      throw new BadRequestError('公司研究 Markdown 内容为空，无法生成报告');
    }
  }

  private async refreshIfNeeded(
    record: ArtifactReportGenerationRecord,
  ): Promise<ArtifactReportGenerationRecord> {
    if (!record.jobId || (record.status !== 'queued' && record.status !== 'running')) {
      return record;
    }

    try {
      const job = await this.options.externalSkillService.getSkillJob(record.jobId);
      return this.syncJobStatus(record, job);
    } catch (error) {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactReportErrorMessage(getErrorMessage(error)),
      });
    }
  }

  private async refreshIfNeededByVersion(versionId: string): Promise<ArtifactReportGenerationRecord | null> {
    const record = await this.options.repository.getByVersion(versionId);
    return record ? this.refreshIfNeeded(record) : null;
  }

  private syncJobStatus(
    record: ArtifactReportGenerationRecord,
    job: ExternalSkillJobResponse,
  ): Promise<ArtifactReportGenerationRecord> {
    if (job.status === 'failed') {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactReportErrorMessage(job.error?.message ?? '报告生成失败'),
      });
    }

    if (job.status !== 'succeeded') {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: this.mapJobStatus(job.status),
      });
    }

    const reportReady = this.findReportReadyEvent(job);
    const sessionId = reportReady?.transientSessionId || reportReady?.sessionId;
    if (!sessionId || !reportReady?.openUrl) {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactReportErrorMessage('report-generation 未返回可打开的报告链接'),
      });
    }

    const codeArtifactId = reportReady.codeArtifactId || null;
    const persistentOpenUrl = codeArtifactId
      ? this.buildPersistentReportOpenUrl(record.artifactId)
      : reportReady.openUrl;

    return this.options.repository.updateStatus({
      versionId: record.versionId,
      status: 'succeeded',
      reportSessionId: sessionId,
      openUrl: persistentOpenUrl,
      codeArtifactId,
      metadataArtifactId: reportReady.metadataArtifactId || reportReady.artifactId || null,
      metadata: {
        ...reportReady,
        sessionId,
        transientSessionId: sessionId,
        transientOpenUrl: reportReady.transientOpenUrl || reportReady.openUrl,
        openUrl: persistentOpenUrl,
        jobId: job.jobId,
        finalText: job.finalText,
      },
      errorMessage: null,
    });
  }

  private findReportReadyEvent(job: ExternalSkillJobResponse): ReportReadyEventData | null {
    const event = [...job.events]
      .reverse()
      .find((item) => item.type === 'report_ready' && item.data && typeof item.data === 'object');

    return event ? event.data as ReportReadyEventData : null;
  }

  private async waitForMarkdownReportJob(job: ExternalSkillJobResponse): Promise<ExternalSkillJobResponse> {
    let current = job;
    const startedAt = Date.now();

    while (current.status !== 'succeeded' && current.status !== 'failed') {
      if (Date.now() - startedAt >= MARKDOWN_REPORT_WAIT_TIMEOUT_MS) {
        throw new Error('报告生成超时，请稍后重试。');
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, MARKDOWN_REPORT_POLL_INTERVAL_MS));
      current = await this.options.externalSkillService.getSkillJob(job.jobId);
    }

    return current;
  }

  private toMarkdownReportResponse(
    title: string,
    job: ExternalSkillJobResponse,
  ): MarkdownReportGenerationResponse {
    if (job.status === 'failed') {
      return {
        title,
        status: 'failed',
        jobId: job.jobId,
        isPersistent: false,
        errorMessage: normalizeArtifactReportErrorMessage(job.error?.message ?? '报告生成失败'),
        generatedAt: job.updatedAt,
      };
    }

    const reportReady = this.findReportReadyEvent(job);
    const sessionId = reportReady?.transientSessionId || reportReady?.sessionId;
    const openUrl = reportReady?.transientOpenUrl || reportReady?.openUrl;
    if (!sessionId || !openUrl) {
      return {
        title,
        status: 'failed',
        jobId: job.jobId,
        isPersistent: false,
        errorMessage: normalizeArtifactReportErrorMessage('report-generation 未返回可打开的报告链接'),
        generatedAt: job.updatedAt,
      };
    }

    return {
      title: reportReady.subject || title,
      status: 'succeeded',
      jobId: job.jobId,
      openUrl,
      reportSessionId: sessionId,
      isPersistent: false,
      errorMessage: null,
      generatedAt: reportReady.generatedAt || job.updatedAt,
    };
  }

  private mapJobStatus(status: ExternalSkillJobResponse['status']): ArtifactReportStatus {
    if (status === 'succeeded') {
      return 'succeeded';
    }
    if (status === 'failed') {
      return 'failed';
    }
    return status;
  }

  private buildPersistentReportOpenUrl(artifactId: string): string {
    return `/api/artifacts/${encodeURIComponent(artifactId)}/report/open`;
  }

  private writeMarkdownAttachment(detail: ArtifactDetailResponse): string {
    const contentHash = createHash('sha256').update(detail.markdown).digest('hex').slice(0, 12);
    return writeSkillRuntimeInputFile({
      config: this.options.config,
      segments: ['artifact-report-inputs'],
      fileName: `${detail.artifact.versionId}-${contentHash}.md`,
      content: detail.markdown,
    });
  }

  private writeStandaloneMarkdownAttachment(input: {
    title: string;
    markdown: string;
  }): string {
    const contentHash = createHash('sha256').update(input.markdown).digest('hex').slice(0, 12);
    return writeSkillRuntimeInputFile({
      config: this.options.config,
      segments: ['markdown-report-inputs'],
      fileName: `${input.title}-${contentHash}.md`,
      content: input.markdown,
    });
  }

  private toResponse(
    detail: ArtifactDetailResponse,
    record: ArtifactReportGenerationRecord | null,
    status: ArtifactReportStatus = record?.status ?? 'not_started',
  ): ArtifactReportResponse {
    return {
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      status,
      jobId: record?.jobId ?? undefined,
      reportSessionId: record?.reportSessionId ?? undefined,
      openUrl: record?.openUrl ?? undefined,
      codeArtifactId: record?.codeArtifactId ?? undefined,
      metadataArtifactId: record?.metadataArtifactId ?? undefined,
      isPersistent: Boolean(record?.codeArtifactId),
      metadata: record?.metadata ?? undefined,
      errorMessage: record?.errorMessage ?? (
        record?.status === 'succeeded' && !record.codeArtifactId
          ? LEGACY_TRANSIENT_REPORT_MESSAGE
          : null
      ),
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
    };
  }
}
