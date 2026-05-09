import { createHash, randomUUID } from 'node:crypto';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type {
  AnalysisMaterialArtifactRequest,
  AppConfig,
  ArtifactAnchor,
  ArtifactKind,
  ArtifactDetailResponse,
  ArtifactVectorStatus,
  ArtifactVersionSummary,
  CompanyResearchArtifactRequest,
  RecordingMaterialArtifactRequest,
} from './contracts.js';
import { NotFoundError } from './errors.js';

interface ArtifactDocument {
  _id: string;
  artifactId: string;
  eid: string;
  appId: string;
  kind: ArtifactKind;
  title: string;
  sourceToolCode: string;
  anchors: ArtifactAnchor[];
  anchorIdentity: string;
  currentVersionId: string;
  latestVersion: number;
  vectorStatus: ArtifactVectorStatus;
  chunkCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  contentHash: string;
}

interface ArtifactVersionDocument {
  _id: string;
  versionId: string;
  artifactId: string;
  eid: string;
  appId: string;
  version: number;
  title: string;
  markdown: string;
  summary?: string;
  sourceRefs?: CompanyResearchArtifactRequest['sourceRefs'];
  metadata?: Record<string, unknown>;
  contentHash: string;
  createdAt: Date;
}

export interface SavedArtifactVersion {
  artifact: ArtifactVersionSummary;
  markdown: string;
  summary?: string;
  eid: string;
  appId: string;
}

export interface CompanyResearchArtifactLookupInput {
  eid: string;
  appId: string;
  companyName: string;
}

export interface CompanyResearchArtifactMetadataSearchInput {
  eid: string;
  appId: string;
  terms: string[];
  limit: number;
  kinds?: ArtifactKind[];
  exactAnchorKeys?: string[];
  allowSameTenantAppFallback?: boolean;
}

type ArtifactCreateInput =
  Required<Pick<CompanyResearchArtifactRequest, 'eid' | 'appId' | 'createdBy'>> & {
    title: string;
    markdown: string;
    sourceToolCode: string;
    anchors: ArtifactAnchor[];
    summary?: string;
    sourceRefs?: CompanyResearchArtifactRequest['sourceRefs'];
    kind: ArtifactKind;
    metadata?: Record<string, unknown>;
    versionPolicy?: 'append' | 'replace_current';
  };

export class ArtifactRepository {
  private readonly client: MongoClient;
  private db: Db | null = null;
  private indexesReady = false;

  constructor(private readonly config: AppConfig) {
    this.client = new MongoClient(config.storage.mongodbUri);
  }

  async saveCompanyResearchArtifact(
    input: Required<Pick<CompanyResearchArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
      Omit<CompanyResearchArtifactRequest, 'eid' | 'appId' | 'createdBy'>,
  ): Promise<SavedArtifactVersion> {
    return this.saveArtifact({ ...input, kind: 'company_research' });
  }

  async saveRecordingMaterialArtifact(
    input: Required<Pick<RecordingMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
      Omit<RecordingMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'>,
  ): Promise<SavedArtifactVersion> {
    return this.saveArtifact({
      ...input,
      kind: 'recording_material',
      metadata: {
        recordingTaskId: input.recordingTaskId,
        providerDataId: input.providerDataId ?? null,
        sourceFile: input.sourceFile ?? null,
      },
    });
  }

  async saveAnalysisMaterialArtifact(
    input: Required<Pick<AnalysisMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'>> &
      Omit<AnalysisMaterialArtifactRequest, 'eid' | 'appId' | 'createdBy'> & { recordingTaskId?: string },
  ): Promise<SavedArtifactVersion> {
    return this.saveArtifact({
      ...input,
      kind: 'analysis_material',
      versionPolicy: 'replace_current',
      metadata: {
        recordingTaskId: input.recordingTaskId ?? null,
        skillCode: input.skillCode,
        sourceJobId: input.sourceJobId ?? null,
        sourceFile: input.sourceFile ?? null,
      },
    });
  }

