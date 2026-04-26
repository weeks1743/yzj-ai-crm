import type { FetchLike } from './contracts.js';
import { ExternalServiceError } from './errors.js';

interface DocmeeEnvelope<T> {
  code: number;
  message: string;
  data?: T;
}

export interface DocmeeOptionItem {
  name: string;
  value: string;
}

export interface DocmeeOptionsResponse {
  reference: DocmeeOptionItem[];
  audience: DocmeeOptionItem[];
  lang: DocmeeOptionItem[];
  scene: DocmeeOptionItem[];
}

export interface DocmeeCreateTaskResponse {
  id: string;
}

export interface DocmeeContentResponse {
  result?: unknown;
  text?: string;
  markdown?: string;
  streamLog?: string;
  events?: DocmeeSseEvent[];
  finalEventData?: unknown;
}

export interface DocmeePresentationInfo {
  id: string;
  name?: string | null;
  subject?: string | null;
  coverUrl?: string | null;
  fileUrl?: string | null;
  templateId?: string | null;
  pptxProperty?: unknown;
  totalPage?: number | null;
  extInfo?: unknown;
}

export interface DocmeeApiTokenResponse {
  token: string;
  expireTime: number;
}

export interface DocmeeSseEvent<T = unknown> {
  event: string | null;
  id?: string | null;
  retry?: number | null;
  dataRaw: string;
  data?: T;
}

export interface DocmeeAiLayoutResponse {
  streamLog: string;
  events: DocmeeSseEvent[];
  finalEventData?: unknown;
  inferredMarkdown: string | null;
  inferredHtml: string | null;
  inferredStatus: string | null;
  aborted?: boolean;
}

export interface DocmeeLatestDataResponse extends Record<string, unknown> {
  status?: string;
}

export interface DocmeeConvertResultResponse extends Record<string, unknown> {
  status?: string | number;
  mdContent?: string;
  markdown?: string;
}

interface DocmeeTaskFileInput {
  fileName: string;
  file: Buffer | Uint8Array | Blob;
  mimeType?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return {
    message: await response.text(),
  };
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stripMarkdownCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
}

function repairDocmeeJsonString(value: string): string {
  return stripMarkdownCodeFence(value.trim()).replace(
    /(^|[\n\r,{]\s*)\*\*([A-Za-z0-9_]+)\*\*(\s*:)/g,
    '$1"$2"$3',
  );
}

function parseSseEvents(streamLog: string): DocmeeSseEvent[] {
  const normalized = streamLog.replace(/\r\n/g, '\n');
  const blocks = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return blocks
    .map((block) => parseSseBlock(block))
    .filter((item): item is DocmeeSseEvent => Boolean(item));
}

function parseSseBlock(block: string): DocmeeSseEvent | null {
  const normalizedBlock = block.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let event: string | null = null;
  let id: string | null = null;
  let retry: number | null = null;
  const dataLines: string[] = [];

  for (const line of normalizedBlock.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || null;
      continue;
    }

    if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim() || null;
      continue;
    }

    if (line.startsWith('retry:')) {
      const parsed = Number(line.slice('retry:'.length).trim());
      retry = Number.isFinite(parsed) ? parsed : null;
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  const dataRaw = dataLines.join('\n');
  if (!event && !id && !dataRaw) {
    return null;
  }

  return {
    event,
    id,
    retry,
    dataRaw,
    data: dataRaw ? parseMaybeJson(dataRaw) : undefined,
  } satisfies DocmeeSseEvent;
}

function findSseBoundary(value: string): { index: number; length: number } | null {
  const candidates = [
    { index: value.indexOf('\r\n\r\n'), length: 4 },
    { index: value.indexOf('\n\n'), length: 2 },
  ].filter((item) => item.index >= 0);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => left.index - right.index)[0] ?? null;
}

