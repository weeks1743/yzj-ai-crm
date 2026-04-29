import { randomUUID } from 'node:crypto';
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from '@langchain/langgraph';
import type {
  AgentChatRequest,
  AgentEvidenceCard,
  AgentExecutionStatus,
  AgentToolCall,
  AppConfig,
  ExecutionState,
  TaskPlan,
} from './contracts.js';
import {
  type ContextFrame,
  type ContextReferenceCandidate,
  type AgentIntentResolver,
  type AgentPlanner,
  type AgentResumeDecision,
  type AgentRuntimeOutput,
  type AgentToolExecutionResult,
  type AgentToolSelection,
  type ConfirmationRequest,
  type GenericIntentFrame,
  type PendingInteraction,
  type PolicyDecision,
  type ReferenceResolution,
  type SemanticReferenceResolution,
  type ToolArbitrationTrace,
  buildExecutionState,
  createPolicyDecision,
  createToolCall,
  finishToolCall,
} from './agent-core.js';
import { resolvePendingContinuation, resolveProvidedInputContinuation } from './agent-continuation-resolver.js';
import { resolveSemanticReference, type SemanticEmbeddingProvider } from './agent-reference-resolver.js';
import { buildErrorDebugInfo, formatErrorDebugSummary, getErrorMessage } from './errors.js';
import type { AgentToolRegistry } from './tool-registry.js';

interface MainAgentGraphState {
  request: AgentChatRequest;
  runId: string;
  traceId: string;
  startedAt: string;
  eid: string;
  appId: string;
  operatorOpenId: string | null;
  focusedName: string | null;
  contextFrame?: ContextFrame | null;
  contextCandidates?: ContextReferenceCandidate[];
  resolvedContext?: ReferenceResolution | null;
  semanticResolution?: SemanticReferenceResolution | null;
  toolArbitration?: ToolArbitrationTrace | null;
  intentFrame?: GenericIntentFrame;
  taskPlan?: TaskPlan;
  selectedTool?: AgentToolSelection;
  pendingConfirmation?: ConfirmationRequest | null;
  pendingInteraction?: PendingInteraction | null;
  continuationResolution?: AgentRuntimeOutput['continuationResolution'];
  resumeDecision?: AgentResumeDecision | null;
  policyDecisions: PolicyDecision[];
  toolCalls: AgentToolCall[];
  evidence: AgentEvidenceCard[];
  content: string;
  headline: string;
  references: string[];
  attachments: NonNullable<AgentRuntimeOutput['attachments']>;
  qdrantFilter?: unknown;
  status: AgentExecutionStatus;
  currentStepKey: string | null;
}

interface InterruptedGraphOutput extends Partial<MainAgentGraphState> {
  __interrupt__?: unknown;
}

export interface MainAgentRuntimeOptions {
  config: AppConfig;
  registry: AgentToolRegistry;
  intentResolver: AgentIntentResolver;
  planner: AgentPlanner;
  embeddingProvider?: SemanticEmbeddingProvider | null;
}

export interface MainAgentRuntimeInvokeInput {
  request: AgentChatRequest;
  runId: string;
  traceId: string;
  startedAt: string;
  eid: string;
  appId: string;
  operatorOpenId: string | null;
  focusedName: string | null;
  contextFrame?: ContextFrame | null;
  contextCandidates?: ContextReferenceCandidate[];
}

