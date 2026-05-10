import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ADMIN_API_ENV_CONTRACT_KEYS,
  ADMIN_API_REQUIRED_CONNECTION_ENV_KEYS,
  ADMIN_API_REQUIRED_ENV_KEYS,
  loadAppConfig,
} from '../src/config.js';
import { ConfigError } from '../src/errors.js';

const baseEnv = {
  YZJ_EID: '21024647',
  YZJ_APP_ID: '501037729',
  YZJ_APP_SECRET: 'secret-value',
  YZJ_SIGN_KEY: 'sign-value',
  YZJ_ORG_READ_SECRET: 'org-read-value',
  YZJ_APPROVAL_APP_ID: 'approval-app-id',
  YZJ_APPROVAL_APP_SECRET: 'approval-app-secret',
  YZJ_APPROVAL_DEV_KEY: 'approval-dev-key',
  YZJ_APPROVAL_FILE_SECRET: 'approval-file-secret',
  YZJ_LIGHTCLOUD_APP_ID: 'lightcloud-app-id',
  YZJ_LIGHTCLOUD_APP_SECRET: 'lightcloud-app-secret',
  YZJ_LIGHTCLOUD_SECRET: 'lightcloud-secret',
  YZJ_SHADOW_CUSTOMER_FORM_CODE_ID: 'customer-form-code-id',
  YZJ_SHADOW_CONTACT_FORM_CODE_ID: 'contact-form-code-id',
  YZJ_SHADOW_OPPORTUNITY_FORM_CODE_ID: 'opportunity-form-code-id',
  YZJ_SHADOW_FOLLOWUP_FORM_CODE_ID: 'followup-form-code-id',
  ADMIN_API_POSTGRES_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev',
  SKILL_RUNTIME_POSTGRES_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev',
  MONGODB_URI: 'mongodb://127.0.0.1:27018',
  QDRANT_URL: 'http://127.0.0.1:6333',
  SKILL_RUNTIME_BASE_URL: 'http://127.0.0.1:3012',
  TONGYI_AUDIO_SERVICE_BASE_URL: 'http://127.0.0.1:3018',
} satisfies NodeJS.ProcessEnv;

