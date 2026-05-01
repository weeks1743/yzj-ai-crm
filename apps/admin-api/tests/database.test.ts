import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openDatabase, type DatabaseConnection } from '../src/database.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { migrateSqliteToPostgres } from '../scripts/migrate-sqlite-to-postgres.js';

const POSTGRES_URL = (process.env.ADMIN_API_POSTGRES_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev').trim();

function createSchemaName(prefix: string): string {
  return `${prefix}_${process.pid}_${randomUUID().replace(/-/g, '')}`;
}

async function withAdminDatabase<T>(run: (database: DatabaseConnection) => Promise<T>): Promise<T> {
  const database = await openDatabase(POSTGRES_URL, createSchemaName('admin_api_test'));
  try {
    return await run(database);
  } finally {
    await database.dropSchema();
    await database.close();
  }
}

test('openDatabase creates admin-api PostgreSQL tables for fresh schema', async () => {
  await withAdminDatabase(async (database) => {
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
      [
        'agent_confirmations',
        'agent_conversations',
        'agent_messages',
        'agent_runs',
        'agent_tool_calls',
        'artifact_ppt_generations',
        'enterprise_ppt_template_settings',
        'enterprise_ppt_templates',
        'org_employees',
        'org_sync_runs',
        'shadow_object_registry',
        'shadow_object_snapshots',
      ],
    );
  });
});

test('openDatabase initialization is idempotent', async () => {
  const schema = createSchemaName('admin_api_test');
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
    assert.equal(Number(row.total), 12);
  } finally {
    await second.dropSchema();
    await second.close();
  }
});

test('SQLite to PostgreSQL migration imports legacy dictionary bindings into snapshot json', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-sqlite-pg-migration-'));
  const adminSqlitePath = join(tempDir, 'admin-api.sqlite');
  const skillSqlitePath = join(tempDir, 'skill-runtime.sqlite');
  const adminSchema = createSchemaName('admin_api_migrate_test');
  const skillSchema = createSchemaName('skill_runtime_migrate_test');

  try {
    const legacyAdmin = new DatabaseSync(adminSqlitePath);
    legacyAdmin.exec(`
      CREATE TABLE shadow_object_snapshots (
        id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        snapshot_version TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        form_code_id TEXT NOT NULL,
        form_def_id TEXT,
        normalized_fields_json TEXT NOT NULL,
        raw_template_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(object_key, snapshot_version)
      );

      CREATE TABLE shadow_dictionary_bindings (
        object_key TEXT NOT NULL,
        field_code TEXT NOT NULL,
        label TEXT NOT NULL,
        refer_id TEXT,
        source TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        accepted_value_shape TEXT NOT NULL,
        snapshot_version TEXT NOT NULL,
        resolved_entry_count INTEGER NOT NULL DEFAULT 0,
        details_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (object_key, field_code, snapshot_version)
      );

      CREATE TABLE enterprise_ppt_templates (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacyAdmin
      .prepare(
        `
          INSERT INTO shadow_object_snapshots (
            id, object_key, snapshot_version, schema_hash, form_code_id, form_def_id,
            normalized_fields_json, raw_template_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'snapshot-1',
        'customer',
        '2026-04-23T09:00:00.000Z',
        'schema-hash-1',
        'customer-form-001',
        'form-def-001',
        JSON.stringify([]),
        JSON.stringify({}),
        '2026-04-23T09:00:00.000Z',
      );
    legacyAdmin
      .prepare(
        `
          INSERT INTO shadow_dictionary_bindings (
            object_key, field_code, label, refer_id, source, resolution_status,
            accepted_value_shape, snapshot_version, resolved_entry_count, details_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'customer',
        'Pw_0',
        '地区',
        'd_region',
        'manual_json',
        'resolved',
        'array<{title,dicId}>',
        '2026-04-23T09:00:00.000Z',
        1,
        JSON.stringify({
          objectKey: 'customer',
          fieldCode: 'Pw_0',
          label: '地区',
          referId: 'd_region',
          source: 'manual_json',
          resolutionStatus: 'resolved',
          acceptedValueShape: 'array<{title,dicId}>',
          snapshotVersion: '2026-04-23T09:00:00.000Z',
          entries: [
            {
              referId: 'd_region',
              dicId: 'd005a1',
              title: '北京',
              aliases: [],
            },
          ],
        }),
        '2026-04-23T09:00:00.000Z',
      );
    legacyAdmin
      .prepare(
        `
          INSERT INTO enterprise_ppt_templates (
            template_id, name, source_file_name, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run('tpl-1', '默认模板', 'template.pptx', 1, '2026-04-23T09:00:00.000Z', '2026-04-23T09:00:00.000Z');
    legacyAdmin.close();

    const legacySkill = new DatabaseSync(skillSqlitePath);
    legacySkill.exec(`
      CREATE TABLE jobs (
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
    `);
    legacySkill
      .prepare(
        `
          INSERT INTO jobs (
            job_id, skill_name, model, request_text, attachments_json,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'job-1',
        'company-research',
        'deepseek-v4-flash',
        'Research Acme',
        JSON.stringify([]),
        'queued',
        '2026-04-23T09:00:00.000Z',
        '2026-04-23T09:00:00.000Z',
      );
    legacySkill.close();

    const summary = await migrateSqliteToPostgres({
      adminSqlitePath,
      skillRuntimeSqlitePath: skillSqlitePath,
      adminPostgresUrl: POSTGRES_URL,
      skillRuntimePostgresUrl: POSTGRES_URL,
      adminPostgresSchema: adminSchema,
      skillRuntimePostgresSchema: skillSchema,
      logger: { log: () => undefined, warn: () => undefined },
    });

    assert.equal(summary.adminApi.tables.shadow_object_snapshots, 1);
    assert.equal(summary.adminApi.tables.enterprise_ppt_templates, 1);
    assert.equal(summary.skillRuntime.tables.jobs, 1);

    const adminDatabase = await openDatabase(POSTGRES_URL, adminSchema);
    try {
      const snapshot = await new ShadowMetadataRepository(adminDatabase).getLatestSnapshot('customer');
      assert.equal(snapshot?.dictionaryBindings.length, 1);
      assert.equal(snapshot?.dictionaryBindings[0]?.fieldCode, 'Pw_0');
      assert.equal(snapshot?.dictionaryBindings[0]?.entries[0]?.dicId, 'd005a1');
      const activeTemplate = await adminDatabase.queryOne<{ template_id: string }>(
        `SELECT template_id FROM ${adminDatabase.table('enterprise_ppt_templates')} WHERE is_active = true`,
      );
      assert.equal(activeTemplate.template_id, 'tpl-1');
    } finally {
      await adminDatabase.dropSchema();
      await adminDatabase.close();
    }

    const skillDatabase = await openDatabase(POSTGRES_URL, skillSchema);
    try {
      const job = await skillDatabase.queryOne<{ job_id: string; attachments_json: unknown }>(
        `SELECT job_id, attachments_json FROM ${skillDatabase.table('jobs')} WHERE job_id = 'job-1'`,
      );
      assert.equal(job.job_id, 'job-1');
      assert.deepEqual(job.attachments_json, []);
    } finally {
      await skillDatabase.dropSchema();
      await skillDatabase.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
