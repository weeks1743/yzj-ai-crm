import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openDatabase } from '../src/database.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';

test('openDatabase creates minimal shadow tables for fresh database', () => {
  const database = openDatabase(':memory:');

  try {
    const rows = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'shadow_%'
          ORDER BY name ASC
        `,
      )
      .all() as unknown as Array<{ name: string }>;

    assert.deepEqual(
      rows.map((row) => row.name),
      ['shadow_object_registry', 'shadow_object_snapshots'],
    );

    const pptTemplateTable = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'enterprise_ppt_templates'
          LIMIT 1
        `,
      )
      .get() as unknown as { name: string } | undefined;
    assert.equal(pptTemplateTable?.name, 'enterprise_ppt_templates');

    const pptTemplateSettingsTable = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'enterprise_ppt_template_settings'
          LIMIT 1
        `,
      )
      .get() as unknown as { name: string } | undefined;
    assert.equal(pptTemplateSettingsTable?.name, 'enterprise_ppt_template_settings');
  } finally {
    database.close();
  }
});

test('openDatabase migrates legacy dictionary bindings into snapshot json', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-db-'));
  const databasePath = join(tempDir, 'admin-api.sqlite');

  try {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
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
    `);

    legacyDatabase
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

    legacyDatabase
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
              code: null,
              state: null,
              sort: null,
              source: 'manual_json',
              sourceVersion: '2026-04-23T09:00:00.000Z',
              aliases: [],
            },
          ],
        }),
        '2026-04-23T09:00:00.000Z',
      );
    legacyDatabase.close();

    const database = openDatabase(databasePath);

    try {
      const snapshot = new ShadowMetadataRepository(database).getLatestSnapshot('customer');
      assert.equal(snapshot?.dictionaryBindings.length, 1);
      assert.equal(snapshot?.dictionaryBindings[0]?.fieldCode, 'Pw_0');
      assert.equal(snapshot?.dictionaryBindings[0]?.entries[0]?.dicId, 'd005a1');
    } finally {
      database.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
