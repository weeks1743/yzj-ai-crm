import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type {
  AppConfig,
  ArtifactImageGenerationRequest,
  ArtifactDetailResponse,
  ArtifactImageResponse,
  ArtifactImageStatus,
  ImageGenerationResponse,
  ImageGenerationQuality,
  ImageGenerationSize,
} from './contracts.js';
import type {
  ArtifactImageGenerationRecord,
  ArtifactImageRepository,
} from './artifact-image-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import { BadRequestError, NotFoundError, getErrorMessage } from './errors.js';
import { resolveAgentIsolationTenant } from './tenant-isolation.js';

const IMAGE_STALE_QUEUE_BUFFER_MS = 30_000;
const IMAGE_PROMPT_MARKDOWN_MAX_CHARS = 3_800;
const ARTIFACT_IMAGE_DIR = '.local/artifact-images';
const MISSING_IMAGE_FILE_MESSAGE = '图片文件不存在，请重新生成图片';
export interface ArtifactImageFile {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface MarkdownImageGenerationResponse extends ImageGenerationResponse {
  title: string;
  fileName: string;
  byteSize: number;
  downloadDataUrl: string;
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
    const record = await this.resolveMissingSucceededFile(
      await this.resolveStaleQueuedRecord(
        await this.options.repository.getByVersion(detail.artifact.versionId),
      ),
    );
    return this.toResponse(detail, record, record?.status ?? 'not_started');
  }

