import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { openDatabase as openAdminDatabase, type DatabaseConnection } from '../src/database.js';
import { openDatabase as openSkillDatabase, type DatabaseConnection as SkillDatabaseConnection } from '../../skill-runtime/src/database.js';

type SqliteValue = string | number | bigint | Buffer | null;
type SqliteRow = Record<string, SqliteValue>;

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

export interface SqliteToPostgresMigrationOptions {
  adminSqlitePath: string;
  adminPostgresUrl: string;
  adminPostgresSchema: string;
  skillRuntimeSqlitePath: string;
  skillRuntimePostgresUrl: string;
  skillRuntimePostgresSchema: string;
  logger?: Logger;
}

export interface SqliteToPostgresMigrationSummary {
  adminApi: {
    sqlitePath: string;
    postgresSchema: string;
    skipped: boolean;
    tables: Record<string, number>;
  };
  skillRuntime: {
    sqlitePath: string;
    postgresSchema: string;
    skipped: boolean;
    tables: Record<string, number>;
  };
}

const DEFAULT_POSTGRES_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev';

const ADMIN_TABLES = [
  'org_sync_runs',
  'org_employees',
  'shadow_object_registry',
  'shadow_object_snapshots',
  'enterprise_ppt_templates',
  'enterprise_ppt_template_settings',
  'agent_runs',
  'agent_messages',
  'agent_tool_calls',
  'agent_confirmations',
  'artifact_ppt_generations',
] as const;

const SKILL_RUNTIME_TABLES = [
  'jobs',
  'job_events',
  'job_artifacts',
] as const;

function findEnvFile(startDirectory = process.cwd()): string {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidate = resolve(currentDirectory, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return resolve(startDirectory, '.env');
    }

    currentDirectory = parentDirectory;
  }
}

function readRows(database: DatabaseSync, tableName: string): SqliteRow[] {
  const exists = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName);

  if (!exists) {
    return [];
  }

  return database.prepare(`SELECT * FROM "${tableName.replace(/"/g, '""')}"`).all() as SqliteRow[];
}

function parseJson(value: SqliteValue | unknown, fallback: unknown): unknown {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonParam(value: SqliteValue | unknown, fallback: unknown): string {
  return JSON.stringify(parseJson(value, fallback));
}

function stringValue(value: SqliteValue | undefined, fallback = ''): string {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function nullableString(value: SqliteValue | undefined): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value);
  return text.length > 0 ? text : null;
}

