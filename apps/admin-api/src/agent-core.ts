import { randomUUID } from 'node:crypto';
import type {
  AgentAttachment,
  AgentChatRequest,
  AgentEvidenceCard,
  AgentExecutionStatus,
  AgentToolCall,
  AgentToolCallStatus,
  AppConfig,
  ExecutionState,
  IntentFrame,
  TaskPlan,
} from './contracts.js';

export type AgentToolType = 'record' | 'external' | 'meta' | 'artifact';
export type AgentRiskLevel = 'low' | 'medium' | 'high';
export type EvidenceRef = AgentEvidenceCard;
export type AgentConfirmationPolicy =
  | 'read_only'
  | 'asset_only'
  | 'user_input_required'
  | 'editable_by_user'
  | 'required_before_write'
  | 'disabled';
export type PolicyAction =
  | 'allow'
  | 'block'
  | 'require_confirmation'
  | 'clarify'
  | 'downgrade_to_draft'
  | 'audit';

export interface GenericTargetRef {
  kind: 'record' | 'external_subject' | 'artifact' | 'unknown';
  objectType?: string;
  id?: string;
  name?: string;
}

export interface GenericIntentFrame {
  actionType: IntentFrame['actionType'];
  goal: string;
  target: GenericTargetRef;
  inputMaterials: string[];
  constraints: string[];
  missingSlots: string[];
  confidence: number;
  source: IntentFrame['source'];
  fallbackReason?: string;
  legacyIntentFrame: IntentFrame;
}

export interface ContextFrameSubject {
  kind: GenericTargetRef['kind'];
  type?: string;
  id?: string;
  name?: string;
}

export interface ContextFrame {
  subject?: ContextFrameSubject;
  sourceRunId?: string;
  evidenceRefs: EvidenceRef[];
  confidence: number;
  resolvedBy: string;
}

export interface ReferenceResolution {
  usedContext: boolean;
  reason: string;
  subject?: ContextFrameSubject;
  sourceRunId?: string;
  evidenceRefs: EvidenceRef[];
}

export interface RecordToolCapability {
  subjectBinding?: {
    acceptedSubjectTypes?: string[];
    required?: boolean;
  };
  identityFields?: string[];
  duplicateCheckPolicy?: {
    enabled: boolean;
    searchToolCode?: string;
    maxCandidates?: number;
  };
  previewInputPolicy?: {
    subjectNameParam?: string;
    writableParams?: string[];
  };
}

export interface AgentToolDefinition {
  code: string;
  type: AgentToolType;
  provider: string;
  description: string;
  whenToUse: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: AgentRiskLevel;
  confirmationPolicy: AgentConfirmationPolicy;
  displayCardType: string;
  owner: string;
  enabled: boolean;
  recordCapability?: RecordToolCapability;
  execute(input: AgentToolExecuteInput, context: AgentToolExecuteContext): Promise<AgentToolExecutionResult>;
}

export interface AgentToolExecuteInput {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  taskPlan: TaskPlan;
  selectedTool: AgentToolSelection;
  contextFrame?: ContextFrame | null;
  resolvedContext?: ReferenceResolution | null;
  resumeDecision?: AgentResumeDecision | null;
}

export interface AgentToolExecuteContext {
  runId: string;
  traceId: string;
  eid: string;
  appId: string;
  operatorOpenId: string | null;
  config: AppConfig;
  contextFrame?: ContextFrame | null;
  resolvedContext?: ReferenceResolution | null;
}

export interface AgentToolSelection {
  toolCode: string;
  reason: string;
  input: Record<string, unknown>;
  confidence: number;
}

export interface PolicyDecision {
  policyCode: string;
  action: PolicyAction;
  toolCode?: string;
  reason: string;
  createdAt: string;
}

export interface ConfirmationRequest {
  confirmationId: string;
  runId: string;
  toolCode: string;
  title: string;
  summary: string;
  preview: unknown;
  requestInput: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  decidedAt: string | null;
}

export interface AgentResumeDecision {
  runId: string;
  action: 'confirm_writeback';
  decision: 'approve' | 'reject';
  confirmationId?: string;
}

export interface AgentToolExecutionResult {
  status: AgentExecutionStatus;
  currentStepKey?: string | null;
  content: string;
  headline: string;
  references: string[];
  evidence?: AgentEvidenceCard[];
  attachments?: AgentAttachment[];
  toolCalls: AgentToolCall[];
  qdrantFilter?: unknown;
  pendingConfirmation?: ConfirmationRequest | null;
  policyDecisions?: PolicyDecision[];
  taskPlan?: TaskPlan;
}

export interface AgentRuntimeOutput {
  intentFrame: GenericIntentFrame;
  legacyIntentFrame: IntentFrame;
  taskPlan: TaskPlan;
  executionState: ExecutionState;
  toolCalls: AgentToolCall[];
  evidence: AgentEvidenceCard[];
  content: string;
  headline: string;
  references: string[];
  attachments: AgentAttachment[];
  qdrantFilter?: unknown;
  selectedTool?: AgentToolSelection;
  pendingConfirmation?: ConfirmationRequest | null;
  resolvedContext?: ReferenceResolution | null;
  policyDecisions: PolicyDecision[];
}

export interface AgentPlannerInput {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  availableTools: AgentToolDefinition[];
  focusedName?: string | null;
  contextFrame?: ContextFrame | null;
  resolvedContext?: ReferenceResolution | null;
}

export interface AgentPlannerResult {
  taskPlan: TaskPlan;
  selectedTool: AgentToolSelection | null;
  policyDecisions?: PolicyDecision[];
}

export interface AgentPlanner {
  plan(input: AgentPlannerInput): Promise<AgentPlannerResult>;
}

export interface AgentIntentResolver {
  resolve(input: AgentChatRequest, contextFrame?: ContextFrame | null): Promise<GenericIntentFrame>;
}

export function createPolicyDecision(input: Omit<PolicyDecision, 'createdAt'>): PolicyDecision {
  return {
    ...input,
    createdAt: new Date().toISOString(),
  };
}

export function createToolCall(runId: string, toolCode: string, inputSummary: string): AgentToolCall {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    runId,
    toolCode,
    status: 'running',
    inputSummary,
    outputSummary: '',
    startedAt: now,
    finishedAt: null,
    errorMessage: null,
  };
}

export function finishToolCall(
  toolCall: AgentToolCall,
  status: AgentToolCallStatus,
  outputSummary: string,
  error?: unknown,
): AgentToolCall {
  toolCall.status = status;
  toolCall.outputSummary = outputSummary;
  toolCall.finishedAt = status === 'running' ? null : new Date().toISOString();
  toolCall.errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
  return toolCall;
}

export function buildExecutionState(input: {
  runId: string;
  traceId: string;
  status: AgentExecutionStatus;
  currentStepKey?: string | null;
  message: string;
  startedAt: string;
}): ExecutionState {
  return {
    runId: input.runId,
    traceId: input.traceId,
    status: input.status,
    currentStepKey: input.currentStepKey ?? null,
    message: input.message,
    startedAt: input.startedAt,
    finishedAt: input.status === 'running' || input.status.startsWith('waiting_') || input.status === 'paused'
      ? null
      : new Date().toISOString(),
  };
}