const MainAgentState = Annotation.Root({
  request: Annotation<AgentChatRequest>(),
  runId: Annotation<string>(),
  traceId: Annotation<string>(),
  startedAt: Annotation<string>(),
  eid: Annotation<string>(),
  appId: Annotation<string>(),
  operatorOpenId: Annotation<string | null>(),
  focusedName: Annotation<string | null>(),
  contextFrame: Annotation<ContextFrame | null | undefined>(),
  contextCandidates: Annotation<ContextReferenceCandidate[] | undefined>(),
  resolvedContext: Annotation<ReferenceResolution | null | undefined>(),
  semanticResolution: Annotation<SemanticReferenceResolution | null | undefined>(),
  toolArbitration: Annotation<ToolArbitrationTrace | null | undefined>(),
  intentFrame: Annotation<GenericIntentFrame | undefined>(),
  taskPlan: Annotation<TaskPlan | undefined>(),
  selectedTool: Annotation<AgentToolSelection | undefined>(),
  pendingConfirmation: Annotation<ConfirmationRequest | null | undefined>(),
  pendingInteraction: Annotation<PendingInteraction | null | undefined>(),
  continuationResolution: Annotation<AgentRuntimeOutput['continuationResolution']>(),
  resumeDecision: Annotation<AgentResumeDecision | null | undefined>(),
  policyDecisions: Annotation<PolicyDecision[]>(),
  toolCalls: Annotation<AgentToolCall[]>(),
  evidence: Annotation<AgentEvidenceCard[]>(),
  content: Annotation<string>(),
  headline: Annotation<string>(),
  references: Annotation<string[]>(),
  attachments: Annotation<NonNullable<AgentRuntimeOutput['attachments']>>(),
  qdrantFilter: Annotation<unknown | undefined>(),
  status: Annotation<AgentExecutionStatus>(),
  currentStepKey: Annotation<string | null>(),
});

export class MainAgentRuntime {
  private readonly graph;

  constructor(private readonly options: MainAgentRuntimeOptions) {
    this.graph = this.buildGraph();
  }

  async invoke(input: MainAgentRuntimeInvokeInput): Promise<AgentRuntimeOutput> {
    const config = {
      configurable: {
        thread_id: input.request.conversationKey || input.runId,
      },
    };
    const graphInput = await this.buildGraphInput(input, config);
    const graphOutput = await this.graph.invoke(graphInput as never, config) as InterruptedGraphOutput;
    const state = normalizeGraphOutput(graphOutput, input);
    const status: AgentExecutionStatus = state.status;
    const executionState = buildExecutionState({
      runId: input.runId,
      traceId: input.traceId,
      status,
      currentStepKey: state.currentStepKey,
      message: state.headline,
      startedAt: input.startedAt,
    });

    return {
      intentFrame: state.intentFrame!,
      legacyIntentFrame: state.intentFrame!.legacyIntentFrame,
      taskPlan: finishRuntimePlan(state.taskPlan!, status),
      executionState,
      toolCalls: state.toolCalls,
      evidence: state.evidence,
      content: state.content,
      headline: state.headline,
      references: state.references,
      attachments: state.attachments,
      qdrantFilter: state.qdrantFilter,
      contextFrame: state.contextFrame ?? null,
      selectedTool: state.selectedTool,
      pendingConfirmation: state.pendingConfirmation ?? null,
      pendingInteraction: state.pendingInteraction ?? null,
      continuationResolution: state.continuationResolution ?? null,
      resolvedContext: state.resolvedContext ?? null,
      semanticResolution: state.semanticResolution ?? null,
      toolArbitration: state.toolArbitration ?? null,
      policyDecisions: state.policyDecisions,
    };
  }

