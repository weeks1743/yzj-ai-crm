import { spawnSync } from 'node:child_process';
import { ExternalServiceError } from './errors.js';

interface LocalCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

function formatErrorPayload(
  command: string,
  args: string[],
  result: ReturnType<typeof spawnSync>,
): Record<string, unknown> {
  return {
    command,
    args,
    status: result.status,
    stdout: typeof result.stdout === 'string'
      ? result.stdout
      : Buffer.isBuffer(result.stdout)
        ? result.stdout.toString('utf8')
        : '',
    stderr: typeof result.stderr === 'string'
      ? result.stderr
      : Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8')
        : '',
    error: result.error?.message,
  };
}

export function runLocalCommand(
  command: string,
  args: string[],
  options: LocalCommandOptions = {},
): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 80 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw new ExternalServiceError(`执行本地命令失败: ${command}`, formatErrorPayload(command, args, result));
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function runLocalCommandBuffer(
  command: string,
  args: string[],
  options: LocalCommandOptions = {},
): { stdout: Buffer; stderr: Buffer } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: options.maxBuffer ?? 80 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw new ExternalServiceError(`执行本地命令失败: ${command}`, formatErrorPayload(command, args, result));
  }

  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '', 'utf8'),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || '', 'utf8'),
  };
}
