import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  AppConfig,
  ArtifactDetailResponse,
  ArtifactReportResponse,
  ArtifactReportStatus,
  ExternalSkillJobResponse,
} from './contracts.js';
import type {
  ArtifactReportGenerationRecord,
  ArtifactReportRepository,
} from './artifact-report-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import { BadRequestError, getErrorMessage } from './errors.js';

const REPORT_GENERATION_SKILL_CODE = 'ext.report_generation';

interface ReportReadyEventData {
  sessionId?: string;
  subject?: string;
  openUrl?: string;
  artifactId?: string;
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
    if (!reportReady?.sessionId || !reportReady.openUrl) {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactReportErrorMessage('report-generation 未返回可打开的报告链接'),
      });
    }

    return this.options.repository.updateStatus({
      versionId: record.versionId,
      status: 'succeeded',
      reportSessionId: reportReady.sessionId,
      openUrl: reportReady.openUrl,
      metadata: {
        ...reportReady,
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

  private mapJobStatus(status: ExternalSkillJobResponse['status']): ArtifactReportStatus {
    if (status === 'succeeded') {
      return 'succeeded';
    }
    if (status === 'failed') {
      return 'failed';
    }
    return status;
  }

  private writeMarkdownAttachment(detail: ArtifactDetailResponse): string {
    const rootDir = dirname(this.options.config.meta.envFilePath);
    const outputDir = resolve(rootDir, '.local/artifact-report-inputs');
    mkdirSync(outputDir, { recursive: true });

    const contentHash = createHash('sha256').update(detail.markdown).digest('hex').slice(0, 12);
    const markdownPath = join(outputDir, `${detail.artifact.versionId}-${contentHash}.md`);
    writeFileSync(markdownPath, detail.markdown, 'utf8');
    return markdownPath;
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
      metadata: record?.metadata ?? undefined,
      errorMessage: record?.errorMessage ?? null,
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
    };
  }
}