function integerValue(value: SqliteValue | undefined, fallback = 0): number {
  if (value == null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function booleanValue(value: SqliteValue | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'bigint') {
    return value !== 0n;
  }
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return false;
}

function buildLegacyDictionaryBindings(database: DatabaseSync): Map<string, unknown[]> {
  const bindings = new Map<string, unknown[]>();
  const rows = readRows(database, 'shadow_dictionary_bindings');

  for (const row of rows) {
    const objectKey = stringValue(row.object_key);
    const snapshotVersion = stringValue(row.snapshot_version);
    const binding = parseJson(row.details_json, {
      objectKey,
      fieldCode: stringValue(row.field_code),
      label: stringValue(row.label),
      referId: nullableString(row.refer_id),
      source: stringValue(row.source, 'manual_json'),
      resolutionStatus: stringValue(row.resolution_status, 'pending'),
      acceptedValueShape: stringValue(row.accepted_value_shape, 'array<{title,dicId}>'),
      snapshotVersion,
      entries: [],
      updatedAt: nullableString(row.updated_at),
    });
    const key = `${objectKey}\u0000${snapshotVersion}`;
    const current = bindings.get(key) ?? [];
    current.push(binding);
    bindings.set(key, current);
  }

  return bindings;
}

async function clearTables(
  database: Pick<DatabaseConnection, 'query' | 'table'>,
  tableNames: readonly string[],
): Promise<void> {
  for (const tableName of [...tableNames].reverse()) {
    await database.query(`DELETE FROM ${database.table(tableName)}`);
  }
}

async function importAdminApi(
  sqlitePath: string,
  database: DatabaseConnection,
): Promise<Record<string, number>> {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const counts: Record<string, number> = Object.fromEntries(ADMIN_TABLES.map((table) => [table, 0]));

  try {
    await clearTables(database, ADMIN_TABLES);

    for (const row of readRows(sqlite, 'org_sync_runs')) {
      await database.query(
        `
          INSERT INTO ${database.table('org_sync_runs')} (
            id, eid, app_id, trigger_type, status, started_at, finished_at,
            page_count, fetched_count, upserted_count, skipped_count, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          stringValue(row.id),
          stringValue(row.eid),
          stringValue(row.app_id),
          stringValue(row.trigger_type),
          stringValue(row.status),
          stringValue(row.started_at),
          nullableString(row.finished_at),
          integerValue(row.page_count),
          integerValue(row.fetched_count),
          integerValue(row.upserted_count),
          integerValue(row.skipped_count),
          nullableString(row.error_message),
        ],
      );
      counts.org_sync_runs += 1;
    }

    for (const row of readRows(sqlite, 'org_employees')) {
      await database.query(
        `
          INSERT INTO ${database.table('org_employees')} (
            eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at, raw_payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        `,
        [
          stringValue(row.eid),
          stringValue(row.app_id),
          stringValue(row.open_id),
          nullableString(row.uid),
          nullableString(row.name),
          nullableString(row.phone),
          nullableString(row.email),
          nullableString(row.job_title),
          nullableString(row.status),
          stringValue(row.synced_at),
          jsonParam(row.raw_payload_json, {}),
        ],
      );
      counts.org_employees += 1;
    }

    for (const row of readRows(sqlite, 'shadow_object_registry')) {
      await database.query(
        `
          INSERT INTO ${database.table('shadow_object_registry')} (
            object_key, label, enabled, activation_status, form_code_id, form_def_id,
            refresh_status, latest_snapshot_version, latest_schema_hash, last_refresh_at,
            last_error, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          stringValue(row.object_key),
          stringValue(row.label),
          booleanValue(row.enabled),
          stringValue(row.activation_status),
          nullableString(row.form_code_id),
          nullableString(row.form_def_id),
          stringValue(row.refresh_status),
          nullableString(row.latest_snapshot_version),
          nullableString(row.latest_schema_hash),
          nullableString(row.last_refresh_at),
          nullableString(row.last_error),
          stringValue(row.created_at),
          stringValue(row.updated_at),
        ],
      );
      counts.shadow_object_registry += 1;
    }

    const legacyDictionaryBindings = buildLegacyDictionaryBindings(sqlite);
    for (const row of readRows(sqlite, 'shadow_object_snapshots')) {
      const objectKey = stringValue(row.object_key);
      const snapshotVersion = stringValue(row.snapshot_version);
      const bindings = row.dictionary_bindings_json == null
        ? legacyDictionaryBindings.get(`${objectKey}\u0000${snapshotVersion}`) ?? []
        : parseJson(row.dictionary_bindings_json, []);
      await database.query(
        `
          INSERT INTO ${database.table('shadow_object_snapshots')} (
            id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
            normalized_fields_json, dictionary_bindings_json, raw_template_json, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
        `,
        [
          stringValue(row.id),
          objectKey,
          snapshotVersion,
          stringValue(row.schema_hash),
          stringValue(row.form_code_id),
          nullableString(row.form_def_id),
          jsonParam(row.normalized_fields_json, []),
          JSON.stringify(bindings),
          jsonParam(row.raw_template_json, {}),
          stringValue(row.created_at),
        ],
      );
      counts.shadow_object_snapshots += 1;
    }

    for (const row of readRows(sqlite, 'enterprise_ppt_templates')) {
      await database.query(
        `
          INSERT INTO ${database.table('enterprise_ppt_templates')} (
            template_id, name, source_file_name, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          stringValue(row.template_id),
          stringValue(row.name),
          stringValue(row.source_file_name),
          booleanValue(row.is_active),
          stringValue(row.created_at),
          stringValue(row.updated_at),
        ],
      );
      counts.enterprise_ppt_templates += 1;
    }

    for (const row of readRows(sqlite, 'enterprise_ppt_template_settings')) {
      await database.query(
        `
          INSERT INTO ${database.table('enterprise_ppt_template_settings')} (
            singleton_id, default_prompt, created_at, updated_at
          ) VALUES ($1, $2, $3, $4)
        `,
        [
          integerValue(row.singleton_id, 1),
          stringValue(row.default_prompt),
          stringValue(row.created_at),
          stringValue(row.updated_at),
        ],
      );
      counts.enterprise_ppt_template_settings += 1;
    }

    for (const row of readRows(sqlite, 'agent_runs')) {
      await database.query(
        `
          INSERT INTO ${database.table('agent_runs')} (
            run_id, trace_id, eid, app_id, conversation_key, scene_key, user_input,
            intent_frame_json, context_subject_json, task_plan_json, execution_state_json,
            evidence_refs_json, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15)
        `,
        [
          stringValue(row.run_id),
          stringValue(row.trace_id),
          stringValue(row.eid),
          stringValue(row.app_id),
          stringValue(row.conversation_key),
          stringValue(row.scene_key),
          stringValue(row.user_input),
          jsonParam(row.intent_frame_json, {}),
          jsonParam(row.context_subject_json, null),
          jsonParam(row.task_plan_json, {}),
          jsonParam(row.execution_state_json, {}),
          jsonParam(row.evidence_refs_json, []),
          stringValue(row.status),
          stringValue(row.created_at),
          stringValue(row.updated_at),
        ],
      );
      counts.agent_runs += 1;
    }

    for (const row of readRows(sqlite, 'agent_messages')) {
      await database.query(
        `
          INSERT INTO ${database.table('agent_messages')} (
            message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
        `,
        [
          stringValue(row.message_id),
          stringValue(row.run_id),
          stringValue(row.conversation_key),
          stringValue(row.role),
          stringValue(row.content),
          jsonParam(row.attachments_json, []),
          jsonParam(row.extra_info_json, {}),
          stringValue(row.created_at),
        ],
      );
      counts.agent_messages += 1;
    }

    for (const row of readRows(sqlite, 'agent_tool_calls')) {
      await database.query(
        `
          INSERT INTO ${database.table('agent_tool_calls')} (
            tool_call_id, run_id, tool_code, status, input_summary, output_summary,
            started_at, finished_at, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          stringValue(row.tool_call_id),
          stringValue(row.run_id),
          stringValue(row.tool_code),
          stringValue(row.status),
          stringValue(row.input_summary),
          stringValue(row.output_summary),
          stringValue(row.started_at),
          nullableString(row.finished_at),
          nullableString(row.error_message),
        ],
      );
      counts.agent_tool_calls += 1;
    }

    for (const row of readRows(sqlite, 'agent_confirmations')) {
      await database.query(
        `
          INSERT INTO ${database.table('agent_confirmations')} (
            confirmation_id, run_id, tool_code, status, title, summary,
            preview_json, request_input_json, created_at, decided_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
        `,
        [
          stringValue(row.confirmation_id),
          stringValue(row.run_id),
          stringValue(row.tool_code),
          stringValue(row.status),
          stringValue(row.title),
          stringValue(row.summary),
          jsonParam(row.preview_json, {}),
          jsonParam(row.request_input_json, {}),
          stringValue(row.created_at),
          nullableString(row.decided_at),
        ],
      );
      counts.agent_confirmations += 1;
    }

    for (const row of readRows(sqlite, 'artifact_ppt_generations')) {
      await database.query(
        `
          INSERT INTO ${database.table('artifact_ppt_generations')} (
            generation_id, artifact_id, version_id, title, status, job_id,
            ppt_artifact_json, error_message, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
        `,
        [
          stringValue(row.generation_id),
          stringValue(row.artifact_id),
          stringValue(row.version_id),
          stringValue(row.title),
          stringValue(row.status),
          nullableString(row.job_id),
          jsonParam(row.ppt_artifact_json, null),
          nullableString(row.error_message),
          stringValue(row.created_at),
          stringValue(row.updated_at),
        ],
      );
      counts.artifact_ppt_generations += 1;
    }
  } finally {
    sqlite.close();
  }

  return counts;
}

async function importSkillRuntime(
  sqlitePath: string,
  database: SkillDatabaseConnection,
): Promise<Record<string, number>> {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const counts: Record<string, number> = Object.fromEntries(SKILL_RUNTIME_TABLES.map((table) => [table, 0]));

  try {
    await clearTables(database as unknown as DatabaseConnection, SKILL_RUNTIME_TABLES);

    for (const row of readRows(sqlite, 'jobs')) {
      await database.query(
        `
          INSERT INTO ${database.table('jobs')} (
            job_id, skill_name, model, request_text, attachments_json, working_directory,
            template_id, presentation_prompt, status, final_text, error_json,
            created_at, updated_at, started_at, finished_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
        `,
        [
          stringValue(row.job_id),
          stringValue(row.skill_name),
          stringValue(row.model),
          stringValue(row.request_text),
          jsonParam(row.attachments_json, []),
          nullableString(row.working_directory),
          nullableString(row.template_id),
          nullableString(row.presentation_prompt),
          stringValue(row.status),
          nullableString(row.final_text),
          jsonParam(row.error_json, null),
          stringValue(row.created_at),
          stringValue(row.updated_at),
          nullableString(row.started_at),
          nullableString(row.finished_at),
        ],
      );
      counts.jobs += 1;
    }

    for (const row of readRows(sqlite, 'job_events')) {
      await database.query(
        `
          INSERT INTO ${database.table('job_events')} (
            id, job_id, type, message, data_json, created_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        `,
        [
          stringValue(row.id),
          stringValue(row.job_id),
          stringValue(row.type),
          stringValue(row.message),
          jsonParam(row.data_json, null),
          stringValue(row.created_at),
        ],
      );
      counts.job_events += 1;
    }

    for (const row of readRows(sqlite, 'job_artifacts')) {
      await database.query(
        `
          INSERT INTO ${database.table('job_artifacts')} (
            artifact_id, job_id, file_name, mime_type, file_path, byte_size, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          stringValue(row.artifact_id),
          stringValue(row.job_id),
          stringValue(row.file_name),
          stringValue(row.mime_type),
          stringValue(row.file_path),
          integerValue(row.byte_size),
          stringValue(row.created_at),
        ],
      );
      counts.job_artifacts += 1;
    }
  } finally {
    sqlite.close();
  }

  return counts;
}

export async function migrateSqliteToPostgres(
  options: SqliteToPostgresMigrationOptions,
): Promise<SqliteToPostgresMigrationSummary> {
  const logger = options.logger ?? console;
  const adminDatabase = await openAdminDatabase(options.adminPostgresUrl, options.adminPostgresSchema);
  const skillRuntimeDatabase = await openSkillDatabase(
    options.skillRuntimePostgresUrl,
    options.skillRuntimePostgresSchema,
  );

  try {
    const adminSkipped = !existsSync(options.adminSqlitePath);
    const skillSkipped = !existsSync(options.skillRuntimeSqlitePath);

    const adminTables = adminSkipped
      ? Object.fromEntries(ADMIN_TABLES.map((table) => [table, 0]))
      : await importAdminApi(options.adminSqlitePath, adminDatabase);
    const skillTables = skillSkipped
      ? Object.fromEntries(SKILL_RUNTIME_TABLES.map((table) => [table, 0]))
      : await importSkillRuntime(options.skillRuntimeSqlitePath, skillRuntimeDatabase);

    if (adminSkipped) {
      logger.warn(`[migrate] admin-api SQLite not found, skipped: ${options.adminSqlitePath}`);
    } else {
      logger.log(`[migrate] admin-api imported into schema ${options.adminPostgresSchema}`);
    }

    if (skillSkipped) {
      logger.warn(`[migrate] skill-runtime SQLite not found, skipped: ${options.skillRuntimeSqlitePath}`);
    } else {
      logger.log(`[migrate] skill-runtime imported into schema ${options.skillRuntimePostgresSchema}`);
    }

    return {
      adminApi: {
        sqlitePath: options.adminSqlitePath,
        postgresSchema: options.adminPostgresSchema,
        skipped: adminSkipped,
        tables: adminTables,
      },
      skillRuntime: {
        sqlitePath: options.skillRuntimeSqlitePath,
        postgresSchema: options.skillRuntimePostgresSchema,
        skipped: skillSkipped,
        tables: skillTables,
      },
    };
  } finally {
    await adminDatabase.close();
    await skillRuntimeDatabase.close();
  }
}

function loadOptionsFromEnv(): SqliteToPostgresMigrationOptions {
  const envFilePath = findEnvFile();
  if (existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }
  const envDir = dirname(envFilePath);

  return {
    adminSqlitePath: resolve(envDir, process.env.ORG_SYNC_SQLITE_PATH || '.local/admin-api.sqlite'),
    skillRuntimeSqlitePath: resolve(envDir, process.env.SKILL_RUNTIME_SQLITE_PATH || '.local/skill-runtime.sqlite'),
    adminPostgresUrl: (process.env.ADMIN_API_POSTGRES_URL || DEFAULT_POSTGRES_URL).trim(),
    adminPostgresSchema: (process.env.ADMIN_API_POSTGRES_SCHEMA || 'admin_api').trim(),
    skillRuntimePostgresUrl: (process.env.SKILL_RUNTIME_POSTGRES_URL || DEFAULT_POSTGRES_URL).trim(),
    skillRuntimePostgresSchema: (process.env.SKILL_RUNTIME_POSTGRES_SCHEMA || 'skill_runtime').trim(),
  };
}

async function main(): Promise<void> {
  const summary = await migrateSqliteToPostgres(loadOptionsFromEnv());
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
