export type ShadowObjectKey = 'customer' | 'contact' | 'opportunity' | 'followup';
export type ShadowDictionarySource = 'manual_json' | 'approval_api' | 'hybrid';
export type ShadowResolvedDictionarySource =
  | ShadowDictionarySource
  | 'field_binding_workbook'
  | 'unresolved';
export type ShadowObjectActivationStatus = 'active' | 'pending' | 'not_configured';
export type ShadowObjectRefreshStatus = 'not_started' | 'ready' | 'failed';
export type ShadowDictionaryResolutionStatus = 'resolved' | 'pending' | 'failed';
export type ShadowDictionaryAcceptedValueShape = 'array<{title,dicId}>';
export type FieldBoundDictionaryKey = 'province' | 'city' | 'district';
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

export interface ShadowObjectConfig {
  key: ShadowObjectKey;
  label: string;
  formCodeId: string | null;
  enabled: boolean;
}

export interface AppConfig {
  yzj: {
    eid: string;
    appId: string;
    appSecret: string;
    signKey: string;
    orgReadSecret: string;
    baseUrl: string;
    approval: {
      appId: string;
      appSecret: string;
      developerKey: string;
      fileSecret: string | null;
    };
    lightCloud: {
      appId: string;
      appSecret: string;
      secret: string;
    };
  };
  shadow: {
    dictionarySource: ShadowDictionarySource;
    dictionaryJsonPath: string;
    skillOutputDir: string;
    objects: Record<ShadowObjectKey, ShadowObjectConfig>;
  };
  server: {
    port: number;
  };
  docmee: {
    baseUrl: string;
    apiKey: string | null;
  };
  storage: {
    sqlitePath: string;
    mongodbUri: string;
    mongodbDb: string;
  };
  qdrant: {
    url: string;
    apiKey: string | null;
    collectionName: string;
  };
  embedding: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    dimensions: number;
  };
  deepseek: {
    baseUrl: string;
    apiKey: string | null;
    defaultModel: SkillRuntimeModelName;
  };
  external: {
    image: {
      baseUrl: string;
      apiKey: string | null;
      model: string;
      timeoutMs: number;
    };
    skillRuntime: {
      baseUrl: string;
    };
  };
  meta: {
    configSource: '.env';
    envFilePath: string;
  };
}

export type ArtifactAnchorType =
  | 'customer'
  | 'opportunity'
  | 'contact'
  | 'followup'
  | 'company'
  | 'source_file';

export type ArtifactVectorStatus =
  | 'pending_embedding'
  | 'pending_config'
  | 'indexed'
  | 'embedding_failed';

export interface ArtifactAnchor {
  type: ArtifactAnchorType;
  id: string;
  name?: string;
  role?: 'primary' | 'related' | 'source';
  confidence?: number;
  bindingStatus?: 'bound' | 'unbound' | 'suggested';
}

export interface CompanyResearchArtifactRequest {
  eid?: string;
  appId?: string;
  title: string;
  markdown: string;
  sourceToolCode: string;
  anchors: ArtifactAnchor[];
  createdBy?: string;
  summary?: string;
  sourceRefs?: Array<{
    title: string;
    url?: string;
    source?: string;
  }>;
}

