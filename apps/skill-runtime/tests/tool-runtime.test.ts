import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createTempDir, QueueChatClient, writeTextFixture } from './test-helpers.js';
import { createPptxGenJsInstance } from '../src/pptxgenjs-runtime.js';
import { createPptxTools, runToolLoop, type ToolExecutionContext } from '../src/tool-runtime.js';

test('runToolLoop executes tool calls and returns final text', async () => {
  const tempDir = createTempDir('tool-loop-');
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-1',
      skillName: 'demo',
      model: 'deepseek-v4-pro',
      requestText: 'hello',
      attachments: [],
      workingDirectory: null,
      status: 'running',
      finalText: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    },
    skill: {
      skillName: 'demo',
      skillFilePath: `${tempDir}/demo/SKILL.md`,
      rawContent: '',
      promptContent: 'demo prompt',
      frontmatter: {},
      profile: {
        skillName: 'demo',
        displayName: 'demo',
        description: 'demo',
        arguments: [],
        allowedTools: [],
        baseDir: tempDir,
        supportFiles: [],
        examples: [],
        hasTemplate: false,
      },
    },
    paths: {
      jobHomeDir: tempDir,
      workspaceDir: tempDir,
      inputsDir: tempDir,
      outputsDir: tempDir,
      skillDir: tempDir,
      artifactDir: tempDir,
    },
    webSearchClient: {
      async search() {
        throw new Error('not used');
      },
    },
    emitEvent() {},
    publishTextArtifact() {
      throw new Error('not used');
    },
    publishFileArtifact() {
      throw new Error('not used');
    },
  };

  const client = new QueueChatClient([
    {
      content: null,
      toolCalls: [
        {
          id: 'call-1',
          name: 'echo_tool',
          arguments: JSON.stringify({ value: 'world' }),
        },
      ],
    },
    {
      content: 'done',
      toolCalls: [],
    },
  ]);

  const result = await runToolLoop({
    client,
    model: 'deepseek-v4-pro',
    systemPrompt: 'system',
    userPrompt: 'user',
    context,
    tools: [
      {
        name: 'echo_tool',
        description: 'echoes content',
        inputSchema: {
          type: 'object',
        },
        async execute(args) {
          return args;
        },
      },
    ],
  });

  assert.equal(result.finalText, 'done');
  assert.equal(result.turns, 2);
  assert.equal(client.calls.length, 2);
});

test('runToolLoop supports explicit stop conditions for pptx QA pass', async () => {
  const tempDir = createTempDir('tool-loop-stop-');
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-2',
      skillName: 'pptx',
      model: 'deepseek-v4-pro',
      requestText: 'make deck',
      attachments: [],
      workingDirectory: null,
      status: 'running',
      finalText: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    },
    skill: {
      skillName: 'pptx',
      skillFilePath: `${tempDir}/pptx/SKILL.md`,
      rawContent: '',
      promptContent: 'pptx prompt',
      frontmatter: {},
      profile: {
        skillName: 'pptx',
        displayName: 'pptx',
        description: 'pptx',
        arguments: [],
        allowedTools: [],
        baseDir: tempDir,
        supportFiles: [],
        examples: [],
        hasTemplate: false,
      },
    },
    paths: {
      jobHomeDir: tempDir,
      workspaceDir: tempDir,
      inputsDir: tempDir,
      outputsDir: tempDir,
      skillDir: tempDir,
      artifactDir: tempDir,
    },
    webSearchClient: {
      async search() {
        throw new Error('not used');
      },
    },
    emitEvent() {},
    publishTextArtifact() {
      throw new Error('not used');
    },
    publishFileArtifact() {
      throw new Error('not used');
    },
  };

  const client = new QueueChatClient([
    {
      content: null,
      toolCalls: [
        {
          id: 'call-qa',
          name: 'qa_tool',
          arguments: JSON.stringify({}),
        },
        {
          id: 'call-preview',
          name: 'preview_tool',
          arguments: JSON.stringify({}),
        },
      ],
    },
  ]);

  const result = await runToolLoop({
    client,
    model: 'deepseek-v4-pro',
    systemPrompt: 'system',
    userPrompt: 'user',
    context,
    tools: [
      {
        name: 'qa_tool',
        description: 'returns qa pass',
        inputSchema: { type: 'object' },
        async execute() {
          return { passed: true };
        },
      },
      {
        name: 'preview_tool',
        description: 'returns preview output',
        inputSchema: { type: 'object' },
        async execute() {
          return { createdFiles: ['final-deck.pdf', 'slide-1.jpg'] };
        },
      },
    ],
    stopWhen({ toolExecutions }) {
      const passedQa = toolExecutions.some((execution) => execution.name === 'qa_tool' && (execution.result as any)?.passed === true);
      const hasPreview = toolExecutions.some((execution) => execution.name === 'preview_tool');
      if (passedQa && hasPreview) {
        return {
          stop: true,
          finalText: 'stopped after QA pass and previews',
        };
      }
      return null;
    },
  });

  assert.equal(result.finalText, 'stopped after QA pass and previews');
  assert.equal(result.turns, 1);
});