  private async buildGraphInput(
    input: MainAgentRuntimeInvokeInput,
    config: { configurable: { thread_id: string } },
  ): Promise<MainAgentGraphState | Command> {
    const invocationUpdate = buildInvocationUpdate(input);
    if (input.request.resume?.action === 'provide_input') {
      const snapshot = await this.readGraphState(config);
      const values = snapshot?.values as Partial<MainAgentGraphState> | undefined;
      const continuation = resolveProvidedInputContinuation({
        request: input.request,
        runId: input.runId,
        pendingInteraction: values?.pendingInteraction ?? null,
        selectedTool: values?.selectedTool ?? null,
        registry: this.options.registry,
        interactionId: input.request.resume.interactionId,
        answers: input.request.resume.answers,
      });

      if (continuation.decision) {
        return new Command({
          resume: continuation.decision,
          update: {
            ...invocationUpdate,
            continuationResolution: continuation.resolution,
          },
        });
      }
    }

    if (input.request.resume?.action === 'confirm_writeback') {
      const decision = input.request.resume satisfies AgentResumeDecision;
      return new Command({
        resume: decision,
        update: invocationUpdate,
      });
    }

    const snapshot = await this.readGraphState(config);
    const values = snapshot?.values as Partial<MainAgentGraphState> | undefined;
    const pendingInteraction = values?.pendingInteraction ?? null;
    if (pendingInteraction?.status === 'pending') {
      const continuation = resolvePendingContinuation({
        request: input.request,
        runId: input.runId,
        pendingInteraction,
        selectedTool: values?.selectedTool ?? null,
        registry: this.options.registry,
      });

      if (continuation.decision) {
        return new Command({
          resume: continuation.decision,
          update: {
            ...invocationUpdate,
            continuationResolution: continuation.resolution,
          },
        });
      }
    }

    return this.buildInitialState(input);
  }

  private async readGraphState(config: { configurable: { thread_id: string } }) {
    try {
      return await this.graph.getState(config);
    } catch {
      return null;
    }
  }

  private buildInitialState(input: MainAgentRuntimeInvokeInput): MainAgentGraphState {
    return {
      request: input.request,
      runId: input.runId,
      traceId: input.traceId,
      startedAt: input.startedAt,
      eid: input.eid,
      appId: input.appId,
      operatorOpenId: input.operatorOpenId,
      focusedName: input.focusedName,
      contextFrame: input.contextFrame ?? null,
      contextCandidates: input.contextCandidates ?? [],
      resolvedContext: null,
      semanticResolution: null,
      toolArbitration: null,
      pendingConfirmation: null,
      pendingInteraction: null,
      continuationResolution: null,
      resumeDecision: null,
      policyDecisions: [],
      toolCalls: [],
      evidence: [],
      content: '',
      headline: '',
      references: [],
      attachments: [],
      status: 'draft',
      currentStepKey: null,
    };
  }

