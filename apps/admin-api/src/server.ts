import { dirname, resolve } from 'node:path';
import { ApprovalFileClient } from './approval-file-client.js';
import { ApprovalFileService } from './approval-file-service.js';
import { ApprovalClient } from './approval-client.js';
import { AgentObservabilityService } from './agent-observability-service.js';
import { AgentConversationService } from './agent-conversation-service.js';
import { AgentPersonalSettingsService } from './agent-personal-settings-service.js';
import { AgentRunRepository } from './agent-run-repository.js';
import { MainAgentRuntime } from './agent-runtime.js';
import { AgentService } from './agent-service.js';
import { ArtifactImageRepository } from './artifact-image-repository.js';
import { ArtifactImageService } from './artifact-image-service.js';
import { ArtifactReportRepository } from './artifact-report-repository.js';
import { ArtifactReportService } from './artifact-report-service.js';
import { ArtifactRepository } from './artifact-repository.js';
import { ArtifactService } from './artifact-service.js';
import { createAdminApiServer } from './app.js';
import { loadAppConfig } from './config.js';
import { createCrmAgentRuntimeParts } from './crm-agent-pack.js';
import { openDatabase } from './database.js';
import { ConfigError } from './errors.js';
import { DashScopeEmbeddingService } from './dashscope-embedding-service.js';
import { DeepSeekChatClient } from './deepseek-chat-client.js';
import { DictionaryResolver } from './dictionary-resolver.js';
import { ExternalSkillService } from './external-skill-service.js';
import { LightCloudClient } from './lightcloud-client.js';
import { OrgSyncRepository } from './org-sync-repository.js';
import { OrgSyncService } from './org-sync-service.js';
import { QdrantVectorService } from './qdrant-vector-service.js';
import { RecordingTaskRepository } from './recording-task-repository.js';
import { RecordingTaskService } from './recording-task-service.js';
import { ShadowMetadataRepository } from './shadow-metadata-repository.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';
import { TongyiAudioServiceClient } from './tongyi-audio-service-client.js';
import { IntentFrameService } from './intent-frame-service.js';
import { YzjClient } from './yzj-client.js';

function describePostgresConnection(connectionString: string, schema: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname || 'localhost';
    const port = url.port ? `:${url.port}` : '';
    const database = url.pathname.replace(/^\/+/, '') || 'postgres';
    return `${host}${port}/${database}#${schema}`;
  } catch {
    return `postgres#${schema}`;
  }
}

function loadConfigForStartup() {
  try {
    return loadAppConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logStartupConfigError(error);
      process.exit(1);
    }
    throw error;
  }
}

function logStartupConfigError(error: ConfigError): void {
  const details = readConfigErrorDetails(error.details);
  console.error(`[admin-api] 配置加载失败: ${error.message}`);
  if (details.envFilePath) {
    console.error(`[admin-api] env 文件: ${details.envFilePath}`);
  }
  if (details.missingKeys.length) {
    console.error(`[admin-api] 缺失或为空: ${details.missingKeys.join(', ')}`);
  }
  if (details.placeholderKeys.length) {
    console.error(`[admin-api] 仍为示例占位值: ${details.placeholderKeys.join(', ')}`);
  }
  if (details.invalidKeys.length) {
    console.error(`[admin-api] 格式无效: ${details.invalidKeys.join(', ')}`);
  }
  for (const hint of details.hints) {
    console.error(`[admin-api] 提示: ${hint}`);
  }
}

