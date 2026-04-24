import type {
  FetchLike,
  YzjAccessTokenResponse,
  YzjLightCloudBatchDeleteResponse,
  YzjLightCloudBatchSaveResponse,
  YzjLightCloudListResponse,
  YzjLightCloudRecord,
  YzjLightCloudSearchPage,
  YzjLightCloudSearchResponse,
} from './contracts.js';
import { YzjApiError } from './errors.js';

interface LightCloudClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class LightCloudClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: LightCloudClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.yunzhijia.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async getTeamAccessToken(params: {
    eid: string;
    appId: string;
    secret: string;
  }): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/gateway/oauth2/token/getAccessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: params.appId,
        eid: params.eid,
        secret: params.secret,
        timestamp: this.now(),
        scope: 'team',
      }),
    });

    const payload = (await this.parseJson(
      response,
      '获取轻云 AccessToken 失败',
    )) as YzjAccessTokenResponse;
    if (!response.ok || !payload.success || !payload.data?.accessToken) {
      throw new YzjApiError('获取轻云 AccessToken 失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data.accessToken;
  }

  async searchList(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<YzjLightCloudSearchPage> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/lightcloud/data/searchList?accessToken=${encodeURIComponent(params.accessToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.body),
      },
    );

    const payload = (await this.parseJson(
      response,
      '查询轻云单据列表失败',
    )) as YzjLightCloudSearchResponse;
    if (
      !response.ok ||
      !payload.success ||
      !payload.data ||
      !Array.isArray(payload.data.content)
    ) {
      throw new YzjApiError('查询轻云单据列表失败', {
        status: response.status,
        payload,
      });
    }

    return {
      pageNumber: payload.data.pageNumber ?? 1,
      totalPages: payload.data.totalPages ?? 0,
      pageSize: payload.data.pageSize ?? 0,
      totalElements: payload.data.totalElements ?? 0,
      content: payload.data.content,
    };
  }

  async listRecords(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<YzjLightCloudRecord[]> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/lightcloud/data/list?accessToken=${encodeURIComponent(params.accessToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.body),
      },
    );

    const payload = (await this.parseJson(
      response,
      '获取轻云单据详情失败',
    )) as YzjLightCloudListResponse;
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new YzjApiError('获取轻云单据详情失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data;
  }

  async batchSave(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<string[]> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/lightcloud/data/batchSave?accessToken=${encodeURIComponent(params.accessToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.body),
      },
    );

    const payload = (await this.parseJson(
      response,
      '写入轻云单据失败',
    )) as YzjLightCloudBatchSaveResponse;
    const fallbackFormInstIds = Array.isArray(params.body.data)
      ? params.body.data.map((item) =>
          item && typeof item === 'object' && typeof item.formInstId === 'string'
            ? item.formInstId
            : null,
        )
      : [];
    const formInstIds =
      Array.isArray(payload.data)
        ? payload.data.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? payload.data.hasException
            ? null
            : Array.isArray(payload.data.formInstIds)
              ? payload.data.formInstIds
                  .map((item, index) =>
                    typeof item === 'string' && item.length > 0
                      ? item
                      : fallbackFormInstIds[index],
                  )
                  .filter((item): item is string => typeof item === 'string' && item.length > 0)
              : null
          : null;

    if (!response.ok || !payload.success || !formInstIds) {
      throw new YzjApiError('写入轻云单据失败', {
        status: response.status,
        payload,
      });
    }

    return formInstIds;
  }

  async batchDelete(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<string[]> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/lightcloud/data/batchDelete?accessToken=${encodeURIComponent(params.accessToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.body),
      },
    );

    const payload = (await this.parseJson(
      response,
      '删除轻云单据失败',
    )) as YzjLightCloudBatchDeleteResponse;
    const formInstIds = Array.isArray(payload.data)
      ? payload.data.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : null;

    if (!response.ok || !payload.success || !formInstIds) {
      throw new YzjApiError('删除轻云单据失败', {
        status: response.status,
        payload,
      });
    }

    return formInstIds;
  }

  buildSearchPreview(params: {
    accessTokenPlaceholder?: string;
    body: Record<string, unknown>;
  }): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    return {
      url: `${this.baseUrl}/gateway/lightcloud/data/searchList?accessToken=${
        params.accessTokenPlaceholder ?? '{accessToken}'
      }`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params.body,
    };
  }

  buildBatchSavePreview(params: {
    accessTokenPlaceholder?: string;
    body: Record<string, unknown>;
  }): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    return {
      url: `${this.baseUrl}/gateway/lightcloud/data/batchSave?accessToken=${
        params.accessTokenPlaceholder ?? '{accessToken}'
      }`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params.body,
    };
  }

  buildBatchGetPreview(params: {
    accessTokenPlaceholder?: string;
    body: Record<string, unknown>;
  }): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    return {
      url: `${this.baseUrl}/gateway/lightcloud/data/list?accessToken=${
        params.accessTokenPlaceholder ?? '{accessToken}'
      }`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params.body,
    };
  }

  buildBatchDeletePreview(params: {
    accessTokenPlaceholder?: string;
    body: Record<string, unknown>;
  }): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    return {
      url: `${this.baseUrl}/gateway/lightcloud/data/batchDelete?accessToken=${
        params.accessTokenPlaceholder ?? '{accessToken}'
      }`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params.body,
    };
  }

  private async parseJson(response: Response, errorMessage: string): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      const repaired = text.replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":');
      if (repaired !== text) {
        try {
          return JSON.parse(repaired);
        } catch {
          // fall through to the original error below
        }
      }

      throw new YzjApiError(`${errorMessage}，接口返回了无法解析的 JSON`, {
        status: response.status,
        text,
        cause: error,
      });
    }
  }
}
