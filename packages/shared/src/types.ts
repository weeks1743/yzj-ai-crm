export type HealthStatus = 'healthy' | 'attention' | 'risk';
export type FlowStatus =
  | 'ready'
  | 'running'
  | 'syncing'
  | 'warning'
  | 'blocked'
  | 'draft'
  | 'completed';

export interface TenantContext {
  eid: string;
  appId: string;
  tenantName: string;
  suiteName: string;
  owner: string;
  region: string;
  accessStatus: string;
  orgSyncStatus: string;
  lastSyncAt: string;
  lastHeartbeatAt: string;
  seatUsage: string;
}

export interface PageMetric {
  key: string;
  label: string;
  value: string;
  helper: string;
  trend: string;
  status: HealthStatus;
}

export interface TrendPoint {
  date: string;
  writebackSuccess: number;
  audioCompletion: number;
  researchReuse: number;
  visitBriefSuccess: number;
}

export interface RankingItem {
  name: string;
  value: number;
  category: string;
}

export interface SystemAlert {
  id: string;
  title: string;
  severity: '紧急' | '高' | '中';
  description: string;
  owner: string;
  updatedAt: string;
}

export interface SystemHealthItem {
  key: string;
  name: string;
  status: HealthStatus;
  value: string;
  target: string;
  description: string;
}

export interface TimelineEntry {
  time: string;
  title: string;
  description: string;
  actor: string;
  status: 'success' | 'processing' | 'warning';
}

export interface RecordEntity {
  id: string;
  name: string;
  code: string;
  status: string;
  owner: string;
  industry?: string;
  amount?: string;
  phone?: string;
  customerName?: string;
  opportunityName?: string;
  source: string;
  updatedAt: string;
  nextAction: string;
  health: HealthStatus;
  tags: string[];
  description: string;
  related: Array<{ label: string; value: string }>;
  timeline: TimelineEntry[];
}

export interface RecordPageConfig {
  key: string;
  title: string;
  summary: string;
  searchPlaceholder: string;
  metrics: PageMetric[];
  records: RecordEntity[];
}

export interface AssetItem {
  id: string;
  title: string;
  status: string;
  owner: string;
  entityAnchor: string;
  summary: string;
  updatedAt: string;
  score: string;
  tags: string[];
  timeline: TimelineEntry[];
}

export interface AssetPageConfig {
  key: string;
  title: string;
  summary: string;
  metrics: PageMetric[];
  items: AssetItem[];
}

export type ShadowObjectKey = 'customer' | 'contact' | 'opportunity' | 'followup';
export type AgentClientAction =
  | {
      type: 'record.open';
      objectKey: ShadowObjectKey;
      formInstId: string;
      title?: string;
    };

export interface AgentUiSurface {
  kind: 'record-search-results' | 'record-detail';
  protocol: 'a2ui';
  version: 'v0.9';
  surfaceId: string;
  catalogId: 'local://yzj-crm/record-result/v1';
  commands: AgentA2UiCommand[];
  pagination?: AgentRecordSearchPageQuery;
  summary: {
    objectKey: ShadowObjectKey;
    operation: 'search' | 'get';
    total?: number;
    pageNumber?: number;
    pageSize?: number;
    totalPages?: number;
    returnedCount?: number;
    displayMode: 'empty' | 'list' | 'card';
  };
  rawResult?: unknown;
}

export interface AgentRecordSearchFilter {
  field: string;
  value: unknown;
  operator?: string;
}