  async saveArtifact(input: ArtifactCreateInput): Promise<SavedArtifactVersion> {
    await this.ensureIndexes();
    const artifacts = await this.artifacts();
    const versions = await this.versions();
    const now = new Date();
    const contentHash = hashContent(input.markdown);
    const anchorIdentity = buildAnchorIdentity(input.anchors, {
      kind: input.kind,
      sourceToolCode: input.sourceToolCode,
      metadata: input.metadata,
    });
    const existing = await artifacts.findOne({
      eid: input.eid,
      appId: input.appId,
      kind: input.kind,
      anchorIdentity,
    });
    const artifactId = existing?.artifactId ?? randomUUID();
    const replaceCurrent = input.versionPolicy === 'replace_current' && existing !== null;
    const versionId = replaceCurrent ? existing.currentVersionId : randomUUID();
    const version = replaceCurrent ? existing.latestVersion : (existing?.latestVersion ?? 0) + 1;

    const versionDoc: ArtifactVersionDocument = {
      _id: versionId,
      versionId,
      artifactId,
      eid: input.eid,
      appId: input.appId,
      version,
      title: input.title,
      markdown: input.markdown,
      summary: input.summary,
      sourceRefs: input.sourceRefs,
      metadata: input.metadata,
      contentHash,
      createdAt: now,
    };
    if (replaceCurrent) {
      const existingVersion = await versions.findOne({ artifactId, versionId });
      if (existingVersion) {
        await versions.updateOne(
          { artifactId, versionId },
          {
            $set: {
              title: versionDoc.title,
              markdown: versionDoc.markdown,
              summary: versionDoc.summary,
              sourceRefs: versionDoc.sourceRefs,
              metadata: versionDoc.metadata,
              contentHash: versionDoc.contentHash,
              createdAt: versionDoc.createdAt,
            },
          },
        );
      } else {
        await versions.insertOne(versionDoc);
      }
    } else {
      await versions.insertOne(versionDoc);
    }

    const artifactDoc: ArtifactDocument = {
      _id: artifactId,
      artifactId,
      eid: input.eid,
      appId: input.appId,
      kind: input.kind,
      title: input.title,
      sourceToolCode: input.sourceToolCode,
      anchors: input.anchors,
      anchorIdentity,
      currentVersionId: versionId,
      latestVersion: version,
      vectorStatus: 'pending_embedding',
      chunkCount: 0,
      createdBy: input.createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      contentHash,
    };

    if (existing) {
      await artifacts.updateOne(
        { artifactId },
        {
          $set: {
            title: artifactDoc.title,
            sourceToolCode: artifactDoc.sourceToolCode,
            anchors: artifactDoc.anchors,
            currentVersionId: artifactDoc.currentVersionId,
            latestVersion: artifactDoc.latestVersion,
            vectorStatus: artifactDoc.vectorStatus,
            chunkCount: artifactDoc.chunkCount,
            updatedAt: artifactDoc.updatedAt,
            contentHash: artifactDoc.contentHash,
          },
        },
      );
    } else {
      await artifacts.insertOne(artifactDoc);
    }

    return {
      artifact: toSummary(artifactDoc),
      markdown: input.markdown,
      summary: input.summary,
      eid: input.eid,
      appId: input.appId,
    };
  }