  private buildGraph() {
    return new StateGraph(MainAgentState)
      .addNode('resolve_intent', async (state) => {
        const intentFrame = await this.options.intentResolver.resolve(state.request, state.contextFrame ?? null);
        return {
          intentFrame,
          policyDecisions: [
            ...(state.policyDecisions ?? []),
            createPolicyDecision({
              policyCode: 'agent_core.business_agnostic',
              action: 'audit',
              reason: 'Main Agent Runtime 只消费通用 IntentFrame/TaskPlan/ToolDefinition，业务映射由外部 pack 注入。',
            }),
          ],
        };
      })
      .addNode('resolve_reference', async (state) => {
        const resolved = await resolveSemanticReference({
          request: state.request,
          intentFrame: state.intentFrame!,
          contextFrame: state.contextFrame ?? null,
          contextCandidates: state.contextCandidates ?? [],
          availableTools: this.options.registry.list(),
          embeddingProvider: this.options.embeddingProvider ?? null,
        });
        return {
          intentFrame: resolved.intentFrame,
          resolvedContext: resolved.resolvedContext,
          semanticResolution: resolved.semanticResolution,
          policyDecisions: [
            ...(state.policyDecisions ?? []),
            createPolicyDecision({
              policyCode: 'agent_core.semantic_reference_resolution',
              action: 'audit',
              reason: resolved.resolvedContext.reason,
            }),
          ],
        };
      })
      .addNode('build_plan', async (state) => {
        const planned = await this.options.planner.plan({
          request: state.request,
          intentFrame: state.intentFrame!,
          availableTools: this.options.registry.list(),
          focusedName: state.focusedName,
          contextFrame: state.contextFrame ?? null,
          resolvedContext: state.resolvedContext ?? null,
          semanticResolution: state.semanticResolution ?? null,
        });
        return {
          taskPlan: planned.taskPlan,
          selectedTool: planned.selectedTool ?? undefined,
          toolArbitration: planned.toolArbitration ?? null,
          policyDecisions: [...(state.policyDecisions ?? []), ...(planned.policyDecisions ?? [])],
          status: planned.selectedTool ? planned.taskPlan.status : 'waiting_input',
          headline: planned.selectedTool ? '已生成通用 TaskPlan' : '需要补充信息',
        };
      })
      .addNode('execute_tool', async (state) => {
        if (!state.selectedTool) {
          return {
            status: 'waiting_input' as AgentExecutionStatus,
            content: '我还需要你补充目标对象或希望完成的动作。',
            headline: '需要补充信息',
            references: ['meta.clarify_card'],
            currentStepKey: 'clarify',
            pendingInteraction: buildPendingInteraction({
              state,
              status: 'waiting_input',
              content: '我还需要你补充目标对象或希望完成的动作。',
              headline: '需要补充信息',
              references: ['meta.clarify_card'],
            }),
          };
        }

        const tool = this.options.registry.assert(state.selectedTool.toolCode);
        let result: AgentToolExecutionResult;
        try {
          result = await tool.execute(
            {
              request: state.request,
              intentFrame: state.intentFrame!,
              taskPlan: state.taskPlan!,
              selectedTool: state.selectedTool,
              contextFrame: state.contextFrame ?? null,
              resolvedContext: state.resolvedContext ?? null,
              resumeDecision: state.resumeDecision ?? null,
            },
            {
              runId: state.runId,
              traceId: state.traceId,
              eid: state.eid,
              appId: state.appId,
              operatorOpenId: state.operatorOpenId,
              config: this.options.config,
              contextFrame: state.contextFrame ?? null,
              resolvedContext: state.resolvedContext ?? null,
            },
          );
        } catch (error) {
          return buildToolUnavailableState({
            state,
            selectedTool: state.selectedTool,
            currentStepKey: 'execute-tool',
            error,
          });
        }

        return {
          status: result.status,
          currentStepKey: result.currentStepKey ?? null,
          content: result.content,
          headline: result.headline,
          references: result.references,
          evidence: result.evidence ?? [],
          attachments: result.attachments ?? [],
          qdrantFilter: result.qdrantFilter,
          contextFrame: result.contextFrame ?? state.contextFrame ?? null,
          toolArbitration: result.toolArbitration ?? state.toolArbitration ?? null,
          toolCalls: result.toolCalls,
          pendingConfirmation: result.pendingConfirmation ?? state.pendingConfirmation ?? null,
          pendingInteraction: result.pendingInteraction ?? buildPendingInteraction({
            state,
            status: result.status,
            content: result.content,
            headline: result.headline,
            references: result.references,
            pendingConfirmation: result.pendingConfirmation ?? state.pendingConfirmation ?? null,
          }),
          policyDecisions: [...(state.policyDecisions ?? []), ...(result.policyDecisions ?? [])],
          taskPlan: result.taskPlan ?? state.taskPlan,
        };
      })
      .addNode('wait_for_interaction', async (state) => {
        const decision = interrupt<PendingInteraction | null | undefined, AgentResumeDecision>(
          state.pendingInteraction,
        );
        if (decision.action === 'confirm_writeback') {
          return {
            resumeDecision: decision,
            pendingInteraction: state.pendingInteraction
              ? { ...state.pendingInteraction, status: 'resolved' as const }
              : null,
            continuationResolution: {
              usedContinuation: true,
              action: decision.decision === 'approve' ? 'confirm_writeback' as const : 'reject_writeback' as const,
              reason: decision.decision === 'approve' ? '用户确认写回。' : '用户拒绝写回。',
              sourceInteractionId: state.pendingInteraction?.interactionId,
              toolCode: state.pendingConfirmation?.toolCode,
            },
            policyDecisions: [
              ...(state.policyDecisions ?? []),
              createPolicyDecision({
                policyCode: 'meta.confirm_writeback.resume',
                action: decision.decision === 'approve' ? 'allow' : 'block',
                toolCode: state.pendingConfirmation?.toolCode,
                reason: decision.decision === 'approve' ? '用户确认写回。' : '用户拒绝写回。',
              }),
            ],
          };
        }

        if (decision.action === 'provide_input') {
          const selectedTool = state.selectedTool
            ? { ...state.selectedTool, input: decision.mergedInput }
            : undefined;
          return {
            selectedTool,
            pendingInteraction: null,
            continuationResolution: {
              usedContinuation: true,
              action: 'resume_pending_interaction' as const,
              reason: decision.reason,
              sourceInteractionId: decision.interactionId,
              toolCode: selectedTool?.toolCode,
              mergedInput: decision.mergedInput,
            },
            status: 'running' as AgentExecutionStatus,
            currentStepKey: 'execute-tool',
          };
        }

        if (decision.action === 'select_candidate') {
          const selectedTool: AgentToolSelection = {
            toolCode: decision.toolCode,
            reason: decision.reason,
            input: decision.mergedInput,
            confidence: 0.9,
          };
          return {
            selectedTool,
            pendingInteraction: null,
            continuationResolution: {
              usedContinuation: true,
              action: 'select_candidate' as const,
              reason: decision.reason,
              sourceInteractionId: decision.interactionId,
              toolCode: decision.toolCode,
              mergedInput: decision.mergedInput,
            },
            status: 'running' as AgentExecutionStatus,
            currentStepKey: 'execute-tool',
          };
        }

        if (decision.action === 'route_tool') {
          const selectedTool: AgentToolSelection = {
            toolCode: decision.toolCode,
            reason: decision.reason,
            input: decision.mergedInput,
            confidence: 0.9,
          };
          return {
            selectedTool,
            pendingInteraction: null,
            continuationResolution: {
              usedContinuation: true,
              action: 'route_tool' as const,
              reason: decision.reason,
              sourceInteractionId: decision.interactionId,
              toolCode: decision.toolCode,
              mergedInput: decision.mergedInput,
            },
            status: 'running' as AgentExecutionStatus,
            currentStepKey: 'execute-tool',
          };
        }

        return {
          intentFrame: undefined,
          taskPlan: undefined,
          selectedTool: undefined,
          pendingConfirmation: null,
          pendingInteraction: state.pendingInteraction
            ? { ...state.pendingInteraction, status: 'cancelled' as const }
            : null,
          resumeDecision: decision,
          resolvedContext: null,
          semanticResolution: null,
          content: '',
          headline: '',
          references: [],
          attachments: [],
          qdrantFilter: undefined,
          status: 'draft' as AgentExecutionStatus,
          currentStepKey: null,
          continuationResolution: {
            usedContinuation: false,
            action: 'start_new_task' as const,
            reason: decision.reason,
            sourceInteractionId: decision.interactionId,
            toolCode: state.pendingInteraction?.toolCode,
          },
          policyDecisions: [
            ...(state.policyDecisions ?? []),
            createPolicyDecision({
              policyCode: 'agent_core.continuation_abandoned',
              action: 'audit',
              toolCode: state.pendingInteraction?.toolCode,
              reason: decision.reason,
            }),
          ],
        };
      })
      .addNode('commit_after_confirmation', async (state) => {
        const pending = state.pendingConfirmation;
        const decision = state.resumeDecision;
        if (!pending || !decision || decision.action !== 'confirm_writeback') {
          return {
            status: 'failed' as AgentExecutionStatus,
            content: '缺少待确认写回上下文，无法恢复执行。',
            headline: '确认恢复失败',
            references: ['meta.confirm_writeback'],
          };
        }
        if (decision.runId !== state.runId || (decision.confirmationId && decision.confirmationId !== pending.confirmationId)) {
          return {
            status: 'failed' as AgentExecutionStatus,
            content: '确认请求与当前待确认写回不匹配，已阻止真实写回。',
            headline: '确认上下文不匹配',
            references: ['meta.confirm_writeback'],
            policyDecisions: [
              ...(state.policyDecisions ?? []),
              createPolicyDecision({
                policyCode: 'meta.confirm_writeback.context_match',
                action: 'block',
                toolCode: pending.toolCode,
                reason: 'resume.runId 或 confirmationId 与挂起确认不一致。',
              }),
            ],
          };
        }

        const commitToolCode = pending.toolCode.replace('.preview_', '.commit_');
        const tool = this.options.registry.assert(commitToolCode);
        const selectedTool: AgentToolSelection = {
          toolCode: commitToolCode,
          reason: '用户已对预览做出确认决策，恢复执行确认写回工具。',
          input: {
            confirmationId: pending.confirmationId,
          },
          confidence: 1,
        };
        let result: AgentToolExecutionResult;
        try {
          result = await tool.execute(
            {
              request: state.request,
              intentFrame: state.intentFrame!,
              taskPlan: state.taskPlan!,
              selectedTool,
              contextFrame: state.contextFrame ?? null,
              resolvedContext: state.resolvedContext ?? null,
              resumeDecision: decision,
            },
            {
              runId: state.runId,
              traceId: state.traceId,
              eid: state.eid,
              appId: state.appId,
              operatorOpenId: state.operatorOpenId,
              config: this.options.config,
              contextFrame: state.contextFrame ?? null,
              resolvedContext: state.resolvedContext ?? null,
            },
          );
        } catch (error) {
          return buildToolUnavailableState({
            state,
            selectedTool,
            currentStepKey: 'confirm-writeback',
            error,
          });
        }

        return {
          selectedTool,
          status: result.status,
          currentStepKey: result.currentStepKey ?? null,
          content: result.content,
          headline: result.headline,
          references: result.references,
          evidence: result.evidence ?? [],
          attachments: result.attachments ?? [],
          qdrantFilter: result.qdrantFilter,
          contextFrame: result.contextFrame ?? state.contextFrame ?? null,
          toolArbitration: result.toolArbitration ?? state.toolArbitration ?? null,
          toolCalls: result.toolCalls,
          pendingConfirmation: result.pendingConfirmation ?? pending,
          pendingInteraction: null,
          policyDecisions: [...(state.policyDecisions ?? []), ...(result.policyDecisions ?? [])],
          taskPlan: markConfirmationPlan(state.taskPlan!, result.status),
        };
      })
      .addEdge(START, 'resolve_intent')
      .addEdge('resolve_intent', 'resolve_reference')
      .addEdge('resolve_reference', 'build_plan')
      .addEdge('build_plan', 'execute_tool')
      .addConditionalEdges('execute_tool', (state) => (
        isWaitingStatus(state.status) ? 'wait_for_interaction' : END
      ))
      .addConditionalEdges('wait_for_interaction', (state) => {
        if (state.resumeDecision?.action === 'confirm_writeback') {
          return 'commit_after_confirmation';
        }
        if (state.continuationResolution?.action === 'resume_pending_interaction'
          || state.continuationResolution?.action === 'select_candidate'
          || state.continuationResolution?.action === 'route_tool') {
          return 'execute_tool';
        }
        if (state.continuationResolution?.action === 'start_new_task') {
          return 'resolve_intent';
        }
        return END;
      })
      .addEdge('commit_after_confirmation', END)
      .compile({
        checkpointer: new MemorySaver(),
      });
  }
}

