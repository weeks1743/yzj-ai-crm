import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentPersonalSettingsService,
  DEFAULT_SOUL_PROMPT,
} from '../src/agent-personal-settings-service.js';
import { createTestConfig, createInMemoryDatabase } from './test-helpers.js';

test('AgentPersonalSettingsService reads default SOUL and resolves employee display name', async () => {
  const database = createInMemoryDatabase();
  const config = createTestConfig();
  await database.query(
    `
      INSERT INTO ${database.table('org_employees')} (
        eid,
        app_id,
        open_id,
        uid,
        name,
        phone,
        email,
        job_title,
        status,
        synced_at,
        raw_payload_json
      ) VALUES ($1, $2, $3, NULL, $4, NULL, NULL, NULL, '1', $5, '{}'::jsonb)
    `,
    [
      config.yzj.eid,
      config.yzj.appId,
      '69e75eb5e4b0e65b61c014da',
      '陈伟棠',
      new Date().toISOString(),
    ],
  );

  const service = new AgentPersonalSettingsService({
    config,
    database,
    orgSyncRepository: {
      findEmployees: async (input) => {
        const rows = await database.query<{
          eid: string;
          app_id: string;
          open_id: string;
          name: string | null;
          status: string | null;
          synced_at: string;
        }>(
          `
            SELECT eid, app_id, open_id, name, status, synced_at
            FROM ${database.table('org_employees')}
            WHERE eid = $1 AND app_id = $2 AND open_id = $3
          `,
          [input.eid, input.appId, input.keyword],
        );
        return rows.map((row) => ({
          eid: row.eid,
          appId: row.app_id,
          openId: row.open_id,
          uid: null,
          name: row.name,
          phone: null,
          email: null,
          jobTitle: null,
          status: row.status,
          syncedAt: row.synced_at,
        }));
      },
    },
  });

  const settings = await service.getSettings('69e75eb5e4b0e65b61c014da');
  assert.equal(settings.displayName, '陈伟棠');
  assert.equal(settings.roleLabel, '金蝶云之家销售');
  assert.equal(settings.soulPrompt, DEFAULT_SOUL_PROMPT);
  assert.equal(settings.isDefaultSoulPrompt, true);
  assert.equal(settings.updatedAt, null);
});

test('AgentPersonalSettingsService saves, isolates and clears SOUL by eid and openId', async () => {
  const database = createInMemoryDatabase();
  const config = createTestConfig();
  const service = new AgentPersonalSettingsService({ config, database });

  const saved = await service.updateSettings({
    operatorOpenId: 'oid-a',
    soulPrompt: '我是销售 A 的 SOUL',
  });
  assert.equal(saved.soulPrompt, '我是销售 A 的 SOUL');
  assert.equal(saved.isDefaultSoulPrompt, false);
  assert.ok(saved.updatedAt);

  const other = await service.getSettings('oid-b');
  assert.equal(other.soulPrompt, DEFAULT_SOUL_PROMPT);
  assert.equal(other.isDefaultSoulPrompt, true);

  const cleared = await service.updateSettings({
    operatorOpenId: 'oid-a',
    soulPrompt: '   ',
  });
  assert.equal(cleared.soulPrompt, DEFAULT_SOUL_PROMPT);
  assert.equal(cleared.isDefaultSoulPrompt, true);

  await assert.rejects(() => service.getSettings(' '), /operatorOpenId 不能为空/);
});
