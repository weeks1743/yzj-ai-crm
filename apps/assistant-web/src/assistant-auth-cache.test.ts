import assert from 'node:assert/strict';
import test from 'node:test';
import type { YzjAuthIdentityResponse } from '@shared/types';
import {
  ASSISTANT_AUTH_IDENTITY_STORAGE_KEY,
  readCachedAssistantIdentity,
  writeCachedAssistantIdentity,
  type BrowserStorageLike,
} from './assistant-auth-cache';

test('assistant auth cache restores resolved ticket identity for internal navigation', () => {
  const storage = memoryStorage();
  const identity: YzjAuthIdentityResponse = {
    source: 'ticket',
    eid: '21024647',
    appId: '501037729',
    operatorOpenId: 'openid-1',
    userId: 'user-1',
    userName: '云之家用户',
    networkId: null,
    deviceId: null,
  };

  writeCachedAssistantIdentity(storage, identity);

  assert.deepEqual(readCachedAssistantIdentity(storage), identity);
});

test('assistant auth cache rejects malformed cached identity', () => {
  const storage = memoryStorage();
  storage.setItem(ASSISTANT_AUTH_IDENTITY_STORAGE_KEY, JSON.stringify({
    source: 'ticket',
    eid: '21024647',
  }));

  assert.equal(readCachedAssistantIdentity(storage), null);
});

function memoryStorage(): BrowserStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
