import type { AppConfig } from './contracts.js';
import { ServiceUnavailableError } from './errors.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export class DeepSeekChatClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.deepseek.apiKey);
  }

  async completeJson(messages: ChatMessage[]): Promise<string> {
    if (!this.config.deepseek.apiKey) {
      throw new ServiceUnavailableError('缺少 DEEPSEEK_API_KEY，无法调用 IntentFrame LLM');
    }

    const response = await fetch(`${trimTrailingSlash(this.config.deepseek.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.deepseek.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.deepseek.defaultModel,
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as ChatCompletionPayload;

    if (!response.ok) {
      throw new ServiceUnavailableError(
        payload.error?.message || `DeepSeek 请求失败: ${response.status}`,
      );
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceUnavailableError('DeepSeek 未返回可解析内容');
    }

    return content;
  }
}