function normalizeGraphOutput(
  output: InterruptedGraphOutput,
  fallback: MainAgentRuntimeInvokeInput,
): MainAgentGraphState {
  return {
    ...fallback,
    request: output.request ?? fallback.request,
    policyDecisions: output.policyDecisions ?? [],
    toolCalls: output.toolCalls ?? [],
    evidence: output.evidence ?? [],
    content: output.content ?? '',
    headline: output.headline ?? '',
    references: output.references ?? [],
    attachments: output.attachments ?? [],
    status: output.status ?? 'failed',
    currentStepKey: output.currentStepKey ?? null,
    focusedName: output.focusedName ?? fallback.focusedName,
    contextFrame: output.contextFrame ?? fallback.contextFrame ?? null,
    contextCandidates: output.contextCandidates ?? fallback.contextCandidates ?? [],
    resolvedContext: output.resolvedContext ?? null,
    semanticResolution: output.semanticResolution ?? null,
    toolArbitration: output.toolArbitration ?? null,
    intentFrame: output.intentFrame,
    taskPlan: output.taskPlan,
    selectedTool: output.selectedTool,
    pendingConfirmation: output.pendingConfirmation ?? null,
    pendingInteraction: output.pendingInteraction ?? null,
    continuationResolution: output.continuationResolution ?? null,
    resumeDecision: output.resumeDecision ?? null,
    qdrantFilter: output.qdrantFilter,
  };
}

