import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type {
  ShadowDictionaryBindingRecord,
  ShadowObjectActivationStatus,
  ShadowObjectKey,
  ShadowObjectRefreshStatus,
  ShadowObjectRegistryRecord,
  ShadowObjectSnapshotRecord,
  ShadowStandardizedField,
} from './contracts.js';

interface ShadowObjectRegistryRow extends QueryResultRow {
  object_key: ShadowObjectKey;
  label: string;
  enabled: boolean;
  activation_status: ShadowObjectActivationStatus;
  form_code_id: string | null;
  form_def_id: string | null;
  refresh_status: ShadowObjectRefreshStatus;
  latest_snapshot_version: string | null;
  latest_schema_hash: string | null;
  last_refresh_at: string | null;
  last_error: string | null;
}

interface ShadowObjectSnapshotRow extends QueryResultRow {
  id: string;
  object_key: ShadowObjectKey;
  snapshot_version: string;
  schema_hash: string;
  form_code_id: string;
  form_def_id: string | null;
  normalized_fields_json: ShadowStandardizedField[] | string;
  dictionary_bindings_json: ShadowDictionaryBindingRecord[] | string;
  raw_template_json: unknown;
  created_at: string;
}

function parseJsonArray<T>(value: T[] | string | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function mapRegistryRow(row: ShadowObjectRegistryRow): ShadowObjectRegistryRecord {
  return {
    objectKey: row.object_key,
    label: row.label,
    enabled: Boolean(row.enabled),
    activationStatus: row.activation_status,
    formCodeId: row.form_code_id,
    formDefId: row.form_def_id,
    refreshStatus: row.refresh_status,
    latestSnapshotVersion: row.latest_snapshot_version,
    latestSchemaHash: row.latest_schema_hash,
    lastRefreshAt: row.last_refresh_at,
    lastError: row.last_error,
  };
}

function mapSnapshotRow(row: ShadowObjectSnapshotRow): ShadowObjectSnapshotRecord {
  return {
    id: row.id,
    objectKey: row.object_key,
    snapshotVersion: row.snapshot_version,
    schemaHash: row.schema_hash,
    formCodeId: row.form_code_id,
    formDefId: row.form_def_id,
    normalizedFields: parseJsonArray<ShadowStandardizedField>(row.normalized_fields_json),
    dictionaryBindings: parseJsonArray<ShadowDictionaryBindingRecord>(row.dictionary_bindings_json),
    rawTemplate: row.raw_template_json,
    createdAt: row.created_at,
  };
}

export class ShadowMetadataRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async upsertObjectRegistryConfig(record: {
    objectKey: ShadowObjectKey;
    label: string;
    enabled: boolean;
    activationStatus: ShadowObjectActivationStatus;
    formCodeId: string | null;
    now: string;
  }): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ${this.database.table('shadow_object_registry')} (
          object_key, label, enabled, activation_status, form_code_id, form_def_id,
          refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at,
          last_error, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NULL, 'not_started', NULL, NULL, NULL, NULL, $6, $7)
        ON CONFLICT (object_key) DO UPDATE SET
          label = EXCLUDED.label,
          enabled = EXCLUDED.enabled,
          activation_status = EXCLUDED.activation_status,
          form_code_id = EXCLUDED.form_code_id,
          updated_at = EXCLUDED.updated_at
      `,
      [
        record.objectKey,
        record.label,
        record.enabled,
        record.activationStatus,
        record.formCodeId,
        record.now,
        record.now,
      ],
    );
  }

  async markRefreshFailed(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string | null;
    formDefId: string | null;
    message: string;
    now: string;
  }): Promise<void> {
    await this.database.query(
      `
        UPDATE ${this.database.table('shadow_object_registry')}
        SET form_code_id = $1,
            form_def_id = $2,
            refresh_status = 'failed',
            last_error = $3,
            last_refresh_at = $4,
            updated_at = $5
        WHERE object_key = $6
      `,
      [
        params.formCodeId,
        params.formDefId,
        params.message,
        params.now,
        params.now,
        params.objectKey,
      ],
    );
  }

  async markRefreshReady(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string;
    formDefId: string | null;
    snapshotVersion: string;
    schemaHash: string;
    now: string;
  }): Promise<void> {
    await this.database.query(
      `
        UPDATE ${this.database.table('shadow_object_registry')}
        SET form_code_id = $1,
            form_def_id = $2,
            refresh_status = 'ready',
            latest_snapshot_version = $3,
            latest_schema_hash = $4,
            last_refresh_at = $5,
            last_error = NULL,
            updated_at = $6
        WHERE object_key = $7
      `,
      [
        params.formCodeId,
        params.formDefId,
        params.snapshotVersion,
        params.schemaHash,
        params.now,
        params.now,
        params.objectKey,
      ],
    );
  }

  async listObjectRegistry(): Promise<ShadowObjectRegistryRecord[]> {
    const rows = await this.database.query<ShadowObjectRegistryRow>(
      `
        SELECT object_key, label, enabled, activation_status, form_code_id, form_def_id,
               refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at, last_error
        FROM ${this.database.table('shadow_object_registry')}
        ORDER BY object_key ASC
      `,
    );

    return rows.map(mapRegistryRow);
  }

  async getObjectRegistry(objectKey: ShadowObjectKey): Promise<ShadowObjectRegistryRecord | null> {
    const row = await this.database.queryMaybeOne<ShadowObjectRegistryRow>(
      `
        SELECT object_key, label, enabled, activation_status, form_code_id, form_def_id,
               refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at, last_error
        FROM ${this.database.table('shadow_object_registry')}
        WHERE object_key = $1
      `,
      [objectKey],
    );

    return row ? mapRegistryRow(row) : null;
  }

  async saveSnapshot(snapshot: {
    id: string;
    objectKey: ShadowObjectKey;
    snapshotVersion: string;
    schemaHash: string;
    formCodeId: string;
    formDefId: string | null;
    normalizedFields: ShadowStandardizedField[];
    dictionaryBindings: ShadowDictionaryBindingRecord[];
    rawTemplate: unknown;
    createdAt: string;
  }): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ${this.database.table('shadow_object_snapshots')} (
          id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
          normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
      `,
      [
        snapshot.id,
        snapshot.objectKey,
        snapshot.snapshotVersion,
        snapshot.schemaHash,
        snapshot.formCodeId,
        snapshot.formDefId,
        JSON.stringify(snapshot.normalizedFields),
        JSON.stringify(snapshot.dictionaryBindings),
        JSON.stringify(snapshot.rawTemplate),
        snapshot.createdAt,
      ],
    );
  }

  async getLatestSnapshot(objectKey: ShadowObjectKey): Promise<ShadowObjectSnapshotRecord | null> {
    const row = await this.database.queryMaybeOne<ShadowObjectSnapshotRow>(
      `
        SELECT id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
               normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
        FROM ${this.database.table('shadow_object_snapshots')}
        WHERE object_key = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [objectKey],
    );

    return row ? mapSnapshotRow(row) : null;
  }

  async getSnapshotByVersion(
    objectKey: ShadowObjectKey,
    snapshotVersion: string,
  ): Promise<ShadowObjectSnapshotRecord | null> {
    const row = await this.database.queryMaybeOne<ShadowObjectSnapshotRow>(
      `
        SELECT id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
               normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
        FROM ${this.database.table('shadow_object_snapshots')}
        WHERE object_key = $1 AND snapshot_version = $2
      `,
      [objectKey, snapshotVersion],
    );

    return row ? mapSnapshotRow(row) : null;
  }
}