  async generateImage(
    artifactId: string,
    input: ArtifactImageGenerationRequest,
  ): Promise<ArtifactImageResponse> {
    const detail = await this.options.artifactService.getArtifact(artifactId);
    const prompt = buildCompanyResearchImagePrompt(detail);
    const size = (input.size ?? 'auto') as ImageGenerationSize;
    const quality = (input.quality ?? 'auto') as ImageGenerationQuality;
    await this.options.repository.reserve({
      ...resolveAgentIsolationTenant(this.options.config),
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

  async generateMarkdownImage(input: {
    title?: string;
    markdown?: string;
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
  }): Promise<MarkdownImageGenerationResponse> {
    const title = input.title?.trim() || 'Markdown 配图';
    const markdown = normalizePromptMarkdown(input.markdown ?? '');
    if (!markdown) {
      throw new BadRequestError('Markdown 内容为空，无法生成图片');
    }

    const size = (input.size ?? 'auto') as ImageGenerationSize;
    const quality = (input.quality ?? 'auto') as ImageGenerationQuality;
    const prompt = buildMarkdownImagePrompt({ title, markdown });
    const generated = await this.options.externalSkillService.generateImage({
      prompt,
      size,
      quality,
    });
    const parsed = parseImageDataUrl(generated.previewDataUrl, generated.mimeType);
    return {
      ...generated,
      title,
      fileName: buildMarkdownImageFileName(title, parsed.extension),
      byteSize: parsed.content.byteLength,
      downloadDataUrl: generated.previewDataUrl,
    };
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

    try {
      return {
        fileName: record.fileName,
        mimeType: record.mimeType,
        content: await readFile(record.filePath),
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        await this.options.repository.markFailed({
          versionId: record.versionId,
          errorMessage: MISSING_IMAGE_FILE_MESSAGE,
        });
        throw new NotFoundError(MISSING_IMAGE_FILE_MESSAGE);
      }
      throw error;
    }
  }

  private async writeImageFile(
    detail: ArtifactDetailResponse,
    fileName: string,
    content: Buffer,
  ): Promise<string> {
    const rootDir = dirname(this.options.config.meta.envFilePath);
    const outputDir = resolve(
      rootDir,
      ARTIFACT_IMAGE_DIR,
      safePathSegment(this.options.config.yzj.eid),
      safePathSegment(detail.artifact.artifactId),
    );
    await mkdir(outputDir, { recursive: true });

    const filePath = join(outputDir, fileName);
    await writeFile(filePath, content);
    return filePath;
  }

  private async resolveMissingSucceededFile(
    record: ArtifactImageGenerationRecord | null,
  ): Promise<ArtifactImageGenerationRecord | null> {
    if (!record || record.status !== 'succeeded' || !record.filePath) {
      return record;
    }

    try {
      const fileStats = await stat(record.filePath);
      if (fileStats.isFile()) {
        return record;
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    return this.options.repository.markFailed({
      versionId: record.versionId,
      errorMessage: MISSING_IMAGE_FILE_MESSAGE,
    });
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
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

function buildCompanyResearchImagePrompt(detail: ArtifactDetailResponse): string {
  const company = detail.artifact.anchors.find((item) => item.type === 'company')?.name?.trim()
    || detail.artifact.anchors.find((item) => item.type === 'company')?.id?.trim()
    || detail.artifact.title.replace(/\s*公司研究\s*$/, '').trim()
    || detail.artifact.title;
  const markdown = normalizePromptMarkdown(detail.markdown);
  if (!markdown) {
    throw new BadRequestError('Markdown 资料为空，无法生成图片');
  }

  return [
    '请基于下面 Markdown 正文生成一张适合销售汇报或客户洞察页使用的商务配图。',
    `公司：${company}`,
    `资料标题：${detail.artifact.title}`,
    '',
    '资料原文（已去除元信息和来源引用，控制在3800字以内）：',
    markdown,
    '',
    '画面要求：专业、清晰、偏真实商务视觉，优先覆盖资料中的客户画像、行业洞察、业务定位、成长驱动、核心风险和销售推进信息；可以用信息分区、图标、标题和标签组织重点；避免底部脚注、警示横幅、来源链接、引用表或技术界面截图。',
  ].join('\n');
}

function buildMarkdownImagePrompt(input: { title: string; markdown: string }): string {
  return [
    '请基于下面 Markdown 正文生成一张适合销售汇报或客户拜访准备页使用的商务配图。',
    `资料标题：${input.title}`,
    '',
    '资料原文（已去除元信息、来源引用和内部提醒，控制在3800字以内）：',
    input.markdown,
    '',
    '画面要求：专业、清晰、偏真实商务视觉，优先覆盖正文中的客户画像、行业洞察、业务痛点、方案匹配、推进建议和关键风险；可以用信息分区、图标、标题和标签组织重点；只呈现业务事实、拜访策略和方案重点，避免底部脚注、警示横幅、来源链接、引用表或技术界面截图。',
  ].join('\n');
}

function normalizePromptMarkdown(markdown: string): string {
  return truncatePromptMarkdown(
    removePromptNoiseLines(
      removePromptNoiseSections(
        removeSourceReferenceSections(
          removeOpeningMetadata(markdown.trim()),
        ),
      ),
    ),
  );
}

function removeOpeningMetadata(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim().startsWith('# ')) {
    lines.shift();
  }
  while (lines[0]?.trim() === '') {
    lines.shift();
  }

  const metadataLines: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed || trimmed.startsWith('>')) {
      metadataLines.push(trimmed);
      index += 1;
      continue;
    }
    break;
  }

  if (metadataLines.some((line) => /研究日期|数据截至|研究目的/.test(line))) {
    lines.splice(0, index);
    while (/^\s*$|^\s*-{3,}\s*$/.test(lines[0] ?? '')) {
      lines.shift();
    }
  }

  return lines.join('\n').trim();
}

function removeSourceReferenceSections(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let skippingLevel: number | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s*(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (skippingLevel !== null && level <= skippingLevel) {
        skippingLevel = null;
      }
      if (isSourceReferenceHeading(heading[2])) {
        skippingLevel = level;
        continue;
      }
    }

    if (skippingLevel === null) {
      kept.push(line);
    }
  }

  return kept.join('\n').trim();
}

function isSourceReferenceHeading(title: string): boolean {
  const normalized = title
    .replace(/^[一二三四五六七八九十百\d]+[、.．]?\s*/, '')
    .trim();
  return /^(来源引用|引用来源|数据来源|信息来源|参考来源|参考资料)$/.test(normalized);
}

function removePromptNoiseSections(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let skippingLevel: number | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s*(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (skippingLevel !== null && level <= skippingLevel) {
        skippingLevel = null;
      }
      if (isPromptNoiseHeading(heading[2])) {
        skippingLevel = level;
        continue;
      }
    }

    if (skippingLevel === null) {
      kept.push(line);
    }
  }

  return kept.join('\n').trim();
}

function isPromptNoiseHeading(title: string): boolean {
  const normalized = title
    .replace(/^[一二三四五六七八九十百\d]+[、.．]?\s*/, '')
    .replace(/[⚠️!！]/g, '')
    .trim();
  return /^(待(?:销售|客户)?确认(?:事项|问题)?|需(?:销售|客户)?确认(?:事项|问题)?|待核实(?:事项|问题)?|需核实(?:事项|问题)?|内部提醒|使用说明|说明|注意事项)$/.test(normalized);
}

function removePromptNoiseLines(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^[-*]?\s*(?:\*{0,2})?来源[:：]/.test(trimmed)
        && !/仅供参考|不构成投资建议/.test(trimmed)
        && !/本报告基于.*(?:公开研究资料|产品能力库|公开信息)/.test(trimmed)
        && !/待(?:销售|客户)?确认|待核实|需核实|核实确认/.test(trimmed)
        && !/拜访前\/拜访中请务必与客户核实确认/.test(trimmed)
        && !/^>?\s*[⚠️!！]?\s*(?:说明|注意|提示)[:：].*(?:待确认|核实确认|错误假设)/.test(trimmed);
    })
    .join('\n')
    .replace(/「?⚠️?\s*待(?:销售)?确认」?/g, '')
    .replace(/【?⚠️?\s*待(?:销售)?确认】?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncatePromptMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= IMAGE_PROMPT_MARKDOWN_MAX_CHARS) {
    return trimmed;
  }

  const sliced = chars.slice(0, IMAGE_PROMPT_MARKDOWN_MAX_CHARS).join('');
  const paragraphBoundary = sliced.lastIndexOf('\n\n');
  if (paragraphBoundary > IMAGE_PROMPT_MARKDOWN_MAX_CHARS * 0.8) {
    return sliced.slice(0, paragraphBoundary).trim();
  }

  const lineBoundary = sliced.lastIndexOf('\n');
  if (lineBoundary > IMAGE_PROMPT_MARKDOWN_MAX_CHARS * 0.9) {
    return sliced.slice(0, lineBoundary).trim();
  }

  return sliced.trim();
}

function buildMarkdownImageFileName(title: string, extension: string): string {
  const titleHash = createHash('sha256').update(title).digest('hex').slice(0, 8);
  const safeExtension = extname(`image${extension}`) || '.png';
  return `${safePathSegment(title)}-${titleHash}${safeExtension}`;
}
