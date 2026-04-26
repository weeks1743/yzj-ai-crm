import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      skill_name TEXT NOT NULL,
      model TEXT NOT NULL,
      request_text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      working_directory TEXT,
      template_id TEXT,
      presentation_prompt TEXT,
      status TEXT NOT NULL,
      final_text TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_artifacts (
      artifact_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_job_artifacts_job_id ON job_artifacts(job_id, created_at);
  `);

  ensureColumn(database, 'jobs', 'template_id', 'TEXT');
  ensureColumn(database, 'jobs', 'presentation_prompt', 'TEXT');

  return database;
}
