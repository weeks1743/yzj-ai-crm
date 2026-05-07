import type { FetchLike, RecordingAnchorInput, RecordingTaskStatus } from './contracts.js';
import { ExternalSkillProviderError, ServiceUnavailableError } from './errors.js';

export interface TongyiAudioServiceTask {
  taskId: string;
  provider: string;
  status: RecordingTaskStatus;
  providerDataId?: string | null;
  fixtureTaskId?: string | null;
  file?: {
    fileName: string;
    mimeType: string;
    size: number;
    md5?: string;
    sha256?: string;
  } | null;
  anchors?: RecordingAnchorInput;
  stages?: Array<{
    key: string;
    label: string;
    status: string;
  }>;
  material?: {
    available: boolean;
    path?: string | null;
    source?: string | null;
    fileName?: string;
    markdown?: string;
    excludedProcessFiles?: string[];
  };
  playback?: {
    available: boolean;
    path?: string | null;
  };
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TongyiAudioServiceHealth {
  status: string;
  providerConfigured: boolean;
  capabilities: string[];
}

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

export class TongyiAudioServiceClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      baseUrl: string;
      fetchImpl?: FetchLike;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<TongyiAudioServiceHealth> {
    return this.fetchJson<TongyiAudioServiceHealth>('/health');
  }

  async createFixtureTask(input: {
    fixtureTaskId: string;
    fileName?: string;
    anchors?: RecordingAnchorInput;
  }): Promise<TongyiAudioServiceTask> {
    return this.fetchJson<TongyiAudioServiceTask>('/api/audio-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async uploadTask(input: {
    fileName: string;
    mimeType: string;
    content: Buffer;
    anchors?: RecordingAnchorInput;
  }): Promise<TongyiAudioServiceTask> {
    const formData = new FormData();
    formData.append('file', new Blob([input.content], { type: input.mimeType }), input.fileName);
    if (input.anchors && Object.keys(input.anchors).length) {
      formData.append('anchors', JSON.stringify(input.anchors));
    }

    return this.fetchJson<TongyiAudioServiceTask>('/api/audio-tasks', {
      method: 'POST',
      body: formData,
    });
  }

  async getTask(taskId: string): Promise<TongyiAudioServiceTask> {
    return this.fetchJson<TongyiAudioServiceTask>(`/api/audio-tasks/${encodeURIComponent(taskId)}`);
  }

  async materialize(input: {
    taskId: string;
    preferredSource?: 'auto' | 'generated' | 'profile_analysis';
    anchors?: RecordingAnchorInput;
  }): Promise<TongyiAudioServiceTask> {
    return this.fetchJson<TongyiAudioServiceTask>(
      `/api/audio-tasks/${encodeURIComponent(input.taskId)}/materialize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredSource: input.preferredSource ?? 'auto',
          anchors: input.anchors ?? {},
        }),
      },
    );
  }

  private async fetchJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}${pathname}`, init);
    } catch (error) {
      throw new ServiceUnavailableError('录音处理服务当前不可达，请检查 apps/tongyi-audio-service 是否已启动', {
        baseUrl: this.options.baseUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readJsonOrText(response);
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `录音处理服务请求失败 (${response.status})`;
      throw new ExternalSkillProviderError(message, response.status, {
        baseUrl: this.options.baseUrl,
        pathname,
        payload,
      });
    }

    return payload as T;
  }
}
