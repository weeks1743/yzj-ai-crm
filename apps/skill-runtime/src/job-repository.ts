import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ApiErrorResponse,
  JobArtifact,
  JobEvent,
  JobResponse,
  JobStatus,
  StoredJobRecord,
  SupportedDeepseekModel,
} from './contracts.js';
import { NotFoundError } from './errors.js';

interface JobRow {
  job_id: string;
  skill_name: string;
  model: SupportedDeepseekModel;
  request_text: string;
  attachments_json: string;
  working_directory: string | null;
  status: JobStatus;
  final_text: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface JobEventRow {
  id: string;
  job_id: string;
  type: JobEvent['type'];
  message: string;
  data_json: string | null;
  created_at: string;
}

interface JobArtifactRow {
  artifact_id: string;
  job_id: string;
  file_name: string;
  mime_type: string;
  file_path: string;
  byte_size: number;
  created_at: string;
}

function mapJob(row: JobRow): StoredJobRecord {
  return {
    jobId: row.job_id,
    skillName: row.skill_name,
    model: row.model,
    requestText: row.request_text,
    attachments: JSON.parse(row.attachments_json) as string[],
    workingDirectory: row.working_directory,
    status: row.status,
    finalText: row.final_text,
    error: row.error_json ? (JSON.parse(row.error_json) as ApiErrorResponse) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapEvent(row: JobEventRow): JobEvent {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    createdAt: row.created_at,
  };
}

function mapArtifact(row: JobArtifactRow): JobArtifact & { filePath: string } {
  return {
    artifactId: row.artifact_id,
    jobId: row.job_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    downloadPath: `/api/jobs/${row.job_id}/artifacts/${row.artifact_id}`,
    filePath: row.file_path,
  };
}

export class JobRepository {
  constructor(private readonly database: DatabaseSync) {}

  createJob(input: {
    skillName: string;
    model: SupportedDeepseekModel;
    requestText: string;
    attachments: string[];
    workingDirectory: string | null;
  }): StoredJobRecord {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO jobs (
            job_id,
            skill_name,
            model,
            request_text,
            attachments_json,
            working_directory,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `,
      )
      .run(
        jobId,
        input.skillName,
        input.model,
        input.requestText,
        JSON.stringify(input.attachments),
        input.workingDirectory,
        now,
        now,
      );

    return this.getJob(jobId);
  }

  getJob(jobId: string): StoredJobRecord {
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE job_id = ? LIMIT 1')
      .get(jobId) as JobRow | undefined;

    if (!row) {
      throw new NotFoundError(`Job 不存在: ${jobId}`);
    }

    return mapJob(row);
  }

  listEvents(jobId: string): JobEvent[] {
    const rows = this.database
      .prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC, id ASC')
      .all(jobId) as unknown as JobEventRow[];
    return rows.map(mapEvent);
  }

  listArtifacts(jobId: string): Array<JobArtifact & { filePath: string }> {
    const rows = this.database
      .prepare('SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY created_at ASC, artifact_id ASC')
      .all(jobId) as unknown as JobArtifactRow[];
    return rows.map(mapArtifact);
  }

  getArtifact(jobId: string, artifactId: string): JobArtifact & { filePath: string } {
    const row = this.database
      .prepare(
        'SELECT * FROM job_artifacts WHERE job_id = ? AND artifact_id = ? LIMIT 1',
      )
      .get(jobId, artifactId) as JobArtifactRow | undefined;

    if (!row) {
      throw new NotFoundError(`Artifact 不存在: ${artifactId}`);
    }

    return mapArtifact(row);
  }

  markRunning(jobId: string): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE jobs
          SET status = 'running',
              started_at = COALESCE(started_at, ?),
              updated_at = ?
          WHERE job_id = ?
        `,
      )
      .run(now, now, jobId);
  }

  markSucceeded(jobId: string, finalText: string | null): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE jobs
          SET status = 'succeeded',
              final_text = ?,
              finished_at = ?,
              updated_at = ?
          WHERE job_id = ?
        `,
      )
      .run(finalText, now, now, jobId);
  }

  markFailed(jobId: string, error: ApiErrorResponse): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE jobs
          SET status = 'failed',
              error_json = ?,
              finished_at = ?,
              updated_at = ?
          WHERE job_id = ?
        `,
      )
      .run(JSON.stringify(error), now, now, jobId);
  }

  appendEvent(
    jobId: string,
    type: JobEvent['type'],
    message: string,
    data?: unknown,
  ): JobEvent {
    const event: JobEvent = {
      id: randomUUID(),
      type,
      message,
      data,
      createdAt: new Date().toISOString(),
    };

    this.database
      .prepare(
        `
          INSERT INTO job_events (id, job_id, type, message, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        jobId,
        event.type,
        event.message,
        event.data ? JSON.stringify(event.data) : null,
        event.createdAt,
      );

    return event;
  }

  addArtifact(input: {
    artifactId?: string;
    jobId: string;
    fileName: string;
    mimeType: string;
    filePath: string;
    byteSize: number;
  }): JobArtifact {
    const artifactId = input.artifactId ?? randomUUID();
    const createdAt = new Date().toISOString();

    this.database
      .prepare(
        `
          INSERT INTO job_artifacts (
            artifact_id,
            job_id,
            file_name,
            mime_type,
            file_path,
            byte_size,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        artifactId,
        input.jobId,
        input.fileName,
        input.mimeType,
        input.filePath,
        input.byteSize,
        createdAt,
      );

    return {
      artifactId,
      jobId: input.jobId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      createdAt,
      downloadPath: `/api/jobs/${input.jobId}/artifacts/${artifactId}`,
    };
  }

  toJobResponse(jobId: string): JobResponse {
    const job = this.getJob(jobId);
    return {
      ...job,
      events: this.listEvents(jobId),
      artifacts: this.listArtifacts(jobId).map(({ filePath: _filePath, ...artifact }) => artifact),
    };
  }
}
