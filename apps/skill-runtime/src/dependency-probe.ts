import { spawnSync } from 'node:child_process';
import type { AppConfig, DependencyDetail, DependencySnapshot } from './contracts.js';

function makeKey(kind: DependencyDetail['kind'], name: string): string {
  return `${kind}:${name}`;
}

function runCommand(command: string, args: string[]): {
  available: boolean;
  output: string;
  error?: string;
} {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    return {
      available: false,
      output: '',
      error: result.error.message,
    };
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    available: result.status === 0,
    output,
    error: result.status === 0 ? undefined : output || `退出码 ${result.status}`,
  };
}

function probeCommand(
  name: string,
  args: string[],
  versionPattern?: RegExp,
): [string, DependencyDetail] {
  const result = runCommand(name, args);
  return [
    makeKey('command', name),
    {
      name,
      kind: 'command',
      available: result.available,
      version: result.available
        ? result.output.match(versionPattern ?? /([0-9]+(?:\.[0-9]+)+)/)?.[1]
        : undefined,
      error: result.error,
    },
  ];
}

function probePythonModule(moduleName: string): [string, DependencyDetail] {
  const result = runCommand('python3', [
    '-c',
    `import importlib.util; print(bool(importlib.util.find_spec("${moduleName}")))`,
  ]);
  const available = result.available && result.output.endsWith('True');
  return [
    makeKey('python_module', moduleName),
    {
      name: moduleName,
      kind: 'python_module',
      available,
      error: available ? undefined : result.error || `python 模块 ${moduleName} 不可用`,
    },
  ];
}

function probeEnv(name: string, value: string | null): [string, DependencyDetail] {
  return [
    makeKey('env', name),
    {
      name,
      kind: 'env',
      available: Boolean(value?.trim()),
      error: value?.trim() ? undefined : `${name} 未配置`,
    },
  ];
}

export function getDependencyDetail(
  snapshot: DependencySnapshot,
  dependencyKey: string,
): DependencyDetail | undefined {
  return snapshot.details[dependencyKey];
}

export function probeDependencies(config: AppConfig): DependencySnapshot {
  const details = Object.fromEntries([
    probeEnv('DEEPSEEK_API_KEY', config.deepseek.apiKey),
    probeEnv('ARK_API_KEY', config.ark.apiKey),
    probeCommand('python3', ['--version']),
    probeCommand('soffice', ['--version']),
    probeCommand('pdftoppm', ['-v']),
    probeCommand('markitdown', ['--version']),
    probePythonModule('markitdown'),
    probePythonModule('PIL'),
    probePythonModule('pptx'),
    probePythonModule('openpyxl'),
    probePythonModule('defusedxml'),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    details,
  };
}
