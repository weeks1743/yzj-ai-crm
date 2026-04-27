export const SUPPORTED_DEEPSEEK_MODELS = [
  'deepseek-v4-pro',
  'deepseek-v4-flash',
] as const;

export type SupportedDeepseekModel = (typeof SUPPORTED_DEEPSEEK_MODELS)[number];

export type SkillStatus = 'available' | 'blocked' | 'unsupported_yet';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export interface AppConfig {
  server: {
    port: number;
  };
  storage: {
    sqlitePath: string;
    artifactDir: string;
  };
  runtime: {
    allowedRoots: string[];
    skillDirs: string[];
    outputScanExtensions: string[];
  };
  deepseek: {
    baseUrl: string;
    apiKey: string | null;
    defaultModel: SupportedDeepseekModel;
    allowedModels: SupportedDeepseekModel[];
  };
  ark: {
    baseUrl: string;
    apiKey: string | null;
    webSearchModel: string;
  };
  docmee: {
    baseUrl: string;
    apiKey: string | null;
    editorTokenHours: number;
  };
  meta: {
    configSource: '.env';
    envFilePath: string;
    rootDir: string;
  };
}

export interface SkillProfile {
  skillName: string;
  displayName: string;
  description: string;
  whenToUse?: string;
  arguments: string[];
  allowedTools: string[];
  baseDir: string;
  supportFiles: string[];
  examples: string[];
  hasTemplate: boolean;
}

export interface SkillCatalogEntry {
  skillName: string;
  status: SkillStatus;
  profile: SkillProfile;
  supportsInvoke: boolean;
  requiredDependencies: string[];
  missingDependencies: string[];
  summary: string;
}

export interface HealthResponse {
  status: 'ok';
  service: '@yzj-ai-crm/skill-runtime';
  port: number;
  sqlitePath: string;
  artifactDir: string;
  dependencySummary: {
    available: number;
    missing: number;
  };
}

export interface ModelDescriptor {
  name: SupportedDeepseekModel;
  label: string;
  isDefault: boolean;
}

export interface CreateJobRequest {
  skillName?: string;
  requestText?: string;
  model?: string;
  attachments?: string[];
  workingDirectory?: string;
  templateId?: string;
  presentationPrompt?: string;
}

export interface JobEvent {
  id: string;
  type:
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
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface JobArtifact {
  artifactId: string;
  jobId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  downloadPath: string;
}

export interface JobResponse {
  jobId: string;
  skillName: string;
  model: string | null;
  status: JobStatus;
  finalText: string | null;
  events: JobEvent[];
  artifacts: JobArtifact[];
  error: ApiErrorResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredJobRecord {
  jobId: string;
  skillName: string;
  model: string | null;
  requestText: string;
  attachments: string[];
  workingDirectory: string | null;
  templateId: string | null;
  presentationPrompt: string | null;
  status: JobStatus;
  finalText: string | null;
  error: ApiErrorResponse | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DependencyDetail {
  name: string;
  kind: 'command' | 'python_module' | 'env';
  available: boolean;
  version?: string;
  error?: string;
}

export interface DependencySnapshot {
  checkedAt: string;
  details: Record<string, DependencyDetail>;
}

export interface LoadedSkill {
  skillName: string;
  skillFilePath: string;
  rawContent: string;
  promptContent: string;
  frontmatter: Record<string, unknown>;
  profile: SkillProfile;
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: SupportedDeepseekModel;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ChatToolCall[];
  raw?: unknown;
}

export interface ChatCompletionClient {
  createChatCompletion(input: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  provider: 'ark-web-search';
  query: string;
  summary: string;
  results: WebSearchResultItem[];
  raw?: unknown;
}

export interface WebSearchClient {
  search(query: string, options?: { maxResults?: number }): Promise<WebSearchResult>;
}

export interface WebFetchExtractResult {
  url: string;
  title: string;
  contentMarkdown: string;
  plainText: string;
  links: Array<{ text: string; url: string }>;
  fetchedAt: string;
}

export interface PresentationSessionResponse {
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

export interface PresentationSessionRequest {
  clientId?: string;
  clientLabel?: string;
  takeover?: boolean;
}

export interface PresentationSessionHeartbeatRequest {
  clientId?: string;
  clientLabel?: string;
}

export interface PresentationSessionHeartbeatResponse {
  status: 'ok';
  jobId: string;
  clientId: string;
  expiresAt: string;
  leaseExpireAt: string;
}

export interface PresentationSessionCloseRequest {
  clientId?: string;
}

export interface PresentationSessionCloseResponse {
  status: 'closed';
  jobId: string;
  clientId: string;
  released: boolean;
}

export interface PresentationSessionHolder {
  clientId: string;
  clientLabel: string;
  lastActiveAt: string;
  leaseExpireAt: string;
}
