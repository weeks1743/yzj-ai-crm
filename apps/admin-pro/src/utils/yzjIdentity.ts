import type { YzjAuthIdentityResponse } from '@shared/types';

function isLocalDebugHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function readTicketFromLocation() {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('ticket')?.trim() || '';
}

async function readApiError(response: Response) {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message?.trim() || '';
  } catch {
    return '';
  }
}

export async function resolveAdminIdentity(): Promise<YzjAuthIdentityResponse> {
  const ticket = readTicketFromLocation();
  const allowLocalIdentity =
    process.env.NODE_ENV === 'development' ||
    process.env.UMI_ENV === 'dev' ||
    process.env.YZJ_ALLOW_LOCAL_IDENTITY === 'true' ||
    isLocalDebugHost();

  if (!ticket && !allowLocalIdentity) {
    throw new Error('缺少云之家 ticket，请从云之家轻应用入口进入。');
  }

  const endpoint = ticket ? '/api/yzj/auth/resolve-ticket' : '/api/yzj/auth/local-identity';
  const response = ticket
    ? await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket }),
        cache: 'no-store',
      })
    : await fetch(endpoint, { cache: 'no-store' });

  if (!response.ok) {
    const reason = await readApiError(response);
    throw new Error(reason || '云之家身份解析失败');
  }

  return response.json() as Promise<YzjAuthIdentityResponse>;
}
