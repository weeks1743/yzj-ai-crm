import type {
  FetchLike,
  YzjAccessTokenResponse,
  YzjEmployee,
  YzjPersonListResponse,
} from './contracts.js';
import { YzjApiError } from './errors.js';

interface YzjClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class YzjClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: YzjClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.yunzhijia.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async getAccessToken(params: { eid: string; secret: string }): Promise<string> {
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

    const payload = (await this.parseJson(response)) as YzjAccessTokenResponse;
    if (!response.ok || !payload.success || !payload.data?.accessToken) {
      throw new YzjApiError('获取云之家 AccessToken 失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data.accessToken;
  }

  async listActiveEmployees(params: {
    accessToken: string;
    eid: string;
    begin: number;
    count: number;
  }): Promise<YzjEmployee[]> {
    const form = new URLSearchParams({
      eid: params.eid,
      data: JSON.stringify({
        eid: params.eid,
        begin: params.begin,
        count: params.count,
      }),
    });

    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/openimport/open/person/getall?accessToken=${encodeURIComponent(
        params.accessToken,
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );

    const payload = (await this.parseJson(response)) as YzjPersonListResponse;
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new YzjApiError('查询云之家在职人员失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data;
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new YzjApiError('云之家接口返回了无法解析的 JSON', {
        status: response.status,
        text,
        cause: error,
      });
    }
  }
}
