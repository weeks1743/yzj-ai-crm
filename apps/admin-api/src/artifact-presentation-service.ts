import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  AppConfig,
  ArtifactDetailResponse,
  ArtifactPresentationResponse,
  ArtifactPresentationStatus,
  ExternalSkillJobArtifact,
  ExternalSkillJobResponse,
} from './contracts.js';
import type {
  ArtifactPptGenerationRecord,
  ArtifactPresentationRepository,
} from './artifact-presentation-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import { getErrorMessage } from './errors.js';

const SUPER_PPT_SKILL_CODE = 'ext.super_ppt';
const PPT_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function normalizeArtifactPresentationErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'PPT 生成失败，请稍后重试。';
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized.includes('模板解析失败') ||
    normalized.includes('未识别到可用内容页') ||
    normalized.includes('classification result must include at least one content page')
  ) {
    return '当前企业 PPT 模板未被 Docmee 识别出内容页，请在后台更换或修复模板后重试。';
  }

  if (
    normalized.includes('官方链路未完成') ||
    normalized.includes('排版链路未完成') ||
    normalized.includes('未执行降级 ppt') ||
    normalized.includes('默认模板降级') ||
    normalized.includes('排版任务未在预期时间内完成') ||
    normalized.includes('智能布局未在预期时间内完成')
  ) {
    return 'PPT 排版任务未完成，已停止本次生成。请稍后重试；如持续失败，请在后台检查企业 PPT 模板。';
  }

  if (normalized.includes('未返回 .pptx') || normalized.includes('未返回 pptx')) {
    return 'PPT 生成完成但未返回可下载文件，请稍后重试或联系管理员查看任务产物。';
  }

  return trimmed;
}

export class ArtifactPresentationService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: ArtifactPresentationRepository;
      artifactService: ArtifactService;
      externalSkillService: ExternalSkillService;
    },
  ) {}

  async getPresentation(artifactId: string): Promise<ArtifactPresentationResponse> {
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

  async ensurePresentation(artifactId: string): Promise<ArtifactPresentationResponse> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const existing = await this.options.repository.getByVersion(detail.artifact.versionId);
    if (existing && existing.status !== 'failed') {
      return this.toResponse(
        detail,
        await this.refreshIfNeeded(existing),
      );
    }

    const reserved = await this.options.repository.reserve({
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
    });

    try {
      const markdownPath = this.writeMarkdownAttachment(detail);
      const job = await this.options.externalSkillService.createSkillJob(SUPER_PPT_SKILL_CODE, {
        requestText: `请基于「${detail.artifact.title}」生成一份适合销售或管理层汇报的企业研究 PPT。`,
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
        errorMessage: normalizeArtifactPresentationErrorMessage(getErrorMessage(error)),
      });
      return this.toResponse(detail, failed);
    }
  }

  private async refreshIfNeeded(
    record: ArtifactPptGenerationRecord,
  ): Promise<ArtifactPptGenerationRecord> {
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
        errorMessage: normalizeArtifactPresentationErrorMessage(getErrorMessage(error)),
      });
    }
  }

  private syncJobStatus(
    record: ArtifactPptGenerationRecord,
    job: ExternalSkillJobResponse,
  ): Promise<ArtifactPptGenerationRecord> {
    if (job.status === 'failed') {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactPresentationErrorMessage(job.error?.message ?? 'super-ppt 生成失败'),
      });
    }

    if (job.status !== 'succeeded') {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: this.mapJobStatus(job.status),
      });
    }

    const pptArtifact = this.findPptArtifact(job);
    if (!pptArtifact) {
      return this.options.repository.updateStatus({
        versionId: record.versionId,
        status: 'failed',
        errorMessage: normalizeArtifactPresentationErrorMessage('super-ppt 未返回 .pptx 产物'),
      });
    }

    return this.options.repository.updateStatus({
      versionId: record.versionId,
      status: 'succeeded',
      pptArtifact,
      errorMessage: null,
    });
  }

  private findPptArtifact(job: ExternalSkillJobResponse): ExternalSkillJobArtifact | null {
    return job.artifacts.find((artifact) =>
      artifact.mimeType === PPT_MIME_TYPE || artifact.fileName.toLowerCase().endsWith('.pptx')
    ) ?? null;
  }

  private mapJobStatus(status: ExternalSkillJobResponse['status']): ArtifactPresentationStatus {
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
    const outputDir = resolve(rootDir, '.local/artifact-ppt-inputs');
    mkdirSync(outputDir, { recursive: true });

    const contentHash = createHash('sha256').update(detail.markdown).digest('hex').slice(0, 12);
    const markdownPath = join(outputDir, `${detail.artifact.versionId}-${contentHash}.md`);
    writeFileSync(markdownPath, detail.markdown, 'utf8');
    return markdownPath;
  }

  private toResponse(
    detail: ArtifactDetailResponse,
    record: ArtifactPptGenerationRecord | null,
    status: ArtifactPresentationStatus = record?.status ?? 'not_started',
  ): ArtifactPresentationResponse {
    return {
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      status,
      jobId: record?.jobId ?? undefined,
      pptArtifact: record?.pptArtifact ?? undefined,
      errorMessage: record?.errorMessage ?? null,
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
    };
  }
}
