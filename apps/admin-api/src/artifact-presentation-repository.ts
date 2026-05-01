import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type {
  ArtifactPresentationStatus,
  ExternalSkillJobArtifact,
} from './contracts.js';

interface ArtifactPptGenerationRow extends QueryResultRow {
  generation_id: string;
  artifact_id: string;
  version_id: string;
  title: string;
  status: ArtifactPresentationStatus;
  job_id: string | null;
  ppt_artifact_json: ExternalSkillJobArtifact | string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactPptGenerationRecord {
  generationId: string;
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactPresentationStatus;
  jobId: string | null;
  pptArtifact: ExternalSkillJobArtifact | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

function parsePptArtifact(value: ExternalSkillJobArtifact | string | null): ExternalSkillJobArtifact | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as ExternalSkillJobArtifact;
  }

  try {
    return JSON.parse(value) as ExternalSkillJobArtifact;
  } catch {
    return null;
  }
}

function mapRow(row: ArtifactPptGenerationRow): ArtifactPptGenerationRecord {
  return {
    generationId: row.generation_id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    title: row.title,
    status: row.status,
    jobId: row.job_id,
    pptArtifact: parsePptArtifact(row.ppt_artifact_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactPresentationRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async getByVersion(versionId: string): Promise<ArtifactPptGenerationRecord | null> {
    const row = await this.database.queryMaybeOne<ArtifactPptGenerationRow>(
      `
        SELECT *
        FROM ${this.database.table('artifact_ppt_generations')}
        WHERE version_id = $1
      `,
      [versionId],
    );

    return row ? mapRow(row) : null;
  }

  async reserve(input: {
    artifactId: string;
    versionId: string;
    title: string;
  }): Promise<ArtifactPptGenerationRecord> {
    const existing = await this.getByVersion(input.versionId);
    if (existing && existing.status !== 'failed') {
      return existing;
    }

    const now = new Date().toISOString();
    const generationId = existing?.generationId ?? randomUUID();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('artifact_ppt_generations')} (
          generation_id,
          artifact_id,
          version_id,
          title,
          status,
          job_id,
          ppt_artifact_json,
          error_message,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, 'queued', NULL, NULL, NULL, $5, $6)
        ON CONFLICT (version_id) DO UPDATE SET
          title = EXCLUDED.title,
          status = 'queued',
          job_id = NULL,
          ppt_artifact_json = NULL,
          error_message = NULL,
          updated_at = EXCLUDED.updated_at
      `,
      [
        generationId,
        input.artifactId,
        input.versionId,
        input.title,
        now,
        now,
      ],
    );

    return (await this.getByVersion(input.versionId))!;
  }

  async attachJob(input: {
    versionId: string;
    jobId: string;
    status: ArtifactPresentationStatus;
  }): Promise<ArtifactPptGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_ppt_generations')}
        SET job_id = $1,
            status = $2,
            error_message = NULL,
            updated_at = $3
        WHERE version_id = $4
      `,
      [input.jobId, input.status, new Date().toISOString(), input.versionId],
    );

    return (await this.getByVersion(input.versionId))!;
  }

  async updateStatus(input: {
    versionId: string;
    status: ArtifactPresentationStatus;
    pptArtifact?: ExternalSkillJobArtifact | null;
    errorMessage?: string | null;
  }): Promise<ArtifactPptGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_ppt_generations')}
        SET status = $1,
            ppt_artifact_json = $2::jsonb,
            error_message = $3,
            updated_at = $4
        WHERE version_id = $5
      `,
      [
        input.status,
        input.pptArtifact ? JSON.stringify(input.pptArtifact) : null,
        input.errorMessage ?? null,
        new Date().toISOString(),
        input.versionId,
      ],
    );

    return (await this.getByVersion(input.versionId))!;
  }
}
