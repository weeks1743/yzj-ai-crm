import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

test('loadAppConfig loads required env values and defaults', () => {
  const config = loadAppConfig({
    env: {
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
    },
  });

  assert.equal(config.yzj.eid, '21024647');
  assert.equal(config.yzj.appId, '501037729');
  assert.equal(config.shadow.objects.customer.formCodeId, 'customer-form-code-id');
  assert.equal(config.yzj.approval.fileSecret, 'approval-file-secret');
  assert.equal(config.shadow.dictionarySource, 'manual_json');
  assert.equal(config.server.port, 3001);
  assert.match(config.storage.sqlitePath, /\.local\/admin-api\.sqlite$/);
  assert.match(config.shadow.dictionaryJsonPath, /\.local\/shadow-dictionaries\.json$/);
  assert.match(config.shadow.skillOutputDir, /skills\/shadow$/);
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
      return true;
    },
  );
});