function buildToolUnavailableState(input: {
  state: MainAgentGraphState;
  selectedTool: AgentToolSelection;
  currentStepKey: string;
  error: unknown;
}): Partial<MainAgentGraphState> {
  const message = getErrorMessage(input.error);
  const debugInfo = buildErrorDebugInfo(input.error);
  const debugSummary = formatErrorDebugSummary(debugInfo);
  const toolCall = createToolCall(
    input.state.runId,
    input.selectedTool.toolCode,
    JSON.stringify(input.selectedTool.input ?? {}),
  );
  finishToolCall(
    toolCall,
    'failed',
    debugSummary
      ? `工具执行异常，未生成本地替代结果；${debugSummary}`
      : '工具执行异常，未生成本地替代结果',
    input.error,
  );

  return {
    selectedTool: input.selectedTool,
    toolArbitration: input.state.toolArbitration ?? null,
    status: 'tool_unavailable',
    currentStepKey: input.currentStepKey,
    content: [
      '## 工具执行失败',
      `- 工具：\`${input.selectedTool.toolCode}\``,
      `- 失败原因：${message}`,
      '',
      '## 当前处理',
      '- 未生成本地替代结果。',
      '- 未伪造写入完成状态。',
      '- 请检查对应工具服务、外部接口或运行时日志后重试。',
      ...(debugSummary || debugInfo.details
        ? [
            '',
            '## 调试信息',
            `- 错误类型：${debugInfo.name ?? 'UnknownError'}`,
            ...(debugInfo.code ? [`- 错误编码：${debugInfo.code}`] : []),
            ...(typeof debugInfo.statusCode === 'number' ? [`- 状态码：${debugInfo.statusCode}`] : []),
            ...(debugInfo.detailsSummary.length
              ? debugInfo.detailsSummary.map((item) => `- ${item}`)
              : []),
            ...(debugInfo.details
              ? [
                  '',
                  '```json',
                  JSON.stringify(debugInfo.details, null, 2).slice(0, 4000),
                  '```',
                ]
              : []),
          ]
        : []),
    ].join('\n'),
    headline: '工具执行失败，未生成本地替代结果',
    references: [input.selectedTool.toolCode],
    toolCalls: [toolCall],
    pendingConfirmation: input.state.pendingConfirmation ?? null,
    pendingInteraction: null,
    policyDecisions: [
      ...(input.state.policyDecisions ?? []),
      createPolicyDecision({
        policyCode: 'runtime.tool_execution_error',
        action: 'block',
        toolCode: input.selectedTool.toolCode,
        reason: `工具执行异常，已阻止降级替代：${debugSummary ? `${message}；${debugSummary}` : message}`,
      }),
    ],
  };
}

