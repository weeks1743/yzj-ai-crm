import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppConfig,
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  DependencySnapshot,
  FetchLike,
  WebSearchClient,
  WebSearchResult,
} from '../src/contracts.js';
import { createSkillRuntimeServer } from '../src/app.js';
import { ArtifactStore } from '../src/artifact-store.js';
import { openDatabase } from '../src/database.js';
import { JobRepository } from '../src/job-repository.js';
import { loadSkillsFromDirectories } from '../src/skill-loader.js';
import { SkillCatalogService } from '../src/skill-catalog-service.js';
import { SkillExecutor } from '../src/skill-executor.js';
import { SkillRuntimeService } from '../src/skill-runtime-service.js';

export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = resolve(APP_ROOT, '../..');

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeSkillFixture(rootDir: string, skillName: string, skillMd: string, extraFiles: Record<string, string> = {}): string {
  const skillDir = join(rootDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf8');
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const filePath = join(skillDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return skillDir;
}

export function writeTextFixture(rootDir: string, relativePath: string, content: string): string {
  const filePath = join(rootDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function createBasePptxFixture(outputPath: string): string {
  const scriptPath = join(APP_ROOT, 'scripts/create_base_pptx.py');
  const result = spawnSync('python3', [scriptPath, outputPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      `create_base_pptx.py failed: ${result.error?.message || result.stderr || result.stdout || result.status}`,
    );
  }

  return outputPath;
}

export function createDependencySnapshot(overrides: Record<string, boolean> = {}): DependencySnapshot {
  const keys = [
    'env:DEEPSEEK_API_KEY',
    'env:ARK_API_KEY',
    'command:python3',
    'command:markitdown',
    'command:soffice',
    'command:pdftoppm',
    'python_module:markitdown',
    'python_module:PIL',
    'python_module:pptx',
    'python_module:defusedxml',
    'python_module:openpyxl',
  ];

  return {
    checkedAt: new Date().toISOString(),
    details: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          name: key.split(':')[1] || key,
          kind: key.split(':')[0] as 'env' | 'command' | 'python_module',
          available: overrides[key] ?? true,
        },
      ]),
    ),
  };
}

export function createTestConfig(options: {
  rootDir?: string;
  skillDirs: string[];
  allowedRoots?: string[];
  artifactDir?: string;
  sqlitePath?: string;
  deepseekApiKey?: string | null;
  arkApiKey?: string | null;
  arkWebSearchModel?: string;
}): AppConfig {
  const rootDir = options.rootDir ?? createTempDir('skill-runtime-config-');
  const artifactDir = options.artifactDir ?? join(rootDir, 'artifacts');
  return {
    server: {
      port: 0,
    },
    storage: {
      sqlitePath: options.sqlitePath ?? ':memory:',
      artifactDir,
    },
    runtime: {
      allowedRoots: options.allowedRoots ?? [rootDir],
      skillDirs: options.skillDirs,
      outputScanExtensions: ['.md', '.pptx', '.jpg', '.jpeg', '.pdf'],
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.example',
      apiKey: options.deepseekApiKey ?? 'test-deepseek-key',
      defaultModel: 'deepseek-v4-flash',
      allowedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    },
    ark: {
      baseUrl: 'https://ark.example/api/v3',
      apiKey: options.arkApiKey ?? 'test-ark-key',
      webSearchModel: options.arkWebSearchModel ?? 'doubao-seed-2-0-lite-260215',
    },
    meta: {
      configSource: '.env',
      envFilePath: join(rootDir, '.env'),
      rootDir,
    },
  };
}

export class QueueChatClient implements ChatCompletionClient {
  readonly calls: ChatCompletionRequest[] = [];

  constructor(
    private readonly queue: Array<
      ChatCompletionResult | ((input: ChatCompletionRequest) => ChatCompletionResult | Promise<ChatCompletionResult>)
    >,
  ) {}

  async createChatCompletion(input: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(input);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('No queued chat completion response available');
    }

    if (typeof next === 'function') {
      return next(input);
    }

    return next;
  }
}

export class StubWebSearchClient implements WebSearchClient {
  readonly queries: string[] = [];

  constructor(private readonly results: Record<string, WebSearchResult>) {}

  async search(query: string): Promise<WebSearchResult> {
    this.queries.push(query);
    const result = this.results[query];
    if (!result) {
      throw new Error(`No stub result for query: ${query}`);
    }

    return result;
  }
}

export async function waitForJobCompletion(
  baseUrl: string,
  jobId: string,
  timeoutMs = 20_000,
): Promise<any> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const payload = await response.json();
    if (payload.status === 'succeeded' || payload.status === 'failed') {
      return payload;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Timed out waiting for job ${jobId}`);
}

export async function withHtmlServer<T>(
  routes: Record<string, string>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = routes[url.pathname];
    if (!body) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(body);
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

export async function createRuntimeHarness(options: {
  config: AppConfig;
  dependencySnapshot: DependencySnapshot;
  chatClient: ChatCompletionClient;
  webSearchClient: WebSearchClient;
  fetchImpl?: FetchLike;
}) {
  const database = openDatabase(options.config.storage.sqlitePath);
  const repository = new JobRepository(database);
  const artifactStore = new ArtifactStore(options.config.storage.artifactDir, repository);
  const loadedSkills = loadSkillsFromDirectories(options.config.runtime.skillDirs);
  const catalogService = new SkillCatalogService(loadedSkills, options.dependencySnapshot);
  const executor = new SkillExecutor({
    config: options.config,
    repository,
    artifactStore,
    chatClient: options.chatClient,
    webSearchClient: options.webSearchClient,
    fetchImpl: options.fetchImpl,
  });
  const service = new SkillRuntimeService({
    config: options.config,
    catalogService,
    repository,
    artifactStore,
    executor,
  });
  const server = createSkillRuntimeServer({ service });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    server,
    service,
    repository,
    artifactStore,
    loadedSkills,
    close: async () => {
      server.close();
      await once(server, 'close');
      if (options.config.storage.sqlitePath !== ':memory:') {
        rmSync(options.config.storage.sqlitePath, { force: true });
      }
      rmSync(options.config.storage.artifactDir, { recursive: true, force: true });
    },
  };
}
