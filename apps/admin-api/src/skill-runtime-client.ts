import type {
  ExternalSkillJobRequest,
  ExternalSkillPresentationSessionCloseRequest,
  ExternalSkillPresentationSessionCloseResponse,
  ExternalSkillPresentationSessionConflictResponse,
  ExternalSkillPresentationSessionHeartbeatRequest,
  ExternalSkillPresentationSessionHeartbeatResponse,
  ExternalSkillPresentationSessionOpenRequest,
  ExternalSkillPresentationSessionResponse,
  FetchLike,
  SkillRuntimeModelName,
} from './contracts.js';
import type { ApiErrorResponse } from './contracts.js';
import { ExternalSkillProviderError, ServiceUnavailableError } from './errors.js';

interface SkillRuntimeModelDescriptor {
  name: SkillRuntimeModelName;
  label: string;
  isDefault: boolean;
}

interface SkillRuntimeCatalogEntry {
  skillName: string;
  status: 'available' | 'blocked' | 'unsupported_yet';
  supportsInvoke: boolean;
  requiredDependencies: string[];
  missingDependencies: string[];
  summary: string;
}

interface SkillRuntimeJobArtifact {
  artifactId: string;
  jobId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  downloadPath: string;
}

interface SkillRuntimeJobEvent {
  id: string;
  type: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

interface SkillRuntimeJobResponse {
  jobId: string;
  skillName: string;
  model: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  finalText: string | null;
  events: SkillRuntimeJobEvent[];
  artifacts: SkillRuntimeJobArtifact[];
  error: ApiErrorResponse | null;
  createdAt: string;
  updatedAt: string;
}

interface SkillRuntimeCreateJobRequest extends ExternalSkillJobRequest {
  templateId?: string;
  presentationPrompt?: string;
}

interface SkillRuntimeArtifactPayload {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

interface JsonResponse<T> {
  statusCode: number;
  payload: T;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function decodeFileNameFromHeader(contentDisposition: string | null, fallbackValue: string): string {
  if (!contentDisposition) {
    return fallbackValue;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    try {
      return decodeURIComponent(quotedMatch[1]);
    } catch {
      return quotedMatch[1];
    }
  }

  return fallbackValue;
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return {
    message: await response.text(),
  } satisfies Partial<ApiErrorResponse>;
}

export class SkillRuntimeClient {
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

  private async fetchJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.resolveUrl(pathname), init);
    } catch (error) {
      throw new ServiceUnavailableError('SKILL Runtime 服务当前不可达，请检查服务是否已启动', {
        baseUrl: this.options.baseUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readJsonOrText(response);
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `SKILL Runtime 请求失败 (${response.status})`;
      throw new ExternalSkillProviderError(message, response.status, {
        baseUrl: this.options.baseUrl,
        pathname,
        payload,
      });
    }

    return payload as T;
  }

  private async fetchJsonResponse<T>(pathname: string, init?: RequestInit): Promise<JsonResponse<T>> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.resolveUrl(pathname), init);
    } catch (error) {
      throw new ServiceUnavailableError('SKILL Runtime 服务当前不可达，请检查服务是否已启动', {
        baseUrl: this.options.baseUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      statusCode: response.status,
      payload: await readJsonOrText(response) as T,
    };
  }

  listModels(): Promise<SkillRuntimeModelDescriptor[]> {
    return this.fetchJson<SkillRuntimeModelDescriptor[]>('/api/models');
  }

  listSkills(): Promise<SkillRuntimeCatalogEntry[]> {
    return this.fetchJson<SkillRuntimeCatalogEntry[]>('/api/skills');
  }

  createJob(skillName: string, input: SkillRuntimeCreateJobRequest): Promise<SkillRuntimeJobResponse> {
    return this.fetchJson<SkillRuntimeJobResponse>('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName,
        requestText: input.requestText,
        model: input.model,
        attachments: input.attachments,
        workingDirectory: input.workingDirectory,
        templateId: input.templateId,
        presentationPrompt: input.presentationPrompt,
      }),
    });
  }

  getJob(jobId: string): Promise<SkillRuntimeJobResponse> {
    return this.fetchJson<SkillRuntimeJobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
  }

  createPresentationSession(
    jobId: string,
    options?: {
      forceRefresh?: boolean;
    },
  ): Promise<ExternalSkillPresentationSessionResponse> {
    const refreshSuffix = options?.forceRefresh ? '?refresh=1' : '';
    return this.fetchJson<ExternalSkillPresentationSessionResponse>(
      `/api/jobs/${encodeURIComponent(jobId)}/presentation-session${refreshSuffix}`,
      {
        method: 'POST',
      },
    );
  }

  openPresentationSession(
    jobId: string,
    input: ExternalSkillPresentationSessionOpenRequest,
  ): Promise<JsonResponse<ExternalSkillPresentationSessionResponse | ExternalSkillPresentationSessionConflictResponse | ApiErrorResponse>> {
    return this.fetchJsonResponse(
      `/api/jobs/${encodeURIComponent(jobId)}/presentation-session/open`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    );
  }

  heartbeatPresentationSession(
    jobId: string,
    input: ExternalSkillPresentationSessionHeartbeatRequest,
  ): Promise<JsonResponse<ExternalSkillPresentationSessionHeartbeatResponse | ExternalSkillPresentationSessionConflictResponse | ApiErrorResponse>> {
    return this.fetchJsonResponse(
      `/api/jobs/${encodeURIComponent(jobId)}/presentation-session/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    );
  }

  closePresentationSession(
    jobId: string,
    input: ExternalSkillPresentationSessionCloseRequest,
  ): Promise<JsonResponse<ExternalSkillPresentationSessionCloseResponse | ApiErrorResponse>> {
    return this.fetchJsonResponse(
      `/api/jobs/${encodeURIComponent(jobId)}/presentation-session/close`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    );
  }

  async downloadArtifact(jobId: string, artifactId: string): Promise<SkillRuntimeArtifactPayload> {
    let response: Response;

    try {
      response = await this.fetchImpl(
        this.resolveUrl(`/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`),
      );
    } catch (error) {
      throw new ServiceUnavailableError('SKILL Runtime 产物下载失败，服务当前不可达', {
        baseUrl: this.options.baseUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      const payload = await readJsonOrText(response);
      const message =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `SKILL Runtime 产物下载失败 (${response.status})`;
      throw new ExternalSkillProviderError(message, response.status, {
        baseUrl: this.options.baseUrl,
        jobId,
        artifactId,
        payload,
      });
    }

    return {
      fileName: decodeFileNameFromHeader(
        response.headers.get('content-disposition'),
        `${artifactId}.bin`,
      ),
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
      content: Buffer.from(await response.arrayBuffer()),
    };
  }
}

export type {
  SkillRuntimeCatalogEntry,
  SkillRuntimeModelDescriptor,
  SkillRuntimeArtifactPayload,
  SkillRuntimeJobResponse,
};
