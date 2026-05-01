import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openDatabase, type DatabaseConnection } from '../src/database.js';

const POSTGRES_URL = (process.env.SKILL_RUNTIME_POSTGRES_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev').trim();

function createSchemaName(): string {
  return `skill_runtime_test_${process.pid}_${randomUUID().replace(/-/g, '')}`;
}

async function withSkillRuntimeDatabase<T>(run: (database: DatabaseConnection) => Promise<T>): Promise<T> {
  const database = await openDatabase(POSTGRES_URL, createSchemaName());
  try {
    return await run(database);
  } finally {
    await database.dropSchema();
    await database.close();
  }
}

test('openDatabase creates skill-runtime PostgreSQL tables for fresh schema', async () => {
  await withSkillRuntimeDatabase(async (database) => {
    const rows = await database.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name ASC
      `,
      [database.schema],
    );

    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['job_artifacts', 'job_events', 'jobs'],
    );
  });
});

test('openDatabase initialization is idempotent', async () => {
  const schema = createSchemaName();
  const first = await openDatabase(POSTGRES_URL, schema);
  await first.close();

  const second = await openDatabase(POSTGRES_URL, schema);
  try {
    const row = await second.queryOne<{ total: string }>(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      `,
      [schema],
    );
    assert.equal(Number(row.total), 3);
  } finally {
    await second.dropSchema();
    await second.close();
  }
});