export interface ArtifactVersionSummary {
  artifactId: string;
  versionId: string;
  version: number;
  title: string;
  sourceToolCode: string;
  vectorStatus: ArtifactVectorStatus;
  anchors: ArtifactAnchor[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactCreateResponse {
  artifact: ArtifactVersionSummary;
}

export interface ArtifactDetailResponse {
  artifact: ArtifactVersionSummary;
  markdown: string;
  summary?: string;
}

export interface ArtifactSearchRequest {
  eid?: string;
  appId?: string;
  query: string;
  anchors?: ArtifactAnchor[];
  limit?: number;
}

export interface ArtifactEvidenceRef {
  artifactId: string;
  versionId: string;
  title: string;
  version: number;
  sourceToolCode: string;
  anchorTypes: ArtifactAnchorType[];
  anchorIds: string[];
  snippet: string;
  heading?: string;
  score: number;
}

export interface ArtifactSearchResponse {
  query: string;
  vectorStatus: ArtifactVectorStatus | 'searched';
  qdrantFilter: unknown;
  evidence: ArtifactEvidenceRef[];
}

export type ArtifactPresentationStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface ArtifactPresentationResponse {
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactPresentationStatus;
  jobId?: string;
  pptArtifact?: ExternalSkillJobArtifact;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type AgentActionType = 'query' | 'analyze' | 'write' | 'plan' | 'export' | 'clarify';
export type AgentTargetType = 'company' | 'customer' | 'opportunity' | 'contact' | 'followup' | 'artifact' | 'unknown';
export type AgentTaskPlanKind = 'company_research' | 'artifact_search' | 'audio_not_supported' | 'unknown_clarify';
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
export type AgentToolCallStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface AgentAttachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface IntentFrame {
  actionType: AgentActionType;
  goal: string;
  targetType: AgentTargetType;
  targets: Array<{
    type: AgentTargetType;
    id: string;
    name: string;
  }>;
  inputMaterials: string[];
  constraints: string[];
  missingSlots: string[];
  confidence: number;
  source: 'llm' | 'fallback';
  fallbackReason?: string;
}

export interface TaskPlanStep {
  key: string;
  title: string;
  actionType: 'query' | 'analyze' | 'write_preview' | 'confirm' | 'external' | 'meta';
  toolRefs: string[];
  required: boolean;
  skippable: boolean;
  confirmationRequired: boolean;
  status: AgentToolCallStatus;
}

export interface TaskPlan {
  planId: string;
  kind: AgentTaskPlanKind;
  title: string;
  status: AgentExecutionStatus;
  steps: TaskPlanStep[];
  evidenceRequired: boolean;
}

export interface ExecutionState {
  runId: string;
  traceId: string;
  status: AgentExecutionStatus;
  currentStepKey: string | null;
  message: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface AgentToolCall {
  id: string;
  runId: string;
  toolCode: string;
  status: AgentToolCallStatus;
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface AgentChatRequest {
  conversationKey: string;
  query: string;
  sceneKey: string;
  attachments?: AgentAttachment[];
  tenantContext?: {
    eid?: string;
    appId?: string;
  };
}

export interface AgentEvidenceCard {
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

export interface AgentChatMessage {
  role: 'assistant';
  content: string;
  attachments?: AgentAttachment[];
  extraInfo: {
    feedback: 'default';
    sceneKey: string;
    headline: string;
    references: string[];
    evidence?: AgentEvidenceCard[];
    agentTrace: {
      traceId: string;
      intentFrame: IntentFrame;
      taskPlan: TaskPlan;
      executionState: ExecutionState;
      toolCalls: AgentToolCall[];
      qdrantFilter?: unknown;
    };
  };
}

export interface AgentChatResponse {
  success: true;
  data: {
    content: string;
    attachments?: AgentAttachment[];
    extraInfo: AgentChatMessage['extraInfo'];
  };
  message: AgentChatMessage;
  intentFrame: IntentFrame;
  taskPlan: TaskPlan;
  executionState: ExecutionState;
  toolCalls: AgentToolCall[];
  traceId: string;
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
  requestText?: string;
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

export interface YzjAccessTokenResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: {
    accessToken: string;
    expireIn: number;
    refreshToken?: string;
  };
}

export interface YzjApprovalFileUploadItem {
  fileId: string;
  fileType: string;
  isEncrypted?: boolean;
  fileName: string;
  length: number;
}

export interface YzjApprovalFileUploadResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: YzjApprovalFileUploadItem[];
}

export interface YzjPersonListResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: YzjEmployee[];
}

export interface YzjEmployee {
  openId: string;
  uid?: string;
  name?: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  status?: string;
  birthday?: string;
  hireDate?: string;
  positiveDate?: string;
  gender?: string;
  isHidePhone?: string;
  jobNo?: string;
  orgId?: string;
  orgUserType?: string;
  photoUrl?: string;
  department?: string;
  weights?: string;
  contact?: string;
  staffType?: string;
  [key: string]: unknown;
}

export interface OrgEmployeeRecord {
  eid: string;
  appId: string;
  openId: string;
  uid: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  status: string | null;
  syncedAt: string;
  rawPayloadJson: string;
}

export interface SyncProgress {
  pageCount: number;
  fetchedCount: number;
  upsertedCount: number;
  skippedCount: number;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface YzjApprovalOption {
  key?: string;
  value?: string;
  checked?: boolean;
  [key: string]: unknown;
}

export interface YzjApprovalWidget {
  codeId: string;
  title?: string;
  type: string;
  required?: boolean;
  readOnly?: boolean;
  option?: 'single' | 'multi' | string | null;
  options?: YzjApprovalOption[];
  referId?: string;
  parentCodeId?: string | null;
  extendFieldMap?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface YzjApprovalDetailWidget {
  codeId: string;
  title?: string;
  type: string;
  widgetVos?: Record<string, YzjApprovalWidget>;
  extendFieldMap?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface YzjApprovalFormTemplateResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: {
    formDefId?: string;
    formInfo?: {
      widgetMap?: Record<string, YzjApprovalWidget>;
      detailMap?: Record<string, YzjApprovalDetailWidget>;
    };
    [key: string]: unknown;
  };
}

export interface YzjDictionaryCategory {
  dicId: string;
  title: string;
  sort?: number;
}

export interface YzjDictionaryOption {
  dicId: string;
  title: string;
  parentId: string;
  sort?: number;
}

export interface YzjDictionaryEntry {
  dicId: string;
  title: string;
  parentId: string;
  code?: string;
  state?: string;
  sort?: number;
  createTime?: number;
  updateTime?: number;
}

export interface YzjApprovalListResponse<T> {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: {
    list?: T[];
    total?: number;
    pageNumber?: number;
    pageSize?: number;
  };
}

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

export interface ShadowFieldEnumBinding {
  kind: 'public_option';
  referId: string | null;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  acceptedValueShape: ShadowDictionaryAcceptedValueShape;
  resolvedEntryCount: number;
}

export interface ShadowFieldRelationBinding {
  kind: 'basic_data';
  formCodeId: string | null;
  modelName: string | null;
  displayCol: string | null;
}

export interface ShadowStandardizedField {
  fieldCode: string;
  label: string;
  widgetType: string;
  required: boolean;
  readOnly: boolean;
  multi: boolean;
  linkCodeId?: string | null;
  options: ShadowFieldOption[];
  referId?: string;
  semanticSlot?: ShadowSemanticSlot;
  enumBinding?: ShadowFieldEnumBinding;
  relationBinding?: ShadowFieldRelationBinding;
}

export interface ShadowObjectRegistryRecord {
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

export interface ShadowObjectSnapshotRecord {
  id: string;
  objectKey: ShadowObjectKey;
  snapshotVersion: string;
  schemaHash: string;
  formCodeId: string;
  formDefId: string | null;
  normalizedFields: ShadowStandardizedField[];
  dictionaryBindings: ShadowDictionaryBindingRecord[];
  rawTemplate: unknown;
  createdAt: string;
}

export interface ShadowSkillClarificationRule {
  when: string;
  response: string;
}

export interface ShadowSkillInteractionStrategy {
  recommendedFlow: string[];
  parameterCollectionPolicy: string[];
  clarificationTriggers: ShadowSkillClarificationRule[];
  disambiguationRules: string[];
  targetResolutionPolicy: string[];
  executionGuardrails: string[];
}

export interface ShadowSkillContract {
  skillName: string;
  skillKey: string;
  operation: 'search' | 'get' | 'create' | 'update' | 'delete';
  description: string;
  whenToUse: string;
  notWhenToUse: string;
  requiredParams: string[];
  optionalParams: string[];
  confirmationPolicy: string;
  outputCardType: string;
  interactionStrategy: ShadowSkillInteractionStrategy;
  sourceObject: ShadowObjectKey;
  sourceFormCodeId: string;
  sourceVersion: string;
  bundleDirectory: string;
  skillPath: string;
  agentMetadataPath: string | null;
  referencePaths: {
    skillBundle: string;
    templateSummary: string;
    templateRaw: string;
    dictionaries: string;
    execution: string;
  };
  executionBinding: {
    previewApi: {
      method: 'POST';
      path: string;
      payloadExample: Record<string, unknown>;
    };
    liveApi?: {
      method: 'POST';
      path: string;
      payloadExample: Record<string, unknown>;
    };
    lightCloudPreview: {
      url: string;
      method: 'POST';
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    lightCloudLive?: {
      url: string;
      method: 'POST';
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    phase: 'preview_only' | 'live_read_enabled' | 'live_write_enabled';
  };
}

export interface ShadowObjectSummaryResponse extends ShadowObjectRegistryRecord {}

export interface ShadowObjectDetailResponse extends ShadowObjectRegistryRecord {
  fields: ShadowStandardizedField[];
  snapshotVersion: string | null;
  schemaHash: string | null;
}

export interface ShadowDictionaryEntryRecord {
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

export interface ShadowDictionaryBindingRecord {
  objectKey: ShadowObjectKey;
  fieldCode: string;
  label: string;
  referId: string | null;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  acceptedValueShape: ShadowDictionaryAcceptedValueShape;
  snapshotVersion: string;
  entries: ShadowDictionaryEntryRecord[];
}

export interface ShadowPreviewSearchInput {
  filters?: Array<{
    field: string;
    value: unknown;
    operator?: string;
  }>;
  operatorOpenId?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface ShadowPreviewGetInput {
  formInstId?: string;
  operatorOpenId?: string;
}

export interface ShadowPreviewUpsertInput {
  mode: 'create' | 'update';
  formInstId?: string;
  params?: Record<string, unknown>;
  operatorOpenId?: string;
}

export interface ShadowPreviewDeleteInput {
  formInstIds?: string[];
  operatorOpenId?: string;
}

export interface ShadowResolvedDictionaryMapping {
  fieldCode: string;
  label: string;
  referId: string;
  matchedBy: 'title' | 'dicId' | 'object' | 'array-object';
  value: Array<{
    title: string;
    dicId: string;
  }>;
}

export interface ShadowUnresolvedDictionary {
  fieldCode: string;
  label: string;
  referId: string | null;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  reason: string;
}

export interface ShadowPreviewResponse {
  objectKey: ShadowObjectKey;
  operation: 'search' | 'get' | 'upsert' | 'delete';
  unresolvedDictionaries: ShadowUnresolvedDictionary[];
  resolvedDictionaryMappings: ShadowResolvedDictionaryMapping[];
  missingRequiredParams: string[];
  blockedReadonlyParams: string[];
  missingRuntimeInputs: string[];
  validationErrors: string[];
  readyToSend: boolean;
  requestBody: unknown;
}

export interface YzjLightCloudFieldContentItem {
  codeId: string;
  rawValue?: unknown;
  parentCodeId?: string | null;
  sum?: boolean;
  title?: string;
  type?: string;
  value?: unknown;
  [key: string]: unknown;
}

export interface YzjLightCloudRecord {
  id?: string;
  formInstId?: string;
  formInstance?: {
    id?: string;
    [key: string]: unknown;
  };
  important?: Record<string, unknown>;
  fieldContent?: YzjLightCloudFieldContentItem[];
  [key: string]: unknown;
}

export interface YzjLightCloudListResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: YzjLightCloudRecord[];
}

export interface YzjLightCloudBatchSaveResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?:
    | string[]
    | {
        hasException?: boolean;
        formInstIds?: Array<string | null>;
        exceptions?: Record<string, unknown>;
      };
}

export interface YzjLightCloudBatchDeleteResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: string[];
}

export interface YzjLightCloudSearchPage {
  pageNumber: number;
  totalPages: number;
  pageSize: number;
  totalElements: number;
  content: YzjLightCloudRecord[];
}

export interface YzjLightCloudSearchResponse {
  success: boolean;
  errorCode: number;
  error?: string | null;
  data?: Partial<YzjLightCloudSearchPage>;
}

export interface ShadowLiveRecordField {
  codeId: string;
  title: string | null;
  type: string | null;
  value: unknown;
  rawValue: unknown;
  parentCodeId: string | null;
}

export interface ShadowLiveRecord {
  formInstId: string;
  important: Record<string, unknown>;
  fields: ShadowLiveRecordField[];
  fieldMap: Record<string, ShadowLiveRecordField>;
  rawRecord: YzjLightCloudRecord;
}

export interface ShadowExecuteSearchResponse {
  objectKey: ShadowObjectKey;
  operation: 'search';
  mode: 'live';
  requestBody: Record<string, unknown>;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalElements: number;
  records: ShadowLiveRecord[];
}

export interface ShadowExecuteGetResponse {
  objectKey: ShadowObjectKey;
  operation: 'get';
  mode: 'live';
  requestBody: Record<string, unknown>;
  record: ShadowLiveRecord;
}

export interface ShadowExecuteUpsertResponse {
  objectKey: ShadowObjectKey;
  operation: 'upsert';
  mode: 'live';
  writeMode: ShadowPreviewUpsertInput['mode'];
  requestBody: Record<string, unknown>;
  formInstIds: string[];
}

export interface ShadowExecuteDeleteResponse {
  objectKey: ShadowObjectKey;
  operation: 'delete';
  mode: 'live';
  requestBody: Record<string, unknown>;
  formInstIds: string[];
}

export interface ManualDictionaryEntry {
  dicId: string;
  title: string;
  code?: string;
  state?: string;
  sort?: number;
  aliases?: string[];
}

export interface ManualDictionaryDefinition {
  referId: string;
  title: string;
  aliases?: string[];
  entries: ManualDictionaryEntry[];
}

export interface ManualDictionaryFile {
  version?: string;
  dictionaries: ManualDictionaryDefinition[];
}
