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

export function loadAppConfig(options: LoadAppConfigOptions = {}): AppConfig {
  const envFilePath = options.envFilePath ?? findEnvFile();

  if (!options.env && existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }

  const env = options.env ?? process.env;
  const rootDir = dirname(envFilePath);
  const defaultModel = parseDeepseekDefaultModel(env.DEEPSEEK_DEFAULT_MODEL);

  return {
    server: {
      port: parsePort(env.SKILL_RUNTIME_PORT),
    },
    storage: {
      sqlitePath: resolve(
        rootDir,
        env.SKILL_RUNTIME_SQLITE_PATH || '.local/skill-runtime.sqlite',
      ),
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
    meta: {
      configSource: '.env',
      envFilePath,
      rootDir,
    },
  };
}
