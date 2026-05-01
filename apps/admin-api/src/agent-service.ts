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
    const contextFrame = await this.options.repository.findContextFrame(request.conversationKey);
    const contextCandidates = await this.options.repository.findContextCandidates(request.conversationKey);
    const focusedName = contextFrame?.subject?.name ?? await this.options.repository.findFocusedCompany(request.conversationKey);
    const resumeFallback = request.resume?.action === 'provide_input'
      ? await this.options.repository.findPendingInteractionState({
          runId: request.resume.runId,
          conversationKey: request.conversationKey,
          interactionId: request.resume.interactionId,
        })
      : null;

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
      contextCandidates,
      resumeFallback,
    });
    const message = buildMessage(request.sceneKey, output);

    try {
      await this.options.repository.saveRun({
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
        contextFrame: output.contextFrame !== undefined ? output.contextFrame : contextFrame,
        message,
      });
    } catch (error) {
      throw error;
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
      uiSurfaces: output.uiSurfaces,
      agentTrace: {
        traceId: output.executionState.traceId,
        intentFrame: output.legacyIntentFrame,
        taskPlan: output.taskPlan,
        executionState: output.executionState,
        toolCalls: output.toolCalls,
        qdrantFilter: output.qdrantFilter,
        selectedTool: output.selectedTool,
        pendingConfirmation: output.pendingConfirmation ?? null,
        pendingInteraction: output.pendingInteraction ?? null,
        continuationResolution: output.continuationResolution ?? null,
        resolvedContext: output.resolvedContext ?? null,
        semanticResolution: output.semanticResolution ?? null,
        toolArbitration: output.toolArbitration ?? null,
        policyDecisions: output.policyDecisions,
      },
    },
  };
}
