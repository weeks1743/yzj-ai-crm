import type { QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  RecordingAnchorInput,
  RecordingTaskResponse,
  RecordingTaskStatus,
} from './contracts.js';
import type { DatabaseConnection } from './database.js';
import { NotFoundError } from './errors.js';

interface RecordingTaskRow extends QueryResultRow {
  task_id: string;
  eid: string;
  app_id: string;
  service_task_id: string;
  provider_data_id: string | null;
  fixture_task_id: string | null;
  status: RecordingTaskStatus;
  file_name: string;
  mime_type: string;
  byte_size: number;
  file_sha256: string;
  anchors_json: unknown;
  service_payload_json: unknown;
  artifact_id: string | null;
  material_path: string | null;
  material_source: string | null;
  error_message: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RecordingTaskRecord {
  taskId: string;
  eid: string;
  appId: string;
  serviceTaskId: string;
  providerDataId: string | null;
  fixtureTaskId: string | null;
  status: RecordingTaskStatus;
  file: {
    fileName: string;
    mimeType: string;
    size: number;
    md5: string;
  };
  anchors: RecordingAnchorInput;
  servicePayload: Record<string, unknown>;
  artifactId: string | null;
  materialPath: string | null;
  materialSource: string | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class RecordingTaskRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async findByFileHash(input: {
    eid: string;
    appId: string;
    md5: string;
  }): Promise<RecordingTaskRecord | null> {
    const row = await this.database.queryMaybeOne<RecordingTaskRow>(
      `
      SELECT * FROM ${this.database.table('recording_audio_tasks')}
      WHERE eid = $1 AND app_id = $2 AND file_sha256 = $3
      `,
      [input.eid, input.appId, input.md5],
    );
    return row ? mapRow(row) : null;
  }

  async getTask(taskId: string): Promise<RecordingTaskRecord> {
    const row = await this.database.queryMaybeOne<RecordingTaskRow>(
      `SELECT * FROM ${this.database.table('recording_audio_tasks')} WHERE task_id = $1`,
      [taskId],
    );
    if (!row) {
      throw new NotFoundError('录音任务不存在');
    }
    return mapRow(row);
  }

  async createTask(input: {
    eid: string;
    appId: string;
    serviceTaskId: string;
    providerDataId?: string | null;
    fixtureTaskId?: string | null;
    status: RecordingTaskStatus;
    file: RecordingTaskRecord['file'];
    anchors: RecordingAnchorInput;
    servicePayload: Record<string, unknown>;
    errorMessage?: string | null;
    createdBy: string;
  }): Promise<RecordingTaskRecord> {
    const now = new Date().toISOString();
    const taskId = `recording-task-${randomUUID().slice(0, 8)}`;
    await this.database.query(
      `
      INSERT INTO ${this.database.table('recording_audio_tasks')} (
        task_id, eid, app_id, service_task_id, provider_data_id, fixture_task_id, status,
        file_name, mime_type, byte_size, file_sha256, anchors_json, service_payload_json,
        artifact_id, material_path, material_source, error_message, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb, $13::jsonb,
        NULL, NULL, NULL, $14, $15, $16, $16
      )
      `,
      [
        taskId,
        input.eid,
        input.appId,
        input.serviceTaskId,
        input.providerDataId ?? null,
        input.fixtureTaskId ?? null,
        input.status,
        input.file.fileName,
        input.file.mimeType,
        input.file.size,
        input.file.md5,
        JSON.stringify(input.anchors),
        JSON.stringify(input.servicePayload),
        input.errorMessage ?? null,
        input.createdBy,
        now,
      ],
    );
    return this.getTask(taskId);
  }

  async updateFromService(input: {
    taskId: string;
    status: RecordingTaskStatus;
    providerDataId?: string | null;
    fixtureTaskId?: string | null;
    anchors?: RecordingAnchorInput;
    servicePayload: Record<string, unknown>;
    errorMessage?: string | null;
    materialPath?: string | null;
    materialSource?: string | null;
  }): Promise<RecordingTaskRecord> {
    const current = await this.getTask(input.taskId);
    const anchors = input.anchors ? { ...current.anchors, ...input.anchors } : current.anchors;
    const now = new Date().toISOString();
    await this.database.query(
      `
      UPDATE ${this.database.table('recording_audio_tasks')}
      SET status = $2,
          provider_data_id = COALESCE($3, provider_data_id),
          fixture_task_id = COALESCE($4, fixture_task_id),
          anchors_json = $5::jsonb,
          service_payload_json = $6::jsonb,
          error_message = $7,
          material_path = COALESCE($8, material_path),
          material_source = COALESCE($9, material_source),
          updated_at = $10
      WHERE task_id = $1
      `,
      [
        input.taskId,
        input.status,
        input.providerDataId ?? null,
        input.fixtureTaskId ?? null,
        JSON.stringify(anchors),
        JSON.stringify(input.servicePayload),
        input.errorMessage ?? null,
        input.materialPath ?? null,
        input.materialSource ?? null,
        now,
      ],
    );
    return this.getTask(input.taskId);
  }

  async replaceFromService(input: {
    taskId: string;
    serviceTaskId: string;
    providerDataId?: string | null;
    fixtureTaskId?: string | null;
    status: RecordingTaskStatus;
    file: RecordingTaskRecord['file'];
    anchors: RecordingAnchorInput;
    servicePayload: Record<string, unknown>;
    errorMessage?: string | null;
    materialPath?: string | null;
    materialSource?: string | null;
  }): Promise<RecordingTaskRecord> {
    const now = new Date().toISOString();
    await this.database.query(
      `
      UPDATE ${this.database.table('recording_audio_tasks')}
      SET service_task_id = $2,
          provider_data_id = $3,
          fixture_task_id = $4,
          status = $5,
          file_name = $6,
          mime_type = $7,
          byte_size = $8,
          file_sha256 = $9,
          anchors_json = $10::jsonb,
          service_payload_json = $11::jsonb,
          artifact_id = NULL,
          material_path = $12,
          material_source = $13,
          error_message = $14,
          updated_at = $15
      WHERE task_id = $1
      `,
      [
        input.taskId,
        input.serviceTaskId,
        input.providerDataId ?? null,
        input.fixtureTaskId ?? null,
        input.status,
        input.file.fileName,
        input.file.mimeType,
        input.file.size,
        input.file.md5,
        JSON.stringify(input.anchors),
        JSON.stringify(input.servicePayload),
        input.materialPath ?? null,
        input.materialSource ?? null,
        input.errorMessage ?? null,
        now,
      ],
    );
    return this.getTask(input.taskId);
  }

  async attachArtifact(input: {
    taskId: string;
    artifactId: string;
    materialPath?: string | null;
    materialSource?: string | null;
    servicePayload: Record<string, unknown>;
  }): Promise<RecordingTaskRecord> {
    const now = new Date().toISOString();
    await this.database.query(
      `
      UPDATE ${this.database.table('recording_audio_tasks')}
      SET artifact_id = $2,
          material_path = COALESCE($3, material_path),
          material_source = COALESCE($4, material_source),
          service_payload_json = $5::jsonb,
          updated_at = $6
      WHERE task_id = $1
      `,
      [
        input.taskId,
        input.artifactId,
        input.materialPath ?? null,
        input.materialSource ?? null,
        JSON.stringify(input.servicePayload),
        now,
      ],
    );
    return this.getTask(input.taskId);
  }
}

export function toRecordingTaskResponse(record: RecordingTaskRecord): RecordingTaskResponse {
  const servicePayload = record.servicePayload;
  const stages = Array.isArray(servicePayload.stages)
    ? servicePayload.stages as RecordingTaskResponse['stages']
    : [];
  const playback = servicePayload.playback && typeof servicePayload.playback === 'object'
    ? servicePayload.playback as RecordingTaskResponse['playback']
    : { available: false };
  const archivedFollowupId = readPayloadString(servicePayload.archivedFollowupId) || record.anchors.followup;
  const archivedArtifactId = readPayloadString(servicePayload.archivedArtifactId) || record.artifactId || undefined;
  const archive: RecordingTaskResponse['archive'] = archivedFollowupId && archivedArtifactId
    ? {
        status: 'archived',
        artifactId: archivedArtifactId,
        followupId: archivedFollowupId,
        customerId: record.anchors.customer,
        opportunityId: record.anchors.opportunity,
        sourceFileMd5: record.file.md5,
      }
    : {
        status: 'unarchived',
        sourceFileMd5: record.file.md5,
      };

  return {
    taskId: record.taskId,
    eid: record.eid,
    appId: record.appId,
    status: record.status,
    serviceTaskId: record.serviceTaskId,
    providerDataId: record.providerDataId,
    fixtureTaskId: record.fixtureTaskId,
    file: record.file,
    anchors: record.anchors,
    stages,
    material: {
      available: Boolean(record.artifactId || record.materialPath),
      artifactId: record.artifactId ?? undefined,
      path: record.materialPath,
      source: record.materialSource,
    },
    archive,
    playback,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function readPayloadString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function mapRow(row: RecordingTaskRow): RecordingTaskRecord {
  return {
    taskId: row.task_id,
    eid: row.eid,
    appId: row.app_id,
    serviceTaskId: row.service_task_id,
    providerDataId: row.provider_data_id,
    fixtureTaskId: row.fixture_task_id,
    status: row.status,
    file: {
      fileName: row.file_name,
      mimeType: row.mime_type,
      size: Number(row.byte_size),
      md5: row.file_sha256,
    },
    anchors: parseJsonObject<RecordingAnchorInput>(row.anchors_json),
    servicePayload: parseJsonObject(row.service_payload_json),
    artifactId: row.artifact_id,
    materialPath: row.material_path,
    materialSource: row.material_source,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonObject<T = Record<string, unknown>>(value: unknown): T {
  if (!value) {
    return {} as T;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as T;
  }
  return {} as T;
}
