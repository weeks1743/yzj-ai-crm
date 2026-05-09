import type {
  AnalysisMaterialArtifactRequest,
  AppConfig,
  ArtifactAnchor,
  ArtifactCreateResponse,
  ArtifactDetailResponse,
  ArtifactEvidenceRef,
  ArtifactSearchRequest,
  ArtifactSearchResponse,
  ArtifactVersionSummary,
  CompanyResearchArtifactRequest,
  RecordingMaterialArtifactRequest,
} from './contracts.js';
import { chunkMarkdown } from './artifact-chunker.js';
import type { DashScopeEmbeddingService } from './dashscope-embedding-service.js';
import { buildAnchorKeys, type ArtifactRepository, type SavedArtifactVersion } from './artifact-repository.js';
import type { QdrantVectorService } from './qdrant-vector-service.js';
import { BadRequestError, getErrorMessage } from './errors.js';
import { resolveAgentIsolationTenant, resolveLegacyAgentAppIds } from './tenant-isolation.js';

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

  async createRecordingMaterialArtifact(
    input: RecordingMaterialArtifactRequest,
  ): Promise<ArtifactCreateResponse> {
    const normalized = this.normalizeRecordingMaterialInput(input);
    const saved = await this.options.repository.saveRecordingMaterialArtifact(normalized);
    const artifact = await this.vectorizeSavedArtifact(saved);

    return { artifact };
  }

  async createAnalysisMaterialArtifact(
    input: AnalysisMaterialArtifactRequest,
  ): Promise<ArtifactCreateResponse> {
    const normalized = this.normalizeAnalysisMaterialInput(input);
    const saved = await this.options.repository.saveAnalysisMaterialArtifact(normalized);
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

    const tenant = resolveAgentIsolationTenant(this.options.config, { eid: input.eid });
    const detail = await this.options.repository.findLatestCompanyResearchArtifactByAnchor({
      eid: tenant.eid,
      appId: tenant.appId,
      companyName,
    });
    if (detail?.markdown.trim()) {
      return detail;
    }

    for (const legacyAppId of resolveLegacyAgentAppIds(this.options.config)) {
      const legacyDetail = await this.options.repository.findLatestCompanyResearchArtifactByAnchor({
        eid: tenant.eid,
        appId: legacyAppId,
        companyName,
      });
      if (legacyDetail?.markdown.trim()) {
        return legacyDetail;
      }
    }

    return null;
  }

  async findCompanyResearchArtifactsForVisitPrep(input: {
    eid?: string;
    appId?: string;
    customerId: string;
    customerName: string;
    companyName?: string;
    lookupTerms?: string[];
    limit?: number;
  }): Promise<ArtifactDetailResponse[]> {
    const customerId = input.customerId.trim();
    const customerName = input.customerName.trim();
    const companyName = input.companyName?.trim() || customerName;
    if (!customerId) {
      throw new BadRequestError('customerId 不能为空');
    }
    if (!customerName) {
      throw new BadRequestError('customerName 不能为空');
    }

    const repository = this.options.repository as ArtifactRepository & {
      findCompanyResearchArtifactsByMetadata?: ArtifactRepository['findCompanyResearchArtifactsByMetadata'];
    };
    if (typeof repository.findCompanyResearchArtifactsByMetadata !== 'function') {
      return [];
    }

    const tenant = resolveAgentIsolationTenant(this.options.config, { eid: input.eid });
    const { eid, appId } = tenant;
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
    const customerAnchorKey = `customer:${customerId}`;
    const lookupTerms = buildCompanyResearchVisitPrepTerms({
      customerId,
      customerName,
      companyName,
      lookupTerms: input.lookupTerms,
    });
    const anchoredCandidates = await repository.findCompanyResearchArtifactsByMetadata({
      eid,
      appId,
      terms: lookupTerms.withCustomerAnchorTerms,
      kinds: ['company_research'],
      limit,
      exactAnchorKeys: [customerAnchorKey],
      allowSameTenantAppFallback: false,
    });
    const anchored = anchoredCandidates.filter((detail) =>
      detail.artifact.anchors.some((anchor) => anchor.type === 'customer' && anchor.id === customerId),
    );
    if (anchored.length) {
      return anchored;
    }

    const sameAppFallback = await repository.findCompanyResearchArtifactsByMetadata({
      eid,
      appId,
      terms: lookupTerms.fallbackTerms,
      kinds: ['company_research'],
      limit,
      exactAnchorKeys: [customerAnchorKey],
      allowSameTenantAppFallback: false,
    });
    if (sameAppFallback.length) {
      return sameAppFallback;
    }

    for (const legacyAppId of resolveLegacyAgentAppIds(this.options.config)) {
      const legacyFallback = await repository.findCompanyResearchArtifactsByMetadata({
        eid,
        appId: legacyAppId,
        terms: lookupTerms.fallbackTerms,
        kinds: ['company_research'],
        limit,
        exactAnchorKeys: [customerAnchorKey],
        allowSameTenantAppFallback: false,
      });
      if (legacyFallback.length) {
        return legacyFallback;
      }
    }

    return [];
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

    const exactAnchorKeys = buildAnchorKeys(input.anchors ?? []);
    const details = await repository.findCompanyResearchArtifactsByMetadata({
      eid: input.eid,
      appId: input.appId,
      terms,
      kinds: input.kinds,
      limit: input.limit ?? 5,
      exactAnchorKeys,
      allowSameTenantAppFallback: shouldAllowSameTenantAppArtifactFallback(input.anchors ?? []),
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
        kind: saved.artifact.kind,
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
      ...resolveAgentIsolationTenant(this.options.config, { eid: input.eid }),
      createdBy: input.createdBy?.trim() || 'assistant-web',
      anchors: input.anchors.map((item) => ({
        ...item,
        id: item.id.trim(),
        name: item.name?.trim(),
      })),
    };
  }

  private normalizeRecordingMaterialInput(
    input: RecordingMaterialArtifactRequest,
  ): Required<Pick<RecordingMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
    Omit<RecordingMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'> {
    if (!input.recordingTaskId?.trim()) {
      throw new BadRequestError('recordingTaskId 不能为空');
    }
    if (input.sourceFile && !input.sourceFile.name?.trim()) {
      throw new BadRequestError('sourceFile.name 不能为空');
    }

    const normalized = this.normalizeCreateInput(input);
    return {
      ...input,
      ...normalized,
      recordingTaskId: input.recordingTaskId.trim(),
      providerDataId: input.providerDataId?.trim() || null,
      sourceFile: input.sourceFile
        ? {
            ...input.sourceFile,
            name: input.sourceFile.name.trim(),
            md5: input.sourceFile.md5?.trim(),
            mimeType: input.sourceFile.mimeType?.trim(),
          }
        : undefined,
    };
  }

  private normalizeAnalysisMaterialInput(
    input: AnalysisMaterialArtifactRequest,
  ): Required<Pick<AnalysisMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
    Omit<AnalysisMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'> & { recordingTaskId?: string } {
    if (!input.skillCode?.trim()) {
      throw new BadRequestError('skillCode 不能为空');
    }
    if (input.sourceFile && !input.sourceFile.name?.trim()) {
      throw new BadRequestError('sourceFile.name 不能为空');
    }

    const normalized = this.normalizeCreateInput(input);
    return {
      ...input,
      ...normalized,
      recordingTaskId: input.recordingTaskId?.trim(),
      skillCode: input.skillCode.trim(),
      sourceJobId: input.sourceJobId?.trim(),
      sourceFile: input.sourceFile
        ? {
            ...input.sourceFile,
            name: input.sourceFile.name.trim(),
            md5: input.sourceFile.md5?.trim(),
            mimeType: input.sourceFile.mimeType?.trim(),
          }
        : undefined,
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
      ...resolveAgentIsolationTenant(this.options.config, { eid: input.eid }),
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

function buildUniqueMetadataTerms(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value?.replace(/\s+/g, '').trim() ?? '')
    .filter((value) => {
      if (value.length < 2 || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function buildCompanyResearchVisitPrepTerms(input: {
  customerId: string;
  customerName: string;
  companyName: string;
  lookupTerms?: string[];
}): {
  withCustomerAnchorTerms: string[];
  fallbackTerms: string[];
} {
  const fallbackTerms = buildUniqueMetadataTerms([
    input.customerName,
    input.companyName,
    ...(input.lookupTerms ?? []),
    ...buildCompanyNameLookupVariants(input.customerName),
    ...buildCompanyNameLookupVariants(input.companyName),
    ...(input.lookupTerms ?? []).flatMap((term) => buildCompanyNameLookupVariants(term)),
  ]);
  return {
    withCustomerAnchorTerms: buildUniqueMetadataTerms([input.customerId, ...fallbackTerms]),
    fallbackTerms,
  };
}

function buildCompanyNameLookupVariants(value: string | undefined): string[] {
  const normalized = value?.replace(/\s+/g, '').trim() ?? '';
  if (!normalized) {
    return [];
  }

  const withoutStockSuffix = normalized.replace(/[（(][^)）]*(?:股票|代码|SZ|SH|BJ|\.SZ|\.SH|\.BJ)[^)）]*[)）]/gi, '');
  const withoutLegalSuffix = withoutStockSuffix
    .replace(/(?:股份有限公司|有限责任公司|集团股份有限公司|集团有限公司|有限公司|公司)$/g, '')
    .trim();
  const variants = [
    withoutStockSuffix,
    withoutLegalSuffix,
  ];
  const coreMatch = withoutLegalSuffix.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20}?(?:美|科技|化工|机械|材料|生物|医药|电气|精工|集团))/);
  if (coreMatch?.[1]) {
    variants.push(coreMatch[1]);
  }
  return variants;
}

function shouldAllowSameTenantAppArtifactFallback(anchors: ArtifactAnchor[]): boolean {
  return anchors.some((anchor) => (
    (anchor.type === 'customer' || anchor.type === 'opportunity' || anchor.type === 'followup' || anchor.type === 'company')
    && Boolean(anchor.id?.trim())
  ));
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
    kind: detail.artifact.kind,
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
