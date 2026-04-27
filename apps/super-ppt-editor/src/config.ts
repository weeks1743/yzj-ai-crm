import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface LoadAppConfigOptions {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}

export interface AppConfig {
  server: {
    port: number;
    baseUrl: string;
  };
  adminApi: {
    baseUrl: string;
  };
  assets: {
    docmeeSdkFilePath: string;
  };
  meta: {
    configSource: '.env';
    envFilePath: string;
    rootDir: string;
  };
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
  if (!value?.trim()) {
    return 8001;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('SUPER_PPT_EDITOR_PORT 必须是正整数');
  }

  return parsed;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function loadAppConfig(options: LoadAppConfigOptions = {}): AppConfig {
  const envFilePath = options.envFilePath ?? findEnvFile();

  if (!options.env && existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }

  const env = options.env ?? process.env;
  const rootDir = dirname(envFilePath);
  const port = parsePort(env.SUPER_PPT_EDITOR_PORT);
  const baseUrl = trimTrailingSlash(
    env.SUPER_PPT_EDITOR_BASE_URL?.trim() || `http://127.0.0.1:${port}`,
  );
  const adminApiBaseUrl = trimTrailingSlash(
    env.SUPER_PPT_EDITOR_ADMIN_API_BASE_URL?.trim()
      || `http://127.0.0.1:${env.ADMIN_API_PORT?.trim() || '3001'}`,
  );

  return {
    server: {
      port,
      baseUrl,
    },
    adminApi: {
      baseUrl: adminApiBaseUrl,
    },
    assets: {
      docmeeSdkFilePath: resolve(
        rootDir,
        '3rd/aippt-ui-ppt-editor-main/static/docmee-ui-sdk-iframe.min.js',
      ),
    },
    meta: {
      configSource: '.env',
      envFilePath,
      rootDir,
    },
  };
}
