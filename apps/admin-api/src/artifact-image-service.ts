import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type {
  AppConfig,
  ArtifactDetailResponse,
  ArtifactImageResponse,
  ArtifactImageStatus,
  ImageGenerationQuality,
  ImageGenerationRequest,
  ImageGenerationSize,
} from './contracts.js';
import type {
  ArtifactImageGenerationRecord,
  ArtifactImageRepository,
} from './artifact-image-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import { BadRequestError, NotFoundError, getErrorMessage } from './errors.js';

const IMAGE_STALE_QUEUE_BUFFER_MS = 30_000;

export interface ArtifactImageFile {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

interface ParsedImageData {
  mimeType: string;
  content: Buffer;
  extension: string;
}

export class ArtifactImageService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: ArtifactImageRepository;
      artifactService: ArtifactService;
      externalSkillService: ExternalSkillService;
    },
  ) {}

  async getImage(artifactId: string): Promise<ArtifactImageResponse> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const record = await this.resolveStaleQueuedRecord(
      await this.options.repository.getByVersion(detail.artifact.versionId),
    );
    return this.toResponse(detail, record, record?.status ?? 'not_started');
  }

  async generateImage(
    artifactId: string,
    input: ImageGenerationRequest,
  ): Promise<ArtifactImageResponse> {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new BadRequestError('图片生成必须提供 prompt');
    }

    const detail = await this.options.artifactService.getArtifact(artifactId);
    const size = (input.size ?? 'auto') as ImageGenerationSize;
    const quality = (input.quality ?? 'auto') as ImageGenerationQuality;
    await this.options.repository.reserve({
      eid: this.options.config.yzj.eid,
      appId: this.options.config.yzj.appId,
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      prompt,
      size,
      quality,
    });

    try {
      const generated = await this.options.externalSkillService.generateImage({
        prompt,
        size,
        quality,
      });
      const parsed = parseImageDataUrl(generated.previewDataUrl, generated.mimeType);
      const fileName = buildImageFileName(detail, parsed.extension);
      const filePath = await this.writeImageFile(detail, fileName, parsed.content);
      const fileStats = await stat(filePath);
      const record = await this.options.repository.markSucceeded({
        versionId: detail.artifact.versionId,
        filePath,
        fileName,
        mimeType: parsed.mimeType,
        byteSize: fileStats.size,
        model: generated.model,
        provider: generated.provider,
        size: generated.size,
        quality: generated.quality,
        latencyMs: generated.latencyMs,
        generatedAt: generated.generatedAt,
      });

      return this.toResponse(detail, record);
    } catch (error) {
      const record = await this.options.repository.markFailed({
        versionId: detail.artifact.versionId,
        errorMessage: getErrorMessage(error),
      });
      return this.toResponse(detail, record);
    }
  }

  private async resolveStaleQueuedRecord(
    record: ArtifactImageGenerationRecord | null,
  ): Promise<ArtifactImageGenerationRecord | null> {
    if (!record || record.status !== 'queued') {
      return record;
    }

    const updatedAt = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      return record;
    }

    const staleAfterMs = this.options.config.external.image.timeoutMs + IMAGE_STALE_QUEUE_BUFFER_MS;
    if (Date.now() - updatedAt <= staleAfterMs) {
      return record;
    }

    return this.options.repository.markQueuedFailedBefore({
      versionId: record.versionId,
      before: new Date(Date.now() - staleAfterMs).toISOString(),
      errorMessage: '图片生成任务超时或已中断，请重新生成',
    });
  }

  async getImageFile(generationId: string): Promise<ArtifactImageFile> {
    const record = await this.options.repository.getByGeneration(generationId);
    if (!record || record.status !== 'succeeded' || !record.filePath || !record.fileName || !record.mimeType) {
      throw new NotFoundError('未找到已生成的图片文件');
    }

    return {
      fileName: record.fileName,
      mimeType: record.mimeType,
      content: await readFile(record.filePath),
    };
  }

  private async writeImageFile(
    detail: ArtifactDetailResponse,
    fileName: string,
    content: Buffer,
  ): Promise<string> {
    const rootDir = dirname(this.options.config.meta.envFilePath);
    const outputDir = resolve(
      rootDir,
      'tmp/artifact-images',
      safePathSegment(this.options.config.yzj.eid),
      safePathSegment(detail.artifact.artifactId),
    );
    await mkdir(outputDir, { recursive: true });

    const filePath = join(outputDir, fileName);
    await writeFile(filePath, content);
    return filePath;
  }

  private toResponse(
    detail: ArtifactDetailResponse,
    record: ArtifactImageGenerationRecord | null,
    status: ArtifactImageStatus = record?.status ?? 'not_started',
  ): ArtifactImageResponse {
    const cacheKey = record?.updatedAt ? `?v=${encodeURIComponent(record.updatedAt)}` : '';
    return {
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      status,
      generationId: record?.generationId,
      prompt: record?.prompt ?? null,
      fileName: record?.fileName ?? undefined,
      mimeType: record?.mimeType ?? undefined,
      byteSize: record?.byteSize ?? undefined,
      previewUrl: record?.status === 'succeeded' && record.generationId
        ? `/api/artifact-images/${encodeURIComponent(record.generationId)}/file${cacheKey}`
        : undefined,
      downloadPath: record?.status === 'succeeded' && record.generationId
        ? `/api/artifact-images/${encodeURIComponent(record.generationId)}/file?download=1`
        : undefined,
      model: record?.model ?? undefined,
      provider: record?.provider ?? undefined,
      size: record?.size ?? undefined,
      quality: record?.quality ?? undefined,
      latencyMs: record?.latencyMs ?? undefined,
      errorMessage: record?.errorMessage ?? null,
      generatedAt: record?.generatedAt ?? null,
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
    };
  }
}

function parseImageDataUrl(dataUrl: string, fallbackMimeType: string): ParsedImageData {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  const mimeType = match?.[1]?.trim() || fallbackMimeType || 'image/png';
  const base64Value = match?.[2]?.trim() || dataUrl.trim();
  const content = Buffer.from(base64Value, 'base64');
  if (!content.byteLength) {
    throw new BadRequestError('图片生成返回了空图片内容');
  }

  return {
    mimeType,
    content,
    extension: extensionForMimeType(mimeType),
  };
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return '.jpg';
  }
  if (normalized.includes('webp')) {
    return '.webp';
  }
  if (normalized.includes('gif')) {
    return '.gif';
  }
  return '.png';
}

function buildImageFileName(detail: ArtifactDetailResponse, extension: string): string {
  const titleHash = createHash('sha256').update(detail.artifact.title).digest('hex').slice(0, 8);
  const safeExtension = extname(`image${extension}`) || '.png';
  return `${safePathSegment(detail.artifact.versionId)}-${titleHash}${safeExtension}`;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'item';
}
