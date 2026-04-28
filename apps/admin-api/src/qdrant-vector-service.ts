import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import type {
  AppConfig,
  ArtifactAnchor,
  ArtifactAnchorType,
  ArtifactEvidenceRef,
  ArtifactSearchRequest,
} from './contracts.js';
import type { ArtifactMarkdownChunk } from './artifact-chunker.js';
import { buildAnchorKeys } from './artifact-repository.js';

interface VectorPayload {
  eid: string;
  appId: string;
  artifactId: string;
  versionId: string;
  title: string;
  version: number;
  sourceToolCode: string;
  logicalPointId: string;
  chunkIndex: number;
  heading?: string;
  text: string;
  anchorTypes: ArtifactAnchorType[];
  anchorIds: string[];
  anchorKeys: string[];
}

export class QdrantVectorService {
  private readonly client: QdrantClient;
  private collectionReady = false;

  constructor(private readonly config: AppConfig) {
    this.client = new QdrantClient({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey ?? undefined,
      checkCompatibility: false,
    });
  }

  buildFilter(input: Pick<ArtifactSearchRequest, 'eid' | 'appId' | 'anchors'>) {
    const must: unknown[] = [
      { key: 'eid', match: { value: input.eid } },
      { key: 'appId', match: { value: input.appId } },
    ];
    const anchorKeys = buildAnchorKeys(input.anchors ?? []);
    if (anchorKeys.length) {
      must.push({ key: 'anchorKeys', match: { any: anchorKeys } });
    }

    return { must };
  }

  async upsertChunks(input: {
    artifactId: string;
    versionId: string;
    version: number;
    title: string;
    sourceToolCode: string;
    eid: string;
    appId: string;
    anchors: ArtifactAnchor[];
    chunks: ArtifactMarkdownChunk[];
    embeddings: number[][];
  }): Promise<void> {
    await this.ensureCollection();
    const anchorTypes = Array.from(new Set(input.anchors.map((item) => item.type)));
    const anchorIds = Array.from(new Set(input.anchors.map((item) => item.id)));
    const anchorKeys = buildAnchorKeys(input.anchors);
    const points = input.chunks.map((chunk, index) => {
      const logicalPointId = `${input.versionId}:${chunk.chunkIndex}`;
      return {
        id: toQdrantUuid(logicalPointId),
        vector: input.embeddings[index],
        payload: {
        eid: input.eid,
        appId: input.appId,
        artifactId: input.artifactId,
        versionId: input.versionId,
        title: input.title,
        version: input.version,
        sourceToolCode: input.sourceToolCode,
        logicalPointId,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        text: chunk.text,
        anchorTypes,
        anchorIds,
        anchorKeys,
        } satisfies VectorPayload,
      };
    });

    await this.client.upsert(this.config.qdrant.collectionName, {
      wait: true,
      points: points as any[],
    });
  }

  async search(input: {
    vector: number[];
    filter: unknown;
    limit: number;
  }): Promise<ArtifactEvidenceRef[]> {
    await this.ensureCollection();
    const results = await this.client.search(this.config.qdrant.collectionName, {
      vector: input.vector,
      filter: input.filter as any,
      limit: input.limit,
      with_payload: true,
    });

    return results.map((item) => {
      const payload = (item.payload ?? {}) as Partial<VectorPayload>;
      return {
        artifactId: String(payload.artifactId ?? ''),
        versionId: String(payload.versionId ?? ''),
        title: String(payload.title ?? '未命名 Artifact'),
        version: Number(payload.version ?? 1),
        sourceToolCode: String(payload.sourceToolCode ?? ''),
        anchorTypes: (payload.anchorTypes ?? []) as ArtifactAnchorType[],
        anchorIds: (payload.anchorIds ?? []).map(String),
        snippet: String(payload.text ?? '').slice(0, 360),
        heading: payload.heading,
        score: Number(item.score ?? 0),
      };
    });
  }

  private async ensureCollection(): Promise<void> {
    if (this.collectionReady) {
      return;
    }

    try {
      await this.client.getCollection(this.config.qdrant.collectionName);
    } catch {
      await this.client.createCollection(this.config.qdrant.collectionName, {
        vectors: {
          size: this.config.embedding.dimensions,
          distance: 'Cosine',
        },
      });
    }

    this.collectionReady = true;
  }
}

function toQdrantUuid(logicalPointId: string): string {
  const hex = createHash('sha256').update(logicalPointId).digest('hex');
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
