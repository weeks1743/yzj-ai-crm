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
    PRAGMA busy_timeout = 5000;
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

    CREATE TABLE IF NOT EXISTS enterprise_ppt_templates (
      template_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enterprise_ppt_template_settings (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      default_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_ppt_templates_single_active
    ON enterprise_ppt_templates(is_active)
    WHERE is_active = 1;

    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      eid TEXT NOT NULL,
      app_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      scene_key TEXT NOT NULL,
      user_input TEXT NOT NULL,
      intent_frame_json TEXT NOT NULL,
      context_subject_json TEXT,
      task_plan_json TEXT NOT NULL,
      execution_state_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      message_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      extra_info_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      tool_call_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool_code TEXT NOT NULL,
      status TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      output_summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_confirmations (
      confirmation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool_code TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      request_input_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_recent
    ON agent_runs(conversation_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run
    ON agent_tool_calls(run_id, started_at ASC);

    CREATE INDEX IF NOT EXISTS idx_agent_confirmations_run_status
    ON agent_confirmations(run_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS artifact_ppt_generations (
      generation_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      job_id TEXT,
      ppt_artifact_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(version_id)
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_ppt_generations_artifact
    ON artifact_ppt_generations(artifact_id, updated_at DESC);
  `);
  migrateSnapshotDictionaryBindings(database);
  ensureColumn(database, 'agent_runs', 'context_subject_json', 'TEXT');

  return database;
}
