import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type { ArtifactReportStatus } from './contracts.js';

interface ArtifactReportGenerationRow extends QueryResultRow {
  generation_id: string;
  artifact_id: string;
  version_id: string;
  title: string;
  status: ArtifactReportStatus;
  job_id: string | null;
  report_session_id: string | null;
  open_url: string | null;
  code_artifact_id: string | null;
  metadata_artifact_id: string | null;
  metadata_json: Record<string, unknown> | string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactReportGenerationRecord {
  generationId: string;
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactReportStatus;
  jobId: string | null;
  reportSessionId: string | null;
  openUrl: string | null;
  codeArtifactId: string | null;
  metadataArtifactId: string | null;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseMetadata(value: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function mapRow(row: ArtifactReportGenerationRow): ArtifactReportGenerationRecord {
  return {
    generationId: row.generation_id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    title: row.title,
    status: row.status,
    jobId: row.job_id,
    reportSessionId: row.report_session_id,
    openUrl: row.open_url,
    codeArtifactId: row.code_artifact_id,
    metadataArtifactId: row.metadata_artifact_id,
    metadata: parseMetadata(row.metadata_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactReportRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async getByVersion(versionId: string): Promise<ArtifactReportGenerationRecord | null> {
    const row = await this.database.queryMaybeOne<ArtifactReportGenerationRow>(
      `
        SELECT *
        FROM ${this.database.table('artifact_report_generations')}
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
  }): Promise<ArtifactReportGenerationRecord> {
    const existing = await this.getByVersion(input.versionId);
    if (existing && existing.status !== 'failed') {
      return existing;
    }

    const now = new Date().toISOString();
    const generationId = existing?.generationId ?? randomUUID();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('artifact_report_generations')} (
          generation_id,
          artifact_id,
          version_id,
          title,
          status,
          job_id,
          report_session_id,
          open_url,
          code_artifact_id,
          metadata_artifact_id,
          metadata_json,
          error_message,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, 'queued', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $5, $6)
        ON CONFLICT (version_id) DO UPDATE SET
          title = EXCLUDED.title,
          status = 'queued',
          job_id = NULL,
          report_session_id = NULL,
          open_url = NULL,
          code_artifact_id = NULL,
          metadata_artifact_id = NULL,
          metadata_json = NULL,
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
    status: ArtifactReportStatus;
  }): Promise<ArtifactReportGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_report_generations')}
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
    status: ArtifactReportStatus;
    reportSessionId?: string | null;
    openUrl?: string | null;
    codeArtifactId?: string | null;
    metadataArtifactId?: string | null;
    metadata?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }): Promise<ArtifactReportGenerationRecord> {
    await this.database.query(
      `
        UPDATE ${this.database.table('artifact_report_generations')}
        SET status = $1,
            report_session_id = $2,
            open_url = $3,
            code_artifact_id = $4,
            metadata_artifact_id = $5,
            metadata_json = $6::jsonb,
            error_message = $7,
            updated_at = $8
        WHERE version_id = $9
      `,
      [
        input.status,
        input.reportSessionId ?? null,
        input.openUrl ?? null,
        input.codeArtifactId ?? null,
        input.metadataArtifactId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.errorMessage ?? null,
        new Date().toISOString(),
        input.versionId,
      ],
    );

    return (await this.getByVersion(input.versionId))!;
  }
}
