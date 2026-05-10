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
      const systemPrompt = input.messages.find((message) => message.role === 'system')?.content || '';
      assert.match(systemPrompt, /只能读取“可用输入文件”清单中的具体文件路径/);
      assert.doesNotMatch(systemPrompt, /Job 附件目录/);
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
              fileName: 'customer-value-positioning.md',
              content: [
                '# 客户价值定位',
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
      content: 'Customer value positioning generated.',
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
        skillName: 'customer-value-positioning',
        requestText: '请根据附件整理一个客户价值定位',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
    assert.equal(job.finalText, 'Customer value positioning generated.');
    assert.equal(job.artifacts.length, 1);

    const artifactResponse = await fetch(`${harness.baseUrl}${job.artifacts[0].downloadPath}`);
    assert.equal(artifactResponse.status, 200);
    const artifactText = await artifactResponse.text();
    assert.match(artifactText, /客户价值定位/);
    assert.match(artifactText, /多个系统间来回切换/);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs runs yunzhijia visit prep with company research attachment', async () => {
  const tempRoot = createTempDir('skill-runtime-http-visit-prep-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/company-research.md',
    [
      '# 绍兴贝斯美化工股份有限公司 公司研究',
      '',
      '## 公司概览',
      '贝斯美是化工制造企业，销售拜访需要关注流程规范和统一门户。',
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
            id: 'visit-1',
            name: 'read_source_file',
            arguments: JSON.stringify({
              path: attachmentPath,
            }),
          },
          {
            id: 'visit-2',
            name: 'write_text_artifact',
            arguments: JSON.stringify({
              fileName: 'visit-prep.md',
              content: [
                '# 绍兴贝斯美化工股份有限公司 拜访讲解准备',
                '',
                '## 一、客户画像速览',
                '- 化工制造企业，关注统一门户和流程审批。',
                '',
                '## 二、需求理解与方案匹配',
                '- 统一门户 -> 聚合系统入口。',
              ].join('\n'),
            }),
          },
        ],
      };
    },
    {
      content: 'Visit prep generated.',
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
        skillName: 'yunzhijia-visit-prep',
        requestText: '请基于公司研究 md，为绍兴贝斯美化工股份有限公司准备拜访材料，客户关注统一门户和流程审批。',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
    assert.equal(job.finalText, 'Visit prep generated.');
    assert.equal(job.artifacts.length, 1);

    const artifactResponse = await fetch(`${harness.baseUrl}${job.artifacts[0].downloadPath}`);
    assert.equal(artifactResponse.status, 200);
    const artifactText = await artifactResponse.text();
    assert.match(artifactText, /拜访讲解准备/);
    assert.match(artifactText, /统一门户/);
  } finally {
    await harness.close();
  }
});

