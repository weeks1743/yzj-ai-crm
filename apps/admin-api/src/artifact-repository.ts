import { createHash, randomUUID } from 'node:crypto';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type {
  AppConfig,
  ArtifactAnchor,
  ArtifactDetailResponse,
  ArtifactVectorStatus,
  ArtifactVersionSummary,
  CompanyResearchArtifactRequest,
} from './contracts.js';
import { NotFoundError } from './errors.js';

interface ArtifactDocument {
  _id: string;
  artifactId: string;
  eid: string;
  appId: string;
  kind: 'company_research';
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
    await this.ensureIndexes();
    const artifacts = await this.artifacts();
    const versions = await this.versions();
    const now = new Date();
    const contentHash = hashContent(input.markdown);
    const anchorIdentity = buildAnchorIdentity(input.anchors);
    const existing = await artifacts.findOne({
      eid: input.eid,
      appId: input.appId,
      kind: 'company_research',
      anchorIdentity,
    });
    const artifactId = existing?.artifactId ?? randomUUID();
    const versionId = randomUUID();
    const version = (existing?.latestVersion ?? 0) + 1;

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
      contentHash,
      createdAt: now,
    };
    await versions.insertOne(versionDoc);

    const artifactDoc: ArtifactDocument = {
      _id: artifactId,
      artifactId,
      eid: input.eid,
      appId: input.appId,
      kind: 'company_research',
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

export function buildAnchorIdentity(anchors: ArtifactAnchor[]): string {
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
    title: document.title,
    sourceToolCode: document.sourceToolCode,
    vectorStatus: document.vectorStatus,
    anchors: document.anchors,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
