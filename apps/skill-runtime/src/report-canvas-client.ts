import type {
  FetchLike,
  ReportCanvasGenerateResponse,
  ReportCanvasResultResponse,
  ReportCanvasStatusResponse,
} from './contracts.js';
import { ExternalServiceError, NotFoundError } from './errors.js';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return { message: await response.text() };
}

function readMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const direct = record.message;
    if (typeof direct === 'string' && direct.trim()) {
      return direct;
    }
    const error = record.error;
    if (error && typeof error === 'object') {
      const errorMessage = (error as Record<string, unknown>).message;
      if (typeof errorMessage === 'string' && errorMessage.trim()) {
        return errorMessage;
      }
    }
  }
  return fallback;
}

export class ReportCanvasClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      baseUrl: string;
      fetchImpl?: FetchLike;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private resolveUrl(pathname: string): string {
    return `${trimTrailingSlash(this.options.baseUrl)}${pathname}`;
  }

  async generate(input: {
    markdown: string;
    query?: string;
    ttlMinutes?: number;
  }): Promise<ReportCanvasGenerateResponse> {
    return this.fetchJson<ReportCanvasGenerateResponse>('/api/report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async getStatus(sessionId: string): Promise<ReportCanvasStatusResponse> {
    return this.fetchJson<ReportCanvasStatusResponse>(`/api/report/status/${encodeURIComponent(sessionId)}`);
  }

  async getResult(sessionId: string): Promise<ReportCanvasResultResponse | ReportCanvasStatusResponse> {
    return this.fetchJson<ReportCanvasResultResponse | ReportCanvasStatusResponse>(
      `/api/report/result/${encodeURIComponent(sessionId)}`,
      undefined,
      [202],
    );
  }

  private async fetchJson<T>(
    pathname: string,
    init?: RequestInit,
    okExtraStatuses: number[] = [],
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.resolveUrl(pathname), init);
    } catch (error) {
      throw new ExternalServiceError('报告生成服务当前不可达，请检查 apps/report-canvas-service 是否已启动', {
        baseUrl: this.options.baseUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readJsonOrText(response);
    if (!response.ok && !okExtraStatuses.includes(response.status)) {
      const message = readMessage(payload, `报告生成服务请求失败 (${response.status})`);
      if (response.status === 404) {
        throw new NotFoundError(message, { baseUrl: this.options.baseUrl, pathname, payload });
      }
      throw new ExternalServiceError(message, {
        baseUrl: this.options.baseUrl,
        pathname,
        status: response.status,
        payload,
      });
    }

    return payload as T;
  }
}