export interface AgentRecordSearchPageInput {
  filters?: AgentRecordSearchFilter[];
  operatorOpenId?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface AgentRecordSearchPageRequest {
  objectKey: ShadowObjectKey;
  searchInput: AgentRecordSearchPageInput;
  toolCode?: string;
  queryText?: string;
}

export interface AgentRecordSearchPageQuery {
  endpoint: '/api/agent/record-search-page';
  request: AgentRecordSearchPageRequest;
}

export interface AgentRecordResultFieldView {
  label: string;
  value: string;
}

export interface AgentRecordResultRecordView {
  formInstId: string;
  title: string;
  subtitle?: string;
  tags: string[];
  primaryFields: AgentRecordResultFieldView[];
  secondaryFields: AgentRecordResultFieldView[];
}

export interface AgentRecordResultViewModel {
  objectKey: ShadowObjectKey;
  operation: 'search' | 'get';
  toolCode: string;
  title: string;
  total: number;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  returnedCount: number;
  queryText?: string;
  pagination?: AgentRecordSearchPageQuery;
  displayMode: 'empty' | 'list' | 'card';
  records: AgentRecordResultRecordView[];
  record?: AgentRecordResultRecordView;
}

export interface AgentRecordSearchPageResponse {
  result: AgentRecordResultViewModel;
  rawResult: unknown;
}

export interface AgentFieldOptionHint {
  label: string;
  value: string | number | boolean;
  key?: string;
  description?: string;
  source?: 'field_option' | 'dictionary' | 'widget' | 'employee' | 'record';
}

export interface AgentMetaQuestionLookup {
  kind: 'remote_select';
  endpoint: '/api/agent/meta-question-options';
  source: 'employee' | 'record';
  targetObjectKey?: ShadowObjectKey;
  minKeywordLength: 1;
  pageSize: number;
  allowFreeText: false;
}

export interface AgentMetaQuestionOptionsRequest {
  toolCode: string;
  paramKey: string;
  keyword: string;
  pageSize?: number;
  tenantContext?: {
    operatorOpenId?: string;
  };
}

export interface AgentMetaQuestionOptionsResponse {
  options: AgentFieldOptionHint[];
}

export type AgentA2UiCommand =
  | {
      version: 'v0.9';
      createSurface: {
        surfaceId: string;
        catalogId: 'local://yzj-crm/record-result/v1';
      };
    }
  | {
      version: 'v0.9';
      updateDataModel: {
        surfaceId: string;
        path: string;
        value: unknown;
      };
    }
  | {
      version: 'v0.9';
      updateComponents: {
        surfaceId: string;
        components: Array<Record<string, unknown>>;
      };
    }
  | {
      version: 'v0.9';
      deleteSurface: {
        surfaceId: string;
      };
    };
export type ShadowDictionarySource = 'manual_json' | 'approval_api' | 'hybrid';
export type ShadowResolvedDictionarySource =
  | ShadowDictionarySource
  | 'field_binding_workbook'
  | 'unresolved';
export type ShadowObjectActivationStatus = 'active' | 'pending' | 'not_configured';
export type ShadowObjectRefreshStatus = 'not_started' | 'ready' | 'failed';
export type ShadowDictionaryResolutionStatus = 'resolved' | 'pending' | 'failed';
export type ShadowDictionaryAcceptedValueShape = 'array<{title,dicId}>';
export type ShadowSkillOperation = 'search' | 'get' | 'create' | 'update' | 'delete';
export type ShadowExecutionPhase = 'preview_only' | 'live_read_enabled' | 'live_write_enabled';
export type ShadowSemanticSlot =
  | 'customer_name'
  | 'opportunity_name'
  | 'owner_open_id'
  | 'service_rep_open_id'
  | 'customer_status'
  | 'opportunity_status'
  | 'customer_type'
  | 'industry'
  | 'last_followup_date'
  | 'region'
  | 'province'
  | 'city'
  | 'district'
  | 'phone'
  | string;

export interface ShadowFieldOption {
  title: string;
  key?: string;
  value?: string;
  dicId?: string;
  code?: string | null;
  state?: string | null;
  sort?: number | null;
  aliases?: string[];
}

export interface ShadowFieldEnumBindingView {
  kind: 'public_option';
  referId: string | null;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  acceptedValueShape: ShadowDictionaryAcceptedValueShape;
  resolvedEntryCount: number;
}

export interface ShadowFieldRelationBindingView {
  kind: 'basic_data';
  formCodeId: string | null;
  modelName: string | null;
  displayCol: string | null;
}

export type ShadowFieldRequiredMode = 'required' | 'conditional' | 'optional';
export type ShadowFieldWritePolicy = 'promptable' | 'derived' | 'read_only';
export type ShadowTemplateSource = 'public_view_form_def' | 'internal_get_form_by_code_id';

export interface ShadowFieldRequiredRuleView {
  kind: 'static' | 'conditional';
  sourceFieldCode?: string;
  sourceLabel?: string;
  optionLabels?: string[];
  description: string;
}

export interface ShadowFieldProvenanceView {
  sources: ShadowTemplateSource[];
  truthSource: ShadowTemplateSource;
}

export interface ShadowStandardizedFieldView {
  fieldCode: string;
  label: string;
  widgetType: string;
  required: boolean;
  requiredMode?: ShadowFieldRequiredMode;
  requiredRules?: ShadowFieldRequiredRuleView[];
  readOnly: boolean;
  edit: boolean;
  view: boolean;
  systemDefault?: string | null;
  placeholder?: string | null;
  writePolicy: ShadowFieldWritePolicy;
  isSystemField: boolean;
  provenance: ShadowFieldProvenanceView;
  writeParameterKey?: string;
  searchParameterKey?: string;
  multi: boolean;
  linkCodeId?: string | null;
  options: ShadowFieldOption[];
  referId?: string;
  semanticSlot?: ShadowSemanticSlot;
  enumBinding?: ShadowFieldEnumBindingView;
  relationBinding?: ShadowFieldRelationBindingView;
}

export interface ShadowObjectSummaryView {
  objectKey: ShadowObjectKey;
  label: string;
  enabled: boolean;
  activationStatus: ShadowObjectActivationStatus;
  formCodeId: string | null;
  formDefId: string | null;
  refreshStatus: ShadowObjectRefreshStatus;
  latestSnapshotVersion: string | null;
  latestSchemaHash: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

export interface ShadowObjectDetailView extends ShadowObjectSummaryView {
  fields: ShadowStandardizedFieldView[];
  snapshotVersion: string | null;
  schemaHash: string | null;
}

export interface ShadowDictionaryEntryView {
  referId: string;
  dicId: string;
  title: string;
  code: string | null;
  state: string | null;
  sort: number | null;
  source: ShadowResolvedDictionarySource;
  sourceVersion: string;
  aliases: string[];
}

export interface ShadowDictionaryBindingView {
  objectKey: ShadowObjectKey;
  fieldCode: string;
  label: string;
  referId: string | null;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  acceptedValueShape: ShadowDictionaryAcceptedValueShape;
  snapshotVersion: string;
  entries: ShadowDictionaryEntryView[];
}

export interface ShadowSkillExecutionApiView {
  method: 'POST';
  path: string;
  payloadExample: Record<string, unknown>;
}

export interface ShadowSkillExecutionTargetView {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ShadowSkillReferencePathsView {
  skillBundle: string;
  templateSummary: string;
  templateRaw: string;
  dictionaries: string;
  execution: string;
}

export interface ShadowSkillExecutionBindingView {
  previewApi: ShadowSkillExecutionApiView;
  liveApi?: ShadowSkillExecutionApiView;
  lightCloudPreview: ShadowSkillExecutionTargetView;
  lightCloudLive?: ShadowSkillExecutionTargetView;
  phase: ShadowExecutionPhase;
}

export interface ShadowSkillClarificationRuleView {
  when: string;
  response: string;
}

export interface ShadowSkillInteractionStrategyView {
  recommendedFlow: string[];
  parameterCollectionPolicy: string[];
  clarificationTriggers: ShadowSkillClarificationRuleView[];
  disambiguationRules: string[];
  targetResolutionPolicy: string[];
  executionGuardrails: string[];
}

export interface ShadowSkillView {
  skillName: string;
  skillKey: string;
  operation: ShadowSkillOperation;
  description: string;
  whenToUse: string;
  notWhenToUse: string;
  requiredParams: string[];
  optionalParams: string[];
  derivedParams: string[];
  confirmationPolicy: string;
  outputCardType: string;
  interactionStrategy: ShadowSkillInteractionStrategyView;
  sourceObject: ShadowObjectKey;
  sourceFormCodeId: string;
  sourceVersion: string;
  bundleDirectory: string;
  skillPath: string;
  agentMetadataPath: string | null;
  referencePaths: ShadowSkillReferencePathsView;
  executionBinding: ShadowSkillExecutionBindingView;
}

export type ExternalSkillStatus = '运行中' | '告警中' | '占位中';
export type ExternalSkillImplementationType =
  | 'http_request'
  | 'tool'
  | 'mcp'
  | 'skill'
  | 'placeholder';
export type ExternalSkillDebugMode = 'none' | 'image_generate' | 'skill_job';
export type ExternalSkillDebugArtifactKind = 'image' | 'markdown' | 'presentation';
export type SkillRuntimeModelName = 'deepseek-v4-pro' | 'deepseek-v4-flash';
export type ImageGenerationSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export type ImageGenerationQuality = 'auto' | 'low' | 'medium' | 'high';
export type ExternalSkillJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ExternalSkillJobEventType =
  | 'status'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'error'
  | 'deck_planned'
  | 'deck_rendered'
  | 'qa_report'
  | 'previews_rendered'
  | 'presentation_ready';

export interface ExternalSkillDebugConfig {
  defaultModel?: SkillRuntimeModelName | null;
  supportedModels?: SkillRuntimeModelName[];
  supportsAttachments?: boolean;
  supportsWorkingDirectory?: boolean;
  requestPlaceholder?: string;
  artifactKind?: ExternalSkillDebugArtifactKind;
}

export interface ExternalSkillCatalogItem {
  id: string;
  label: string;
  skillCode: string;
  type: '外部技能';
  trigger: string;
  route?: string;
  dependencies: string[];
  status: ExternalSkillStatus;
  implementationType: ExternalSkillImplementationType;
  supportsInvoke: boolean;
  runtimeSkillName?: string;
  debugMode: ExternalSkillDebugMode;
  debugConfig?: ExternalSkillDebugConfig;
  provider?: string | null;
  model?: string | null;
  missingDependencies?: string[];
  owner: string;
  sla: string;
  summary: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
}

export interface ImageGenerationResponse {
  skillCode: 'ext.image_generate';
  model: string;
  provider: string;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  previewDataUrl: string;
  mimeType: string;
  latencyMs: number;
  generatedAt: string;
}

export interface ExternalSkillJobRequest {
  requestText: string;
  model?: SkillRuntimeModelName;
  attachments?: string[];
  workingDirectory?: string;
  presentationPrompt?: string;
}

export interface ExternalSkillJobArtifact {
  artifactId: string;
  jobId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  downloadPath: string;
}

export interface ExternalSkillJobEvent {
  id: string;
  type: ExternalSkillJobEventType;
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface ExternalSkillJobResponse {
  jobId: string;
  skillCode: string;
  runtimeSkillName: string;
  model: string | null;
  status: ExternalSkillJobStatus;
  finalText: string | null;
  events: ExternalSkillJobEvent[];
  artifacts: ExternalSkillJobArtifact[];
  error: ApiErrorResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalSkillPresentationSessionResponse {
  status: 'ok';
  jobId: string;
  pptId: string;
  token: string;
  subject: string;
  animation: boolean;
  expiresAt: string;
  leaseExpireAt: string;
  clientId: string;
}

export interface ExternalSkillPresentationSessionHolder {
  clientId: string;
  clientLabel: string;
  lastActiveAt: string;
  leaseExpireAt: string;
}

export interface ExternalSkillPresentationSessionOpenRequest {
  clientId?: string;
  clientLabel?: string;
  takeover?: boolean;
}

export interface ExternalSkillPresentationSessionHeartbeatRequest {
  clientId?: string;
  clientLabel?: string;
}

export interface ExternalSkillPresentationSessionHeartbeatResponse {
  status: 'ok';
  jobId: string;
  clientId: string;
  expiresAt: string;
  leaseExpireAt: string;
}

export interface ExternalSkillPresentationSessionCloseRequest {
  clientId?: string;
}

export interface ExternalSkillPresentationSessionCloseResponse {
  status: 'closed';
  jobId: string;
  clientId: string;
  released: boolean;
}

export interface ExternalSkillPresentationSessionConflictResponse {
  code: 'PRESENTATION_SESSION_CONFLICT' | 'PRESENTATION_SESSION_TAKEN_OVER' | 'PRESENTATION_SESSION_EXPIRED';
  message: string;
  holder?: ExternalSkillPresentationSessionHolder;
  leaseExpireAt?: string;
  canTakeover?: boolean;
}

export interface EnterprisePptTemplateItem {
  templateId: string;
  name: string;
  sourceFileName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnterprisePptTemplateListResponse {
  items: EnterprisePptTemplateItem[];
  activeTemplate: EnterprisePptTemplateItem | null;
  defaultPrompt: string;
  effectivePrompt: string;
  promptMaxLength: number;
  isFallbackApplied: boolean;
  fallbackReason: string | null;
}

export interface EnterprisePptTemplateUploadResponse {
  item: EnterprisePptTemplateItem;
}

export interface EnterprisePptTemplatePromptResponse {
  defaultPrompt: string;
  effectivePrompt: string;
  promptMaxLength: number;
  isFallbackApplied: boolean;
  fallbackReason: string | null;
}

export type SceneAssemblyKey =
  | 'scene.post_visit_loop'
  | 'scene.customer_analysis'
  | 'scene.conversation_understanding'
  | 'scene.needs_todo_analysis'
  | 'scene.problem_statement'
  | 'scene.value_positioning'
  | 'scene.solution_matching';
export type SceneAssemblyStatus = '待组装' | '依赖缺口' | '能力风险';
export type SceneAssemblyDependencyStatus = 'available' | 'gap' | 'risk';
export type SceneAssemblyCategory = '复合场景' | '分析场景';
export type ScenePlanStepRequirement = 'required' | 'optional' | 'conditional';

export interface ScenePlanStep {
  key: string;
  label: string;
  description: string;
  requirement: ScenePlanStepRequirement;
  skillCode?: string;
  canSkip: boolean;
  canPause: boolean;
}

export interface ScenePlanVariant {
  key: string;
  label: string;
  summary: string;
  recommendedFor: string;
  steps: string[];
  userDecisions: string[];
}

export interface ScenePlanPolicy {
  confirmation: string;
  writeback: string;
  pauseResume: string;
  adminBoundary: string;
}

export interface ScenePlanPlaybook {
  sceneKey: SceneAssemblyKey;
  planModes: string[];
  stepLibrary: ScenePlanStep[];
  variants: ScenePlanVariant[];
  policies: ScenePlanPolicy[];
  adminControls: string[];
}

export interface SceneRecordSkillDependency {
  skillName: string;
  objectKey: ShadowObjectKey;
  operation: ShadowSkillOperation;
}

export interface SceneExternalDependency {
  skillCode: string;
  label: string;
}

export interface SceneAssemblyDraft {
  key: SceneAssemblyKey;
  label: string;
  category: SceneAssemblyCategory;
  salesStage: string;
  businessGoal: string;
  entityAnchor: string;
  summary: string;
  triggerEntries: string[];
  upstreamAssets: string[];
  outputs: string[];
  orchestrationChain: string[];
  recordSkillDependencies: SceneRecordSkillDependency[];
  externalSkillDependencies: SceneExternalDependency[];
  boundaries: {
    scene: string[];
    shadow: string[];
    external: string[];
    writeback: string[];
  };
}

export interface SceneAssemblyDependency {
  code: string;
  label: string;
  layer: 'record_skill' | 'external_skill';
  status: SceneAssemblyDependencyStatus;
  objectKey?: ShadowObjectKey;
  operation?: ShadowSkillOperation;
  route?: string;
  owner?: string;
  summary?: string;
  reason?: string;
}

export interface SceneAssemblyResolvedView {
  key: SceneAssemblyKey;
  label: string;
  category: SceneAssemblyCategory;
  salesStage: string;
  businessGoal: string;
  entityAnchor: string;
  summary: string;
  triggerEntries: string[];
  upstreamAssets: string[];
  outputs: string[];
  orchestrationChain: string[];
  playbook: ScenePlanPlaybook;
  status: SceneAssemblyStatus;
  recordSkillDependencies: SceneAssemblyDependency[];
  externalSkillDependencies: SceneAssemblyDependency[];
  gaps: string[];
  boundaries: SceneAssemblyDraft['boundaries'];
}

export interface WritebackPolicy {
  id: string;
  objectKey: string;
  strategy: string;
  trigger: string;
  approver: string;
  auditSampling: string;
  rollbackRule: string;
  updatedAt: string;
}

export interface TraceLog {
  traceId: string;
  taskId: string;
  eid: string;
  appId: string;
  scene: string;
  status: string;
  toolChain: string[];
  writebackResult: string;
  timestamp: string;
}

export type AgentToolType = 'record' | 'external' | 'meta';
export type AgentToolRiskLevel = 'low' | 'medium' | 'high';
export type AgentToolStatus = 'ready' | 'warning' | 'placeholder';

export interface AgentToolRow {
  id: string;
  name: string;
  code: string;
  type: AgentToolType;
  provider: string;
  status: AgentToolStatus;
  riskLevel: AgentToolRiskLevel;
  confirmationPolicy: string;
  inputSummary: string;
  outputSummary: string;
  owner: string;
  healthNote: string;
}

export interface AgentPlanStepTemplate {
  key: string;
  title: string;
  actionType: 'query' | 'analyze' | 'write_preview' | 'confirm' | 'external' | 'meta';
  toolRefs: string[];
  required: boolean;
  skippable: boolean;
  confirmationRequired: boolean;
}

export interface AgentPlanTemplate {
  id: string;
  name: string;
  intentPattern: string;
  summary: string;
  sampleUtterances: string[];
  steps: AgentPlanStepTemplate[];
  outputs: string[];
  governanceNotes: string[];
  status: 'enabled' | 'draft';
}

export interface AgentPolicy {
  id: string;
  name: string;
  target: string;
  trigger: string;
  action: 'block' | 'require_confirmation' | 'clarify' | 'downgrade_to_draft' | 'audit';
  severity: AgentToolRiskLevel;
  owner: string;
  lastTriggered: string;
}

export interface AgentRuntimeTrace {
  id: string;
  userInput: string;
  intentFrame: {
    actionType: string;
    goal: string;
    targets: string[];
    missingSlots: string[];
  };
  taskPlan: {
    planId: string;
    status: string;
    steps: string[];
  };
  executionState: string;
  toolChain: string[];
  evidenceRefs: string[];
  result: string;
  timestamp: string;
}

export type AgentExecutionStatus =
  | 'draft'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'waiting_confirmation'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'tool_unavailable';
export type AgentTargetType =
  | 'company'
  | 'customer'
  | 'opportunity'
  | 'contact'
  | 'followup'
  | 'artifact'
  | 'unknown';
export type AgentTaskPlanKind =
  | 'tool_execution'
  | 'tool_confirmation'
  | 'tool_clarify'
  | 'company_research'
  | 'artifact_search'
  | 'audio_not_supported'
  | 'unknown_clarify';
export type AgentToolCallStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type AgentConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface AgentObservedAttachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface AgentObservedContextSubject {
  kind: string;
  type?: string;
  id?: string;
  name?: string;
}

export interface AgentObservedEvidenceCard {
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

export interface AgentObservedToolCall {
  id: string;
  runId: string;
  toolCode: string;
  status: AgentToolCallStatus;
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  errorDetails?: unknown;
}

export interface AgentObservedMessage {
  messageId: string;
  runId: string;
  conversationKey: string;
  role: string;
  content: string;
  attachments: AgentObservedAttachment[];
  extraInfo: unknown;
  createdAt: string;
}

export interface AgentRunSummary {
  runId: string;
  traceId: string;
  eid: string;
  appId: string;
  conversationKey: string;
  sceneKey: string;
  userInput: string;
  status: AgentExecutionStatus;
  goal: string;
  targetType: AgentTargetType;
  planTitle: string;
  planKind: AgentTaskPlanKind;
  currentStepKey: string | null;
  toolCallCount: number;
  failedToolCallCount: number;
  pendingConfirmationCount: number;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfirmationAuditRow {
  confirmationId: string;
  runId: string;
  traceId: string;
  toolCode: string;
  status: AgentConfirmationStatus;
  title: string;
  summary: string;
  preview: unknown;
  requestInput: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
}

export interface AgentRunListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AgentRunSummary[];
}

export interface AgentRunDetailResponse {
  run: AgentRunSummary;
  intentFrame: unknown;
  taskPlan: unknown;
  executionState: unknown;
  contextSubject: AgentObservedContextSubject | null;
  evidenceRefs: AgentObservedEvidenceCard[];
  messages: AgentObservedMessage[];
  toolCalls: AgentObservedToolCall[];
  confirmations: AgentConfirmationAuditRow[];
}

export interface AgentConfirmationListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AgentConfirmationAuditRow[];
}

export interface SettingField {
  name: string;
  label: string;
  value: string | boolean;
  kind: 'text' | 'switch' | 'select' | 'textarea';
  options?: string[];
}

export interface SettingGroup {
  key: string;
  title: string;
  summary: string;
  tags: string[];
  healthNote: string;
  fields: SettingField[];
}

export interface SettingPageConfig {
  key: string;
  title: string;
  summary: string;
  metrics: PageMetric[];
  groups: SettingGroup[];
}

export interface ConversationSession {
  key: string;
  label: string;
  route: string;
  group: string;
  lastMessage: string;
  updatedAt: string;
  badgeCount?: number;
  scene: string;
}

export interface SceneTask {
  id: string;
  title: string;
  scene: string;
  route: string;
  status: string;
  progress: number;
  owner: string;
  entityAnchor: string;
  nextAction: string;
  traceId: string;
  taskId: string;
  eid: string;
  appId: string;
  updatedAt: string;
}

export interface Citation {
  title: string;
  source: string;
}

export interface ResearchSnapshot {
  id: string;
  companyName: string;
  intent: string;
  sourceCount: number;
  freshness: string;
  owner: string;
  updatedAt: string;
  summary: string;
  citations: Citation[];
  risks: string[];
  opportunities: string[];
}

export interface TenantAppSettingsResponse {
  eid: string;
  appId: string;
  appName: string;
  enabled: boolean;
  configSource: string;
  isolationKey: string;
}

export interface CredentialSummary {
  key: 'appId' | 'appSecret' | 'signKey' | 'orgReadSecret';
  label: string;
  configured: boolean;
  maskedValue: string;
  description: string;
}

export interface YzjAuthSettingsResponse {
  yzjServerBaseUrl: string;
  tokenScope: 'resGroupSecret';
  tokenEndpoint: string;
  employeeEndpoint: string;
  credentials: CredentialSummary[];
}

export type OrgSyncTriggerType = 'manual';
export type OrgSyncRunStatus = 'running' | 'completed' | 'failed';

export interface OrgSyncRunSummary {
  id: string;
  triggerType: OrgSyncTriggerType;
  status: OrgSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  pageCount: number;
  fetchedCount: number;
  upsertedCount: number;
  skippedCount: number;
  errorMessage: string | null;
}

export interface OrgSyncSettingsResponse {
  syncMode: 'manual_full_active_only';
  schedulerEnabled: false;
  pageSize: number;
  employeeCount: number;
  isSyncing: boolean;
  lastRun: OrgSyncRunSummary | null;
  recentRuns: OrgSyncRunSummary[];
}

export interface ManualSyncStartResponse {
  runId: string;
  status: 'running';
  message: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  runId?: string;
  details?: unknown;
}

export interface AudioImportTask {
  id: string;
  title: string;
  branch: '无客户无商机' | '有客户无商机' | '有客户有商机';
  customerName?: string;
  opportunityName?: string;
  duration: string;
  transcriptStatus: string;
  analysisStatus: string;
  writebackStatus: string;
  progress: number;
  owner: string;
  updatedAt: string;
  steps: Array<{ title: string; status: FlowStatus; description: string }>;
}

export interface VisitBrief {
  id: string;
  customerName: string;
  theme: string;
  owner: string;
  updatedAt: string;
  sourceMix: string[];
  summary: string[];
  questions: string[];
  risks: string[];
  actions: string[];
}

export interface AssistantPrompt {
  key: string;
  label: string;
  description: string;
}

export interface AssistantGuide {
  key: string;
  title: string;
  description: string;
}

export interface AssistantHotTopic {
  key: string;
  title: string;
  description: string;
}

export interface AssistantTaskCard {
  key: string;
  title: string;
  status: string;
  description: string;
  metric: string;
}

export interface AssistantScene {
  key:
    | 'chat'
    | 'customer-analysis'
    | 'conversation-understanding'
    | 'needs-todo-analysis'
    | 'problem-statement'
    | 'value-positioning'
    | 'solution-matching'
    | 'tasks';
  route: string;
  title: string;
  subtitle: string;
  headline: string;
  description: string;
  defaultInput: string;
  prompts: AssistantPrompt[];
  hotTopics: AssistantHotTopic[];
  guides: AssistantGuide[];
  taskCards: AssistantTaskCard[];
}