function buildInvocationUpdate(input: MainAgentRuntimeInvokeInput): Partial<MainAgentGraphState> {
  return {
    request: input.request,
    runId: input.runId,
    traceId: input.traceId,
    startedAt: input.startedAt,
    eid: input.eid,
    appId: input.appId,
    operatorOpenId: input.operatorOpenId,
    focusedName: input.focusedName,
    contextFrame: input.contextFrame ?? null,
    contextCandidates: input.contextCandidates ?? [],
    resolvedContext: null,
    semanticResolution: null,
    policyDecisions: [],
    toolCalls: [],
    evidence: [],
    content: '',
    headline: '',
    references: [],
    attachments: [],
    qdrantFilter: undefined,
  };
}

function buildPendingInteraction(input: {
  state: MainAgentGraphState;
  status: AgentExecutionStatus;
  content: string;
  headline: string;
  references: string[];
  pendingConfirmation?: ConfirmationRequest | null;
}): PendingInteraction | null {
  if (!isWaitingStatus(input.status)) {
    return null;
  }

  const kind = input.status === 'waiting_confirmation'
    ? 'confirmation'
    : input.status === 'waiting_selection'
      ? 'candidate_selection'
      : 'input_required';
  const pendingConfirmation = input.pendingConfirmation ?? null;
  const userPreview = pendingConfirmation?.userPreview;
  return {
    interactionId: randomUUID(),
    kind,
    runId: input.state.runId,
    toolCode: input.state.selectedTool?.toolCode ?? pendingConfirmation?.toolCode,
    status: 'pending',
    title: pendingConfirmation?.title ?? input.headline,
    summary: pendingConfirmation?.summary ?? input.content.slice(0, 500),
    partialInput: input.state.selectedTool?.input,
    missingRows: userPreview?.missingRequiredRows,
    blockedRows: userPreview?.blockedRows,
    recommendedRows: userPreview?.recommendedRows,
    contextSubject: input.state.resolvedContext?.subject ?? input.state.contextFrame?.subject,
    createdAt: new Date().toISOString(),
  };
}

