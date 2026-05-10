import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AppConfig, SupportedDeepseekModel } from './contracts.js';
import { SUPPORTED_DEEPSEEK_MODELS } from './contracts.js';
import { ConfigError } from './errors.js';

interface LoadAppConfigOptions {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}

function findEnvFile(startDirectory = process.cwd()): string {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidate = resolve(currentDirectory, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return resolve(startDirectory, '.env');
    }

    currentDirectory = parentDirectory;
  }
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3012;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError('SKILL_RUNTIME_PORT 必须是正整数');
  }

  return port;
}

function parsePositiveInteger(value: string | undefined, fallbackValue: number, label: string): number {
  if (!value) {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${label} 必须是正整数`);
  }

  return parsed;
}

function parseHttpBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConfigError(`${label} 必须是合法 URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${label} 必须使用 http:// 或 https://`);
  }

  if (!url.hostname) {
    throw new ConfigError(`${label} 必须包含主机名`);
  }

  return value.trim().replace(/\/+$/, '');
}

function splitList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(/\r?\n|,|;/)
    .flatMap((item) => item.split(':'))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePathList(
  value: string | undefined,
  baseDir: string,
  fallbackItems: string[],
): string[] {
  const items = splitList(value);
  const source = items.length > 0 ? items : fallbackItems;
  return Array.from(new Set(source.map((item) => resolve(baseDir, item))));
}

function parseDeepseekDefaultModel(
  value: string | undefined,
): SupportedDeepseekModel {
  const candidate = (value?.trim() || 'deepseek-v4-flash') as SupportedDeepseekModel;
  if (SUPPORTED_DEEPSEEK_MODELS.includes(candidate)) {
    return candidate;
  }

  throw new ConfigError(
    `DEEPSEEK_DEFAULT_MODEL 仅支持: ${SUPPORTED_DEEPSEEK_MODELS.join(', ')}`,
  );
}

function parsePostgresSchema(value: string | undefined, fallbackValue: string): string {
  const schema = (value?.trim() || fallbackValue).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new ConfigError('SKILL_RUNTIME_POSTGRES_SCHEMA 必须是合法 PostgreSQL schema 名称');
  }
  return schema;
}

export function loadAppConfig(options: LoadAppConfigOptions = {}): AppConfig {
  const envFilePath = options.envFilePath ?? findEnvFile();

  if (!options.env && existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }

  const env = options.env ?? process.env;
  const rootDir = dirname(envFilePath);
  const defaultModel = parseDeepseekDefaultModel(env.DEEPSEEK_DEFAULT_MODEL);
  const reportCanvasBaseUrl = parseHttpBaseUrl(
    env.REPORT_CANVAS_SERVICE_BASE_URL || 'http://127.0.0.1:3020',
    'REPORT_CANVAS_SERVICE_BASE_URL',
  );
  const reportCanvasPublicBaseUrl = env.REPORT_CANVAS_PUBLIC_BASE_URL?.trim()
    ? parseHttpBaseUrl(env.REPORT_CANVAS_PUBLIC_BASE_URL, 'REPORT_CANVAS_PUBLIC_BASE_URL')
    : reportCanvasBaseUrl;

  return {
    server: {
      port: parsePort(env.SKILL_RUNTIME_PORT),
    },
    storage: {
      postgresUrl: (
        env.SKILL_RUNTIME_POSTGRES_URL
        || 'postgresql://postgres:postgres@127.0.0.1:5432/yzj_ai_crm_dev'
      ).trim(),
      postgresSchema: parsePostgresSchema(env.SKILL_RUNTIME_POSTGRES_SCHEMA, 'skill_runtime'),
      artifactDir: resolve(
        rootDir,
        env.SKILL_RUNTIME_ARTIFACT_DIR || '.local/skill-runtime-artifacts',
      ),
    },
    runtime: {
      allowedRoots: parsePathList(
        env.SKILL_RUNTIME_ALLOWED_ROOTS,
        rootDir,
        ['.'],
      ),
      skillDirs: parsePathList(
        env.SKILL_RUNTIME_SKILL_DIRS,
        rootDir,
        ['3rdSkill'],
      ),
      outputScanExtensions: ['.md', '.pptx', '.jpg', '.jpeg', '.pdf'],
    },
    deepseek: {
      baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim(),
      apiKey: env.DEEPSEEK_API_KEY?.trim() || null,
      defaultModel,
      allowedModels: [...SUPPORTED_DEEPSEEK_MODELS],
    },
    ark: {
      baseUrl: (env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').trim(),
      apiKey: env.ARK_API_KEY?.trim() || null,
      webSearchModel: (env.ARK_WEB_SEARCH_MODEL || 'doubao-seed-2-0-lite-260215').trim(),
    },
    reportCanvas: {
      baseUrl: reportCanvasBaseUrl,
      publicBaseUrl: reportCanvasPublicBaseUrl,
      timeoutMs: parsePositiveInteger(env.REPORT_CANVAS_TIMEOUT_MS, 600000, 'REPORT_CANVAS_TIMEOUT_MS'),
      pollIntervalMs: parsePositiveInteger(env.REPORT_CANVAS_POLL_INTERVAL_MS, 2000, 'REPORT_CANVAS_POLL_INTERVAL_MS'),
    },
    meta: {
      configSource: '.env',
      envFilePath,
      rootDir,
    },
  };
}
