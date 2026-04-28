import type { ActionsFeedbackProps } from '@ant-design/x';
import {
  AbstractChatProvider,
  XRequest,
  type XRequestOptions,
} from '@ant-design/x-sdk';

export interface AssistantAttachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface AssistantEvidenceCard {
  artifactId: string;
  versionId: string;
  title: string;
  version: number;
  sourceToolCode: string;
  anchorLabel: string;
  snippet: string;
  score?: number;
  vectorStatus?: string;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: AssistantAttachment[];
  extraInfo?: {
    feedback: ActionsFeedbackProps['value'];
    sceneKey: string;
    headline: string;
    references: string[];
    evidence?: AssistantEvidenceCard[];
    artifactTrace?: {
      intentFrame: string;
      taskPlan: string[];
      qdrantFilter?: unknown;
      vectorStatus?: string;
    };
    agentTrace?: {
      traceId: string;
      intentFrame: any;
      taskPlan: any;
      executionState: any;
      toolCalls: any[];
      qdrantFilter?: unknown;
    };
  };
}

export interface AssistantRequestInput {
  query: string;
  sceneKey: string;
  conversationKey: string;
  attachments?: AssistantAttachment[];
}

interface AssistantResponseOutput {
  success: boolean;
  data?: {
    content: string;
    attachments?: AssistantAttachment[];
    extraInfo?: AssistantChatMessage['extraInfo'];
  };
  code?: string;
  message?: string;
}

class AgentApiProvider extends AbstractChatProvider<
  AssistantChatMessage,
  AssistantRequestInput,
  AssistantResponseOutput
> {
  transformParams(
    requestParams: Partial<AssistantRequestInput>,
    options: XRequestOptions<
      AssistantRequestInput,
      AssistantResponseOutput,
      AssistantChatMessage
    >,
  ): AssistantRequestInput {
    return {
      ...(options.params ?? {}),
      ...(requestParams ?? {}),
    } as AssistantRequestInput;
  }

  transformLocalMessage(
    requestParams: Partial<AssistantRequestInput>,
  ): AssistantChatMessage {
    return {
      role: 'user',
      content: requestParams.query ?? '',
      attachments: requestParams.attachments,
    };
  }

  transformMessage(info: any): AssistantChatMessage {
    const chunk =
      (info?.chunk as AssistantResponseOutput | undefined) ??
      (Array.isArray(info?.chunks)
        ? (info.chunks[info.chunks.length - 1] as AssistantResponseOutput | undefined)
        : undefined);

    if (!chunk?.success || !chunk.data) {
      return (
        info?.originMessage ?? {
          role: 'assistant',
          content: chunk?.message || 'Agent API 未返回有效数据，请稍后重试。',
        }
      );
    }

    return {
      role: 'assistant',
      content: chunk.data.content,
      attachments: chunk.data.attachments,
      extraInfo: chunk.data.extraInfo,
    };
  }
}

async function readApiError(response: Response) {
  try {
    const payload = await response.json();
    if (payload?.message) {
      return payload.message as string;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function agentApiFetch(
  _baseURL: Parameters<typeof fetch>[0],
  options: XRequestOptions<AssistantRequestInput, AssistantResponseOutput>,
) {
  const params = options.params as AssistantRequestInput;
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationKey: params.conversationKey,
      query: params.query,
      sceneKey: params.sceneKey,
      attachments: params.attachments ?? [],
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const reason = await readApiError(response);
    throw new Error(`Agent API 请求失败：${reason}`);
  }

  return new Response(await response.text(), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

const providerCache = new Map<string, AgentApiProvider>();

export function providerFactory(conversationKey: string) {
  if (!providerCache.has(conversationKey)) {
    providerCache.set(
      conversationKey,
      new AgentApiProvider({
        request: XRequest<AssistantRequestInput, AssistantResponseOutput>(
          '/api/agent/chat',
          {
            manual: true,
            fetch: agentApiFetch,
          },
        ),
      }),
    );
  }

  return providerCache.get(conversationKey)!;
}
