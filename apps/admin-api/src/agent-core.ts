import { randomUUID } from 'node:crypto';
import type {
  AgentAttachment,
  AgentChatRequest,
  AgentEvidenceCard,
  AgentExecutionStatus,
  AgentToolCall,
  AgentToolCallStatus,
  AgentUiSurface,
  AppConfig,
  ExecutionState,
  IntentFrame,
  ShadowObjectKey,
  TaskPlan,
} from './contracts.js';
import { buildErrorDebugInfo } from './errors.js';

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

export interface TargetSanitizationTrace {
  reasonCode: 'ignored_ungrounded_target';
  reason: string;
  source: 'intent_target';
  ignoredTargetName?: string;
  ignoredTargetId?: string;
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
  targetSanitization?: TargetSanitizationTrace;
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

export interface ContextReferenceCandidate {
  candidateId: string;
  subject: ContextFrameSubject;
  sourceRunId?: string;
  evidenceRefs: EvidenceRef[];
  text: string;
  recencyRank: number;
  confidence: number;
  source: 'context_subject' | 'intent_frame' | 'evidence' | 'artifact_anchor' | 'pending_interaction';
}

export interface ReferenceResolution {
  usedContext: boolean;
  reason: string;
  subject?: ContextFrameSubject;
  sourceRunId?: string;
  evidenceRefs: EvidenceRef[];
  usageMode?: 'used' | 'candidate_only' | 'skipped_collection_query' | 'none';
  skipReasonCode?: string;
}

export interface SemanticResolutionCandidate extends ContextReferenceCandidate {
  score: number;
  scoreLabel: 'embedding' | 'recency' | 'direct_match' | 'compatibility';
  reasons: string[];
}

export interface SemanticReferenceResolution {
  usedSemantic: boolean;
  shouldClarify: boolean;
  reason: string;
  selectedCandidate?: SemanticResolutionCandidate;
  candidates: SemanticResolutionCandidate[];
  threshold: number;
  margin: number;
  embeddingProvider: string;
  targetWasOverridden: boolean;
  usageMode?: ReferenceResolution['usageMode'];
  skipReasonCode?: string;
}

export interface RecordToolCapability {
  objectLabels?: string[];
  subjectBinding?: {
    acceptedSubjectTypes?: string[];
    required?: boolean;
    searchFilterField?: string;
    searchValueSource?: 'subject_id' | 'subject_name';
    identityFromSubject?: boolean;
  };
  identityFields?: string[];
  fieldLabels?: Record<string, string>;
  fieldDisplayOrder?: string[];
  requiredFieldRefs?: string[];
  derivedFieldRefs?: string[];
  recommendedFieldRefs?: string[];
  debugVisibility?: 'hidden' | 'trace' | 'content';
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

export type ToolSemanticRisk = 'low_cost' | 'medium_cost' | 'high_cost' | 'write';

export interface ToolSemanticProfile {
  subjectTypes?: string[];
  intentCodes?: string[];
  conflictGroups?: string[];
  priority?: number;
  risk?: ToolSemanticRisk;
  clarifyLabel?: string;
  aliases?: string[];
  readOnlyProbe?: boolean;
}

export interface ToolArbitrationCandidateTrace {
  toolCode: string;
  type: AgentToolType;
  provider: string;
  priority: number;
  risk?: ToolSemanticRisk;
  clarifyLabel?: string;
  readOnlyProbe: boolean;
}

export interface ToolArbitrationTrace {
  usedArbitration: boolean;
  ruleCode: string;
  conflictGroup: string;
  intentCode: string;
  subjectType?: string;
  subjectName?: string;
  action: 'direct_tool' | 'read_only_probe' | 'clarify';
  selectedToolCode?: string;
  probeToolCode?: string;
  candidateTools: ToolArbitrationCandidateTrace[];
  reason: string;
  probeResult?: {
    status: 'not_run' | 'matched' | 'not_matched' | 'failed';
    count?: number;
    summary?: string;
  };
}

export interface ToolArbitrationProbeControl {
  enabled?: boolean;
  ruleCode: string;
  conflictGroup: string;
  subjectType?: string;
  subjectName?: string;
  intentCode?: string;
  query?: string;
  probeToolCode?: string;
  candidateToolCodes?: string[];
}

export type RecordWritePreviewRowSource = 'input' | 'evidence' | 'derived' | 'tool' | 'system';
export type MetaQuestionType = 'text' | 'phone' | 'single_select' | 'multi_select' | 'date' | 'reference';

export interface FieldOptionHint {
  label: string;
  value: string | number | boolean;
  key?: string;
  description?: string;
  source?: 'field_option' | 'dictionary' | 'widget' | 'employee' | 'record';
}

export interface MetaQuestionLookup {
  kind: 'remote_select';
  endpoint: '/api/agent/meta-question-options';
  source: 'employee' | 'record';
  targetObjectKey?: ShadowObjectKey;
  minKeywordLength: 1;
  pageSize: number;
  allowFreeText: false;
}

export interface RecordWritePreviewRow {
  label: string;
  value?: string;
  paramKey?: string;
  reason?: string;
  source?: RecordWritePreviewRowSource;
  options?: FieldOptionHint[];
  lookup?: MetaQuestionLookup;
}

export interface RecordWritePreviewView {
  title: string;
  summaryRows: RecordWritePreviewRow[];
  missingRequiredRows?: RecordWritePreviewRow[];
  blockedRows?: RecordWritePreviewRow[];
  recommendedRows?: RecordWritePreviewRow[];
}

export interface MetaQuestion {
  questionId: string;
  paramKey: string;
  label: string;
  type: MetaQuestionType;
  required: boolean;
  placeholder?: string;
  currentValue?: string | number | boolean | string[];
  options?: FieldOptionHint[];
  lookup?: MetaQuestionLookup;
  reason?: string;
}

export interface MetaQuestionCard {
  title: string;
  description?: string;
  toolCode: string;
  submitLabel: string;
  currentValues: Record<string, {
    label: string;
    value?: string;
  }>;
  questions: MetaQuestion[];
}

export type PendingInteractionKind = 'input_required' | 'candidate_selection' | 'confirmation';

export interface PendingInteraction {
  interactionId: string;
  kind: PendingInteractionKind;
  runId: string;
  toolCode?: string;
  status: 'pending' | 'resolved' | 'cancelled';
  title: string;
  summary: string;
  partialInput?: Record<string, unknown>;
  missingRows?: RecordWritePreviewRow[];
  blockedRows?: RecordWritePreviewRow[];
  recommendedRows?: RecordWritePreviewRow[];
  questionCard?: MetaQuestionCard;
  contextSubject?: ContextFrameSubject;
  createdAt: string;
}

export interface ContinuationResolution {
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
  semanticProfile?: ToolSemanticProfile;
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
  userPreview?: RecordWritePreviewView;
  debugPayload?: unknown;
  requestInput: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  decidedAt: string | null;
}

export interface AgentConfirmWritebackResumeDecision {
  runId: string;
  action: 'confirm_writeback';
  decision: 'approve' | 'reject';
  confirmationId?: string;
}

export interface AgentProvideInputResumeDecision {
  runId: string;
  action: 'provide_input';
  interactionId: string;
  query: string;
  answers?: Record<string, unknown>;
  mergedInput: Record<string, unknown>;
  reason: string;
}

export interface AgentStartNewTaskResumeDecision {
  runId: string;
  action: 'start_new_task';
  interactionId?: string;
  query: string;
  reason: string;
}

export interface AgentCandidateSelectionResumeDecision {
  runId: string;
  action: 'select_candidate';
  interactionId: string;
  query: string;
  decision: 'update_existing' | 'create_new';
  toolCode: string;
  mergedInput: Record<string, unknown>;
  reason: string;
}

export interface AgentRouteToolResumeDecision {
  runId: string;
  action: 'route_tool';
  interactionId: string;
  query: string;
  toolCode: string;
  mergedInput: Record<string, unknown>;
  reason: string;
}

export interface AgentWaitInputResumeDecision {
  runId: string;
  action: 'wait_for_input';
  interactionId: string;
  query: string;
  reason: string;
}

export type AgentResumeDecision =
  | AgentConfirmWritebackResumeDecision
  | AgentProvideInputResumeDecision
  | AgentStartNewTaskResumeDecision
  | AgentCandidateSelectionResumeDecision
  | AgentRouteToolResumeDecision
  | AgentWaitInputResumeDecision;

export interface AgentToolExecutionResult {
  status: AgentExecutionStatus;
  currentStepKey?: string | null;
  content: string;
  headline: string;
  references: string[];
  evidence?: AgentEvidenceCard[];
  attachments?: AgentAttachment[];
  uiSurfaces?: AgentUiSurface[];
  toolCalls: AgentToolCall[];
  qdrantFilter?: unknown;
  contextFrame?: ContextFrame | null;
  pendingConfirmation?: ConfirmationRequest | null;
  pendingInteraction?: PendingInteraction | null;
  toolArbitration?: ToolArbitrationTrace | null;
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
  uiSurfaces?: AgentUiSurface[];
  qdrantFilter?: unknown;
  contextFrame?: ContextFrame | null;
  selectedTool?: AgentToolSelection;
  pendingConfirmation?: ConfirmationRequest | null;
  pendingInteraction?: PendingInteraction | null;
  continuationResolution?: ContinuationResolution | null;
  resolvedContext?: ReferenceResolution | null;
  semanticResolution?: SemanticReferenceResolution | null;
  toolArbitration?: ToolArbitrationTrace | null;
  policyDecisions: PolicyDecision[];
}

export interface AgentPlannerInput {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  availableTools: AgentToolDefinition[];
  focusedName?: string | null;
  contextFrame?: ContextFrame | null;
  resolvedContext?: ReferenceResolution | null;
  semanticResolution?: SemanticReferenceResolution | null;
}

export interface AgentPlannerResult {
  taskPlan: TaskPlan;
  selectedTool: AgentToolSelection | null;
  toolArbitration?: ToolArbitrationTrace | null;
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
  if (error) {
    toolCall.errorDetails = buildErrorDebugInfo(error);
  }
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
