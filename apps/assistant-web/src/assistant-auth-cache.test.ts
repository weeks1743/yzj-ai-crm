import assert from 'node:assert/strict';
import test from 'node:test';
import type { YzjAuthIdentityResponse } from '@shared/types';
import {
  ASSISTANT_AUTH_IDENTITY_STORAGE_KEY,
  ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY,
  clearCachedAssistantTicketFingerprint,
  computeAssistantTicketFingerprint,
  persistCachedAssistantIdentity,
  readCachedAssistantIdentity,
  readCachedAssistantIdentityForTicket,
  readCachedAssistantTicketFingerprint,
  writeCachedAssistantIdentity,
  type BrowserStorageLike,
} from './assistant-auth-cache';

test('assistant auth cache restores resolved ticket identity for internal navigation', () => {
  const storage = memoryStorage();
  const identity: YzjAuthIdentityResponse = {
    source: 'ticket',
    eid: '21024647',
    displayEid: '21024647',
    appId: '501037649',
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

test('assistant auth cache matches ticket identity by fingerprint', async () => {
  const storage = memoryStorage();
  const ticket = 'APPURLWITHTICKETee30f63d41d7d4c17546f01e761d431b';
  const identity: YzjAuthIdentityResponse = {
    source: 'ticket',
    eid: '21024647',
    displayEid: '21024647',
    appId: '501037649',
    operatorOpenId: 'openid-1',
    userId: 'user-1',
    userName: '云之家用户',
    networkId: null,
    deviceId: null,
  };

  await persistCachedAssistantIdentity(storage, identity, ticket);

  assert.equal(readCachedAssistantTicketFingerprint(storage), await computeAssistantTicketFingerprint(ticket));
  assert.deepEqual(await readCachedAssistantIdentityForTicket(storage, ticket), identity);
  assert.equal(await readCachedAssistantIdentityForTicket(storage, `${ticket}-other`), null);
});

test('assistant auth cache clears ticket fingerprint for local fixed identity', async () => {
  const storage = memoryStorage();
  storage.setItem(ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY, 'sha256:deadbeef');

  const identity: YzjAuthIdentityResponse = {
    source: 'local_fixed',
    eid: '21024647',
    displayEid: '21024647',
    appId: '501037649',
    operatorOpenId: 'openid-1',
    userId: null,
    userName: '陈伟棠',
    networkId: null,
    deviceId: null,
  };

  await persistCachedAssistantIdentity(storage, identity);

  assert.equal(readCachedAssistantTicketFingerprint(storage), null);
  assert.equal(storage.getItem(ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY), null);
});

test('assistant auth cache keeps local fixed identity readable', () => {
  const storage = memoryStorage();
  const identity: YzjAuthIdentityResponse = {
    source: 'local_fixed',
    eid: '21024647',
    displayEid: '21024647',
    appId: '501037649',
    operatorOpenId: 'openid-1',
    userId: null,
    userName: '陈伟棠',
    networkId: null,
    deviceId: null,
  };

  writeCachedAssistantIdentity(storage, identity);

  assert.deepEqual(readCachedAssistantIdentity(storage), identity);
});

function memoryStorage(): BrowserStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