function walkUnknown(value: unknown, visit: (input: unknown) => string | null): string | null {
  const direct = visit(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = walkUnknown(item, visit);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const nested = walkUnknown(item, visit);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function extractDocmeeMarkdownCandidate(value: unknown): string | null {
  return walkUnknown(value, (input) => {
    if (!isRecord(input)) {
      return null;
    }

    for (const key of ['mdContent', 'markdown']) {
      const candidate = input[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  });
}

export function extractDocmeeHtmlCandidate(value: unknown): string | null {
  return walkUnknown(value, (input) => {
    if (!isRecord(input)) {
      return null;
    }

    for (const key of ['html', 'htmlContent', 'pageHtml']) {
      const candidate = input[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  });
}

export function extractDocmeeStatusCandidate(value: unknown): string | null {
  return walkUnknown(value, (input) => {
    if (!isRecord(input)) {
      return null;
    }

    const candidate = input.status;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }

    return null;
  });
}

function selectFinalSsePayload(events: DocmeeSseEvent[]): unknown {
  let fallback: unknown = undefined;

  for (const event of events) {
    const payload = event.data;
    if (typeof payload === 'undefined') {
      continue;
    }

    fallback = payload;
    if (isRecord(payload) && payload.status === 4) {
      return payload;
    }
  }

  return fallback;
}

function collectSseText(events: DocmeeSseEvent[]): string {
  const chunks: string[] = [];

  for (const event of events) {
    if (typeof event.data === 'string') {
      chunks.push(event.data);
      continue;
    }

    if (isRecord(event.data) && typeof event.data.text === 'string' && event.data.text.trim()) {
      chunks.push(event.data.text);
    }
  }

  return chunks.join('').trim();
}

function normalizeDocmeeJsonResult(candidate: unknown, fallbackText: string): unknown {
  const attemptedStrings: string[] = [];
  if (typeof candidate === 'string' && candidate.trim()) {
    attemptedStrings.push(candidate.trim());
  }
  if (fallbackText.trim().startsWith('{') || fallbackText.trim().startsWith('[')) {
    attemptedStrings.push(fallbackText.trim());
  }

  for (const rawValue of attemptedStrings) {
    const parsed = parseMaybeJson(rawValue);
    if (typeof parsed !== 'string') {
      return parsed;
    }

    const repaired = repairDocmeeJsonString(rawValue);
    const repairedParsed = parseMaybeJson(repaired);
    if (typeof repairedParsed !== 'string') {
      return repairedParsed;
    }
  }

  if (typeof candidate === 'string' && candidate.trim()) {
    return repairDocmeeJsonString(candidate);
  }

  if (typeof candidate !== 'undefined') {
    return candidate;
  }

  if (attemptedStrings[0]) {
    return repairDocmeeJsonString(attemptedStrings[0]);
  }

  return candidate;
}

function isDocmeeAiLayoutTerminalPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  const status = extractDocmeeStatusCandidate(payload)?.trim().toLowerCase() || null;
  if (
    status === 'completed'
    || status === 'complete'
    || status === 'success'
    || status === 'convert_success'
    || status === 'done'
    || status === '2'
    || status === 'error'
    || status === 'failed'
    || status === '-1'
  ) {
    return true;
  }

  return false;
}

export class DocmeeClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly clientOptions: {
      baseUrl: string;
      apiKey: string;
      fetchImpl?: FetchLike;
    },
  ) {
    this.fetchImpl = clientOptions.fetchImpl ?? fetch;
  }

  private resolveUrl(pathname: string): string {
    return `${trimTrailingSlash(this.clientOptions.baseUrl)}${pathname}`;
  }

  private async fetchResponse(
    pathname: string,
    init?: RequestInit,
    absoluteUrl?: string,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(absoluteUrl ?? this.resolveUrl(pathname), init);
    } catch (error) {
      throw new ExternalServiceError('Docmee 服务请求失败', {
        pathname,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestJson<T>(
    pathname: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetchResponse(pathname, init);

    const payload = await readPayload(response);
    if (!response.ok) {
      throw new ExternalServiceError(
        `Docmee 请求失败 (${response.status})`,
        {
          pathname,
          statusCode: response.status,
          payload,
        },
      );
    }

    const envelope = payload as DocmeeEnvelope<T>;
    if (typeof envelope?.code !== 'number') {
      throw new ExternalServiceError('Docmee 返回了无法识别的响应', {
        pathname,
        payload,
      });
    }

    if (envelope.code !== 0 || typeof envelope.data === 'undefined') {
      throw new ExternalServiceError(envelope.message || 'Docmee 请求失败', {
        pathname,
        code: envelope.code,
        payload,
      });
    }

    return envelope.data;
  }

  private async requestSse(
    pathname: string,
    init?: RequestInit,
    shouldStop?: (event: DocmeeSseEvent) => boolean,
    options?: {
      allowAbort?: boolean;
    },
  ): Promise<{
    streamLog: string;
    events: DocmeeSseEvent[];
    finalEventData?: unknown;
    contentType: string;
    aborted?: boolean;
  }> {
    const response = await this.fetchResponse(pathname, init);
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      const responseText = await response.text();
      const payload = contentType.includes('application/json')
        ? parseMaybeJson(responseText)
        : { message: responseText };
      throw new ExternalServiceError(
        `Docmee 请求失败 (${response.status})`,
        {
          pathname,
          statusCode: response.status,
          payload,
        },
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const responseText = await response.text();
      const payload = parseMaybeJson(responseText);
      const envelope = payload as DocmeeEnvelope<unknown>;
      if (typeof envelope?.code !== 'number') {
        throw new ExternalServiceError('Docmee 返回了无法识别的响应', {
          pathname,
          payload,
        });
      }

      if (envelope.code !== 0 || typeof envelope.data === 'undefined') {
        throw new ExternalServiceError(envelope.message || 'Docmee 请求失败', {
          pathname,
          code: envelope.code,
          payload,
        });
      }

      return {
        streamLog: responseText,
        events: [],
        finalEventData: envelope.data,
        contentType,
      };
    }

    const streamLogParts: string[] = [];
    const events: DocmeeSseEvent[] = [];
    const body = response.body;
    if (!body) {
      return {
        streamLog: '',
        events,
        finalEventData: undefined,
        contentType,
      };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let stopped = false;
    let aborted = false;

    while (!stopped) {
      let done = false;
      let value: Uint8Array<ArrayBufferLike> | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (options?.allowAbort && error instanceof Error && error.name === 'AbortError') {
          aborted = true;
          break;
        }

        throw error;
      }

      if (done) {
        pending += decoder.decode();
      } else if (value) {
        const chunkText = decoder.decode(value, { stream: true });
        streamLogParts.push(chunkText);
        pending += chunkText;
      }

      let boundary = findSseBoundary(pending);
      while (boundary) {
        const block = pending.slice(0, boundary.index).trim();
        pending = pending.slice(boundary.index + boundary.length);
        const parsed = parseSseBlock(block);
        if (parsed) {
          events.push(parsed);
          if (shouldStop?.(parsed)) {
            await reader.cancel();
            pending = '';
            stopped = true;
            break;
          }
        }
        boundary = findSseBoundary(pending);
      }

      if (done || stopped) {
        break;
      }
      if (pending === '') {
        continue;
      }
    }

    if (pending.trim()) {
      const parsed = parseSseBlock(pending.trim());
      if (parsed) {
        events.push(parsed);
      }
    }

    return {
      streamLog: streamLogParts.join(''),
      events,
      finalEventData: selectFinalSsePayload(events),
      contentType,
      aborted,
    };
  }

  private async requestBinary(fileUrl: string): Promise<Buffer> {
    const response = await this.fetchResponse('', undefined, fileUrl).catch((error) => {
      throw new ExternalServiceError('Docmee PPT 文件下载失败', {
        fileUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    });

    if (!response.ok) {
      const payload = await readPayload(response);
      throw new ExternalServiceError(`Docmee PPT 文件下载失败 (${response.status})`, {
        fileUrl,
        statusCode: response.status,
        payload,
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  options(token = this.clientOptions.apiKey): Promise<DocmeeOptionsResponse> {
    return this.requestJson<DocmeeOptionsResponse>('/api/ppt/v2/options', {
      headers: {
        token,
      },
    });
  }

  async createTask(input: {
    type: number | string;
    content?: string;
    files?: DocmeeTaskFileInput[];
  }, token = this.clientOptions.apiKey): Promise<DocmeeCreateTaskResponse> {
    const form = new FormData();
    form.set('type', String(input.type));
    if (typeof input.content === 'string') {
      form.set('content', input.content);
    }
    for (const file of input.files ?? []) {
      const blob = file.file instanceof Blob
        ? file.file
        : new Blob([file.file], {
          type: file.mimeType || 'application/octet-stream',
        });
      form.append('file', blob, file.fileName);
    }

    return this.requestJson<DocmeeCreateTaskResponse>('/api/ppt/v2/createTask', {
      method: 'POST',
      headers: {
        token,
      },
      body: form,
    });
  }

  generateContent(input: {
    id: string;
    stream: boolean;
    outlineType: 'JSON' | 'MD';
    questionMode: boolean;
    isNeedAsk: boolean;
    length: 'medium' | 'short' | 'long';
    scene: string;
    audience: string;
    lang: string;
    prompt: string;
    aiSearch: boolean;
    isGenImg: boolean;
  }, token = this.clientOptions.apiKey): Promise<DocmeeContentResponse> {
    if (input.stream) {
      return this.requestSse('/api/ppt/v2/generateContent', {
        method: 'POST',
        headers: {
          token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }, (event) => isRecord(event.data) && event.data.status === 4).then((response) => {
        if (response.events.length === 0 && isRecord(response.finalEventData)) {
          return {
            ...response.finalEventData,
            streamLog: response.streamLog,
            events: [],
            finalEventData: response.finalEventData,
          } satisfies DocmeeContentResponse;
        }

        const finalEventData = isRecord(response.finalEventData) ? response.finalEventData : undefined;
        const collectedText = collectSseText(response.events);
        const text = typeof finalEventData?.text === 'string' && finalEventData.text.trim()
          ? finalEventData.text.trim()
          : collectedText;
        const markdown = typeof finalEventData?.markdown === 'string' && finalEventData.markdown.trim()
          ? finalEventData.markdown.trim()
          : undefined;
        const result = input.outlineType === 'JSON'
          ? normalizeDocmeeJsonResult(finalEventData?.result, collectedText)
          : finalEventData?.result;

        return {
          ...(finalEventData ?? {}),
          result,
          text: text || undefined,
          markdown,
          streamLog: response.streamLog,
          events: response.events,
          finalEventData: response.finalEventData,
        } satisfies DocmeeContentResponse;
      });
    }

    return this.requestJson<DocmeeContentResponse>('/api/ppt/v2/generateContent', {
      method: 'POST',
      headers: {
        token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  updateContent(input: {
    id: string;
    stream: boolean;
    markdown: string;
    question: string;
  }, token = this.clientOptions.apiKey): Promise<DocmeeContentResponse> {
    if (input.stream) {
      return this.requestSse('/api/ppt/v2/updateContent', {
        method: 'POST',
        headers: {
          token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }, (event) => isRecord(event.data) && event.data.status === 4).then((response) => {
        const finalEventData = isRecord(response.finalEventData) ? response.finalEventData : undefined;
        const text = typeof finalEventData?.text === 'string' && finalEventData.text.trim()
          ? finalEventData.text.trim()
          : collectSseText(response.events);
        const markdown = typeof finalEventData?.markdown === 'string' && finalEventData.markdown.trim()
          ? finalEventData.markdown.trim()
          : undefined;

        return {
          ...(finalEventData ?? {}),
          text: text || undefined,
          markdown,
          streamLog: response.streamLog,
          events: response.events,
          finalEventData: response.finalEventData,
        } satisfies DocmeeContentResponse;
      });
    }

    return this.requestJson<DocmeeContentResponse>('/api/ppt/v2/updateContent', {
      method: 'POST',
      headers: {
        token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  async generatePptxByAi(input: {
    id: string;
    data: unknown;
    templateId?: string;
    signal?: AbortSignal;
    allowAbort?: boolean;
  }, token = this.clientOptions.apiKey): Promise<DocmeeAiLayoutResponse> {
    const form = new FormData();
    form.set('id', input.id);
    const resolvedData = typeof input.data === 'string'
      ? input.data.trim()
      : JSON.stringify(input.data);
    form.set('data', resolvedData);
    if (input.templateId) {
      form.set('templateId', input.templateId);
    }

    const response = await this.requestSse('/api/ppt/v2/generatePptxByAi', {
      method: 'POST',
      headers: {
        token,
      },
      body: form,
      signal: input.signal,
    }, (event) => isDocmeeAiLayoutTerminalPayload(event.data), {
      allowAbort: input.allowAbort,
    });

    return {
      streamLog: response.streamLog,
      events: response.events,
      finalEventData: response.finalEventData,
      inferredMarkdown: extractDocmeeMarkdownCandidate(response.finalEventData) ?? null,
      inferredHtml: extractDocmeeHtmlCandidate(response.finalEventData) ?? null,
      inferredStatus: extractDocmeeStatusCandidate(response.finalEventData) ?? null,
      aborted: response.aborted ?? false,
    };
  }

  async generatePptx(input: {
    id: string;
    markdown: string;
    templateId?: string;
  }, token = this.clientOptions.apiKey): Promise<DocmeePresentationInfo> {
    const payload = {
      id: input.id,
      markdown: input.markdown,
      ...(input.templateId ? { templateId: input.templateId } : {}),
    };

    const response = await this.requestJson<{ pptInfo: DocmeePresentationInfo }>(
      '/api/ppt/v2/generatePptx',
      {
        method: 'POST',
        headers: {
          token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    return response.pptInfo;
  }

  latestData(taskId: string, token = this.clientOptions.apiKey): Promise<DocmeeLatestDataResponse> {
    return this.requestJson<DocmeeLatestDataResponse>(
      `/api/ppt/v2/latestData?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: {
          token,
        },
      },
    );
  }

  getConvertResult(taskId: string, token = this.clientOptions.apiKey): Promise<DocmeeConvertResultResponse> {
    return this.requestJson<DocmeeConvertResultResponse>(
      `/api/ppt/v2/getConvertResult?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: {
          token,
        },
      },
    );
  }

  createApiToken(input: {
    uid: string;
    limit: number;
    timeOfHours: number;
  }): Promise<DocmeeApiTokenResponse> {
    return this.requestJson<DocmeeApiTokenResponse>('/api/user/createApiToken', {
      method: 'POST',
      headers: {
        'Api-Key': this.clientOptions.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  downloadPptx(pptId: string, token = this.clientOptions.apiKey): Promise<DocmeePresentationInfo> {
    return this.requestJson<DocmeePresentationInfo>('/api/ppt/downloadPptx', {
      method: 'POST',
      headers: {
        token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: pptId,
      }),
    });
  }

  async downloadPptxBinary(pptId: string, token?: string): Promise<{
    file: Buffer;
    metadata: DocmeePresentationInfo;
  }> {
    const metadata = await this.downloadPptx(pptId, token);
    const fileUrl = metadata.fileUrl?.trim();
    if (!fileUrl) {
      throw new ExternalServiceError('Docmee 返回的 PPT 下载地址为空', {
        pptId,
        metadata,
      });
    }

    return {
      file: await this.requestBinary(fileUrl),
      metadata,
    };
  }
}
