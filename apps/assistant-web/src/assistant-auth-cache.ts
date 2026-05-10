import type { YzjAuthIdentityResponse } from '@shared/types';

export const ASSISTANT_AUTH_IDENTITY_STORAGE_KEY = 'yzj-ai-crm.assistant.authIdentity.v1';
export const ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY = 'yzj-ai-crm.assistant.authTicketFingerprint.v1';

export interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
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

export async function computeAssistantTicketFingerprint(ticket: string): Promise<string> {
  const normalizedTicket = ticket.trim();
  if (!normalizedTicket) {
    throw new Error('ticket 不能为空');
  }

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('当前环境不支持 ticket 指纹计算');
  }

  const digest = await cryptoApi.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizedTicket),
  );
  return `sha256:${bufferToHex(digest)}`;
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

export function readCachedAssistantTicketIdentity(
  storage: BrowserStorageLike | null,
): YzjAuthIdentityResponse | null {
  const identity = readCachedAssistantIdentity(storage);
  return identity?.source === 'ticket' ? identity : null;
}

export async function readCachedAssistantIdentityForTicket(
  storage: BrowserStorageLike | null,
  ticket: string,
): Promise<YzjAuthIdentityResponse | null> {
  const normalizedTicket = ticket.trim();
  if (!storage || !normalizedTicket) {
    return null;
  }

  const identity = readCachedAssistantTicketIdentity(storage);
  if (!identity) {
    return null;
  }

  const cachedFingerprint = readCachedAssistantTicketFingerprint(storage);
  if (!cachedFingerprint) {
    return null;
  }

  const ticketFingerprint = await computeAssistantTicketFingerprint(normalizedTicket);
  return cachedFingerprint === ticketFingerprint ? identity : null;
}

export function hasCachedAssistantIdentity(storage: BrowserStorageLike | null): boolean {
  return Boolean(readCachedAssistantIdentity(storage));
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

export async function persistCachedAssistantIdentity(
  storage: BrowserStorageLike | null,
  identity: YzjAuthIdentityResponse,
  ticket?: string | null,
) {
  if (!storage) {
    return;
  }

  if (identity.source === 'ticket') {
    const normalizedTicket = ticket?.trim();
    if (normalizedTicket) {
      const ticketFingerprint = await computeAssistantTicketFingerprint(normalizedTicket);
      writeCachedAssistantIdentity(storage, identity);
      writeStorageValue(storage, ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY, ticketFingerprint);
      return;
    }
  }

  writeCachedAssistantIdentity(storage, identity);
  clearCachedAssistantTicketFingerprint(storage);
}

export function readCachedAssistantTicketFingerprint(storage: BrowserStorageLike | null): string | null {
  return readStorageValue(storage, ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY);
}

export function clearCachedAssistantTicketFingerprint(storage: BrowserStorageLike | null) {
  if (!storage) {
    return;
  }
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY);
    return;
  }
  writeStorageValue(storage, ASSISTANT_AUTH_TICKET_FINGERPRINT_STORAGE_KEY, '');
}

function readStorageValue(storage: BrowserStorageLike | null, key: string): string | null {
  if (!storage) {
    return null;
  }
  try {
    const value = storage.getItem(key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function writeStorageValue(storage: BrowserStorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore private-mode storage failures. The current in-memory identity still works.
  }
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
