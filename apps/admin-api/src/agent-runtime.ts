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
  type AgentIntentResolver,
  type AgentPlanner,
  type AgentResumeDecision,
  type AgentRuntimeOutput,
  type AgentToolSelection,
  type ConfirmationRequest,
  type GenericIntentFrame,
  type PolicyDecision,
  type ReferenceResolution,
  buildExecutionState,
  createPolicyDecision,
} from './agent-core.js';
import { resolveContextReference } from './agent-reference-resolver.js';
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
  resolvedContext?: ReferenceResolution | null;
  intentFrame?: GenericIntentFrame;
  taskPlan?: TaskPlan;
  selectedTool?: AgentToolSelection;
  pendingConfirmation?: ConfirmationRequest | null;
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
  resolvedContext: Annotation<ReferenceResolution | null | undefined>(),
  intentFrame: Annotation<GenericIntentFrame | undefined>(),
  taskPlan: Annotation<TaskPlan | undefined>(),
  selectedTool: Annotation<AgentToolSelection | undefined>(),
  pendingConfirmation: Annotation<ConfirmationRequest | null | undefined>(),
  resumeDecision: Annotation<AgentResumeDecision | null | undefined>(),
  policyDecisions: Annotation<PolicyDecision[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  toolCalls: Annotation<AgentToolCall[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  evidence: Annotation<AgentEvidenceCard[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
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
        thread_id: input.runId,
      },
    };
    const graphInput = input.request.resume
      ? new Command({ resume: input.request.resume satisfies AgentResumeDecision })
      : this.buildInitialState(input);
    const graphOutput = await this.graph.invoke(graphInput as never, config) as InterruptedGraphOutput;
    const state = normalizeGraphOutput(graphOutput, input);
    const status: AgentExecutionStatus = graphOutput.__interrupt__ ? 'waiting_confirmation' : state.status;
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
      selectedTool: state.selectedTool,
      pendingConfirmation: state.pendingConfirmation ?? null,
      resolvedContext: state.resolvedContext ?? null,
      policyDecisions: state.policyDecisions,
    };
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
      resolvedContext: null,
      pendingConfirmation: null,
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
            createPolicyDecision({
              policyCode: 'agent_core.business_agnostic',
              action: 'audit',
              reason: 'Main Agent Runtime 只消费通用 IntentFrame/TaskPlan/ToolDefinition，业务映射由外部 pack 注入。',
            }),
          ],
        };
      })
      .addNode('resolve_reference', async (state) => {
        const resolved = resolveContextReference({
          request: state.request,
          intentFrame: state.intentFrame!,
          contextFrame: state.contextFrame ?? null,
        });
        return {
          intentFrame: resolved.intentFrame,
          resolvedContext: resolved.resolvedContext,
          policyDecisions: [
            createPolicyDecision({
              policyCode: 'agent_core.reference_resolution',
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
        });
        return {
          taskPlan: planned.taskPlan,
          selectedTool: planned.selectedTool ?? undefined,
          policyDecisions: planned.policyDecisions ?? [],
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
          };
        }

        const tool = this.options.registry.assert(state.selectedTool.toolCode);
        const result = await tool.execute(
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

        return {
          status: result.status,
          currentStepKey: result.currentStepKey ?? null,
          content: result.content,
          headline: result.headline,
          references: result.references,
          evidence: result.evidence ?? [],
          attachments: result.attachments ?? [],
          qdrantFilter: result.qdrantFilter,
          toolCalls: result.toolCalls,
          pendingConfirmation: result.pendingConfirmation ?? state.pendingConfirmation ?? null,
          policyDecisions: result.policyDecisions ?? [],
          taskPlan: result.taskPlan ?? state.taskPlan,
        };
      })
      .addNode('wait_for_confirmation', async (state) => {
        const decision = interrupt<ConfirmationRequest | null | undefined, AgentResumeDecision>(
          state.pendingConfirmation,
        );
        return {
          resumeDecision: decision,
          policyDecisions: [
            createPolicyDecision({
              policyCode: 'meta.confirm_writeback.resume',
              action: decision.decision === 'approve' ? 'allow' : 'block',
              toolCode: state.pendingConfirmation?.toolCode,
              reason: decision.decision === 'approve' ? '用户确认写回。' : '用户拒绝写回。',
            }),
          ],
        };
      })
      .addNode('commit_after_confirmation', async (state) => {
        const pending = state.pendingConfirmation;
        const decision = state.resumeDecision;
        if (!pending || !decision) {
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
        const result = await tool.execute(
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
          toolCalls: result.toolCalls,
          pendingConfirmation: result.pendingConfirmation ?? pending,
          policyDecisions: result.policyDecisions ?? [],
          taskPlan: markConfirmationPlan(state.taskPlan!, result.status),
        };
      })
      .addEdge(START, 'resolve_intent')
      .addEdge('resolve_intent', 'resolve_reference')
      .addEdge('resolve_reference', 'build_plan')
      .addEdge('build_plan', 'execute_tool')
      .addConditionalEdges('execute_tool', (state) => (
        state.status === 'waiting_confirmation' ? 'wait_for_confirmation' : END
      ))
      .addEdge('wait_for_confirmation', 'commit_after_confirmation')
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
    resolvedContext: output.resolvedContext ?? null,
    intentFrame: output.intentFrame,
    taskPlan: output.taskPlan,
    selectedTool: output.selectedTool,
    pendingConfirmation: output.pendingConfirmation ?? null,
    resumeDecision: output.resumeDecision ?? null,
    qdrantFilter: output.qdrantFilter,
  };
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
