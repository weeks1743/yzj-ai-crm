import { ExternalSkillProviderError, ServiceUnavailableError } from './errors.js';
import type { FetchLike } from './contracts.js';

interface DocmeeEnvelope<T> {
  code: number;
  message: string;
  data?: T;
}

interface DocmeeTemplateDownloadPayload {
  id: string;
  subject?: string | null;
  coverUrl?: string | null;
  fileUrl?: string | null;
  createTime?: string | number | null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

export class DocmeeTemplateClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      fetchImpl?: FetchLike;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private resolveUrl(pathname: string): string {
    return `${trimTrailingSlash(this.options.baseUrl)}${pathname}`;
  }

  private async requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.resolveUrl(pathname), init);
    } catch (error) {
      throw new ServiceUnavailableError('Docmee 模板服务当前不可达', {
        pathname,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      throw new ExternalSkillProviderError(`Docmee 模板请求失败 (${response.status})`, response.status, {
        pathname,
        payload,
      });
    }

    const envelope = payload as DocmeeEnvelope<T>;
    if (typeof envelope?.code !== 'number') {
      throw new ExternalSkillProviderError('Docmee 模板接口返回了无法识别的响应', 502, {
        pathname,
        payload,
      });
    }

    if (envelope.code !== 0 || typeof envelope.data === 'undefined') {
      throw new ExternalSkillProviderError(envelope.message || 'Docmee 模板请求失败', 502, {
        pathname,
        code: envelope.code,
        payload,
      });
    }

    return envelope.data;
  }

  private async requestBinary(fileUrl: string): Promise<Buffer> {
    let response: Response;

    try {
      response = await this.fetchImpl(fileUrl);
    } catch (error) {
      throw new ServiceUnavailableError('Docmee 模板文件下载失败，服务当前不可达', {
        fileUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      const payload = await readPayload(response);
      throw new ExternalSkillProviderError(`Docmee 模板文件下载失败 (${response.status})`, response.status, {
        fileUrl,
        payload,
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  createApiToken(input: {
    uid: string;
    limit: number;
    timeOfHours: number;
  }): Promise<{ token: string; expireTime: number }> {
    return this.requestJson<{ token: string; expireTime: number }>('/api/user/createApiToken', {
      method: 'POST',
      headers: {
        'Api-Key': this.options.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  async uploadTemplate(input: {
    token: string;
    fileName: string;
    file: Buffer;
    templateId?: string;
  }): Promise<{ templateId: string }> {
    const form = new FormData();
    form.set('type', '4');
    form.set(
      'file',
      new Blob([input.file], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
      input.fileName,
    );

    if (input.templateId) {
      form.set('templateId', input.templateId);
    }

    const payload = await this.requestJson<{ id: string }>('/api/ppt/uploadTemplate', {
      method: 'POST',
      headers: {
        token: input.token,
      },
      body: form,
    });

    return {
      templateId: payload.id,
    };
  }

  updateTemplate(input: {
    templateId: string;
    name: string;
  }): Promise<unknown> {
    return this.requestJson<unknown>('/api/ppt/updateTemplate', {
      method: 'POST',
      headers: {
        'Api-Key': this.options.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: input.templateId,
        name: input.name,
      }),
    });
  }

  updateUserTemplate(input: {
    templateId: string;
    isPublic: boolean;
  }): Promise<unknown> {
    return this.requestJson<unknown>('/api/ppt/updateUserTemplate', {
      method: 'POST',
      headers: {
        'Api-Key': this.options.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  downloadTemplate(input: {
    token: string;
    templateId: string;
  }): Promise<DocmeeTemplateDownloadPayload> {
    return this.requestJson<DocmeeTemplateDownloadPayload>('/api/ppt/downloadTemplate', {
      method: 'POST',
      headers: {
        token: input.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: input.templateId,
      }),
    });
  }

  async downloadTemplateBinary(input: {
    token: string;
    templateId: string;
  }): Promise<{
    metadata: DocmeeTemplateDownloadPayload;
    file: Buffer;
  }> {
    const metadata = await this.downloadTemplate(input);
    const fileUrl = metadata.fileUrl?.trim();
    if (!fileUrl) {
      throw new ExternalSkillProviderError('Docmee 模板下载地址为空', 502, {
        templateId: input.templateId,
        metadata,
      });
    }

    return {
      metadata,
      file: await this.requestBinary(fileUrl),
    };
  }

  deleteTemplate(input: {
    token: string;
    templateId: string;
  }): Promise<unknown> {
    return this.requestJson<unknown>('/api/ppt/delTemplateId', {
      method: 'POST',
      headers: {
        token: input.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: input.templateId,
      }),
    });
  }
}
