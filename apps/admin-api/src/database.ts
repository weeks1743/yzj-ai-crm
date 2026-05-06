import { Pool, type PoolClient, type QueryResultRow } from 'pg';

type QueryParams = readonly unknown[];
type QueryExecutor = Pool | PoolClient;

export interface DatabaseQueryContext {
  readonly schema: string;
  table(tableName: string): string;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: QueryParams,
  ): Promise<T[]>;
  queryMaybeOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: QueryParams,
  ): Promise<T | null>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: QueryParams,
  ): Promise<T>;
}

export interface DatabaseConnection extends DatabaseQueryContext {
  transaction<T>(run: (database: DatabaseQueryContext) => Promise<T>): Promise<T>;
  dropSchema(): Promise<void>;
  close(): Promise<void>;
}

export function assertSchemaName(schema: string): string {
  const normalized = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schema}`);
  }
  return normalized;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

class QueryContext implements DatabaseQueryContext {
  constructor(
    protected readonly executor: QueryExecutor,
    readonly schema: string,
  ) {}

  table(tableName: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(tableName)}`;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: QueryParams = [],
  ): Promise<T[]> {
    const result = await this.executor.query<T>(text, [...params]);
    return result.rows;
  }

  async queryMaybeOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: QueryParams = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: QueryParams = [],
  ): Promise<T> {
    const row = await this.queryMaybeOne<T>(text, params);
    if (!row) {
      throw new Error('Expected query to return a row');
    }
    return row;
  }
}

class TransactionContext extends QueryContext {}

export class PostgresDatabase extends QueryContext implements DatabaseConnection {
  private constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    super(pool, schema);
  }

  async transaction<T>(run: (database: TransactionContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(new TransactionContext(client, this.schema));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async dropSchema(): Promise<void> {
    await this.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(this.schema)} CASCADE`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  static async open(options: {
    postgresUrl: string;
    postgresSchema: string;
  }): Promise<PostgresDatabase> {
    const schema = assertSchemaName(options.postgresSchema);
    const pool = new Pool({
      connectionString: options.postgresUrl,
    });
    const database = new PostgresDatabase(pool, schema);
    try {
      await database.initialize();
      return database;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    await initializeDatabaseSchema(this.pool, this.schema);
  }
}

export async function initializeDatabaseSchema(
  executor: QueryExecutor,
  schema: string,
): Promise<void> {
  const normalizedSchema = assertSchemaName(schema);
  const table = (tableName: string) => `${quoteIdentifier(normalizedSchema)}.${quoteIdentifier(tableName)}`;
  await executor.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(normalizedSchema)}`);
  await executor.query(`
      CREATE TABLE IF NOT EXISTS ${table('org_sync_runs')} (
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

      CREATE TABLE IF NOT EXISTS ${table('org_employees')} (
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
        raw_payload_json JSONB NOT NULL,
        PRIMARY KEY (eid, app_id, open_id)
      );

      CREATE TABLE IF NOT EXISTS ${table('shadow_object_registry')} (
        object_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
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

      CREATE TABLE IF NOT EXISTS ${table('shadow_object_snapshots')} (
        id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        snapshot_version TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        form_code_id TEXT NOT NULL,
        form_def_id TEXT,
        normalized_fields_json JSONB NOT NULL,
        dictionary_bindings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_template_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (object_key, snapshot_version)
      );

      CREATE TABLE IF NOT EXISTS ${table('enterprise_ppt_templates')} (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${table('enterprise_ppt_template_settings')} (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        default_prompt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_enterprise_ppt_single_active`)}
      ON ${table('enterprise_ppt_templates')}(is_active)
      WHERE is_active;

      CREATE TABLE IF NOT EXISTS ${table('agent_runs')} (
        run_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        eid TEXT NOT NULL,
        app_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        scene_key TEXT NOT NULL,
        user_input TEXT NOT NULL,
        intent_frame_json JSONB NOT NULL,
        context_subject_json JSONB,
        task_plan_json JSONB NOT NULL,
        execution_state_json JSONB NOT NULL,
        evidence_refs_json JSONB NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${table('agent_messages')} (
        message_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments_json JSONB NOT NULL,
        extra_info_json JSONB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${table('agent_conversations')} (
        conversation_key TEXT PRIMARY KEY,
        operator_open_id TEXT NOT NULL,
        label TEXT NOT NULL,
        route TEXT NOT NULL,
        group_name TEXT NOT NULL,
        last_message TEXT NOT NULL,
        updated_label TEXT NOT NULL,
        scene_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${table('agent_personal_settings')} (
        eid TEXT NOT NULL,
        app_id TEXT NOT NULL,
        operator_open_id TEXT NOT NULL,
        soul_prompt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (eid, operator_open_id)
      );

      CREATE TABLE IF NOT EXISTS ${table('agent_tool_calls')} (
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

      CREATE TABLE IF NOT EXISTS ${table('agent_confirmations')} (
        confirmation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_code TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        preview_json JSONB NOT NULL,
        request_input_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_agent_runs_conversation_recent`)}
      ON ${table('agent_runs')}(conversation_key, created_at DESC, run_id DESC);

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_agent_conversations_operator_recent`)}
      ON ${table('agent_conversations')}(operator_open_id, updated_at DESC, conversation_key DESC);

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_agent_personal_settings_user`)}
      ON ${table('agent_personal_settings')}(eid, operator_open_id);

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_agent_tool_calls_run`)}
      ON ${table('agent_tool_calls')}(run_id, started_at ASC, tool_call_id ASC);

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_agent_confirmations_run_status`)}
      ON ${table('agent_confirmations')}(run_id, status, created_at DESC, confirmation_id DESC);

      CREATE TABLE IF NOT EXISTS ${table('artifact_ppt_generations')} (
        generation_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        job_id TEXT,
        ppt_artifact_json JSONB,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_artifact_ppt_generations_artifact`)}
      ON ${table('artifact_ppt_generations')}(artifact_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ${table('artifact_image_generations')} (
        generation_id TEXT PRIMARY KEY,
        eid TEXT NOT NULL,
        app_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT,
        file_path TEXT,
        file_name TEXT,
        mime_type TEXT,
        byte_size INTEGER,
        model TEXT,
        provider TEXT,
        size TEXT,
        quality TEXT,
        latency_ms INTEGER,
        error_message TEXT,
        generated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_artifact_image_generations_artifact`)}
      ON ${table('artifact_image_generations')}(artifact_id, updated_at DESC);
    `);
  }

export async function openDatabase(
  postgresUrl: string,
  postgresSchema: string,
): Promise<PostgresDatabase> {
  return PostgresDatabase.open({ postgresUrl, postgresSchema });
}