function isWaitingStatus(status?: AgentExecutionStatus): boolean {
  return status === 'waiting_input'
    || status === 'waiting_selection'
    || status === 'waiting_confirmation';
}

function finishRuntimePlan(plan: TaskPlan, status: AgentExecutionStatus): TaskPlan {
  return {
    ...plan,
    status,
    steps: plan.steps.map((item) => {
      if (status === 'waiting_confirmation') {
        if (item.key === 'execute-tool') {
          return { ...item, status: 'succeeded' };
        }
        if (item.key === 'confirm-writeback') {
          return { ...item, status: 'skipped' };
        }
      }
      if (status === 'completed') {
        return { ...item, status: item.status === 'pending' ? 'succeeded' : item.status };
      }
      if (status === 'cancelled') {
        return { ...item, status: item.key === 'confirm-writeback' ? 'skipped' : item.status };
      }
      if (status === 'waiting_selection') {
        if (item.key === 'execute-tool') {
          return { ...item, status: 'succeeded' };
        }
        if (item.key === 'confirm-writeback') {
          return { ...item, status: 'pending' };
        }
      }
      if (status === 'failed' || status === 'tool_unavailable') {
        return { ...item, status: item.status === 'pending' ? 'failed' : item.status };
      }
      return item;
    }),
  };
}

function markConfirmationPlan(plan: TaskPlan, status: AgentExecutionStatus): TaskPlan {
  return {
    ...plan,
    status,
    steps: plan.steps.map((item) => {
      if (item.key === 'confirm-writeback') {
        return { ...item, status: status === 'completed' ? 'succeeded' : status === 'cancelled' ? 'skipped' : item.status };
      }
      return item.status === 'pending' && status === 'completed' ? { ...item, status: 'succeeded' } : item;
    }),
  };
}
