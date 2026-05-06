import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type {
  ArtifactImageStatus,
  ImageGenerationQuality,
  ImageGenerationSize,
} from './contracts.js';

interface ArtifactImageGenerationRow extends QueryResultRow {
  generation_id: string;
  eid: string;
  app_id: string;
  artifact_id: string;
  version_id: string;
  title: string;
  status: ArtifactImageStatus;
  prompt: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  model: string | null;
  provider: string | null;
  size: ImageGenerationSize | null;
  quality: ImageGenerationQuality | null;
  latency_ms: number | null;
  error_message: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactImageGenerationRecord {
  generationId: string;
  eid: string;
  appId: string;
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactImageStatus;
  prompt: string | null;
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  model: string | null;
  provider: string | null;
  size: ImageGenerationSize | null;
  quality: ImageGenerationQuality | null;
  latencyMs: number | null;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: ArtifactImageGenerationRow): ArtifactImageGenerationRecord {
  return {
    generationId: row.generation_id,
    eid: row.eid,
    appId: row.app_id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    title: row.title,
    status: row.status,
    prompt: row.prompt,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    model: row.model,
    provider: row.provider,
    size: row.size,
    quality: row.quality,
    latencyMs: row.latency_ms,
    errorMessage: row.error_message,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactImageRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async getByVersion(versionId: string): Promise<ArtifactImageGenerationRecord | null> {
    const row = await this.database.queryMaybeOne<ArtifactImageGenerationRow>(
      `
        SELECT *
        FROM ${this.database.table('artifact_image_generations')}
        WHERE version_id = $1
      `,
      [versionId],
    );

    return row ? mapRow(row) : null;
  }

  async getByGeneration(generationId: string): Promise<ArtifactImageGenerationRecord | null> {
    const row = await this.database.queryMaybeOne<ArtifactImageGenerationRow>(
      `
        SELECT *
        FROM ${this.database.table('artifact_image_generations')}
        WHERE generation_id = $1
      `,
      [generationId],
    );

    return row ? mapRow(row) : null;
  }

  async reserve(input: {
    eid: string;
    appId: string;
    artifactId: string;
    versionId: string;
    title: string;
    prompt: string;
    size: ImageGenerationSize;
    quality: ImageGenerationQuality;
  }): Promise<ArtifactImageGenerationRecord> {
    const existing = await this.getByVersion(input.versionId);
    const now = new Date().toISOString();
    const generationId = existing?.generationId ?? randomUUID();

    await this.database.query(
      `
        INSERT INTO ${this.database.table('artifact_image_generations')} (
          generation_id,
          eid,
          app_id,
          artifact_id,
          version_id,
          title,
          status,
          prompt,
          file_path,
          file_name,
          mime_type,
          byte_size,
          model,
          provider,
          size,
          quality,
          latency_ms,
          error_message,
          generated_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, NULL, NULL, NULL, NULL, NULL, NULL, $8, $9, NULL, NULL, NULL, $10, $11)
        ON CONFLICT (version_id) DO UPDATE SET
          eid = EXCLUDED.eid,
          app_id = EXCLUDED.app_id,
          artifact_id = EXCLUDED.artifact_id,
          title = EXCLUDED.title,
          status = 'queued',
          prompt = EXCLUDED.prompt,
          size = EXCLUDED.size,
          quality = EXCLUDED.quality,
          error_message = NULL,
          updated_at = EXCLUDED.updated_at
      `,
      [
        generationId,
        input.eid,
        input.appId,
        input.artifactId,
        input.versionId,
        input.title,
        input.prompt,
        input.size,
        input.quality,
        now,
        now,
      ],
    );

    return (await this.getByVersion(input.versionId))!;
  }

  async markSucceeded(input: {
    versionId: string;
    filePath: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    model: string;
    provider: string;
    size: ImageGenerationSize;
    quality: ImageGenerationQuality;
    latencyMs: number;
    generatedAt: string;
  }): Promise<ArtifactImageGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_image_generations')}
        SET status = 'succeeded',
            file_path = $1,
            file_name = $2,
            mime_type = $3,
            byte_size = $4,
            model = $5,
            provider = $6,
            size = $7,
            quality = $8,
            latency_ms = $9,
            error_message = NULL,
            generated_at = $10,
            updated_at = $11
        WHERE version_id = $12
      `,
      [
        input.filePath,
        input.fileName,
        input.mimeType,
        input.byteSize,
        input.model,
        input.provider,
        input.size,
        input.quality,
        input.latencyMs,
        input.generatedAt,
        new Date().toISOString(),
        input.versionId,
      ],
    );

    return (await this.getByVersion(input.versionId))!;
  }

  async markFailed(input: {
    versionId: string;
    errorMessage: string;
  }): Promise<ArtifactImageGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_image_generations')}
        SET status = 'failed',
            error_message = $1,
            updated_at = $2
        WHERE version_id = $3
      `,
      [input.errorMessage, new Date().toISOString(), input.versionId],
    );

    return (await this.getByVersion(input.versionId))!;
  }

  async markQueuedFailedBefore(input: {
    versionId: string;
    before: string;
    errorMessage: string;
  }): Promise<ArtifactImageGenerationRecord | null> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_image_generations')}
        SET status = 'failed',
            error_message = $1,
            updated_at = $2
        WHERE version_id = $3
          AND status = 'queued'
          AND updated_at < $4
      `,
      [input.errorMessage, new Date().toISOString(), input.versionId, input.before],
    );

    return this.getByVersion(input.versionId);
  }
}
