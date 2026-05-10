import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  AppConfig,
  ShadowDictionarySource,
  ShadowObjectConfig,
  ShadowObjectKey,
  SkillRuntimeModelName,
} from './contracts.js';
import { ConfigError } from './errors.js';

export const ADMIN_API_REQUIRED_ENV_KEYS = [
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

export const ADMIN_API_REQUIRED_CONNECTION_ENV_KEYS = [
  'ADMIN_API_POSTGRES_URL',
  'SKILL_RUNTIME_POSTGRES_URL',
  'MONGODB_URI',
  'QDRANT_URL',
  'SKILL_RUNTIME_BASE_URL',
  'TONGYI_AUDIO_SERVICE_BASE_URL',
] as const;

export const ADMIN_API_ENV_CONTRACT_KEYS = [
  ...ADMIN_API_REQUIRED_ENV_KEYS,
  ...ADMIN_API_REQUIRED_CONNECTION_ENV_KEYS,
  'YZJ_APPROVAL_FILE_SECRET',
  'YZJ_SHADOW_CONTACT_FORM_CODE_ID',
  'YZJ_SHADOW_OPPORTUNITY_FORM_CODE_ID',
  'YZJ_SHADOW_FOLLOWUP_FORM_CODE_ID',
  'YZJ_SHADOW_DICTIONARY_SOURCE',
  'YZJ_SHADOW_DICTIONARY_JSON_PATH',
  'YZJ_SHADOW_SKILL_OUTPUT_DIR',
  'EXT_IMAGE_BASE_URL',
  'EXT_IMAGE_API_KEY',
  'EXT_IMAGE_MODEL',
  'EXT_IMAGE_TIMEOUT_MS',
  'TONGYI_AUDIO_SERVICE_PORT',
  'TONGYI_AUDIO_PUBLIC_BASE_URL',
  'REPORT_CANVAS_SERVICE_BASE_URL',
  'REPORT_CANVAS_PUBLIC_BASE_URL',
  'REPORT_CANVAS_SERVICE_PORT',
  'REPORT_CANVAS_TIMEOUT_MS',
  'REPORT_CANVAS_POLL_INTERVAL_MS',
  'TONGYI_DASHSCOPE_API_KEY',
  'TONGYI_TINGWU_APP_ID',
  'TONGYI_AUDIO_OUTPUT_DIR',
  'TONGYI_AUDIO_FIXTURE_OUTPUT_DIR',
  'ADMIN_API_PORT',
  'ADMIN_API_POSTGRES_SCHEMA',
  'MONGODB_DB',
  'QDRANT_API_KEY',
  'QDRANT_COLLECTION',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_EMBEDDING_BASE_URL',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'SKILL_RUNTIME_PORT',
  'SKILL_RUNTIME_POSTGRES_SCHEMA',
  'SKILL_RUNTIME_ARTIFACT_DIR',
  'SKILL_RUNTIME_ALLOWED_ROOTS',
  'SKILL_RUNTIME_SKILL_DIRS',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_DEFAULT_MODEL',
  'ARK_BASE_URL',
  'ARK_API_KEY',
  'ARK_WEB_SEARCH_MODEL',
] as const;

const ENV_COMPATIBILITY_HINTS = [
  '本地 .env 与 Docker env 使用同名 key；连接地址按运行环境填写。',
  '本地开发通常使用 127.0.0.1 和宿主机映射端口。',
  'Docker 部署通常使用 Compose 服务名和容器内部端口，例如 postgres:5432、mongodb:27017、qdrant:6333、skill-runtime:3012。',
  '真实密钥和数据库密码只写入未提交的 .env 或 .env.production，不要写入 Git。',
];

const DEFAULT_REPORT_CANVAS_SERVICE_BASE_URL = 'http://127.0.0.1:3020';
const DEFAULT_REPORT_CANVAS_PUBLIC_BASE_URL = 'http://localhost:3020';

const PLACEHOLDER_VALUE_PATTERN = /^(?:your[_-].*|<.+>|请填写.*|待填写.*|xxx+|placeholder)$/i;

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
    enabled: true,
  },
  followup: {
    label: '商机跟进记录',
    envKey: 'YZJ_SHADOW_FOLLOWUP_FORM_CODE_ID',
    enabled: true,
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
  envFilePath: string,
): Record<string, string> {
  const missingKeys = keys.filter((key) => !env[key]?.trim());
  const placeholderKeys = keys.filter((key) => {
    const value = env[key]?.trim();
    return Boolean(value && PLACEHOLDER_VALUE_PATTERN.test(value));
  });

  if (missingKeys.length > 0 || placeholderKeys.length > 0) {
    throw new ConfigError(
      `缺少或未正确配置必填环境变量: ${[...missingKeys, ...placeholderKeys].join(', ')}`,
      {
        envFilePath,
        missingKeys,
        placeholderKeys,
        hints: ENV_COMPATIBILITY_HINTS,
      },
    );
  }

  return Object.fromEntries(
    keys.map((key) => [key, env[key]!.trim()]),
  ) as Record<string, string>;
}

