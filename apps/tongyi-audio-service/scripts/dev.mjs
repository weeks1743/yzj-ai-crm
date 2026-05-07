import { existsSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(serviceRoot, '../..');
const envFilePath = resolve(repoRoot, '.env');
const setupOnly = process.argv.includes('--setup-only');
const venvPython = resolve(serviceRoot, '.venv/bin/python');

if (existsSync(envFilePath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFilePath);
}

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    cwd: serviceRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(venvPython)) {
  console.log('[tongyi-audio-service] creating Python virtual environment at .venv');
  runChecked('python3', ['-m', 'venv', '.venv']);
}

const dependencyCheck = spawnSync(venvPython, [
  '-c',
  'import requests; from dashscope.multimodal.tingwu.tingwu import TingWu; from dashscope.utils.oss_utils import OssUtils',
], {
  cwd: serviceRoot,
  env: process.env,
  stdio: 'ignore',
});

if (dependencyCheck.status !== 0) {
  console.log('[tongyi-audio-service] installing Python requirements');
  runChecked(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
}

if (setupOnly) {
  process.exit(0);
}

const serviceHost = process.env.TONGYI_AUDIO_SERVICE_HOST || '127.0.0.1';
const servicePort = Number.parseInt(process.env.TONGYI_AUDIO_SERVICE_PORT || '3018', 10);
const serviceUrl = `http://${serviceHost}:${servicePort}`;

function resolveConfigPath(value, fallback) {
  const rawValue = `${value || ''}`.trim();
  if (!rawValue) {
    return resolve(fallback);
  }
  const expandedValue = rawValue === '~'
    ? homedir()
    : rawValue.startsWith('~/')
      ? resolve(homedir(), rawValue.slice(2))
      : rawValue;
  return isAbsolute(expandedValue)
    ? resolve(expandedValue)
    : resolve(repoRoot, expandedValue);
}

const expectedOutputDir = resolveConfigPath(
  process.env.TONGYI_AUDIO_OUTPUT_DIR,
  resolve(serviceRoot, '.local/outputs'),
);
const expectedFixtureOutputDir = resolveConfigPath(
  process.env.TONGYI_AUDIO_FIXTURE_OUTPUT_DIR,
  resolve(repoRoot, 'tmp/EV5TddyrE5zM'),
);

function readExistingHealth() {
  return new Promise((resolveHealth) => {
    const request = http.request(
      {
        host: serviceHost,
        port: servicePort,
        path: '/health',
        method: 'GET',
        timeout: 800,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) {
            resolveHealth(null);
            return;
          }
          try {
            resolveHealth(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolveHealth(null);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolveHealth(null);
    });
    request.on('error', () => resolveHealth(null));
    request.end();
  });
}

function isTongyiAudioServiceHealth(payload) {
  return Boolean(
    payload
      && payload.status === 'ok'
      && payload.provider === 'tongyi-tingwu'
      && Array.isArray(payload.capabilities)
      && payload.capabilities.includes('recording_material'),
  );
}

function isExpectedServiceHealth(payload) {
  return Boolean(
    isTongyiAudioServiceHealth(payload)
      && payload.outputDir === expectedOutputDir
      && payload.fixtureOutputDir === expectedFixtureOutputDir,
  );
}

async function reuseExistingServiceIfAvailable() {
  const health = await readExistingHealth();
  if (!isTongyiAudioServiceHealth(health)) {
    return false;
  }
  if (!isExpectedServiceHealth(health)) {
    console.error(`[tongyi-audio-service] existing service at ${serviceUrl} uses a different config`);
    console.error(`[tongyi-audio-service] expected outputDir: ${expectedOutputDir}`);
    console.error(`[tongyi-audio-service] actual outputDir: ${health.outputDir || '-'}`);
    console.error(`[tongyi-audio-service] expected fixtureOutputDir: ${expectedFixtureOutputDir}`);
    console.error(`[tongyi-audio-service] actual fixtureOutputDir: ${health.fixtureOutputDir || '-'}`);
    console.error('[tongyi-audio-service] stop the old process, then run pnpm dev again.');
    process.exit(1);
  }

  console.log(`[tongyi-audio-service] reusing existing service at ${serviceUrl}`);
  let shuttingDown = false;
  const timer = setInterval(async () => {
    const latestHealth = await readExistingHealth();
    if (!shuttingDown && !isExpectedServiceHealth(latestHealth)) {
      console.error(`[tongyi-audio-service] existing service at ${serviceUrl} is no longer healthy`);
      process.exit(1);
    }
  }, 5000);

  function stop() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(timer);
    console.log('[tongyi-audio-service] detached from existing service');
    process.exit(0);
  }

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return true;
}

const env = {
  ...process.env,
  PYTHONUNBUFFERED: '1',
  PYTHONPATH: [
    resolve(serviceRoot, 'src'),
    process.env.PYTHONPATH,
  ].filter(Boolean).join(delimiter),
};

if (await reuseExistingServiceIfAvailable()) {
  // Keep this package's dev task alive so root `pnpm dev` remains a single
  // long-running process even when the audio service was already started.
  await new Promise(() => {});
}

const child = spawn(venvPython, ['-m', 'tongyi_audio_service.server'], {
  cwd: serviceRoot,
  env,
  stdio: 'inherit',
});

let isShuttingDown = false;
let terminationTimer;
let killTimer;

function requestShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (signal === 'SIGTERM' || !process.stdin.isTTY) {
    child.kill(signal);
  }

  terminationTimer = setTimeout(() => {
    child.kill('SIGTERM');
  }, 3000);
  terminationTimer.unref();

  killTimer = setTimeout(() => {
    child.kill('SIGKILL');
  }, 8000);
  killTimer.unref();
}

child.on('exit', (code, signal) => {
  if (terminationTimer) {
    clearTimeout(terminationTimer);
  }
  if (killTimer) {
    clearTimeout(killTimer);
  }

  if (isShuttingDown) {
    process.exit(0);
  }

  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    requestShutdown(signal);
  });
}
