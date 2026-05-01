import { dirname, resolve } from 'node:path';
import { ApprovalFileClient } from './approval-file-client.js';
import { ApprovalFileService } from './approval-file-service.js';
import { ApprovalClient } from './approval-client.js';
import { AgentObservabilityService } from './agent-observability-service.js';
import { AgentConversationService } from './agent-conversation-service.js';
import { AgentRunRepository } from './agent-run-repository.js';
import { MainAgentRuntime } from './agent-runtime.js';
import { AgentService } from './agent-service.js';
import { ArtifactPresentationRepository } from './artifact-presentation-repository.js';
import { ArtifactPresentationService } from './artifact-presentation-service.js';
import { ArtifactRepository } from './artifact-repository.js';
import { ArtifactService } from './artifact-service.js';
import { createAdminApiServer } from './app.js';
import { loadAppConfig } from './config.js';
import { createCrmAgentRuntimeParts } from './crm-agent-pack.js';
import { openDatabase } from './database.js';
import { DashScopeEmbeddingService } from './dashscope-embedding-service.js';
import { DeepSeekChatClient } from './deepseek-chat-client.js';
import { DictionaryResolver } from './dictionary-resolver.js';
import { DocmeeTemplateClient } from './docmee-template-client.js';
import { EnterprisePptTemplateRepository } from './enterprise-ppt-template-repository.js';
import { EnterprisePptTemplateService } from './enterprise-ppt-template-service.js';
import { ExternalSkillService } from './external-skill-service.js';
import { LightCloudClient } from './lightcloud-client.js';
import { OrgSyncRepository } from './org-sync-repository.js';
import { OrgSyncService } from './org-sync-service.js';
import { QdrantVectorService } from './qdrant-vector-service.js';
import { ShadowMetadataRepository } from './shadow-metadata-repository.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';
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

const config = loadAppConfig();
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
const enterprisePptTemplateService = new EnterprisePptTemplateService({
  config,
  repository: new EnterprisePptTemplateRepository(database),
  client: config.docmee.apiKey
    ? new DocmeeTemplateClient({
        baseUrl: config.docmee.baseUrl,
        apiKey: config.docmee.apiKey,
      })
    : null,
});
const externalSkillService = new ExternalSkillService({
  config,
  enterprisePptTemplateResolver: enterprisePptTemplateService,
});
const embeddingService = new DashScopeEmbeddingService(config);
const artifactService = new ArtifactService({
  config,
  repository: new ArtifactRepository(config),
  embeddingService,
  vectorService: new QdrantVectorService(config),
});
const artifactPresentationService = new ArtifactPresentationService({
  config,
  repository: new ArtifactPresentationRepository(database),
  artifactService,
  externalSkillService,
});
const agentRunRepository = new AgentRunRepository(database);
const agentObservabilityService = new AgentObservabilityService(agentRunRepository);
const agentConversationService = new AgentConversationService(agentRunRepository);
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
  orgSyncService,
  orgSyncRepository,
  approvalFileService,
  shadowMetadataService,
  externalSkillService,
  enterprisePptTemplateService,
  artifactService,
  artifactPresentationService,
  agentService,
  agentConversationService,
  agentObservabilityService,
});

server.listen(config.server.port, () => {
  console.log(
    `[admin-api] listening on http://127.0.0.1:${config.server.port} (postgres: ${describePostgresConnection(config.storage.postgresUrl, config.storage.postgresSchema)})`,
  );
});