test('pptx_extract_text rejects non-pptx sources', async () => {
  const tempDir = createTempDir('tool-loop-extract-');
  const markdownPath = writeTextFixture(tempDir, 'input.md', '# hello');
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-3',
      skillName: 'pptx',
      model: 'deepseek-v4-pro',
      requestText: 'hello',
      attachments: [],
      workingDirectory: null,
      status: 'running',
      finalText: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    },
    skill: {
      skillName: 'pptx',
      skillFilePath: join(tempDir, 'SKILL.md'),
      rawContent: '',
      promptContent: 'pptx prompt',
      frontmatter: {},
      profile: {
        skillName: 'pptx',
        displayName: 'pptx',
        description: 'pptx',
        arguments: [],
        allowedTools: [],
        baseDir: tempDir,
        supportFiles: [],
        examples: [],
        hasTemplate: false,
      },
    },
    paths: {
      jobHomeDir: tempDir,
      workspaceDir: tempDir,
      inputsDir: tempDir,
      outputsDir: tempDir,
      skillDir: tempDir,
      artifactDir: tempDir,
    },
    webSearchClient: {
      async search() {
        throw new Error('not used');
      },
    },
    emitEvent() {},
    publishTextArtifact() {
      throw new Error('not used');
    },
    publishFileArtifact() {
      throw new Error('not used');
    },
  };

  const tools = createPptxTools('template_following');
  const extractTool = tools.find((tool) => tool.name === 'pptx_extract_text');
  assert.ok(extractTool);
  await assert.rejects(
    () => extractTool!.execute({ inputPath: markdownPath }, context),
    /仅支持 \.pptx 或 \.potx/,
  );
});

test('pptx_quality_check accepts partial deckSpec hints from the model', async () => {
  const tempDir = createTempDir('tool-loop-quality-hint-');
  const outputPath = join(tempDir, 'deck.pptx');
  const pptx = createPptxGenJsInstance();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText('风险与观察点', { x: 1, y: 1, w: 4, h: 0.6 });
  await pptx.writeFile({ fileName: outputPath });

  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-4',
      skillName: 'pptx',
      model: 'deepseek-v4-pro',
      requestText: 'qa',
      attachments: [],
      workingDirectory: null,
      status: 'running',
      finalText: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    },
    skill: {
      skillName: 'pptx',
      skillFilePath: join(tempDir, 'SKILL.md'),
      rawContent: '',
      promptContent: 'pptx prompt',
      frontmatter: {},
      profile: {
        skillName: 'pptx',
        displayName: 'pptx',
        description: 'pptx',
        arguments: [],
        allowedTools: [],
        baseDir: tempDir,
        supportFiles: [],
        examples: [],
        hasTemplate: false,
      },
    },
    paths: {
      jobHomeDir: tempDir,
      workspaceDir: tempDir,
      inputsDir: tempDir,
      outputsDir: tempDir,
      skillDir: tempDir,
      artifactDir: tempDir,
    },
    webSearchClient: {
      async search() {
        throw new Error('not used');
      },
    },
    emitEvent() {},
    publishTextArtifact() {
      throw new Error('not used');
    },
    publishFileArtifact() {
      throw new Error('not used');
    },
  };

  const tools = createPptxTools('fresh_deck');
  const qualityTool = tools.find((tool) => tool.name === 'pptx_quality_check');
  assert.ok(qualityTool);
  const report = await qualityTool!.execute(
    {
      pptxPath: outputPath,
      deckSpec: {
        meta: {
          language: 'zh-CN',
        },
        slides: [
          {
            type: 'risk_grid',
          },
        ],
      },
    },
    context,
  ) as { slideCount: number };

  assert.equal(report.slideCount, 1);
});
