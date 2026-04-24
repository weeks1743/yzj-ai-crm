import type { ApiErrorResponse } from '@shared';

export async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as T | ApiErrorResponse)
    : ({ message: await response.text() } as ApiErrorResponse);

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' && payload && 'message' in payload
        ? payload.message
        : '请求失败';
    throw new Error(errorMessage);
  }

  return payload as T;
}
