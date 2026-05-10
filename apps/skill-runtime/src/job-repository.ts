import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type {
  ApiErrorResponse,
  JobArtifact,
  JobEvent,
  JobResponse,
  JobStatus,
  StoredJobRecord,
} from './contracts.js';
import { NotFoundError } from './errors.js';

interface JobRow extends QueryResultRow {
  job_id: string;
  skill_name: string;
  model: string;
  request_text: string;
  attachments_json: string[] | string;
  working_directory: string | null;
  status: JobStatus;
  final_text: string | null;
  error_json: ApiErrorResponse | string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface JobEventRow extends QueryResultRow {
  id: string;
  job_id: string;
  type: JobEvent['type'];
  message: string;
  data_json: unknown;
  created_at: string;
}

interface JobArtifactRow extends QueryResultRow {
  artifact_id: string;
  job_id: string;
  file_name: string;
  mime_type: string;
  file_path: string;
  byte_size: number;
  created_at: string;
}

function parseJsonValue<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapJob(row: JobRow): StoredJobRecord {
  return {
    jobId: row.job_id,
    skillName: row.skill_name,
    model: row.model.trim() ? row.model : null,
    requestText: row.request_text,
    attachments: parseJsonValue<string[]>(row.attachments_json, []),
    workingDirectory: row.working_directory,
    status: row.status,
    finalText: row.final_text,
    error: row.error_json ? parseJsonValue<ApiErrorResponse | null>(row.error_json, null) : null,
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
    data: row.data_json ?? undefined,
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
  constructor(private readonly database: DatabaseConnection) {}

  async createJob(input: {
    skillName: string;
    model: string | null;
    requestText: string;
    attachments: string[];
    workingDirectory: string | null;
  }): Promise<StoredJobRecord> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('jobs')} (
          job_id,
          skill_name,
          model,
          request_text,
          attachments_json,
          working_directory,
          status,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'queued', $7, $8)
      `,
      [
        jobId,
        input.skillName,
        input.model ?? '',
        input.requestText,
        JSON.stringify(input.attachments),
        input.workingDirectory,
        now,
        now,
      ],
    );

    return this.getJob(jobId);
  }

  async getJob(jobId: string): Promise<StoredJobRecord> {
    const row = await this.database.queryMaybeOne<JobRow>(
      `SELECT * FROM ${this.database.table('jobs')} WHERE job_id = $1`,
      [jobId],
    );

    if (!row) {
      throw new NotFoundError(`Job 不存在: ${jobId}`);
    }

    return mapJob(row);
  }

  async listJobs(input: {
    skillName?: string | null;
    status?: JobStatus | null;
    query?: string | null;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ jobs: StoredJobRecord[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize ?? 20)), 100);
    const conditions: string[] = [];
    const params: unknown[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (input.skillName?.trim()) {
      conditions.push(`skill_name = ${addParam(input.skillName.trim())}`);
    }
    if (input.status?.trim()) {
      conditions.push(`status = ${addParam(input.status.trim())}`);
    }
    if (input.query?.trim()) {
      const pattern = `%${input.query.trim()}%`;
      conditions.push(`(
        request_text ILIKE ${addParam(pattern)}
        OR job_id ILIKE ${addParam(pattern)}
        OR EXISTS (
          SELECT 1
          FROM ${this.database.table('job_artifacts')} artifact
          WHERE artifact.job_id = ${this.database.table('jobs')}.job_id
            AND artifact.file_name ILIKE ${addParam(pattern)}
        )
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await this.database.queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${this.database.table('jobs')} ${whereClause}`,
      params,
    );
    const rows = await this.database.query<JobRow>(
      `
        SELECT * FROM ${this.database.table('jobs')}
        ${whereClause}
        ORDER BY updated_at DESC, job_id DESC
        LIMIT ${addParam(pageSize)}
        OFFSET ${addParam((page - 1) * pageSize)}
      `,
      params,
    );

    return {
      jobs: rows.map(mapJob),
      total: Number(totalRow.total || 0),
      page,
      pageSize,
    };
  }

  async listEvents(jobId: string): Promise<JobEvent[]> {
    const rows = await this.database.query<JobEventRow>(
      `
        SELECT * FROM ${this.database.table('job_events')}
        WHERE job_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [jobId],
    );
    return rows.map(mapEvent);
  }

