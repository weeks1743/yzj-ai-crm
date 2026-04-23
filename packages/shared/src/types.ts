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

export interface ShadowObjectMeta {
  key: string;
  label: string;
  templateId: string;
  codeId: string;
  skillVersion: string;
  fieldCount: number;
  generationStatus: string;
  confirmationPolicy: string;
  writebackRate: string;
  writableFields: string[];
  readonlyFields: string[];
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
  meta: ShadowObjectMeta;
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

export interface ToolRegistryItem {
  id: string;
  objectKey: string;
  label: string;
  templateId: string;
  codeId: string;
  generationStatus: string;
  writableFields: string[];
  readonlyFields: string[];
  confirmationPolicy: string;
  version: string;
  updatedAt: string;
}

export interface SkillCatalogItem {
  id: string;
  label: string;
  type: '场景技能' | '外部技能';
  trigger: string;
  route: string;
  dependencies: string[];
  status: string;
  owner: string;
  sla: string;
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
  key: 'chat' | 'audio-import' | 'company-research' | 'visit-prepare' | 'tasks';
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
