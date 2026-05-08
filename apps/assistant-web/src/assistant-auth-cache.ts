import type { YzjAuthIdentityResponse } from '@shared/types';

export const ASSISTANT_AUTH_IDENTITY_STORAGE_KEY = 'yzj-ai-crm.assistant.authIdentity.v1';

export interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isPersistableYzjIdentity(value: unknown): value is YzjAuthIdentityResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<YzjAuthIdentityResponse>;
  return Boolean(
    candidate.eid
    && typeof candidate.eid === 'string'
    && (!candidate.displayEid || typeof candidate.displayEid === 'string')
    && candidate.appId
    && typeof candidate.appId === 'string'
    && candidate.operatorOpenId
    && typeof candidate.operatorOpenId === 'string'
    && (candidate.source === 'ticket' || candidate.source === 'local_fixed')
  );
}

export function readCachedAssistantIdentity(
  storage: BrowserStorageLike | null,
): YzjAuthIdentityResponse | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(ASSISTANT_AUTH_IDENTITY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return isPersistableYzjIdentity(parsed)
      ? {
          ...parsed,
          displayEid: parsed.displayEid || parsed.eid,
        }
      : null;
  } catch {
    return null;
  }
}

export function writeCachedAssistantIdentity(
  storage: BrowserStorageLike | null,
  identity: YzjAuthIdentityResponse,
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(ASSISTANT_AUTH_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Ignore private-mode storage failures. The current in-memory identity still works.
  }
}
