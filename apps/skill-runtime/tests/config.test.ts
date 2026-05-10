import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppConfig } from '../src/config.js';

test('loadAppConfig parses defaults and resolves skill runtime paths', () => {
  const config = loadAppConfig({
    env: {
      SKILL_RUNTIME_PORT: '4012',
      SKILL_RUNTIME_ALLOWED_ROOTS: 'tmp,3rdSkill',
      SKILL_RUNTIME_SKILL_DIRS: '3rdSkill',
      DEEPSEEK_DEFAULT_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'key-a',
      ARK_API_KEY: 'key-b',
      ARK_WEB_SEARCH_MODEL: 'ep-web-search-001',
    },
    envFilePath: '/repo/.env',
  });

  assert.equal(config.server.port, 4012);
  assert.equal(config.deepseek.defaultModel, 'deepseek-v4-flash');
  assert.deepEqual(config.runtime.skillDirs, ['/repo/3rdSkill']);
  assert.deepEqual(config.runtime.allowedRoots, ['/repo/tmp', '/repo/3rdSkill']);
  assert.equal(config.ark.webSearchModel, 'ep-web-search-001');
  assert.equal(config.storage.postgresUrl, 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev');
  assert.equal(config.storage.postgresSchema, 'skill_runtime');
});

test('loadAppConfig rejects non-whitelisted default model', () => {
  assert.throws(
    () =>
      loadAppConfig({
        env: {
          DEEPSEEK_DEFAULT_MODEL: 'gpt-4.1',
        },
        envFilePath: '/repo/.env',
      }),
    /DEEPSEEK_DEFAULT_MODEL/,
  );
});

test('loadAppConfig rejects invalid PostgreSQL schema name', () => {
  assert.throws(
    () =>
      loadAppConfig({
        env: {
          SKILL_RUNTIME_POSTGRES_SCHEMA: 'bad-schema',
        },
        envFilePath: '/repo/.env',
      }),
    /SKILL_RUNTIME_POSTGRES_SCHEMA/,
  );
});
