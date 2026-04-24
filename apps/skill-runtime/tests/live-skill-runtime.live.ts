import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DeepSeekChatCompletionClient } from '../src/deepseek-client.js';
import { probeDependencies } from '../src/dependency-probe.js';
import { VolcWebSearchClient } from '../src/volc-web-search-client.js';
import {
  createRuntimeHarness,
  createTempDir,
  createTestConfig,
  writeTextFixture,
  waitForJobCompletion,
  REPO_ROOT,
} from './test-helpers.js';
import type { SupportedDeepseekModel } from '../src/contracts.js';

const RUN_LIVE = process.env.RUN_SKILL_RUNTIME_LIVE === '1';

function createLiveConfig(tempRoot: string) {
  assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required');
  assert.ok(process.env.ARK_API_KEY, 'ARK_API_KEY is required');

  const config = createTestConfig({
    rootDir: tempRoot,
    skillDirs: [resolve(REPO_ROOT, '3rdSkill')],
    allowedRoots: [tempRoot, REPO_ROOT],
    artifactDir: join(tempRoot, 'artifacts'),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    arkApiKey: process.env.ARK_API_KEY,
    arkWebSearchModel: process.env.ARK_WEB_SEARCH_MODEL || 'doubao-seed-2-0-lite-260215',
  });
  config.deepseek.baseUrl = 'https://api.deepseek.com';
  config.ark.baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
  return config;
}

test('live Ark web search returns normalized results', { skip: !RUN_LIVE }, async () => {
  const tempRoot = createTempDir('skill-runtime-live-search-');
  const config = createLiveConfig(tempRoot);
  const client = new VolcWebSearchClient({
    baseUrl: config.ark.baseUrl,
    apiKey: config.ark.apiKey!,
    model: config.ark.webSearchModel,
  });

  try {
    const result = await client.search('DeepSeek company AI strategy', { maxResults: 3 });
    assert.equal(result.provider, 'ark-web-search');
    assert.equal(result.query, 'DeepSeek company AI strategy');
    assert.ok(result.results.length >= 1);
    assert.ok(result.results.some((item) => item.url.startsWith('http')));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function runLiveCompanyResearch(model: SupportedDeepseekModel) {
  const tempRoot = createTempDir(`skill-runtime-live-${model}-`);
  const config = createLiveConfig(tempRoot);

  const harness = await createRuntimeHarness({
    config,
    dependencySnapshot: probeDependencies(config),
    chatClient: new DeepSeekChatCompletionClient({
      baseUrl: config.deepseek.baseUrl,
      apiKey: config.deepseek.apiKey!,
    }),
    webSearchClient: new VolcWebSearchClient({
      baseUrl: config.ark.baseUrl,
      apiKey: config.ark.apiKey!,
      model: config.ark.webSearchModel,
    }),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'company-research',
        model,
        requestText: `Smoke test: create a short markdown brief about DeepSeek company strategy. Use current public sources, include source links, keep it concise, and finish within at most 2 web searches and 2 fetched pages if possible.`,
      }),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, created.jobId, 180_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(job.artifacts.length >= 1);
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'text/markdown'));
  } finally {
    await harness.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('live company-research works with deepseek-v4-pro', { skip: !RUN_LIVE }, async () => {
  await runLiveCompanyResearch('deepseek-v4-pro');
});

test('live company-research works with deepseek-v4-flash', { skip: !RUN_LIVE }, async () => {
  await runLiveCompanyResearch('deepseek-v4-flash');
});

test('live pptx fresh_deck smoke works with deepseek-v4-pro', { skip: !RUN_LIVE }, async () => {
  const tempRoot = createTempDir('skill-runtime-live-pptx-');
  const config = createLiveConfig(tempRoot);
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/live-pptx-source.md',
    [
      '# DeepSeek 企业能力概览',
      '',
      '## 公司概况',
      '- 聚焦大模型研发与开发者生态',
      '- 面向企业提供模型能力',
      '',
      '## 经营亮点',
      '- 产品节奏快',
      '- API 关注度高',
      '',
      '## 风险与关注点',
      '- 商业化节奏仍需持续观察',
      '- 需要关注模型迭代稳定性',
    ].join('\n'),
  );

  const harness = await createRuntimeHarness({
    config,
    dependencySnapshot: probeDependencies(config),
    chatClient: new DeepSeekChatCompletionClient({
      baseUrl: config.deepseek.baseUrl,
      apiKey: config.deepseek.apiKey!,
    }),
    webSearchClient: new VolcWebSearchClient({
      baseUrl: config.ark.baseUrl,
      apiKey: config.ark.apiKey!,
      model: config.ark.webSearchModel,
    }),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'pptx',
        model: 'deepseek-v4-pro',
        requestText: 'Create a concise 6-8 slide business deck in Chinese. Use the attachment as source material, keep each slide focused, and make sure the final output includes previews.',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, created.jobId, 300_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'application/pdf'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'image/jpeg'));
  } finally {
    await harness.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
