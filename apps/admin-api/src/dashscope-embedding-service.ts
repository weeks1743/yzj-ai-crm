import type { AppConfig } from './contracts.js';
import { ServiceUnavailableError } from './errors.js';

interface DashScopeEmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  error?: {
    message?: string;
  };
}

export class DashScopeEmbeddingService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.embedding.apiKey);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.config.embedding.apiKey) {
      throw new ServiceUnavailableError('缺少 DASHSCOPE_API_KEY，无法执行向量化');
    }

    const batches: number[][] = [];
    for (let index = 0; index < texts.length; index += 10) {
      const batch = texts.slice(index, index + 10);
      batches.push(...(await this.embedBatch(batch)));
    }

    return batches;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const endpoint = `${this.config.embedding.baseUrl.replace(/\/$/, '')}/embeddings`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.embedding.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.embedding.model,
        input: texts,
        dimensions: this.config.embedding.dimensions,
        encoding_format: 'float',
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as DashScopeEmbeddingResponse;
    if (!response.ok) {
      throw new ServiceUnavailableError(
        payload.error?.message || `DashScope Embedding 调用失败: ${response.status}`,
      );
    }

    const embeddings = [...(payload.data ?? [])]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding)
      .filter((item): item is number[] => Array.isArray(item));

    if (embeddings.length !== texts.length) {
      throw new ServiceUnavailableError('DashScope Embedding 返回数量与输入不一致');
    }

    return embeddings;
  }
}
