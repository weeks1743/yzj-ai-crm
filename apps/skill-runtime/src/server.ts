import { createSkillRuntimeServer } from './app.js';
import { ArtifactStore } from './artifact-store.js';
import { loadAppConfig } from './config.js';
import { openDatabase } from './database.js';
import { DeepSeekChatCompletionClient } from './deepseek-client.js';
import { probeDependencies } from './dependency-probe.js';
import {
  DocmeeClient,
  type DocmeeAiLayoutResponse,
  type DocmeeApiTokenResponse,
  type DocmeeContentResponse,
  type DocmeeConvertResultResponse,
  type DocmeeCreateTaskResponse,
  type DocmeeLatestDataResponse,
  type DocmeeOptionsResponse,
  type DocmeePresentationInfo,
} from './docmee-client.js';
import { JobRepository } from './job-repository.js';
import { loadSkillsFromDirectories } from './skill-loader.js';
import { SkillCatalogService } from './skill-catalog-service.js';
import { SkillExecutor } from './skill-executor.js';
import { SkillRuntimeService } from './skill-runtime-service.js';
import { VolcWebSearchClient } from './volc-web-search-client.js';
import type {
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  WebSearchClient,
} from './contracts.js';
import { ConfigError } from './errors.js';

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

class DisabledChatClient implements ChatCompletionClient {
  async createChatCompletion(_input: ChatCompletionRequest): Promise<ChatCompletionResult> {
    throw new ConfigError('DEEPSEEK_API_KEY 未配置，无法执行 skill job');
  }
}

class DisabledWebSearchClient implements WebSearchClient {
  async search(): Promise<never> {
    throw new ConfigError('ARK_API_KEY 未配置，无法执行联网搜索');
  }
}

class DisabledDocmeeClient extends DocmeeClient {
  constructor() {
    super({
      baseUrl: 'https://open.docmee.cn',
      apiKey: 'disabled',
    });
  }

  override options(_token?: string): Promise<DocmeeOptionsResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override createTask(): Promise<DocmeeCreateTaskResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override generateContent(): Promise<DocmeeContentResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override updateContent(): Promise<DocmeeContentResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override generatePptxByAi(): Promise<DocmeeAiLayoutResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override generatePptx(): Promise<DocmeePresentationInfo> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override latestData(): Promise<DocmeeLatestDataResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override getConvertResult(): Promise<DocmeeConvertResultResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法执行 super-ppt');
  }

  override createApiToken(): Promise<DocmeeApiTokenResponse> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法创建 super-ppt 编辑会话');
  }

  override downloadPptx(): Promise<DocmeePresentationInfo> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法下载 super-ppt');
  }

  override downloadPptxBinary(): Promise<{ file: Buffer; metadata: DocmeePresentationInfo }> {
    throw new ConfigError('DOCMEE_API_KEY 未配置，无法下载 super-ppt');
  }
}

const config = loadAppConfig();
const database = await openDatabase(config.storage.postgresUrl, config.storage.postgresSchema);
const repository = new JobRepository(database);
const artifactStore = new ArtifactStore(config.storage.artifactDir, repository);
const dependencySnapshot = probeDependencies(config);
const loadedSkills = loadSkillsFromDirectories(config.runtime.skillDirs);
const catalogService = new SkillCatalogService(loadedSkills, dependencySnapshot);

const chatClient: ChatCompletionClient = config.deepseek.apiKey
  ? new DeepSeekChatCompletionClient({
      baseUrl: config.deepseek.baseUrl,
      apiKey: config.deepseek.apiKey,
    })
  : new DisabledChatClient();

const webSearchClient: WebSearchClient = config.ark.apiKey
  ? new VolcWebSearchClient({
      baseUrl: config.ark.baseUrl,
      apiKey: config.ark.apiKey,
      model: config.ark.webSearchModel,
    })
  : new DisabledWebSearchClient();

const docmeeClient: DocmeeClient = config.docmee.apiKey
  ? new DocmeeClient({
      baseUrl: config.docmee.baseUrl,
      apiKey: config.docmee.apiKey,
    })
  : new DisabledDocmeeClient();

const executor = new SkillExecutor({
  config,
  repository,
  artifactStore,
  chatClient,
  webSearchClient,
  docmeeClient,
});

const service = new SkillRuntimeService({
  config,
  catalogService,
  repository,
  artifactStore,
  executor,
  docmeeClient,
});

const server = createSkillRuntimeServer({
  service,
});

server.listen(config.server.port, () => {
  console.log(
    `[skill-runtime] listening on http://127.0.0.1:${config.server.port} (postgres: ${describePostgresConnection(config.storage.postgresUrl, config.storage.postgresSchema)})`,
  );
});
