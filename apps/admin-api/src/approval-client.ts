import type {
  FetchLike,
  YzjAccessTokenResponse,
  YzjApprovalFormTemplateResponse,
  YzjApprovalListResponse,
  YzjDictionaryCategory,
  YzjDictionaryEntry,
  YzjDictionaryOption,
} from './contracts.js';
import { YzjApiError } from './errors.js';

interface ApprovalClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class ApprovalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: ApprovalClientOptions = {}) {
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

    const payload = (await this.parseJson(response, '获取审批 AccessToken 失败')) as YzjAccessTokenResponse;
    if (!response.ok || !payload.success || !payload.data?.accessToken) {
      throw new YzjApiError('获取审批 AccessToken 失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data.accessToken;
  }

  async viewFormDef(params: {
    accessToken: string;
    formCodeId: string;
  }): Promise<NonNullable<YzjApprovalFormTemplateResponse['data']>> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/gateway/workflow/form/thirdpart/viewFormDef?accessToken=${encodeURIComponent(
        params.accessToken,
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formCodeId: params.formCodeId,
        }),
      },
    );

    const payload = (await this.parseJson(
      response,
      '获取审批表单模板失败',
    )) as YzjApprovalFormTemplateResponse;
    if (!response.ok || !payload.success || !payload.data?.formInfo?.widgetMap) {
      throw new YzjApiError('获取审批表单模板失败', {
        status: response.status,
        payload,
      });
    }

    return payload.data;
  }

  async listDictionaryCategories(params: {
    accessToken: string;
  }): Promise<YzjDictionaryCategory[]> {
    return this.postList<YzjDictionaryCategory>({
      accessToken: params.accessToken,
      path: '/gateway/workflow/form/thirdpart/basicinfo/category/list',
      body: {},
      errorMessage: '获取审批数据字典分类失败',
    });
  }

  async listPublicOptions(params: {
    accessToken: string;
    parentId: string;
  }): Promise<YzjDictionaryOption[]> {
    return this.postList<YzjDictionaryOption>({
      accessToken: params.accessToken,
      path: '/gateway/workflow/form/thirdpart/basicinfo/option/list',
      body: {
        parentId: params.parentId,
      },
      errorMessage: '获取审批公共选项失败',
    });
  }

  async listPublicOptionElements(params: {
    accessToken: string;
    parentId: string;
    pageNumber?: number;
    pageSize?: number;
    title?: string;
  }): Promise<YzjDictionaryEntry[]> {
    return this.postList<YzjDictionaryEntry>({
      accessToken: params.accessToken,
      path: '/gateway/workflow/form/thirdpart/basicinfo/element/list',
      body: {
        parentId: params.parentId,
        pageNumber: params.pageNumber ?? 1,
        pageSize: params.pageSize ?? 500,
        ...(params.title ? { title: params.title } : {}),
      },
      errorMessage: '获取审批公共选项元素失败',
    });
  }

  private async postList<T>(params: {
    accessToken: string;
    path: string;
    body: Record<string, unknown>;
    errorMessage: string;
  }): Promise<T[]> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${params.path}?accessToken=${encodeURIComponent(params.accessToken)}`,
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
      params.errorMessage,
    )) as YzjApprovalListResponse<T>;
    if (!response.ok || !payload.success || !Array.isArray(payload.data?.list)) {
      throw new YzjApiError(params.errorMessage, {
        status: response.status,
        payload,
      });
    }

    return payload.data.list;
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
