import type { FetchLike, WebSearchClient, WebSearchResult, WebSearchResultItem } from './contracts.js';
import { ExternalServiceError } from './errors.js';

function ensureBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function pushUniqueResult(
  collection: WebSearchResultItem[],
  candidate: WebSearchResultItem,
): void {
  if (!candidate.url || collection.some((item) => item.url === candidate.url)) {
    return;
  }

  collection.push(candidate);
}

function collectFromAnnotations(result: WebSearchResultItem[], contentItem: any): void {
  if (!Array.isArray(contentItem?.annotations)) {
    return;
  }

  for (const annotation of contentItem.annotations) {
    const url = typeof annotation?.url === 'string' ? annotation.url : '';
    const title =
      typeof annotation?.title === 'string'
        ? annotation.title
        : typeof annotation?.text === 'string'
          ? annotation.text
          : url;
    if (!url) {
      continue;
    }

    pushUniqueResult(result, {
      title,
      url,
      snippet: typeof contentItem?.text === 'string' ? contentItem.text : '',
    });
  }
}

function normalizeResponse(query: string, payload: any, maxResults: number): WebSearchResult {
  const results: WebSearchResultItem[] = [];
  const summaryParts: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (typeof contentItem?.text === 'string' && contentItem.text.trim()) {
          summaryParts.push(contentItem.text.trim());
        }
        collectFromAnnotations(results, contentItem);
      }
    }

    if (Array.isArray(item?.results)) {
      for (const resultItem of item.results) {
        if (typeof resultItem?.url === 'string') {
          pushUniqueResult(results, {
            title: String(resultItem?.title || resultItem.url),
            url: resultItem.url,
            snippet: String(resultItem?.snippet || ''),
          });
        }
      }
    }
  }

  const citations = Array.isArray(payload?.citations) ? payload.citations : [];
  for (const citation of citations) {
    if (typeof citation?.url === 'string') {
      pushUniqueResult(results, {
        title: String(citation?.title || citation.url),
        url: citation.url,
        snippet: String(citation?.snippet || ''),
      });
    }
  }

  return {
    provider: 'ark-web-search',
    query,
    summary: summaryParts.join('\n').trim(),
    results: results.slice(0, maxResults),
    raw: payload,
  };
}

export class VolcWebSearchClient implements WebSearchClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      fetchImpl?: FetchLike;
    },
  ) {}

  async search(
    query: string,
    options: { maxResults?: number } = {},
  ): Promise<WebSearchResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const endpoint = new URL('responses', ensureBaseUrl(this.options.baseUrl));
    const maxResults = options.maxResults ?? 5;

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        tools: [
          {
            type: 'web_search',
            max_keyword: Math.max(1, Math.min(maxResults, 5)),
          },
        ],
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: query,
              },
            ],
          },
        ],
      }),
    });

    const rawText = await response.text();
    let payload: any;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      throw new ExternalServiceError('火山联网搜索返回了无法解析的 JSON', {
        cause: error instanceof Error ? error.message : String(error),
        rawText,
      });
    }

    if (!response.ok) {
      const providerMessage =
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : `HTTP ${response.status}`;
      const providerCode =
        typeof payload?.error?.code === 'string'
          ? payload.error.code
          : 'UNKNOWN';
      throw new ExternalServiceError(`火山联网搜索调用失败: ${providerCode} - ${providerMessage}`, {
        status: response.status,
        payload,
      });
    }

    return normalizeResponse(query, payload, maxResults);
  }
}
