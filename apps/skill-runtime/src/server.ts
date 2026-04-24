import { createSkillRuntimeServer } from './app.js';
import { ArtifactStore } from './artifact-store.js';
import { loadAppConfig } from './config.js';
import { openDatabase } from './database.js';
import { DeepSeekChatCompletionClient } from './deepseek-client.js';
import { probeDependencies } from './dependency-probe.js';
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

const config = loadAppConfig();
const database = openDatabase(config.storage.sqlitePath);
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

const executor = new SkillExecutor({
  config,
  repository,
  artifactStore,
  chatClient,
  webSearchClient,
});

const service = new SkillRuntimeService({
  config,
  catalogService,
  repository,
  artifactStore,
  executor,
});

const server = createSkillRuntimeServer({
  service,
});

server.listen(config.server.port, () => {
  console.log(
    `[skill-runtime] listening on http://127.0.0.1:${config.server.port} (sqlite: ${config.storage.sqlitePath})`,
  );
});