function readConfigErrorDetails(details: unknown): {
  envFilePath: string | null;
  missingKeys: string[];
  placeholderKeys: string[];
  invalidKeys: string[];
  hints: string[];
} {
  if (!details || typeof details !== 'object') {
    return {
      envFilePath: null,
      missingKeys: [],
      placeholderKeys: [],
      invalidKeys: [],
      hints: [],
    };
  }
  const record = details as Record<string, unknown>;
  return {
    envFilePath: typeof record.envFilePath === 'string' ? record.envFilePath : null,
    missingKeys: readStringList(record.missingKeys),
    placeholderKeys: readStringList(record.placeholderKeys),
    invalidKeys: readStringList(record.invalidKeys),
    hints: readStringList(record.hints),
  };
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const config = loadConfigForStartup();
const database = await openDatabase(config.storage.postgresUrl, config.storage.postgresSchema);

const orgSyncRepository = new OrgSyncRepository(database);
await orgSyncRepository.markRunningRunsAsFailed('admin-api 重启前有同步未完成，已自动标记为失败');

const orgSyncService = new OrgSyncService({
  config,
  repository: orgSyncRepository,
  client: new YzjClient({
    baseUrl: config.yzj.baseUrl,
  }),
});

const approvalClient = new ApprovalClient({
  baseUrl: config.yzj.baseUrl,
});
const approvalFileService = new ApprovalFileService({
  config,
  client: new ApprovalFileClient({
    baseUrl: config.yzj.baseUrl,
  }),
});
const shadowMetadataService = new ShadowMetadataService({
  config,
  repository: new ShadowMetadataRepository(database),
  approvalClient,
  lightCloudClient: new LightCloudClient({
    baseUrl: config.yzj.baseUrl,
  }),
  orgSyncRepository,
  dictionaryResolver: new DictionaryResolver({
    source: config.shadow.dictionarySource,
    jsonPath: config.shadow.dictionaryJsonPath,
    approvalClient,
    fieldBoundWorkbookPath: resolve(
      dirname(config.meta.envFilePath),
      'yzj-api/省市区数据信息.xlsx',
    ),
  }),
});
await shadowMetadataService.initialize();
const externalSkillService = new ExternalSkillService({
  config,
});
const embeddingService = new DashScopeEmbeddingService(config);
const artifactService = new ArtifactService({
  config,
  repository: new ArtifactRepository(config),
  embeddingService,
  vectorService: new QdrantVectorService(config),
});
const artifactImageService = new ArtifactImageService({
  config,
  repository: new ArtifactImageRepository(database),
  artifactService,
  externalSkillService,
});
const artifactReportService = new ArtifactReportService({
  config,
  repository: new ArtifactReportRepository(database),
  artifactService,
  externalSkillService,
});
const recordingTaskService = new RecordingTaskService({
  config,
  repository: new RecordingTaskRepository(database),
  client: new TongyiAudioServiceClient({
    baseUrl: config.external.tongyiAudioService.baseUrl,
  }),
  artifactService,
  externalSkillService,
});
const agentRunRepository = new AgentRunRepository(database);
const agentObservabilityService = new AgentObservabilityService(agentRunRepository);
const agentConversationService = new AgentConversationService(agentRunRepository);
const agentPersonalSettingsService = new AgentPersonalSettingsService({
  config,
  database,
  orgSyncRepository,
});
const agentRuntimeParts = createCrmAgentRuntimeParts({
  config,
  repository: agentRunRepository,
  intentFrameService: new IntentFrameService({
    config,
    chatClient: new DeepSeekChatClient(config),
  }),
  shadowMetadataService,
  orgSyncRepository,
  externalSkillService,
  artifactService,
  recordingTaskService,
});
const agentRuntime = new MainAgentRuntime({
  config,
  registry: agentRuntimeParts.registry,
  intentResolver: agentRuntimeParts.intentResolver,
  planner: agentRuntimeParts.planner,
  embeddingProvider: {
    providerName: 'dashscope.embedding',
    isConfigured: () => embeddingService.isConfigured(),
    embedTexts: (texts) => embeddingService.embedTexts(texts),
  },
});
const agentService = new AgentService({
  config,
  repository: agentRunRepository,
  runtime: agentRuntime,
});

const server = createAdminApiServer({
  config,
  yzjClient: new YzjClient({
    baseUrl: config.yzj.baseUrl,
  }),
  orgSyncService,
  orgSyncRepository,
  approvalFileService,
  shadowMetadataService,
  externalSkillService,
  artifactService,
  artifactReportService,
  artifactImageService,
  recordingTaskService,
  agentService,
  agentConversationService,
  agentPersonalSettingsService,
  agentObservabilityService,
});

server.listen(config.server.port, () => {
  console.log(
    `[admin-api] listening on http://127.0.0.1:${config.server.port} (postgres: ${describePostgresConnection(config.storage.postgresUrl, config.storage.postgresSchema)})`,
  );
});