test('loadAppConfig loads required env values and defaults', () => {
  const config = loadAppConfig({
    env: baseEnv,
  });

  assert.equal(config.yzj.eid, '21024647');
  assert.equal(config.yzj.appId, '501037729');
  assert.equal(config.shadow.objects.customer.formCodeId, 'customer-form-code-id');
  assert.equal(config.shadow.objects.contact.formCodeId, 'contact-form-code-id');
  assert.equal(config.shadow.objects.opportunity.formCodeId, 'opportunity-form-code-id');
  assert.equal(config.shadow.objects.followup.formCodeId, 'followup-form-code-id');
  assert.equal(config.shadow.objects.opportunity.enabled, true);
  assert.equal(config.shadow.objects.followup.enabled, true);
  assert.equal(config.yzj.approval.fileSecret, 'approval-file-secret');
  assert.equal(config.shadow.dictionarySource, 'manual_json');
  assert.equal(config.server.port, 3001);
  assert.equal(config.storage.postgresUrl, 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev');
  assert.equal(config.storage.postgresSchema, 'admin_api');
  assert.match(config.shadow.dictionaryJsonPath, /\.local\/shadow-dictionaries\.json$/);
  assert.match(config.shadow.skillOutputDir, /skills\/shadow$/);
  assert.equal(config.external.image.baseUrl, 'https://api.linkapi.org');
  assert.equal(config.external.image.apiKey, null);
  assert.equal(config.external.image.model, 'gpt-image-2');
  assert.equal(config.external.image.timeoutMs, 150000);
  assert.equal(config.external.skillRuntime.baseUrl, 'http://127.0.0.1:3012');
  assert.equal(config.external.tongyiAudioService.baseUrl, 'http://127.0.0.1:3018');
  assert.equal(config.external.tongyiAudioService.publicBaseUrl, 'http://127.0.0.1:3018');
});

test('loadAppConfig separates internal Tongyi audio service URL from public viewer URL', () => {
  const config = loadAppConfig({
    env: {
      ...baseEnv,
      TONGYI_AUDIO_SERVICE_BASE_URL: 'http://tongyi-audio-service:3018',
      TONGYI_AUDIO_PUBLIC_BASE_URL: 'https://chat.xiami66.com/audio-viewer',
    },
  });

  assert.equal(config.external.tongyiAudioService.baseUrl, 'http://tongyi-audio-service:3018');
  assert.equal(config.external.tongyiAudioService.publicBaseUrl, 'https://chat.xiami66.com/audio-viewer');
});

test('loadAppConfig rejects invalid PostgreSQL schema name', () => {
  assert.throws(
    () =>
      loadAppConfig({
        env: {
          ...baseEnv,
          ADMIN_API_POSTGRES_SCHEMA: 'bad-schema',
        },
      }),
    /ADMIN_API_POSTGRES_SCHEMA/,
  );
});

test('loadAppConfig throws when required env is missing', () => {
  assert.throws(
    () =>
      loadAppConfig({
        env: {
          YZJ_APP_ID: '501037729',
          YZJ_APP_SECRET: 'secret-value',
          YZJ_SIGN_KEY: 'sign-value',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /YZJ_EID/);
      assert.match(error.message, /YZJ_ORG_READ_SECRET/);
      assert.match(error.message, /YZJ_APPROVAL_APP_ID/);
      assert.match(error.message, /YZJ_SHADOW_CUSTOMER_FORM_CODE_ID/);
      assert.match(error.message, /ADMIN_API_POSTGRES_URL/);
      assert.match(error.message, /SKILL_RUNTIME_POSTGRES_URL/);
      assert.match(error.message, /MONGODB_URI/);
      assert.match(error.message, /QDRANT_URL/);
      assert.match(error.message, /SKILL_RUNTIME_BASE_URL/);
      assert.match(error.message, /TONGYI_AUDIO_SERVICE_BASE_URL/);
      assert.deepEqual((error.details as any).missingKeys, [
        'YZJ_EID',
        'YZJ_ORG_READ_SECRET',
        'YZJ_APPROVAL_APP_ID',
        'YZJ_APPROVAL_APP_SECRET',
        'YZJ_APPROVAL_DEV_KEY',
        'YZJ_LIGHTCLOUD_APP_ID',
        'YZJ_LIGHTCLOUD_APP_SECRET',
        'YZJ_LIGHTCLOUD_SECRET',
        'YZJ_SHADOW_CUSTOMER_FORM_CODE_ID',
        'ADMIN_API_POSTGRES_URL',
        'SKILL_RUNTIME_POSTGRES_URL',
        'MONGODB_URI',
        'QDRANT_URL',
        'SKILL_RUNTIME_BASE_URL',
        'TONGYI_AUDIO_SERVICE_BASE_URL',
      ]);
      return true;
    },
  );
});

test('loadAppConfig rejects empty or placeholder org read secret', () => {
  for (const value of ['', 'your_org_read_secret', '<YZJ_ORG_READ_SECRET>']) {
    assert.throws(
      () =>
        loadAppConfig({
          env: {
            ...baseEnv,
            YZJ_ORG_READ_SECRET: value,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /YZJ_ORG_READ_SECRET/);
        const details = error.details as {
          missingKeys?: string[];
          placeholderKeys?: string[];
          hints?: string[];
        };
        assert.ok(
          details.missingKeys?.includes('YZJ_ORG_READ_SECRET')
            || details.placeholderKeys?.includes('YZJ_ORG_READ_SECRET'),
        );
        assert.equal(
          details.hints?.some((item) => item.includes('本地 .env 与 Docker env 使用同名 key')),
          true,
        );
        return true;
      },
    );
  }
});

test('loadAppConfig accepts Docker service-name connection values', () => {
  const config = loadAppConfig({
    env: {
      ...baseEnv,
      ADMIN_API_POSTGRES_URL: 'postgresql://postgres:encoded-password@postgres:5432/yzj_ai_crm',
      SKILL_RUNTIME_POSTGRES_URL: 'postgresql://postgres:encoded-password@postgres:5432/yzj_ai_crm',
      MONGODB_URI: 'mongodb://mongodb:27017',
      MONGODB_DB: 'yzj_ai_crm',
      QDRANT_URL: 'http://qdrant:6333',
      SKILL_RUNTIME_BASE_URL: 'http://skill-runtime:3012',
      TONGYI_AUDIO_SERVICE_BASE_URL: 'http://tongyi-audio-service:3018',
    },
  });

  assert.equal(config.storage.postgresUrl, 'postgresql://postgres:encoded-password@postgres:5432/yzj_ai_crm');
  assert.equal(config.storage.mongodbUri, 'mongodb://mongodb:27017');
  assert.equal(config.storage.mongodbDb, 'yzj_ai_crm');
  assert.equal(config.qdrant.url, 'http://qdrant:6333');
  assert.equal(config.external.skillRuntime.baseUrl, 'http://skill-runtime:3012');
  assert.equal(config.external.tongyiAudioService.baseUrl, 'http://tongyi-audio-service:3018');
  assert.equal(config.external.tongyiAudioService.publicBaseUrl, 'http://tongyi-audio-service:3018');
});

test('loadAppConfig rejects invalid connection environment values', () => {
  for (const [key, value] of [
    ['ADMIN_API_POSTGRES_URL', 'http://postgres:5432/yzj_ai_crm'],
    ['SKILL_RUNTIME_POSTGRES_URL', 'postgresql://'],
    ['MONGODB_URI', 'http://mongodb:27017'],
    ['QDRANT_URL', 'qdrant:6333'],
    ['SKILL_RUNTIME_BASE_URL', 'skill-runtime:3012'],
    ['TONGYI_AUDIO_SERVICE_BASE_URL', 'tongyi-audio-service:3018'],
    ['TONGYI_AUDIO_PUBLIC_BASE_URL', 'chat.xiami66.com/audio-viewer'],
  ] as const) {
    assert.throws(
      () =>
        loadAppConfig({
          env: {
            ...baseEnv,
            [key]: value,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, new RegExp(key));
        assert.deepEqual((error.details as any).invalidKeys, [key]);
        return true;
      },
    );
  }
});

test('.env.example covers admin-api env contract keys', () => {
  const envExample = readEnvExampleKeys();
  for (const key of ADMIN_API_REQUIRED_ENV_KEYS) {
    assert.equal(envExample.has(key), true, `.env.example missing required key ${key}`);
  }
  for (const key of ADMIN_API_REQUIRED_CONNECTION_ENV_KEYS) {
    assert.equal(envExample.has(key), true, `.env.example missing connection key ${key}`);
  }
  for (const key of ADMIN_API_ENV_CONTRACT_KEYS) {
    assert.equal(envExample.has(key), true, `.env.example missing contract key ${key}`);
  }
});

test('.env.example covers sibling runtime env keys used by dev and Docker', () => {
  const envExample = readEnvExampleKeys();
  for (const key of [
    'SKILL_RUNTIME_PORT',
    'SKILL_RUNTIME_POSTGRES_URL',
    'SKILL_RUNTIME_POSTGRES_SCHEMA',
    'SKILL_RUNTIME_ARTIFACT_DIR',
    'SKILL_RUNTIME_ALLOWED_ROOTS',
    'SKILL_RUNTIME_SKILL_DIRS',
    'TONGYI_AUDIO_SERVICE_PORT',
    'TONGYI_AUDIO_SERVICE_BASE_URL',
    'TONGYI_DASHSCOPE_API_KEY',
    'TONGYI_TINGWU_APP_ID',
    'TONGYI_AUDIO_OUTPUT_DIR',
    'TONGYI_AUDIO_FIXTURE_OUTPUT_DIR',
  ]) {
    assert.equal(envExample.has(key), true, `.env.example missing runtime key ${key}`);
  }
});

function readEnvExampleKeys(): Set<string> {
  const root = resolve(import.meta.dirname, '../../..');
  const content = readFileSync(resolve(root, '.env.example'), 'utf8');
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=', 1)[0]),
  );
}
