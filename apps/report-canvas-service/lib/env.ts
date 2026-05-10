import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

let envLoaded = false;

function findRootEnvFile(startDirectory = process.cwd()): string | null {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidate = resolve(currentDirectory, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

export function loadReportCanvasEnv(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const envFilePath = findRootEnvFile();
  if (envFilePath && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFilePath);
  }
}

export function getDashScopeBaseUrl(): string {
  loadReportCanvasEnv();
  return process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_DASHSCOPE_BASE_URL;
}

export function getReportAiConfigError(): string | null {
  loadReportCanvasEnv();
  if (!process.env.DASHSCOPE_API_KEY?.trim()) {
    return "DASHSCOPE_API_KEY 未配置，无法生成报告。请在项目根目录 .env 中配置 DashScope API Key。";
  }
  return null;
}

export function assertReportAiConfig(): void {
  const message = getReportAiConfigError();
  if (message) {
    throw new Error(message);
  }
}
