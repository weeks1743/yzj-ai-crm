import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  FetchLike,
  YzjAccessTokenResponse,
  YzjApprovalFileUploadItem,
  YzjApprovalFileUploadResponse,
} from './contracts.js';
import { YzjApiError } from './errors.js';

interface ApprovalFileClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class ApprovalFileClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: ApprovalFileClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.yunzhijia.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async getResourceAccessToken(params: {
    eid: string;
    secret: string;
  }): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/gateway/oauth2/token/getAccessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eid: params.eid,
        secret: params.secret,
        timestamp: this.now(),
        scope: 'resGroupSecret',
      }),
    });

    const payload = (await this.parseJson(
      response,
      '获取审批文件服务 AccessToken 失败',
    )) as YzjAccessTokenResponse;
    if (!response.ok || !payload.success || !payload.data?.accessToken) {
      throw new YzjApiError('获取审批文件服务 AccessToken 失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data.accessToken;
  }

  async uploadFile(params: {
    accessToken: string;
    filePath: string;
    bizKey: string;
  }): Promise<YzjApprovalFileUploadItem> {
    const fileBuffer = await readFile(params.filePath);
    const fileName = basename(params.filePath);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);
    formData.append('bizkey', params.bizKey);

    const response = await this.fetchImpl(`${this.baseUrl}/docrest/doc/file/uploadfile`, {
      method: 'POST',
      headers: {
        'x-accessToken': params.accessToken,
      },
      body: formData,
    });

    const payload = (await this.parseJson(
      response,
      '上传审批附件失败',
    )) as YzjApprovalFileUploadResponse;
    const uploaded = Array.isArray(payload.data) ? payload.data[0] : null;
    if (!response.ok || !payload.success || !uploaded?.fileId) {
      throw new YzjApiError('上传审批附件失败', {
        status: response.status,
        payload,
      });
    }

    return uploaded;
  }

  private async parseJson(response: Response, errorMessage: string): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new YzjApiError(`${errorMessage}，接口返回了无法解析的 JSON`, {
        status: response.status,
        text,
        cause: error,
      });
    }
  }
}
