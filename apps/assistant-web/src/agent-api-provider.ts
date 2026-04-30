import type { ActionsFeedbackProps } from '@ant-design/x';
import {
  AbstractChatProvider,
  XRequest,
  type XRequestOptions,
} from '@ant-design/x-sdk';
import type { AgentClientAction, AgentUiSurface } from '@shared/types';

const TEST_OPERATOR_OPEN_ID =
  import.meta.env.VITE_YZJ_OPERATOR_OPEN_ID?.trim() || '69e75eb5e4b0e65b61c014da';

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

export interface AssistantFieldOptionHint {
  label: string;
  value: string | number | boolean;
  key?: string;
  description?: string;
  source?: 'field_option' | 'dictionary' | 'widget' | 'employee' | 'record';
}

export interface AssistantMetaQuestionLookup {
  kind: 'remote_select';
  endpoint: '/api/agent/meta-question-options';
  source: 'employee' | 'record';
  targetObjectKey?: string;
  minKeywordLength: 1;
  pageSize: number;
  allowFreeText: false;
}

export interface AssistantRecordWritePreviewRow {
  label: string;
  value?: string;
  paramKey?: string;
  reason?: string;
  source?: 'input' | 'evidence' | 'derived' | 'tool' | 'system';
  options?: AssistantFieldOptionHint[];
}

export interface AssistantMetaQuestion {
  questionId: string;
  paramKey: string;
  label: string;
  type: 'text' | 'phone' | 'single_select' | 'multi_select' | 'date' | 'reference';
  required: boolean;
  placeholder?: string;
  currentValue?: string | number | boolean | string[];
  options?: AssistantFieldOptionHint[];
  lookup?: AssistantMetaQuestionLookup;
  reason?: string;
}

export interface AssistantMetaQuestionCard {
  title: string;
  description?: string;
  toolCode: string;
  submitLabel: string;
  currentValues: Record<string, {
    label: string;
    value?: string;
  }>;
  questions: AssistantMetaQuestion[];
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
    uiSurfaces?: AgentUiSurface[];
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
      toolCalls: Array<{
        id?: string;
        runId?: string;
        toolCode: string;
        status: string;
        inputSummary?: string;
        outputSummary?: string;
        startedAt?: string;
        finishedAt?: string | null;
        errorMessage?: string | null;
        errorDetails?: unknown;
      }>;
      qdrantFilter?: unknown;
      selectedTool?: {
        toolCode: string;
        reason: string;
        input: Record<string, unknown>;
        confidence: number;
      };
      pendingConfirmation?: {
        confirmationId: string;
        runId: string;
        toolCode: string;
        title: string;
        summary: string;
        preview: unknown;
        userPreview?: {
          title: string;
          summaryRows: AssistantRecordWritePreviewRow[];
          missingRequiredRows?: AssistantRecordWritePreviewRow[];
          blockedRows?: AssistantRecordWritePreviewRow[];
          recommendedRows?: AssistantRecordWritePreviewRow[];
        };
        debugPayload?: unknown;
        requestInput: Record<string, unknown>;
        status: 'pending' | 'approved' | 'rejected' | 'expired';
        createdAt: string;
        decidedAt: string | null;
      } | null;
      pendingInteraction?: {
        interactionId: string;
        kind: 'input_required' | 'candidate_selection' | 'confirmation';
        runId: string;
        toolCode?: string;
        status: 'pending' | 'resolved' | 'cancelled';
        title: string;
        summary: string;
        partialInput?: Record<string, unknown>;
        missingRows?: AssistantRecordWritePreviewRow[];
        blockedRows?: AssistantRecordWritePreviewRow[];
        recommendedRows?: AssistantRecordWritePreviewRow[];
        questionCard?: AssistantMetaQuestionCard;
        contextSubject?: {
          kind: string;
          type?: string;
          id?: string;
          name?: string;
        };
        createdAt: string;
      } | null;
      continuationResolution?: {
        usedContinuation: boolean;
        action:
          | 'resume_pending_interaction'
          | 'start_new_task'
          | 'confirm_writeback'
          | 'reject_writeback'
          | 'select_candidate'
          | 'route_tool'
          | 'wait_for_input'
          | 'none';
        reason: string;
        sourceInteractionId?: string;
        toolCode?: string;
        mergedInput?: Record<string, unknown>;
      } | null;
      resolvedContext?: {
        usedContext: boolean;
        reason: string;
        subject?: {
          kind: string;
          type?: string;
          id?: string;
          name?: string;
        };
        sourceRunId?: string;
        evidenceRefs?: AssistantEvidenceCard[];
      } | null;
      semanticResolution?: {
        usedSemantic: boolean;
        shouldClarify: boolean;
        reason: string;
        selectedCandidate?: {
          candidateId: string;
          subject: {
            kind: string;
            type?: string;
            id?: string;
            name?: string;
          };
          sourceRunId?: string;
          evidenceRefs: AssistantEvidenceCard[];
          text: string;
          recencyRank: number;
          confidence: number;
          source: string;
          score: number;
          scoreLabel: string;
          reasons: string[];
        };
        candidates: Array<{
          candidateId: string;
          subject: {
            kind: string;
            type?: string;
            id?: string;
            name?: string;
          };
          sourceRunId?: string;
          evidenceRefs: AssistantEvidenceCard[];
          text: string;
          recencyRank: number;
          confidence: number;
          source: string;
          score: number;
          scoreLabel: string;
          reasons: string[];
        }>;
        threshold: number;
        margin: number;
        embeddingProvider: string;
        targetWasOverridden: boolean;
      } | null;
      toolArbitration?: {
        usedArbitration: boolean;
        ruleCode: string;
        conflictGroup: string;
        intentCode: string;
        subjectType?: string;
        subjectName?: string;
        action: 'direct_tool' | 'read_only_probe' | 'clarify';
        selectedToolCode?: string;
        probeToolCode?: string;
        candidateTools: Array<{
          toolCode: string;
          type: string;
          provider: string;
          priority: number;
          risk?: string;
          clarifyLabel?: string;
          readOnlyProbe: boolean;
        }>;
        reason: string;
        probeResult?: {
          status: 'not_run' | 'matched' | 'not_matched' | 'failed';
          count?: number;
          summary?: string;
        };
      } | null;
      policyDecisions?: Array<{
        policyCode: string;
        action: string;
        toolCode?: string;
        reason: string;
        createdAt: string;
      }>;
    };
  };
}

export interface AssistantRequestInput {
  query: string;
  sceneKey: string;
  conversationKey: string;
  attachments?: AssistantAttachment[];
  clientAction?: AgentClientAction;
  resume?: {
    runId: string;
    action: 'confirm_writeback';
    decision: 'approve' | 'reject';
    confirmationId?: string;
  } | {
    runId: string;
    action: 'provide_input';
    interactionId: string;
    answers: Record<string, unknown>;
  };
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
          content: chunk?.message || '智能体接口未返回有效数据，请稍后重试。',
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
      ...(params.clientAction ? { clientAction: params.clientAction } : {}),
      tenantContext: {
        operatorOpenId: TEST_OPERATOR_OPEN_ID,
      },
      ...(params.resume ? { resume: params.resume } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const reason = await readApiError(response);
    throw new Error(`智能体接口请求失败：${reason}`);
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
