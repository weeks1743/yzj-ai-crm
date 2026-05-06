import type {
  AppConfig,
  ArtifactCreateResponse,
  ArtifactDetailResponse,
  ArtifactEvidenceRef,
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

  async findLatestCompanyResearchArtifact(input: {
    eid?: string;
    appId?: string;
    companyName: string;
  }): Promise<ArtifactDetailResponse | null> {
    const companyName = input.companyName.trim();
    if (!companyName) {
      throw new BadRequestError('companyName 不能为空');
    }

    const detail = await this.options.repository.findLatestCompanyResearchArtifactByAnchor({
      eid: input.eid?.trim() || this.options.config.yzj.eid,
      appId: input.appId?.trim() || this.options.config.yzj.appId,
      companyName,
    });

    return detail?.markdown.trim() ? detail : null;
  }

  async search(input: ArtifactSearchRequest): Promise<ArtifactSearchResponse> {
    const normalized = this.normalizeSearchInput(input);
    const filter = this.options.vectorService.buildFilter(normalized);

    if (!this.options.embeddingService.isConfigured()) {
      const evidence = await this.searchMetadataFallbackEvidence(normalized);
      return {
        query: normalized.query,
        vectorStatus: 'pending_config',
        qdrantFilter: filter,
        evidence,
      };
    }

    try {
      const [vector] = await this.options.embeddingService.embedTexts([normalized.query]);
      const evidence = await this.options.vectorService.search({
        vector,
        filter,
        limit: normalized.limit ?? 5,
      });
      if (evidence.length) {
        return {
          query: normalized.query,
          vectorStatus: 'searched',
          qdrantFilter: filter,
          evidence,
        };
      }

      const fallbackEvidence = await this.searchMetadataFallbackEvidence(normalized);
      return {
        query: normalized.query,
        vectorStatus: 'searched',
        qdrantFilter: filter,
        evidence: fallbackEvidence,
      };
    } catch {
      const evidence = await this.searchMetadataFallbackEvidence(normalized);
      return {
        query: normalized.query,
        vectorStatus: 'embedding_failed',
        qdrantFilter: filter,
        evidence,
      };
    }
  }

  private async searchMetadataFallbackEvidence(
    input: Required<Pick<ArtifactSearchRequest, 'eid' | 'appId' | 'query'>> &
      Omit<ArtifactSearchRequest, 'eid' | 'appId' | 'query'>,
  ): Promise<ArtifactEvidenceRef[]> {
    const terms = buildMetadataSearchTerms(input);
    if (!terms.length) {
      return [];
    }

    const repository = this.options.repository as ArtifactRepository & {
      findCompanyResearchArtifactsByMetadata?: ArtifactRepository['findCompanyResearchArtifactsByMetadata'];
    };
    if (typeof repository.findCompanyResearchArtifactsByMetadata !== 'function') {
      return [];
    }

    const details = await repository.findCompanyResearchArtifactsByMetadata({
      eid: input.eid,
      appId: input.appId,
      terms,
      limit: input.limit ?? 5,
    });

    return details.map((detail, index) => buildFallbackEvidence(detail, index));
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

function buildMetadataSearchTerms(
  input: Required<Pick<ArtifactSearchRequest, 'eid' | 'appId' | 'query'>> &
    Omit<ArtifactSearchRequest, 'eid' | 'appId' | 'query'>,
): string[] {
  const terms = [
    ...(input.anchors ?? []).flatMap((anchor) => [anchor.id, anchor.name ?? '']),
    normalizeMetadataQueryTerm(input.query),
  ];
  const seen = new Set<string>();
  return terms
    .map((term) => term.replace(/\s+/g, '').trim())
    .filter((term) => {
      if (term.length < 2 || seen.has(term)) {
        return false;
      }
      seen.add(term);
      return true;
    });
}

function normalizeMetadataQueryTerm(query: string): string {
  return query
    .replace(/(?:只看|仅看|只用|仅用|基于|使用|从|根据|请|帮我|麻烦)/g, '')
    .replace(/(?:外部信息|系统外信息|系统外资料|公开资料|公开信息)/g, '')
    .replace(/(?:介绍|说明|讲一下|说说|了解一下|概览|概况)/g, '')
    .replace(/(?:有什么业务|有哪些业务|主营业务|业务是什么|做什么|优势是什么|竞争优势|核心优势)/g, '')
    .replace(/(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情|业务|产品|服务|优势|风险)/g, '')
    .replace(/(?:是什么|有什么|有哪些|多少|谁|吗|呢|的)/g, '')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '')
    .trim();
}

function buildFallbackEvidence(detail: ArtifactDetailResponse, index: number): ArtifactEvidenceRef {
  const anchors = detail.artifact.anchors;
  const chunks = chunkMarkdown(detail.markdown);
  const fallbackChunk = chunks.find((item) => normalizeSnippet(item.text).length >= 40)
    ?? chunks.find((item) => item.text.trim());
  const snippet = normalizeSnippet(detail.summary || fallbackChunk?.text || detail.markdown);
  return {
    artifactId: detail.artifact.artifactId,
    versionId: detail.artifact.versionId,
    title: detail.artifact.title,
    version: detail.artifact.version,
    sourceToolCode: detail.artifact.sourceToolCode,
    anchorTypes: Array.from(new Set(anchors.map((item) => item.type))),
    anchorIds: Array.from(new Set(anchors.map((item) => item.name || item.id).filter(Boolean))),
    snippet,
    heading: fallbackChunk?.heading,
    score: Math.max(0.3, 0.55 - index * 0.03),
  };
}

function normalizeSnippet(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}
