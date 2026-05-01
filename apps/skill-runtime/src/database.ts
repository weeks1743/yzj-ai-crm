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

export class PostgresDatabase extends QueryContext implements DatabaseConnection {
  private constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    super(pool, schema);
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
      CREATE TABLE IF NOT EXISTS ${table('jobs')} (
        job_id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        model TEXT NOT NULL,
        request_text TEXT NOT NULL,
        attachments_json JSONB NOT NULL,
        working_directory TEXT,
        template_id TEXT,
        presentation_prompt TEXT,
        status TEXT NOT NULL,
        final_text TEXT,
        error_json JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ${table('job_events')} (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json JSONB,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${table('job_artifacts')} (
        artifact_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_job_events_job_id`)}
      ON ${table('job_events')}(job_id, created_at, id);

      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${normalizedSchema}_job_artifacts_job_id`)}
      ON ${table('job_artifacts')}(job_id, created_at, artifact_id);
    `);
  }

export async function openDatabase(
  postgresUrl: string,
  postgresSchema: string,
): Promise<PostgresDatabase> {
  return PostgresDatabase.open({ postgresUrl, postgresSchema });
}
