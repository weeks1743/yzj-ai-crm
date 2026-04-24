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