  async updateVectorStatus(
    artifactId: string,
    versionId: string,
    vectorStatus: ArtifactVectorStatus,
    chunkCount: number,
  ): Promise<ArtifactVersionSummary> {
    const artifacts = await this.artifacts();
    const now = new Date();
    const artifact = await artifacts.findOneAndUpdate(
      { artifactId, currentVersionId: versionId },
      {
        $set: {
          vectorStatus,
          chunkCount,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );

    if (!artifact) {
      throw new NotFoundError('Artifact 不存在或版本已变化');
    }

    return toSummary(artifact);
  }

  async findLatestCompanyResearchArtifactByAnchor(
    input: CompanyResearchArtifactLookupInput,
  ): Promise<ArtifactDetailResponse | null> {
    await this.ensureIndexes();
    const artifacts = await this.artifacts();
    const versions = await this.versions();
    const anchorIdentity = buildAnchorIdentity([
      { type: 'company', id: input.companyName, role: 'primary' },
    ]);
    const artifact = await artifacts.findOne({
      eid: input.eid,
      appId: input.appId,
      kind: 'company_research',
      anchorIdentity,
    });
    if (!artifact) {
      return null;
    }

    const version = await versions.findOne({
      artifactId: artifact.artifactId,
      versionId: artifact.currentVersionId,
    });
    if (!version?.markdown?.trim()) {
      return null;
    }

    return {
      artifact: toSummary(artifact),
      markdown: version.markdown,
      summary: version.summary,
      metadata: version.metadata,
    };
  }

  async findCompanyResearchArtifactsByMetadata(
    input: CompanyResearchArtifactMetadataSearchInput,
  ): Promise<ArtifactDetailResponse[]> {
    await this.ensureIndexes();
    const terms = normalizeMetadataTerms(input.terms);
    if (!terms.length) {
      return [];
    }

    const artifacts = await this.artifacts();
    const versions = await this.versions();
    const regexClauses = terms.flatMap((term) => {
      const pattern = new RegExp(escapeRegExp(term), 'i');
      return [
        { title: pattern },
        { anchorIdentity: pattern },
        { 'anchors.id': pattern },
        { 'anchors.name': pattern },
      ];
    });
    const kinds: ArtifactKind[] = input.kinds?.length
      ? input.kinds
      : ['company_research', 'recording_material', 'analysis_material'];
    const kindFilter = { $in: kinds };
    const limit = Math.min(Math.max(input.limit, 1), 10);
    let artifactDocs = await artifacts.find({
      eid: input.eid,
      appId: input.appId,
      kind: kindFilter,
      $or: regexClauses,
    }).sort({ updatedAt: -1 }).limit(limit).toArray();

    if (!artifactDocs.length && input.allowSameTenantAppFallback) {
      const anchorClauses = buildExactAnchorClauses(input.exactAnchorKeys ?? []);
      if (anchorClauses.length) {
        artifactDocs = await artifacts.find({
          eid: input.eid,
          appId: { $ne: input.appId },
          kind: kindFilter,
          $or: regexClauses,
          $and: [{ $or: anchorClauses }],
        }).sort({ updatedAt: -1 }).limit(limit).toArray();
      }
    }
    if (!artifactDocs.length) {
      return [];
    }

    const versionDocs = await versions.find({
      versionId: { $in: artifactDocs.map((item) => item.currentVersionId) },
    }).toArray();
    const versionsById = new Map(versionDocs.map((item) => [item.versionId, item]));

    const details: ArtifactDetailResponse[] = [];
    for (const artifact of artifactDocs) {
      const version = versionsById.get(artifact.currentVersionId);
      if (!version?.markdown?.trim()) {
        continue;
      }
      details.push({
        artifact: toSummary(artifact),
        markdown: version.markdown,
        summary: version.summary,
        metadata: version.metadata,
      });
    }
    return details;
  }

  async getArtifact(artifactId: string): Promise<ArtifactDetailResponse> {
    const artifacts = await this.artifacts();
    const versions = await this.versions();
    const artifact = await artifacts.findOne({ artifactId });
    if (!artifact) {
      throw new NotFoundError('Artifact 不存在');
    }

    const version = await versions.findOne({
      artifactId,
      versionId: artifact.currentVersionId,
    });
    if (!version) {
      throw new NotFoundError('Artifact 版本不存在');
    }

    return {
      artifact: toSummary(artifact),
      markdown: version.markdown,
      summary: version.summary,
      metadata: version.metadata,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
    this.db = null;
    this.indexesReady = false;
  }

  private async artifacts(): Promise<Collection<ArtifactDocument>> {
    const db = await this.database();
    return db.collection<ArtifactDocument>('artifacts');
  }

  private async versions(): Promise<Collection<ArtifactVersionDocument>> {
    const db = await this.database();
    return db.collection<ArtifactVersionDocument>('artifact_versions');
  }

  private async database(): Promise<Db> {
    if (!this.db) {
      await this.client.connect();
      this.db = this.client.db(this.config.storage.mongodbDb);
    }

    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexesReady) {
      return;
    }

    const artifacts = await this.artifacts();
    const versions = await this.versions();
    await Promise.all([
      artifacts.createIndex(
        { eid: 1, appId: 1, kind: 1, anchorIdentity: 1 },
        { unique: true, name: 'artifact_identity_unique' },
      ),
      artifacts.createIndex({ eid: 1, appId: 1, updatedAt: -1 }, { name: 'artifact_tenant_recent' }),
      versions.createIndex({ artifactId: 1, version: -1 }, { name: 'artifact_versions_recent' }),
      versions.createIndex({ versionId: 1 }, { unique: true, name: 'artifact_version_unique' }),
    ]);
    this.indexesReady = true;
  }
}

function normalizeMetadataTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const normalizedTerms: string[] = [];
  for (const term of terms) {
    const normalized = term.replace(/\s+/g, '').trim();
    if (normalized.length < 2 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedTerms.push(normalized);
  }
  return normalizedTerms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildExactAnchorClauses(anchorKeys: string[]): Array<{ anchors: { $elemMatch: { type: string; id: string } } }> {
  const clauses: Array<{ anchors: { $elemMatch: { type: string; id: string } } }> = [];
  const seen = new Set<string>();
  for (const key of anchorKeys) {
    const separatorIndex = key.indexOf(':');
    const type = key.slice(0, separatorIndex).trim();
    const id = key.slice(separatorIndex + 1).trim();
    if (separatorIndex <= 0 || !type || !id || seen.has(`${type}:${id}`)) {
      continue;
    }
    seen.add(`${type}:${id}`);
    clauses.push({ anchors: { $elemMatch: { type, id } } });
  }
  return clauses;
}

export function buildAnchorIdentity(
  anchors: ArtifactAnchor[],
  options?: {
    kind?: ArtifactKind;
    sourceToolCode?: string;
    metadata?: Record<string, unknown>;
  },
): string {
  if (options?.kind === 'analysis_material') {
    const followup = anchors.find((item) => item.type === 'followup' && item.id);
    const primary = anchors.find((item) => item.role === 'primary') ?? anchors[0];
    const skillCode = String(options.metadata?.skillCode || options.sourceToolCode || '').trim();
    if (followup && skillCode) {
      return `analysis_material:followup:${followup.id}:skill:${skillCode}`;
    }
    if (primary && skillCode) {
      return `analysis_material:${primary.type}:${primary.id}:skill:${skillCode}`;
    }
  }

  if (options?.kind === 'recording_material') {
    const followup = anchors.find((item) => item.type === 'followup' && item.id);
    const sourceFile = anchors.find((item) => item.type === 'source_file' && item.id);
    if (followup && sourceFile) {
      return `recording_material:followup:${followup.id}:source_file:${sourceFile.id}`;
    }
  }

  const primary =
    anchors.find((item) => item.role === 'primary') ??
    anchors.find((item) => item.type === 'company') ??
    anchors.find((item) => item.type === 'customer') ??
    anchors[0];

  if (!primary) {
    return 'unbound';
  }

  return `${primary.type}:${primary.id}`;
}

export function buildAnchorKeys(anchors: ArtifactAnchor[]): string[] {
  return anchors
    .filter((item) => item.type && item.id)
    .map((item) => `${item.type}:${item.id}`);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function toSummary(document: ArtifactDocument): ArtifactVersionSummary {
  return {
    artifactId: document.artifactId,
    versionId: document.currentVersionId,
    version: document.latestVersion,
    kind: document.kind,
    title: document.title,
    sourceToolCode: document.sourceToolCode,
    vectorStatus: document.vectorStatus,
    anchors: document.anchors,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
