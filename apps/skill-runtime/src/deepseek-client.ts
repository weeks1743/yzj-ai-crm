import type {
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  FetchLike,
} from './contracts.js';
import { ExternalServiceError } from './errors.js';

function ensureBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function mapMessage(message: ChatCompletionRequest['messages'][number]): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content ?? '',
    };
  }

  if (message.role === 'assistant' && message.toolCalls) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

export class DeepSeekChatCompletionClient implements ChatCompletionClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      fetchImpl?: FetchLike;
    },
  ) {}

  async createChatCompletion(
    input: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const endpoint = new URL('chat/completions', ensureBaseUrl(this.options.baseUrl));

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.map(mapMessage),
        tools: input.tools,
        tool_choice: 'auto',
        stream: false,
        thinking: {
          type: 'disabled',
        },
      }),
    });

    const rawText = await response.text();
    let payload: any;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      throw new ExternalServiceError('DeepSeek 返回了无法解析的 JSON', {
        cause: error instanceof Error ? error.message : String(error),
        rawText,
      });
    }

    if (!response.ok) {
      throw new ExternalServiceError('DeepSeek 调用失败', {
        status: response.status,
        payload,
      });
    }

    const choice = payload?.choices?.[0];
    const message = choice?.message ?? {};
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((toolCall: any) => ({
          id: String(toolCall.id),
          name: String(toolCall.function?.name ?? ''),
          arguments: String(toolCall.function?.arguments ?? '{}'),
        }))
      : [];

    let content: string | null = null;
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .filter((item: string) => item.length > 0)
        .join('\n');
    }

    return {
      content,
      toolCalls,
      raw: payload,
    };
  }
}
