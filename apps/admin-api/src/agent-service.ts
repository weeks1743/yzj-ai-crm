import { randomUUID } from 'node:crypto';
import type {
  AgentChatMessage,
  AgentChatRequest,
  AgentChatResponse,
  AppConfig,
} from './contracts.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import type { MainAgentRuntime } from './agent-runtime.js';
import type { AgentRuntimeOutput } from './agent-core.js';
import { createTraceId } from './agent-utils.js';
import { getErrorMessage } from './errors.js';

export class AgentService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: AgentRunRepository;
      runtime: MainAgentRuntime;
    },
  ) {}

  async chat(request: AgentChatRequest): Promise<AgentChatResponse> {
    const runId = request.resume?.runId || randomUUID();
    const traceId = createTraceId();
    const startedAt = new Date().toISOString();
    const eid = request.tenantContext?.eid?.trim() || this.options.config.yzj.eid;
    const appId = request.tenantContext?.appId?.trim() || this.options.config.yzj.appId;
    const operatorOpenId = request.tenantContext?.operatorOpenId?.trim() || null;
    const contextFrame = this.options.repository.findContextFrame(request.conversationKey);
    const focusedName = contextFrame?.subject?.name ?? this.options.repository.findFocusedCompany(request.conversationKey);

    const output = await this.runRuntime({
      request,
      runId,
      traceId,
      startedAt,
      eid,
      appId,
      operatorOpenId,
      focusedName,
      contextFrame,
    });
    const message = buildMessage(request.sceneKey, output);

    try {
      this.options.repository.saveRun({
        request,
        runId,
        traceId,
        eid,
        appId,
        intentFrame: output.legacyIntentFrame,
        taskPlan: output.taskPlan,
        executionState: output.executionState,
        toolCalls: output.toolCalls,
        evidence: output.evidence,
        message,
      });
    } catch (error) {
      if (!isSqliteLockedError(error)) {
        throw error;
      }
      console.warn(
        '[admin-api] sqlite database is locked while saving agent run; response is returned without run persistence. Close DB Browser before trace/writeback tests.',
      );
    }

    return {
      success: true,
      data: {
        content: message.content,
        attachments: message.attachments,
        extraInfo: message.extraInfo,
      },
      message,
      intentFrame: output.legacyIntentFrame,
      taskPlan: output.taskPlan,
      executionState: output.executionState,
      toolCalls: output.toolCalls,
      traceId,
    };
  }

  private async runRuntime(input: Parameters<MainAgentRuntime['invoke']>[0]): Promise<AgentRuntimeOutput> {
    try {
      return await this.options.runtime.invoke(input);
    } catch (error) {
      throw new Error(`主 Agent Runtime 执行失败：${getErrorMessage(error)}`);
    }
  }
}

function isSqliteLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const maybeSqliteError = error as { code?: unknown; errcode?: unknown; errstr?: unknown };
  return message.includes('database is locked')
    || maybeSqliteError.code === 'ERR_SQLITE_ERROR' && maybeSqliteError.errcode === 5
    || maybeSqliteError.errstr === 'database is locked';
}

function buildMessage(sceneKey: string, output: AgentRuntimeOutput): AgentChatMessage {
  return {
    role: 'assistant',
    content: output.content,
    attachments: output.attachments,
    extraInfo: {
      feedback: 'default',
      sceneKey,
      headline: output.headline,
      references: output.references,
      evidence: output.evidence,
      agentTrace: {
        traceId: output.executionState.traceId,
        intentFrame: output.legacyIntentFrame,
        taskPlan: output.taskPlan,
        executionState: output.executionState,
        toolCalls: output.toolCalls,
        qdrantFilter: output.qdrantFilter,
        selectedTool: output.selectedTool,
        pendingConfirmation: output.pendingConfirmation ?? null,
        resolvedContext: output.resolvedContext ?? null,
        policyDecisions: output.policyDecisions,
      },
    },
  };
}