test('POST /api/jobs runs report-generation and emits report_ready with open url', async () => {
  const tempRoot = createTempDir('skill-runtime-http-report-generation-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/company-research.md',
    [
      '# 上海松井机械有限公司 公司研究',
      '',
      '## 公司概览',
      '松井机械关注销售增长、渠道效率和管理层汇报。',
    ].join('\n'),
  );

  const config = createTestConfig({
    rootDir: tempRoot,
    skillDirs: [skillDir],
    allowedRoots: [tempRoot, REPO_ROOT],
    artifactDir: join(tempRoot, 'artifacts'),
    reportCanvasBaseUrl: 'https://report-canvas.internal',
    reportCanvasPublicBaseUrl: 'https://report.example',
    reportCanvasPollIntervalMs: 10,
  });
  const requestedUrls: string[] = [];
  const harness = await createRuntimeHarness({
    config,
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
    fetchImpl: (async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/api/report/generate') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { markdown?: string; query?: string; ttlMinutes?: number };
        assert.match(body.markdown ?? '', /松井机械关注销售增长/);
        assert.equal(body.query, '请基于公司研究生成可视化互动报告');
        assert.equal(body.ttlMinutes, 1440);
        return new Response(JSON.stringify({
          sessionId: 'rpt_001',
          status: 'pending',
          embedUrl: 'https://report-canvas.internal/embed/rpt_001',
          statusUrl: '/api/report/status/rpt_001',
          resultUrl: '/api/report/result/rpt_001',
          createdAt: '2026-05-10T00:00:00.000Z',
          expiresAt: '2026-05-11T00:00:00.000Z',
        }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/report/status/rpt_001')) {
        return new Response(JSON.stringify({
          sessionId: 'rpt_001',
          status: 'complete',
          stage: 'code_gen',
          progress: 100,
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:01:00.000Z',
          expiresAt: '2026-05-11T00:00:00.000Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/report/result/rpt_001')) {
        return new Response(JSON.stringify({
          sessionId: 'rpt_001',
          status: 'complete',
          code: 'export default function Report() { return <div>report</div>; }',
          embedUrl: 'https://report-canvas.internal/embed/rpt_001',
          metadata: {
            codeLength: 60,
            generatedAt: '2026-05-10T00:01:00.000Z',
            pipelineDurationMs: 60_000,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
        skillName: 'report-generation',
        requestText: '请基于公司研究生成可视化互动报告',
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    const job = await waitForJobCompletion(harness.baseUrl, createdJob.jobId);
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
    assert.match(job.finalText, /https:\/\/report\.example\/embed\/rpt_001/);
    assert.ok(requestedUrls.some((url) => url === 'https://report-canvas.internal/api/report/generate'));

    const reportReady = job.events.find((event: any) => event.type === 'report_ready');
    assert.ok(reportReady);
    assert.equal(reportReady.data.sessionId, 'rpt_001');
    assert.equal(reportReady.data.openUrl, 'https://report.example/embed/rpt_001');
    assert.equal(job.artifacts.length, 3);
    assert.ok(job.artifacts.some((artifact: any) => artifact.fileName.endsWith('-source.md')));
    assert.ok(job.artifacts.some((artifact: any) => artifact.fileName.endsWith('-report.jsx')));
    assert.ok(job.artifacts.some((artifact: any) => artifact.fileName.endsWith('.json')));
  } finally {
    await harness.close();
  }
});

test('GET /api/jobs lists completed jobs for downstream repair lookup', async () => {
  const tempRoot = createTempDir('skill-runtime-http-job-list-');
  const skillDir = resolve(REPO_ROOT, '3rdSkill');
  const sourcePath = writeTextFixture(
    tempRoot,
    'inputs/problem-context.md',
    '# 贝斯美拜访\n\n录音任务：recording-task-f4aed9d9\n客户关注采购、合同和报销流程。',
  );

  const chatClient = new QueueChatClient([
    {
      content: null,
      toolCalls: [
        {
          id: 'text-1',
          name: 'write_text_artifact',
          arguments: JSON.stringify({
            fileName: 'customer-value-positioning.md',
            content: '# 客户价值定位\n\n贝斯美需要打通采购、合同和费用报销流程。',
          }),
        },
      ],
    },
    {
      content: 'Customer value positioning generated.',
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
        skillName: 'customer-value-positioning',
        requestText: `来源录音：贝斯美拜访.mp3\n录音任务：recording-task-f4aed9d9`,
        attachments: [sourcePath],
      }),
    });
    assert.equal(response.status, 202);
    const createdJob = await response.json();
    await waitForJobCompletion(harness.baseUrl, createdJob.jobId);

    const listResponse = await fetch(
      `${harness.baseUrl}/api/jobs?skillName=customer-value-positioning&status=succeeded&query=${encodeURIComponent('recording-task-f4aed9d9')}&pageSize=10`,
    );
    assert.equal(listResponse.status, 200);
    const result = await listResponse.json();
    assert.equal(result.total, 1);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].jobId, createdJob.jobId);
    assert.equal(result.jobs[0].skillName, 'customer-value-positioning');
    assert.equal(result.jobs[0].artifacts.length, 1);
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
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
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
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
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
    dependencySnapshot: createDependencySnapshot(),
    chatClient: new QueueChatClient([]),
    webSearchClient: new StubWebSearchClient({}),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/skills`);
    assert.equal(response.status, 200);
    const skills = await response.json();
    assert.equal(skills.some((item: any) => item.skillName === 'super-ppt'), false);
    assert.equal(skills.find((item: any) => item.skillName === 'discovery-interview-prep')?.status, 'unsupported_yet');
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
