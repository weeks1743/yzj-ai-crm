import type {
  AppConfig,
  ArtifactCreateResponse,
  ArtifactDetailResponse,
  ArtifactSearchRequest,
  ArtifactSearchResponse,
  ArtifactVersionSummary,
  CompanyResearchArtifactRequest,
} from './contracts.js';
import { chunkMarkdown } from './artifact-chunker.js';
import type { DashScopeEmbeddingService } from './dashscope-embedding-service.js';
import type { ArtifactRepository, SavedArtifactVersion } from './artifact-repository.js';
import type { QdrantVectorService } from './qdrant-vector-service.js';
import { BadRequestError, getErrorMessage } from './errors.js';

export class ArtifactService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: ArtifactRepository;
      embeddingService: DashScopeEmbeddingService;
      vectorService: QdrantVectorService;
    },
  ) {}

  async createCompanyResearchArtifact(
    input: CompanyResearchArtifactRequest,
  ): Promise<ArtifactCreateResponse> {
    const normalized = this.normalizeCreateInput(input);
    const saved = await this.options.repository.saveCompanyResearchArtifact(normalized);
    const artifact = await this.vectorizeSavedArtifact(saved);

    return { artifact };
  }

  async getArtifact(artifactId: string): Promise<ArtifactDetailResponse> {
    if (!artifactId.trim()) {
      throw new BadRequestError('artifactId 不能为空');
    }

    return this.options.repository.getArtifact(artifactId);
  }

  async search(input: ArtifactSearchRequest): Promise<ArtifactSearchResponse> {
    const normalized = this.normalizeSearchInput(input);
    const filter = this.options.vectorService.buildFilter(normalized);

    if (!this.options.embeddingService.isConfigured()) {
      return {
        query: normalized.query,
        vectorStatus: 'pending_config',
        qdrantFilter: filter,
        evidence: [],
      };
    }

    try {
      const [vector] = await this.options.embeddingService.embedTexts([normalized.query]);
      const evidence = await this.options.vectorService.search({
        vector,
        filter,
        limit: normalized.limit ?? 5,
      });
      return {
        query: normalized.query,
        vectorStatus: 'searched',
        qdrantFilter: filter,
        evidence,
      };
    } catch {
      return {
        query: normalized.query,
        vectorStatus: 'embedding_failed',
        qdrantFilter: filter,
        evidence: [],
      };
    }
  }

  private async vectorizeSavedArtifact(saved: SavedArtifactVersion): Promise<ArtifactVersionSummary> {
    const chunks = chunkMarkdown(saved.markdown);

    if (!this.options.embeddingService.isConfigured()) {
      return this.options.repository.updateVectorStatus(
        saved.artifact.artifactId,
        saved.artifact.versionId,
        'pending_config',
        chunks.length,
      );
    }

    try {
      const embeddings = await this.options.embeddingService.embedTexts(
        chunks.map((item) => item.text),
      );
      await this.options.vectorService.upsertChunks({
        artifactId: saved.artifact.artifactId,
        versionId: saved.artifact.versionId,
        version: saved.artifact.version,
        title: saved.artifact.title,
        sourceToolCode: saved.artifact.sourceToolCode,
        eid: saved.eid,
        appId: saved.appId,
        anchors: saved.artifact.anchors,
        chunks,
        embeddings,
      });

      return this.options.repository.updateVectorStatus(
        saved.artifact.artifactId,
        saved.artifact.versionId,
        'indexed',
        chunks.length,
      );
    } catch (error) {
      console.warn(`[artifact] embedding failed: ${getErrorMessage(error)}`);
      return this.options.repository.updateVectorStatus(
        saved.artifact.artifactId,
        saved.artifact.versionId,
        'embedding_failed',
        chunks.length,
      );
    }
  }

  private normalizeCreateInput(
    input: CompanyResearchArtifactRequest,
  ): Required<Pick<CompanyResearchArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
    Omit<CompanyResearchArtifactRequest, 'eid' | 'appId' | 'createdBy'> {
    if (!input.title?.trim()) {
      throw new BadRequestError('Artifact 标题不能为空');
    }
    if (!input.markdown?.trim()) {
      throw new BadRequestError('Artifact Markdown 不能为空');
    }
    if (!input.sourceToolCode?.trim()) {
      throw new BadRequestError('sourceToolCode 不能为空');
    }
    if (!Array.isArray(input.anchors) || !input.anchors.length) {
      throw new BadRequestError('至少需要一个 Artifact 锚点');
    }

    return {
      ...input,
      title: input.title.trim(),
      markdown: input.markdown.trim(),
      sourceToolCode: input.sourceToolCode.trim(),
      eid: input.eid?.trim() || this.options.config.yzj.eid,
      appId: input.appId?.trim() || this.options.config.yzj.appId,
      createdBy: input.createdBy?.trim() || 'assistant-web',
      anchors: input.anchors.map((item) => ({
        ...item,
        id: item.id.trim(),
        name: item.name?.trim(),
      })),
    };
  }

  private normalizeSearchInput(
    input: ArtifactSearchRequest,
  ): Required<Pick<ArtifactSearchRequest, 'eid' | 'appId' | 'query'>> &
    Omit<ArtifactSearchRequest, 'eid' | 'appId' | 'query'> {
    if (!input.query?.trim()) {
      throw new BadRequestError('检索 query 不能为空');
    }

    return {
      ...input,
      query: input.query.trim(),
      eid: input.eid?.trim() || this.options.config.yzj.eid,
      appId: input.appId?.trim() || this.options.config.yzj.appId,
      limit: Math.min(Math.max(input.limit ?? 5, 1), 10),
    };
  }
}