function parsePostgresUrl(value: string, key: string, envFilePath: string): string {
  const url = parseUrlValue(value, key, envFilePath);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须使用 postgresql:// 或 postgres://');
  }
  if (!url.hostname || !url.pathname.replace(/^\/+/, '')) {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须包含主机名和数据库名');
  }
  return value.trim();
}

function parseMongoUri(value: string, key: string, envFilePath: string): string {
  const url = parseUrlValue(value, key, envFilePath);
  if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须使用 mongodb:// 或 mongodb+srv://');
  }
  if (!url.hostname) {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须包含主机名');
  }
  return value.trim();
}

function parseHttpBaseUrl(value: string, key: string, envFilePath: string): string {
  const url = parseUrlValue(value, key, envFilePath);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须使用 http:// 或 https://');
  }
  if (!url.hostname) {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须包含主机名');
  }
  return value.trim().replace(/\/+$/, '');
}

function parseUrlValue(value: string, key: string, envFilePath: string): URL {
  try {
    return new URL(value.trim());
  } catch {
    throw buildInvalidConnectionEnvError(key, envFilePath, '必须是合法 URL');
  }
}

function buildInvalidConnectionEnvError(key: string, envFilePath: string, reason: string): ConfigError {
  return new ConfigError(
    `环境变量 ${key} 配置无效: ${reason}`,
    {
      envFilePath,
      invalidKeys: [key],
      hints: ENV_COMPATIBILITY_HINTS,
    },
  );
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

function parseSkillRuntimeModel(value: string | undefined): SkillRuntimeModelName {
  const candidate = (value?.trim() || 'deepseek-v4-flash') as SkillRuntimeModelName;
  if (candidate === 'deepseek-v4-pro' || candidate === 'deepseek-v4-flash') {
    return candidate;
  }

  throw new ConfigError('DEEPSEEK_DEFAULT_MODEL 必须是 deepseek-v4-pro 或 deepseek-v4-flash');
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

function parsePostgresSchema(value: string | undefined, fallbackValue: string, label: string): string {
  const schema = (value?.trim() || fallbackValue).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new ConfigError(`${label} 必须是合法 PostgreSQL schema 名称`);
  }
  return schema;
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
  const requiredEnv = getRequiredEnv(
    env,
    [...ADMIN_API_REQUIRED_ENV_KEYS, ...ADMIN_API_REQUIRED_CONNECTION_ENV_KEYS],
    envFilePath,
  );
  const adminPostgresUrl = parsePostgresUrl(
    requiredEnv.ADMIN_API_POSTGRES_URL,
    'ADMIN_API_POSTGRES_URL',
    envFilePath,
  );
  parsePostgresUrl(
    requiredEnv.SKILL_RUNTIME_POSTGRES_URL,
    'SKILL_RUNTIME_POSTGRES_URL',
    envFilePath,
  );
  const mongodbUri = parseMongoUri(
    requiredEnv.MONGODB_URI,
    'MONGODB_URI',
    envFilePath,
  );
  const qdrantUrl = parseHttpBaseUrl(
    requiredEnv.QDRANT_URL,
    'QDRANT_URL',
    envFilePath,
  );
  const skillRuntimeBaseUrl = parseHttpBaseUrl(
    requiredEnv.SKILL_RUNTIME_BASE_URL,
    'SKILL_RUNTIME_BASE_URL',
    envFilePath,
  );
  const tongyiAudioServiceBaseUrl = parseHttpBaseUrl(
    requiredEnv.TONGYI_AUDIO_SERVICE_BASE_URL,
    'TONGYI_AUDIO_SERVICE_BASE_URL',
    envFilePath,
  );
  const tongyiAudioPublicBaseUrl = env.TONGYI_AUDIO_PUBLIC_BASE_URL?.trim()
    ? parseHttpBaseUrl(env.TONGYI_AUDIO_PUBLIC_BASE_URL, 'TONGYI_AUDIO_PUBLIC_BASE_URL', envFilePath)
    : tongyiAudioServiceBaseUrl;
  const reportCanvasServiceBaseUrl = parseHttpBaseUrl(
    env.REPORT_CANVAS_SERVICE_BASE_URL || DEFAULT_REPORT_CANVAS_SERVICE_BASE_URL,
    'REPORT_CANVAS_SERVICE_BASE_URL',
    envFilePath,
  );
  const reportCanvasPublicBaseUrl = env.REPORT_CANVAS_PUBLIC_BASE_URL?.trim()
    ? parseHttpBaseUrl(env.REPORT_CANVAS_PUBLIC_BASE_URL, 'REPORT_CANVAS_PUBLIC_BASE_URL', envFilePath)
    : parseHttpBaseUrl(DEFAULT_REPORT_CANVAS_PUBLIC_BASE_URL, 'REPORT_CANVAS_PUBLIC_BASE_URL', envFilePath);

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
      postgresUrl: adminPostgresUrl,
      postgresSchema: parsePostgresSchema(
        env.ADMIN_API_POSTGRES_SCHEMA,
        'admin_api',
        'ADMIN_API_POSTGRES_SCHEMA',
      ),
      mongodbUri,
      mongodbDb: (env.MONGODB_DB || 'yzj_ai_crm_dev').trim(),
    },
    qdrant: {
      url: qdrantUrl,
      apiKey: env.QDRANT_API_KEY?.trim() || null,
      collectionName: (env.QDRANT_COLLECTION || 'yzj_artifact_chunks').trim(),
    },
    embedding: {
      baseUrl: (
        env.DASHSCOPE_EMBEDDING_BASE_URL ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1'
      ).trim(),
      apiKey: env.DASHSCOPE_API_KEY?.trim() || null,
      model: (env.EMBEDDING_MODEL || 'text-embedding-v4').trim(),
      dimensions: parsePositiveInteger(
        env.EMBEDDING_DIMENSIONS,
        1024,
        'EMBEDDING_DIMENSIONS',
      ),
    },
    deepseek: {
      baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim(),
      apiKey: env.DEEPSEEK_API_KEY?.trim() || null,
      defaultModel: parseSkillRuntimeModel(env.DEEPSEEK_DEFAULT_MODEL),
    },
    external: {
      image: {
        baseUrl: (env.EXT_IMAGE_BASE_URL || 'https://api.linkapi.org').trim(),
        apiKey: env.EXT_IMAGE_API_KEY?.trim() || null,
        model: (env.EXT_IMAGE_MODEL || 'gpt-image-2').trim(),
        timeoutMs: parsePositiveInteger(
          env.EXT_IMAGE_TIMEOUT_MS,
          150000,
          'EXT_IMAGE_TIMEOUT_MS',
        ),
      },
      skillRuntime: {
        baseUrl: skillRuntimeBaseUrl,
      },
      tongyiAudioService: {
        baseUrl: tongyiAudioServiceBaseUrl,
        publicBaseUrl: tongyiAudioPublicBaseUrl,
      },
      reportCanvasService: {
        baseUrl: reportCanvasServiceBaseUrl,
        publicBaseUrl: reportCanvasPublicBaseUrl,
      },
    },
    meta: {
      configSource: '.env',
      envFilePath,
    },
  };
}
