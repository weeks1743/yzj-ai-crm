import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  AppConfig,
  ShadowDictionarySource,
  ShadowObjectConfig,
  ShadowObjectKey,
} from './contracts.js';
import { ConfigError } from './errors.js';

const REQUIRED_ENV_KEYS = [
  'YZJ_EID',
  'YZJ_APP_ID',
  'YZJ_APP_SECRET',
  'YZJ_SIGN_KEY',
  'YZJ_ORG_READ_SECRET',
  'YZJ_APPROVAL_APP_ID',
  'YZJ_APPROVAL_APP_SECRET',
  'YZJ_APPROVAL_DEV_KEY',
  'YZJ_LIGHTCLOUD_APP_ID',
  'YZJ_LIGHTCLOUD_APP_SECRET',
  'YZJ_LIGHTCLOUD_SECRET',
  'YZJ_SHADOW_CUSTOMER_FORM_CODE_ID',
] as const;

const SHADOW_OBJECT_META: Record<ShadowObjectKey, { label: string; envKey: string; enabled: boolean }> = {
  customer: {
    label: '客户',
    envKey: 'YZJ_SHADOW_CUSTOMER_FORM_CODE_ID',
    enabled: true,
  },
  contact: {
    label: '联系人',
    envKey: 'YZJ_SHADOW_CONTACT_FORM_CODE_ID',
    enabled: true,
  },
  opportunity: {
    label: '商机',
    envKey: 'YZJ_SHADOW_OPPORTUNITY_FORM_CODE_ID',
    enabled: false,
  },
  followup: {
    label: '商机跟进记录',
    envKey: 'YZJ_SHADOW_FOLLOWUP_FORM_CODE_ID',
    enabled: false,
  },
};

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

function getRequiredEnv(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): Record<string, string> {
  const missingKeys = keys.filter((key) => !env[key]?.trim());

  if (missingKeys.length > 0) {
    throw new ConfigError(`缺少必填环境变量: ${missingKeys.join(', ')}`, { missingKeys });
  }

  return Object.fromEntries(
    keys.map((key) => [key, env[key]!.trim()]),
  ) as Record<string, string>;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3001;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError('ADMIN_API_PORT 必须是正整数');
  }

  return port;
}

function parseDictionarySource(value: string | undefined): ShadowDictionarySource {
  if (!value) {
    return 'manual_json';
  }

  if (value === 'manual_json' || value === 'approval_api' || value === 'hybrid') {
    return value;
  }

  throw new ConfigError(
    'YZJ_SHADOW_DICTIONARY_SOURCE 必须是 manual_json、approval_api 或 hybrid 之一',
  );
}

function buildShadowObjects(env: NodeJS.ProcessEnv): Record<ShadowObjectKey, ShadowObjectConfig> {
  return Object.fromEntries(
    (Object.entries(SHADOW_OBJECT_META) as Array<
      [ShadowObjectKey, { label: string; envKey: string; enabled: boolean }]
    >).map(([key, meta]) => [
      key,
      {
        key,
        label: meta.label,
        formCodeId: env[meta.envKey]?.trim() || null,
        enabled: meta.enabled,
      },
    ]),
  ) as Record<ShadowObjectKey, ShadowObjectConfig>;
}

export function loadAppConfig(options: LoadAppConfigOptions = {}): AppConfig {
  const envFilePath = options.envFilePath ?? findEnvFile();

  if (!options.env && existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }

  const env = options.env ?? process.env;
  const requiredEnv = getRequiredEnv(env, REQUIRED_ENV_KEYS);

  return {
    yzj: {
      eid: requiredEnv.YZJ_EID,
      appId: requiredEnv.YZJ_APP_ID,
      appSecret: requiredEnv.YZJ_APP_SECRET,
      signKey: requiredEnv.YZJ_SIGN_KEY,
      orgReadSecret: requiredEnv.YZJ_ORG_READ_SECRET,
      baseUrl: 'https://www.yunzhijia.com',
      approval: {
        appId: requiredEnv.YZJ_APPROVAL_APP_ID,
        appSecret: requiredEnv.YZJ_APPROVAL_APP_SECRET,
        developerKey: requiredEnv.YZJ_APPROVAL_DEV_KEY,
        fileSecret: env.YZJ_APPROVAL_FILE_SECRET?.trim() || null,
      },
      lightCloud: {
        appId: requiredEnv.YZJ_LIGHTCLOUD_APP_ID,
        appSecret: requiredEnv.YZJ_LIGHTCLOUD_APP_SECRET,
        secret: requiredEnv.YZJ_LIGHTCLOUD_SECRET,
      },
    },
    shadow: {
      dictionarySource: parseDictionarySource(env.YZJ_SHADOW_DICTIONARY_SOURCE),
      dictionaryJsonPath: resolve(
        dirname(envFilePath),
        env.YZJ_SHADOW_DICTIONARY_JSON_PATH || '.local/shadow-dictionaries.json',
      ),
      skillOutputDir: resolve(
        dirname(envFilePath),
        env.YZJ_SHADOW_SKILL_OUTPUT_DIR || 'skills/shadow',
      ),
      objects: buildShadowObjects(env),
    },
    server: {
      port: parsePort(env.ADMIN_API_PORT),
    },
    storage: {
      sqlitePath: resolve(
        dirname(envFilePath),
        env.ORG_SYNC_SQLITE_PATH || '.local/admin-api.sqlite',
      ),
    },
    meta: {
      configSource: '.env',
      envFilePath,
    },
  };
}
