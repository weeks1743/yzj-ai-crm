import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ArtifactPresentationStatus,
  ExternalSkillJobArtifact,
} from './contracts.js';

interface ArtifactPptGenerationRow {
  generation_id: string;
  artifact_id: string;
  version_id: string;
  title: string;
  status: ArtifactPresentationStatus;
  job_id: string | null;
  ppt_artifact_json: string | null;
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

function parsePptArtifact(value: string | null): ExternalSkillJobArtifact | null {
  if (!value) {
    return null;
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
  constructor(private readonly database: DatabaseSync) {}

  getByVersion(versionId: string): ArtifactPptGenerationRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM artifact_ppt_generations
          WHERE version_id = ?
          LIMIT 1
        `,
      )
      .get(versionId) as ArtifactPptGenerationRow | undefined;

    return row ? mapRow(row) : null;
  }

  reserve(input: {
    artifactId: string;
    versionId: string;
    title: string;
  }): ArtifactPptGenerationRecord {
    const existing = this.getByVersion(input.versionId);
    if (existing && existing.status !== 'failed') {
      return existing;
    }

    const now = new Date().toISOString();
    const generationId = existing?.generationId ?? randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO artifact_ppt_generations (
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
          ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)
          ON CONFLICT(version_id) DO UPDATE SET
            title = excluded.title,
            status = 'queued',
            job_id = NULL,
            ppt_artifact_json = NULL,
            error_message = NULL,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        generationId,
        input.artifactId,
        input.versionId,
        input.title,
        now,
        now,
      );

    return this.getByVersion(input.versionId)!;
  }

  attachJob(input: {
    versionId: string;
    jobId: string;
    status: ArtifactPresentationStatus;
  }): ArtifactPptGenerationRecord {
    this.database
      .prepare(
        `
          UPDATE artifact_ppt_generations
          SET job_id = ?,
              status = ?,
              error_message = NULL,
              updated_at = ?
          WHERE version_id = ?
        `,
      )
      .run(input.jobId, input.status, new Date().toISOString(), input.versionId);

    return this.getByVersion(input.versionId)!;
  }

  updateStatus(input: {
    versionId: string;
    status: ArtifactPresentationStatus;
    pptArtifact?: ExternalSkillJobArtifact | null;
    errorMessage?: string | null;
  }): ArtifactPptGenerationRecord {
    this.database
      .prepare(
        `
          UPDATE artifact_ppt_generations
          SET status = ?,
              ppt_artifact_json = ?,
              error_message = ?,
              updated_at = ?
          WHERE version_id = ?
        `,
      )
      .run(
        input.status,
        input.pptArtifact ? JSON.stringify(input.pptArtifact) : null,
        input.errorMessage ?? null,
        new Date().toISOString(),
        input.versionId,
      );

    return this.getByVersion(input.versionId)!;
  }
}
