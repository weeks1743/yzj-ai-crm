import { DatabaseSync } from 'node:sqlite';
import type {
  ShadowDictionaryBindingRecord,
  ShadowObjectActivationStatus,
  ShadowObjectKey,
  ShadowObjectRefreshStatus,
  ShadowObjectRegistryRecord,
  ShadowObjectSnapshotRecord,
  ShadowStandardizedField,
} from './contracts.js';

interface ShadowObjectRegistryRow {
  object_key: ShadowObjectKey;
  label: string;
  enabled: number;
  activation_status: ShadowObjectActivationStatus;
  form_code_id: string | null;
  form_def_id: string | null;
  refresh_status: ShadowObjectRefreshStatus;
  latest_snapshot_version: string | null;
  latest_schema_hash: string | null;
  last_refresh_at: string | null;
  last_error: string | null;
}

interface ShadowObjectSnapshotRow {
  id: string;
  object_key: ShadowObjectKey;
  snapshot_version: string;
  schema_hash: string;
  form_code_id: string;
  form_def_id: string | null;
  normalized_fields_json: string;
  dictionary_bindings_json: string;
  raw_template_json: string;
  created_at: string;
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
    normalizedFields: JSON.parse(row.normalized_fields_json) as ShadowStandardizedField[],
    dictionaryBindings: JSON.parse(row.dictionary_bindings_json || '[]') as ShadowDictionaryBindingRecord[],
    rawTemplate: JSON.parse(row.raw_template_json),
    createdAt: row.created_at,
  };
}

export class ShadowMetadataRepository {
  constructor(private readonly database: DatabaseSync) {}

  upsertObjectRegistryConfig(record: {
    objectKey: ShadowObjectKey;
    label: string;
    enabled: boolean;
    activationStatus: ShadowObjectActivationStatus;
    formCodeId: string | null;
    now: string;
  }): void {
    this.database
      .prepare(
        `
          INSERT INTO shadow_object_registry (
            object_key, label, enabled, activation_status, form_code_id, form_def_id,
            refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at,
            last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 'not_started', NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(object_key) DO UPDATE SET
            label = excluded.label,
            enabled = excluded.enabled,
            activation_status = excluded.activation_status,
            form_code_id = excluded.form_code_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        record.objectKey,
        record.label,
        record.enabled ? 1 : 0,
        record.activationStatus,
        record.formCodeId,
        record.now,
        record.now,
      );
  }

  markRefreshFailed(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string | null;
    formDefId: string | null;
    message: string;
    now: string;
  }): void {
    this.database
      .prepare(
        `
          UPDATE shadow_object_registry
          SET form_code_id = ?,
              form_def_id = ?,
              refresh_status = 'failed',
              last_error = ?,
              last_refresh_at = ?,
              updated_at = ?
          WHERE object_key = ?
        `,
      )
      .run(
        params.formCodeId,
        params.formDefId,
        params.message,
        params.now,
        params.now,
        params.objectKey,
      );
  }

  markRefreshReady(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string;
    formDefId: string | null;
    snapshotVersion: string;
    schemaHash: string;
    now: string;
  }): void {
    this.database
      .prepare(
        `
          UPDATE shadow_object_registry
          SET form_code_id = ?,
              form_def_id = ?,
              refresh_status = 'ready',
              latest_snapshot_version = ?,
              latest_schema_hash = ?,
              last_refresh_at = ?,
              last_error = NULL,
              updated_at = ?
          WHERE object_key = ?
        `,
      )
      .run(
        params.formCodeId,
        params.formDefId,
        params.snapshotVersion,
        params.schemaHash,
        params.now,
        params.now,
        params.objectKey,
      );
  }

  listObjectRegistry(): ShadowObjectRegistryRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT object_key, label, enabled, activation_status, form_code_id, form_def_id,
                 refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at, last_error
          FROM shadow_object_registry
          ORDER BY object_key ASC
        `,
      )
      .all() as unknown as ShadowObjectRegistryRow[];

    return rows.map(mapRegistryRow);
  }

  getObjectRegistry(objectKey: ShadowObjectKey): ShadowObjectRegistryRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT object_key, label, enabled, activation_status, form_code_id, form_def_id,
                 refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at, last_error
          FROM shadow_object_registry
          WHERE object_key = ?
        `,
      )
      .get(objectKey) as ShadowObjectRegistryRow | undefined;

    return row ? mapRegistryRow(row) : null;
  }

  saveSnapshot(snapshot: {
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
  }): void {
    this.database
      .prepare(
        `
          INSERT INTO shadow_object_snapshots (
            id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
            normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
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
      );
  }

  getLatestSnapshot(objectKey: ShadowObjectKey): ShadowObjectSnapshotRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
                 normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
          FROM shadow_object_snapshots
          WHERE object_key = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(objectKey) as ShadowObjectSnapshotRow | undefined;

    return row ? mapSnapshotRow(row) : null;
  }

  getSnapshotByVersion(
    objectKey: ShadowObjectKey,
    snapshotVersion: string,
  ): ShadowObjectSnapshotRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
                 normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
          FROM shadow_object_snapshots
          WHERE object_key = ? AND snapshot_version = ?
          LIMIT 1
        `,
      )
      .get(objectKey, snapshotVersion) as ShadowObjectSnapshotRow | undefined;

    return row ? mapSnapshotRow(row) : null;
  }
}
