import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface SqliteTableInfoRow {
  name: string;
}

interface SnapshotMigrationRow {
  object_key: string;
  snapshot_version: string;
  dictionary_bindings_json: string | null;
}

interface LegacyDictionaryBindingRow {
  details_json: string;
}

function hasTable(database: DatabaseSync, tableName: string): boolean {
  const row = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName) as SqliteTableInfoRow | undefined;

  return Boolean(row);
}

function hasColumn(database: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as unknown as Array<{ name: string }>;

  return rows.some((row) => row.name === columnName);
}

function ensureColumn(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  if (hasColumn(database, tableName, columnName)) {
    return;
  }

  database.exec(`
    ALTER TABLE ${tableName}
    ADD COLUMN ${columnName} ${columnDefinition}
  `);
}

function migrateSnapshotDictionaryBindings(database: DatabaseSync) {
  if (!hasTable(database, 'shadow_object_snapshots')) {
    return;
  }

  ensureColumn(
    database,
    'shadow_object_snapshots',
    'dictionary_bindings_json',
    "TEXT NOT NULL DEFAULT '[]'",
  );

  if (!hasTable(database, 'shadow_dictionary_bindings')) {
    return;
  }

  const snapshots = database
    .prepare(
      `
        SELECT object_key, snapshot_version, dictionary_bindings_json
        FROM shadow_object_snapshots
      `,
    )
    .all() as unknown as SnapshotMigrationRow[];
  const selectBindings = database.prepare(
    `
      SELECT details_json
      FROM shadow_dictionary_bindings
      WHERE object_key = ? AND snapshot_version = ?
      ORDER BY field_code ASC
    `,
  );
  const updateSnapshot = database.prepare(
    `
      UPDATE shadow_object_snapshots
      SET dictionary_bindings_json = ?
      WHERE object_key = ? AND snapshot_version = ?
    `,
  );

  for (const snapshot of snapshots) {
    if (snapshot.dictionary_bindings_json && snapshot.dictionary_bindings_json !== '[]') {
      continue;
    }

    const rows = selectBindings.all(
      snapshot.object_key,
      snapshot.snapshot_version,
    ) as unknown as LegacyDictionaryBindingRow[];
    if (rows.length === 0) {
      continue;
    }

    updateSnapshot.run(
      JSON.stringify(rows.map((row) => JSON.parse(row.details_json))),
      snapshot.object_key,
      snapshot.snapshot_version,
    );
  }
}

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS org_sync_runs (
      id TEXT PRIMARY KEY,
      eid TEXT NOT NULL,
      app_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      upserted_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS org_employees (
      eid TEXT NOT NULL,
      app_id TEXT NOT NULL,
      open_id TEXT NOT NULL,
      uid TEXT,
      name TEXT,
      phone TEXT,
      email TEXT,
      job_title TEXT,
      status TEXT,
      synced_at TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      PRIMARY KEY (eid, app_id, open_id)
    );

    CREATE TABLE IF NOT EXISTS shadow_object_registry (
      object_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      activation_status TEXT NOT NULL,
      form_code_id TEXT,
      form_def_id TEXT,
      refresh_status TEXT NOT NULL,
      latest_snapshot_version TEXT,
      latest_schema_hash TEXT,
      last_refresh_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shadow_object_snapshots (
      id TEXT PRIMARY KEY,
      object_key TEXT NOT NULL,
      snapshot_version TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      form_code_id TEXT NOT NULL,
      form_def_id TEXT,
      normalized_fields_json TEXT NOT NULL,
      dictionary_bindings_json TEXT NOT NULL DEFAULT '[]',
      raw_template_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(object_key, snapshot_version)
    );
  `);
  migrateSnapshotDictionaryBindings(database);

  return database;
}