  async listArtifacts(jobId: string): Promise<Array<JobArtifact & { filePath: string }>> {
    const rows = await this.database.query<JobArtifactRow>(
      `
        SELECT * FROM ${this.database.table('job_artifacts')}
        WHERE job_id = $1
        ORDER BY created_at ASC, artifact_id ASC
      `,
      [jobId],
    );
    return rows.map(mapArtifact);
  }

  async getArtifact(jobId: string, artifactId: string): Promise<JobArtifact & { filePath: string }> {
    const row = await this.database.queryMaybeOne<JobArtifactRow>(
      `
        SELECT * FROM ${this.database.table('job_artifacts')}
        WHERE job_id = $1 AND artifact_id = $2
      `,
      [jobId, artifactId],
    );

    if (!row) {
      throw new NotFoundError(`Artifact 不存在: ${artifactId}`);
    }

    return mapArtifact(row);
  }

  async markRunning(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        UPDATE ${this.database.table('jobs')}
        SET status = 'running',
            started_at = COALESCE(started_at, $1),
            updated_at = $2
        WHERE job_id = $3
      `,
      [now, now, jobId],
    );
  }

  async markSucceeded(jobId: string, finalText: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        UPDATE ${this.database.table('jobs')}
        SET status = 'succeeded',
            final_text = $1,
            finished_at = $2,
            updated_at = $3
        WHERE job_id = $4
      `,
      [finalText, now, now, jobId],
    );
  }

  async markFailed(jobId: string, error: ApiErrorResponse): Promise<void> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        UPDATE ${this.database.table('jobs')}
        SET status = 'failed',
            error_json = $1::jsonb,
            finished_at = $2,
            updated_at = $3
        WHERE job_id = $4
      `,
      [JSON.stringify(error), now, now, jobId],
    );
  }

  async appendEvent(
    jobId: string,
    type: JobEvent['type'],
    message: string,
    data?: unknown,
  ): Promise<JobEvent> {
    const event: JobEvent = {
      id: randomUUID(),
      type,
      message,
      data,
      createdAt: new Date().toISOString(),
    };

    await this.database.query(
      `
        INSERT INTO ${this.database.table('job_events')} (id, job_id, type, message, data_json, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        event.id,
        jobId,
        event.type,
        event.message,
        event.data === undefined ? null : JSON.stringify(event.data),
        event.createdAt,
      ],
    );

    return event;
  }

  async addArtifact(input: {
    artifactId?: string;
    jobId: string;
    fileName: string;
    mimeType: string;
    filePath: string;
    byteSize: number;
  }): Promise<JobArtifact> {
    const artifactId = input.artifactId ?? randomUUID();
    const createdAt = new Date().toISOString();

    await this.database.query(
      `
        INSERT INTO ${this.database.table('job_artifacts')} (
          artifact_id,
          job_id,
          file_name,
          mime_type,
          file_path,
          byte_size,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        artifactId,
        input.jobId,
        input.fileName,
        input.mimeType,
        input.filePath,
        input.byteSize,
        createdAt,
      ],
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

  async toJobResponse(jobId: string): Promise<JobResponse> {
    const job = await this.getJob(jobId);
    return this.toResponse(job);
  }

  async toJobResponses(jobs: StoredJobRecord[]): Promise<JobResponse[]> {
    return Promise.all(jobs.map((job) => this.toResponse(job)));
  }

  private async toResponse(job: StoredJobRecord): Promise<JobResponse> {
    return {
      ...job,
      events: await this.listEvents(job.jobId),
      artifacts: (await this.listArtifacts(job.jobId)).map(({ filePath: _filePath, ...artifact }) => artifact),
    };
  }
}
