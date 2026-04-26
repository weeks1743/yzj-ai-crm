import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPptxGenJsInstance } from '../src/pptxgenjs-runtime.js';
import {
  REPO_ROOT,
  QueueChatClient,
  StubWebSearchClient,
  createDependencySnapshot,
  createRuntimeHarness,
  createTempDir,
  createTestConfig,
  waitForJobCompletion,
  withHtmlServer,
  writeTextFixture,
} from './test-helpers.js';

function extractListItem(text: string, extension: string): string {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('- ') && item.endsWith(extension));
  assert.ok(line, `Expected a ${extension} entry in prompt:\n${text}`);
  return line!.slice(2);
}

async function createWideTemplatePptx(outputPath: string): Promise<string> {
  const pptx = createPptxGenJsInstance();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText('Template Placeholder', {
    x: 1,
    y: 1,
    w: 6,
    h: 0.7,
    fontSize: 24,
    bold: true,
  });
  slide.addText('Template subtitle', {
    x: 1,
    y: 2,
    w: 6,
    h: 0.4,
    fontSize: 18,
  });
  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

test('POST /api/jobs runs company-research end-to-end with mock model and local fetch', async () => {
  const tempRoot = createTempDir('skill-runtime-http-company-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');

  await withHtmlServer(
    {
      '/company': `
        <html>
          <head><title>Acme Company</title></head>
          <body>
            <main>
              <h1>Acme Company</h1>
              <p>Acme launched AI copilots in 2026.</p>
            </main>
          </body>
        </html>
      `,
    },
    async (htmlBaseUrl) => {
      const chatClient = new QueueChatClient([
        {
          content: null,
          toolCalls: [
            {
              id: 'tool-1',
              name: 'web_search',
              arguments: JSON.stringify({
                query: 'Acme AI strategy',
                maxResults: 3,
              }),
            },
            {
              id: 'tool-2',
              name: 'web_fetch_extract',
              arguments: JSON.stringify({
                url: `${htmlBaseUrl}/company`,
              }),
            },
            {
              id: 'tool-3',
              name: 'write_text_artifact',
              arguments: JSON.stringify({
                fileName: 'company-brief.md',
                content: `# Acme Brief\n\n- Source: ${htmlBaseUrl}/company\n- Insight: Acme launched AI copilots in 2026.`,
              }),
            },
          ],
        },
        {
          content: 'Research brief completed.',
          toolCalls: [],
        },
      ]);

      const webSearchClient = new StubWebSearchClient({
        'Acme AI strategy': {
          provider: 'ark-web-search',
          query: 'Acme AI strategy',
          summary: 'Acme AI strategy summary',
          results: [
            {
              title: 'Acme Company',
              url: `${htmlBaseUrl}/company`,
              snippet: 'Acme launched AI copilots in 2026.',
            },
          ],
        },
      });

      const harness = await createRuntimeHarness({
        config: createTestConfig({
          rootDir: tempRoot,
          skillDirs: [skillDir],
          allowedRoots: [tempRoot, REPO_ROOT],
          artifactDir: join(tempRoot, 'artifacts'),
        }),
        dependencySnapshot: createDependencySnapshot(),
        chatClient,
        webSearchClient,
      });

      try {
        const response = await fetch(`${harness.baseUrl}/api/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            skillName: 'company-research',
            requestText: 'Research Acme company strategy',
          }),
        });
        assert.equal(response.status, 202);
        const createdJob = await response.json();
        const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
        assert.equal(job.status, 'succeeded');
        assert.equal(job.finalText, 'Research brief completed.');
        assert.equal(job.artifacts.length, 1);

        const artifactResponse = await fetch(`${harness.baseUrl}${job.artifacts[0].downloadPath}`);
        assert.equal(artifactResponse.status, 200);
        const artifactText = await artifactResponse.text();
        assert.match(artifactText, /Acme launched AI copilots in 2026/);
        assert.match(artifactText, /Source:/);
      } finally {
        await harness.close();
      }
    },
  );
});

test('POST /api/jobs runs generic text skill flow and publishes markdown artifact', async () => {
  const tempRoot = createTempDir('skill-runtime-http-generic-text-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/problem-context.md',
    [
      '# 线索录入问题',
      '',
      '- 销售需要在多个系统间来回切换',
      '- 客户资料经常重复填写',
      '- 管理层看不到录入延迟对转化的影响',
    ].join('\n'),
  );

  const chatClient = new QueueChatClient([
    (input) => {
      const userPrompt = input.messages.find((message) => message.role === 'user')?.content || '';
      const attachmentPath = extractListItem(userPrompt, '.md');
      return {
        content: null,
        toolCalls: [
          {
            id: 'text-1',
            name: 'read_source_file',
            arguments: JSON.stringify({
              path: attachmentPath,
            }),
          },
          {
            id: 'text-2',
            name: 'write_text_artifact',
            arguments: JSON.stringify({
              fileName: 'problem-statement.md',
              content: [
                '# 问题陈述',
                '',
                '## 我是谁',
                '- 一线销售代表',
                '',
                '## 正在尝试',
                '- 快速、准确地录入客户线索',
                '',
                '## 主要阻碍',
                '- 需要在多个系统间来回切换，客户资料重复填写',
              ].join('\n'),
            }),
          },
        ],
      };
    },
    {
      content: 'Problem statement generated.',
      toolCalls: [],
    },
  ]);

  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
    }),
    dependencySnapshot: createDependencySnapshot(),
    chatClient,
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'problem-statement',
        requestText: '请根据附件整理一个用户视角的问题陈述',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.finalText, 'Problem statement generated.');
    assert.equal(job.artifacts.length, 1);

    const artifactResponse = await fetch(`${harness.baseUrl}${job.artifacts[0].downloadPath}`);
    assert.equal(artifactResponse.status, 200);
    const artifactText = await artifactResponse.text();
    assert.match(artifactText, /问题陈述/);
    assert.match(artifactText, /多个系统间来回切换/);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs runs super-ppt without model and creates presentation session', async () => {
  const tempRoot = createTempDir('skill-runtime-http-super-ppt-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/besme-report.md',
    [
      '# 绍兴贝斯美化工股份有限公司企业研究',
      '',
      '## 公司概况',
      '- 聚焦农药中间体与特色精细化学品',
      '- 海外收入占比较高',
      '',
      '## 成长驱动',
      '- 新项目建设推进',
      '- 海外客户稳定',
      '',
      '## 风险',
      '- 原材料波动',
      '- 海外需求变化',
    ].join('\n'),
  );

  let receivedTemplateId: string | undefined;
  let receivedCreateTaskType: string | null = null;
  let receivedCreateTaskFileName: string | null = null;
  const receivedGenerateRequests: Array<{
    prompt?: string;
    outlineType?: string;
    length?: string;
    scene?: string;
    audience?: string;
    lang?: string;
    aiSearch?: boolean;
    isGenImg?: boolean;
    stream?: boolean;
  }> = [];
  let receivedGeneratePptxByAiTemplateId: string | null = null;
  const receivedTokenLimits: number[] = [];
  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
      docmeeBaseUrl: 'https://docmee.example',
    }),
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
    docmeeFetchImpl: (async (input, init) => {
      const url = String(input);

      if (url === 'https://docmee.example/api/ppt/v2/createTask') {
        const form = init?.body as FormData;
        receivedCreateTaskType = String(form.get('type'));
        const upload = form.get('file');
        receivedCreateTaskFileName = upload instanceof File ? upload.name : null;
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { id: 'task-001' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/options') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            reference: [{ name: '保持原文', value: '保持原文' }],
            audience: [{ name: '大众', value: '大众' }],
            lang: [{ name: '简体中文', value: 'zh' }],
            scene: [{ name: '公司介绍', value: '公司介绍' }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generateContent') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          prompt?: string;
          outlineType?: string;
          length?: string;
          aiSearch?: boolean;
          isGenImg?: boolean;
          stream?: boolean;
        };
        receivedGenerateRequests.push(body);
        if (body.outlineType === 'JSON') {
          return new Response([
            'data: {"status":1,"text":"# Docmee Outline"}',
            '',
            'data: {"status":4,"text":"# Docmee Outline\\n\\n## 公司概况","result":{"title":"Docmee Outline","slides":[{"headline":"公司概况"}]}}',
          ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
        }

        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            text: '# Final Docmee Outline\n\n## 核心结论\n- 公司具备清晰成长路径',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptxByAi') {
        const form = init?.body as FormData;
        receivedGeneratePptxByAiTemplateId = String(form.get('templateId') || '');
        return new Response([
          'event: message',
          'data: {"status":"running","payload":{"page_num":"1","html":"<article>page-1</article>"}}',
          '',
          'event: message',
          'data: {"status":"completed","payload":{"page_num":"2","html":"<article>page-2</article>"}}',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptx') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { templateId?: string };
        receivedTemplateId = body.templateId;
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            pptInfo: {
              id: 'ppt-001',
              subject: '绍兴贝斯美化工股份有限公司企业研究',
              coverUrl: 'https://files.example/ppt-001.png',
              templateId: 'tpl-001',
            },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/latestData?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'convert_success', mdContent: '# Latest Markdown' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/getConvertResult?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'done', mdContent: '# Convert Markdown' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/downloadPptx') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            id: 'ppt-001',
            subject: '绍兴贝斯美化工股份有限公司企业研究',
            fileUrl: 'https://files.example/ppt-001.pptx',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://files.example/ppt-001.pptx') {
        return new Response(Buffer.from('pptx-binary'), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
        });
      }

      if (url === 'https://docmee.example/api/user/createApiToken' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { limit?: number };
        if (typeof body.limit === 'number') {
          receivedTokenLimits.push(body.limit);
        }
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            token: 'sk-session-001',
            expireTime: 3600,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as any,
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'super-ppt',
        requestText: '请生成管理层研究汇报',
        attachments: [sourcePath],
        templateId: 'tpl-enterprise-001',
        presentationPrompt: '请基于完整 Markdown 内容生成一份正式科技行业汇报 PPT',
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.model, null);
    assert.equal(job.artifacts.length, 6);
    assert.ok(job.artifacts.some((artifact: { fileName: string }) => artifact.fileName.endsWith('.pptx')));
    assert.ok(job.artifacts.some((artifact: { fileName: string }) => artifact.fileName.endsWith('-source.md')));
    assert.ok(job.artifacts.some((artifact: { fileName: string }) => artifact.fileName.endsWith('-content-outline.json')));
    assert.ok(job.artifacts.some((artifact: { fileName: string }) => artifact.fileName.endsWith('-ai-layout.log')));
    assert.ok(job.events.some((event: { type: string }) => event.type === 'presentation_ready'));
    assert.equal(receivedTemplateId, 'tpl-enterprise-001');
    assert.equal(receivedCreateTaskType, '2');
    assert.equal(receivedCreateTaskFileName, 'besme-report.md');
    assert.equal(receivedGenerateRequests.length, 2);
    assert.deepEqual(receivedGenerateRequests.map((item) => item.outlineType), ['JSON', 'MD']);
    assert.ok(receivedGenerateRequests.every((item) => item.prompt === '请基于完整 Markdown 内容生成一份正式科技行业汇报 PPT'));
    assert.ok(receivedGenerateRequests.every((item) => item.length === 'short'));
    assert.ok(receivedGenerateRequests.every((item) => item.scene === '公司介绍'));
    assert.ok(receivedGenerateRequests.every((item) => item.audience === '大众'));
    assert.ok(receivedGenerateRequests.every((item) => item.lang === 'zh'));
    assert.ok(receivedGenerateRequests.every((item) => item.aiSearch === false));
    assert.ok(receivedGenerateRequests.every((item) => item.isGenImg === false));
    assert.equal(receivedGeneratePptxByAiTemplateId, 'tpl-enterprise-001');
    assert.ok(
      job.events.some(
        (event: { type: string; data?: { templateId?: string | null; docmeeFlow?: string | null } }) =>
          event.type === 'presentation_ready'
          && event.data?.templateId === 'tpl-001'
          && event.data?.docmeeFlow === 'official-v2-main-flow',
      ),
    );

    const sessionResponse = await fetch(`${harness.baseUrl}/api/jobs/${createdJob.jobId}/presentation-session`, {
      method: 'POST',
    });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.pptId, 'ppt-001');
    assert.equal(session.token, 'sk-session-001');
    assert.equal(session.subject, '绍兴贝斯美化工股份有限公司企业研究');
    assert.deepEqual(receivedTokenLimits, [50, 200]);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs fails fast when Docmee rejects the selected PPT template', async () => {
  const tempRoot = createTempDir('skill-runtime-http-super-ppt-template-error-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/besme-report.md',
    [
      '# 绍兴贝斯美化工股份有限公司企业研究',
      '',
      '## 公司概况',
      '- 聚焦农药中间体与特色精细化学品',
      '- 海外收入占比较高',
    ].join('\n'),
  );

  let generatePptxCalled = false;
  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
      docmeeBaseUrl: 'https://docmee.example',
    }),
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
    docmeeFetchImpl: (async (input, init) => {
      const url = String(input);

      if (url === 'https://docmee.example/api/user/createApiToken' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            token: 'sk-session-001',
            expireTime: 3600,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/createTask') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { id: 'task-001' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/options') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            reference: [{ name: '保持原文', value: '保持原文' }],
            audience: [{ name: '大众', value: '大众' }],
            lang: [{ name: '简体中文', value: 'zh' }],
            scene: [{ name: '公司介绍', value: '公司介绍' }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generateContent') {
        return new Response([
          'data: {"status":1,"text":"# Docmee Outline"}',
          '',
          'data: {"status":4,"text":"# Docmee Outline\\n\\n## 公司概况","result":{"title":"Docmee Outline","slides":[{"headline":"公司概况"}]}}',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptxByAi') {
        return new Response([
          'event: message',
          'data: {"payload":{},"status":"running","step":0,"todo":[["running","模板解析中"]]}',
          '',
          'event: message',
          'data: {"payload":{},"status":"running","step":0,"todo":[["error","模板解析失败"]]}',
          '',
          'event: message',
          'data: {"error":"模板文件解析失败：Classification result must include at least one content page","outlineType":"MD","status":-1,"text":""}',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptx') {
        generatePptxCalled = true;
        throw new Error('generatePptx should not be called after template parse failure');
      }

      if (url === 'https://docmee.example/api/ppt/v2/latestData?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'running' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/getConvertResult?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as any,
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'super-ppt',
        requestText: '请生成管理层研究汇报',
        attachments: [sourcePath],
        templateId: 'tpl-enterprise-001',
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(generatePptxCalled, false);
    assert.match(job.error?.message || '', /模板未识别到可用内容页/);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs fails instead of downgrading when Docmee official layout does not complete', async () => {
  const tempRoot = createTempDir('skill-runtime-http-super-ppt-no-fallback-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/besme-report.md',
    [
      '# 绍兴贝斯美化工股份有限公司企业研究',
      '',
      '## 公司概况',
      '- 聚焦农药中间体与特色精细化学品',
      '- 海外收入占比较高',
    ].join('\n'),
  );

  let generatePptxCalled = false;
  let markdownGenerateCalled = false;
  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
      docmeeBaseUrl: 'https://docmee.example',
    }),
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
    docmeeFetchImpl: (async (input, init) => {
      const url = String(input);

      if (url === 'https://docmee.example/api/user/createApiToken' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            token: 'sk-session-001',
            expireTime: 3600,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/createTask') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { id: 'task-001' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/options') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            reference: [{ name: '保持原文', value: '保持原文' }],
            audience: [{ name: '大众', value: '大众' }],
            lang: [{ name: '简体中文', value: 'zh' }],
            scene: [{ name: '公司介绍', value: '公司介绍' }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generateContent') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outlineType?: string };
        if (body.outlineType === 'MD') {
          markdownGenerateCalled = true;
          return new Response(JSON.stringify({
            code: 0,
            message: 'ok',
            data: {
              text: '# Unexpected Markdown',
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        }

        return new Response([
          'data: {"status":1,"text":"# Docmee Outline"}',
          '',
          'data: {"status":4,"text":"# Docmee Outline\\n\\n## 公司概况","result":{"title":"Docmee Outline","slides":[{"headline":"公司概况"}]}}',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptxByAi') {
        return new Response([
          'event: message',
          'data: {"status":"running","payload":{"page_num":"1","html":"<article>page-1</article>"}}',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/latestData?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'failed' },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/getConvertResult?taskId=task-001') {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 1 },
        }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptx') {
        generatePptxCalled = true;
        throw new Error('generatePptx should not be called after official layout failure');
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as any,
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'super-ppt',
        requestText: '请生成管理层研究汇报',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(generatePptxCalled, false);
    assert.equal(markdownGenerateCalled, false);
    assert.match(job.error?.message || '', /未执行降级 PPT/);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs runs pptx fresh_deck flow with plan/render/qa/previews artifacts', async () => {
  const tempRoot = createTempDir('skill-runtime-http-pptx-fresh-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/besme-report.md',
    [
      '# 绍兴贝斯美化工股份有限公司',
      '',
      '## 公司概况',
      '- 聚焦农药中间体与特色精细化学品',
      '- 海外收入占比较高',
      '',
      '## 成长驱动',
      '- 新项目建设推进',
      '- 海外客户稳定',
      '',
      '## 风险',
      '- 原材料波动',
      '- 海外需求变化',
    ].join('\n'),
  );

  const chatClient = new QueueChatClient([
    (input) => {
      const userPrompt = input.messages.find((message) => message.role === 'user')?.content || '';
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const sourceFile = extractListItem(userPrompt, '.md');
      const outputDir = /输出目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      assert.ok(outputDir);
      return {
        content: null,
        toolCalls: [
          {
            id: 'fresh-1',
            name: 'read_source_file',
            arguments: JSON.stringify({
              path: sourceFile,
            }),
          },
          {
            id: 'fresh-2',
            name: 'pptx_plan_deck',
            arguments: JSON.stringify({
              meta: {
                title: '绍兴贝斯美化工股份有限公司',
                subtitle: '企业研究演示版',
                audience: '管理层',
                purpose: '快速理解业务、成长性与风险',
                language: 'zh-CN',
              },
              slides: [
                {
                  type: 'company_overview',
                  headline: '公司概况',
                  goal: '概括公司定位与经营基础',
                  supportingPoints: ['聚焦农药中间体与特色精细化学品', '海外收入占比较高'],
                  evidence: ['主业清晰，业务链条较完整'],
                },
                {
                  type: 'kpi_strip',
                  headline: '经营亮点',
                  goal: '提炼核心经营信号',
                  supportingPoints: ['海外收入占比较高', '新项目建设推进', '海外客户稳定'],
                  evidence: ['需要跟踪项目投放节奏'],
                },
                {
                  type: 'timeline',
                  headline: '成长路径',
                  goal: '展示成长逻辑的时间节奏',
                  supportingPoints: ['既有产品稳定', '新项目建设推进', '海外客户稳定'],
                  evidence: ['成长驱动以项目释放为主'],
                },
                {
                  type: 'risk_summary',
                  headline: '核心风险',
                  goal: '呈现主要不确定性与应对重点',
                  supportingPoints: ['原材料价格波动', '海外需求变化'],
                  evidence: ['需要跟踪景气度与项目爬坡'],
                },
              ],
            }),
          },
        ],
      };
    },
    (input) => {
      const toolMessages = input.messages.filter((message) => message.role === 'tool');
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const planPayload = JSON.parse(toolMessages.at(-1)?.content || '{}') as { deckSpec?: unknown };
      const outputDir = /输出目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      assert.ok(outputDir);
      return {
        content: null,
        toolCalls: [
          {
            id: 'fresh-3',
            name: 'pptx_render_deck',
            arguments: JSON.stringify({
              deckSpec: planPayload.deckSpec,
            }),
          },
          {
            id: 'fresh-4',
            name: 'pptx_quality_check',
            arguments: JSON.stringify({
              pptxPath: `${outputDir}/final-deck.pptx`,
              deckSpec: planPayload.deckSpec,
            }),
          },
        ],
      };
    },
    (input) => {
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const outputDir = /输出目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      assert.ok(outputDir);
      return {
        content: null,
        toolCalls: [
          {
            id: 'fresh-5',
            name: 'pptx_render_previews',
            arguments: JSON.stringify({
              pptxPath: `${outputDir}/final-deck.pptx`,
            }),
          },
        ],
      };
    },
  ]);

  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
    }),
    dependencySnapshot: createDependencySnapshot({
      'python_module:openpyxl': false,
    }),
    chatClient,
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'pptx',
        requestText: '将企业研究报告生成 6-8 页商务版 PPT',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId, 90_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.finalText, 'Deck generated, quality-checked, and preview artifacts rendered.');
    assert.ok(job.events.some((event: any) => event.type === 'deck_planned'));
    assert.ok(job.events.some((event: any) => event.type === 'deck_rendered'));
    assert.ok(job.events.some((event: any) => event.type === 'qa_report'));
    assert.ok(job.events.some((event: any) => event.type === 'previews_rendered'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.fileName.endsWith('final-deck.pptx')));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'application/pdf'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'image/jpeg'));
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs runs pptx template_following flow and still finishes with qa + previews', async () => {
  const tempRoot = createTempDir('skill-runtime-http-pptx-template-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(tempRoot, 'inputs/template-source.md', '# 模板跟随\n\n- 重点更新模板内容');
  const templatePath = await createWideTemplatePptx(join(tempRoot, 'inputs/template.pptx'));

  const chatClient = new QueueChatClient([
    (input) => {
      const userPrompt = input.messages.find((message) => message.role === 'user')?.content || '';
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const templateFile = extractListItem(userPrompt, '.pptx');
      const sourceFile = extractListItem(userPrompt, '.md');
      const workspaceDir = /工作目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      assert.ok(workspaceDir);

      return {
        content: null,
        toolCalls: [
          {
            id: 'template-1',
            name: 'read_source_file',
            arguments: JSON.stringify({
              path: sourceFile,
            }),
          },
          {
            id: 'template-2',
            name: 'office_unpack',
            arguments: JSON.stringify({
              inputPath: templateFile,
              outputDir: `${workspaceDir}/unpacked`,
            }),
          },
          {
            id: 'template-3',
            name: 'read_workspace_file',
            arguments: JSON.stringify({
              path: `${workspaceDir}/unpacked/ppt/slides/slide1.xml`,
            }),
          },
        ],
      };
    },
    (input) => {
      const toolMessages = input.messages.filter((message) => message.role === 'tool');
      const userPrompt = input.messages.find((message) => message.role === 'user')?.content || '';
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const outputDir = /输出目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      const workspaceDir = /工作目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      const stagedTemplateFile = extractListItem(userPrompt, '.pptx');
      const unpackedXml = JSON.parse(toolMessages.at(-1)?.content || '{}') as { content?: string };
      assert.ok(outputDir);
      assert.ok(workspaceDir);
      assert.ok(unpackedXml.content);
      const updatedContent = unpackedXml.content!
        .replace(/Template Placeholder/g, 'Template Following Update')
        .replace(/Template subtitle/g, '根据输入材料更新模板内容');

      return {
        content: null,
        toolCalls: [
          {
            id: 'template-4',
            name: 'write_workspace_file',
            arguments: JSON.stringify({
              path: `${workspaceDir}/unpacked/ppt/slides/slide1.xml`,
              content: updatedContent,
            }),
          },
          {
            id: 'template-5',
            name: 'office_pack',
            arguments: JSON.stringify({
              inputDir: `${workspaceDir}/unpacked`,
              outputPath: `${outputDir}/final-deck.pptx`,
              originalPath: stagedTemplateFile,
              validate: true,
            }),
          },
        ],
      };
    },
    (input) => {
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      const outputDir = /输出目录：(.+)/.exec(systemPrompt)?.[1]?.trim();
      assert.ok(outputDir);
      return {
        content: null,
        toolCalls: [
          {
            id: 'template-6',
            name: 'pptx_quality_check',
            arguments: JSON.stringify({
              pptxPath: `${outputDir}/final-deck.pptx`,
            }),
          },
          {
            id: 'template-7',
            name: 'pptx_render_previews',
            arguments: JSON.stringify({
              pptxPath: `${outputDir}/final-deck.pptx`,
            }),
          },
        ],
      };
    },
  ]);

  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
    }),
    dependencySnapshot: createDependencySnapshot({
      'python_module:openpyxl': false,
    }),
    chatClient,
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillName: 'pptx',
        requestText: '基于模板更新内容并产出预览',
        attachments: [sourcePath, templatePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId, 90_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.finalText, 'Template-following deck updated, quality-checked, and preview artifacts rendered.');
    assert.ok(job.events.some((event: any) => event.type === 'qa_report'));
    assert.ok(job.events.some((event: any) => event.type === 'previews_rendered'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.fileName.endsWith('final-deck.pptx')));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'application/pdf'));
    assert.ok(job.artifacts.some((artifact: any) => artifact.mimeType === 'image/jpeg'));
  } finally {
    await harness.close();
  }
});

test('GET /api/skills reports blocked and unsupported_yet skills', async () => {
  const tempRoot = createTempDir('skill-runtime-http-skills-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
    }),
    dependencySnapshot: createDependencySnapshot({
      'command:markitdown': false,
      'python_module:openpyxl': false,
    }),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/skills`);
    assert.equal(response.status, 200);
    const skills = await response.json();
    assert.equal(skills.find((item: any) => item.skillName === 'pptx')?.status, 'blocked');
    assert.equal(skills.find((item: any) => item.skillName === 'docx')?.status, 'unsupported_yet');
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs rejects invalid model and illegal attachment path', async () => {
  const tempRoot = createTempDir('skill-runtime-http-invalid-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const outsideFile = join(createTempDir('skill-runtime-outside-'), 'outside.txt');
  const harness = await createRuntimeHarness({
    config: createTestConfig({
      rootDir: tempRoot,
      skillDirs: [skillDir],
      allowedRoots: [tempRoot, REPO_ROOT],
      artifactDir: join(tempRoot, 'artifacts'),
    }),
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const invalidModelResponse = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: 'company-research',
        requestText: 'research',
        model: 'gpt-4.1',
      }),
    });
    assert.equal(invalidModelResponse.status, 400);

    const invalidPathResponse = await fetch(`${harness.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: 'company-research',
        requestText: 'research',
        attachments: [outsideFile],
      }),
    });
    assert.equal(invalidPathResponse.status, 400);
  } finally {
    await harness.close();
  }
});
