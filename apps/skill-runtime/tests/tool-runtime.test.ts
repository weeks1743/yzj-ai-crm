import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createTempDir, QueueChatClient, writeSkillFixture, writeTextFixture } from './test-helpers.js';
import { createPptxGenJsInstance } from '../src/pptxgenjs-runtime.js';
import { createGenericTextTools, createPptxTools, runToolLoop, type ToolExecutionContext } from '../src/tool-runtime.js';

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

test('read_source_file reads staged inputs directory as combined text attachments', async () => {
  const tempDir = createTempDir('tool-read-inputs-dir-');
  const inputsDir = join(tempDir, 'inputs');
  const outputsDir = join(tempDir, 'outputs');
  const workspaceDir = join(tempDir, 'workspace');
  writeTextFixture(tempDir, 'inputs/mindMapSummary.json', '{"mindMapSummary":[{"title":"客户预算"}]}');
  writeTextFixture(tempDir, 'inputs/recording-material.md', '# 录音资料包\n\n客户关注预算审批。');
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-read-inputs-dir',
      skillName: 'customer-value-positioning',
      model: 'deepseek-v4-pro',
      requestText: '基于录音生成客户价值定位',
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
      skillName: 'customer-value-positioning',
      skillFilePath: `${tempDir}/customer-value-positioning/SKILL.md`,
      rawContent: '',
      promptContent: 'customer value positioning prompt',
      frontmatter: {},
      profile: {
        skillName: 'customer-value-positioning',
        displayName: 'customer value positioning',
        description: 'customer value positioning',
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
      workspaceDir,
      inputsDir,
      outputsDir,
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
          id: 'call-read-inputs-dir',
          name: 'read_source_file',
          arguments: JSON.stringify({ path: inputsDir }),
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
    tools: createGenericTextTools(),
  });

  assert.equal(result.finalText, 'done');
  const toolMessage = client.calls[1]?.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content.includes('mindMapSummary.json'));
  assert.ok(toolMessage?.content.includes('客户关注预算审批'));
});

test('read_skill_file falls back to template.md when relativePath is omitted', async () => {
  const tempDir = createTempDir('tool-read-skill-template-fallback-');
  const skillDir = writeSkillFixture(
    tempDir,
    'customer-value-positioning',
    [
      '---',
      'name: customer-value-positioning',
      'description: demo',
      '---',
      '',
      'demo prompt',
    ].join('\n'),
    {
      'template.md': '# 客户价值定位模板\n\n## 当前客户关注点',
    },
  );
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-read-template-fallback',
      skillName: 'customer-value-positioning',
      model: 'deepseek-v4-pro',
      requestText: '基于录音生成客户价值定位',
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
      skillName: 'customer-value-positioning',
      skillFilePath: join(skillDir, 'SKILL.md'),
      rawContent: '',
      promptContent: 'customer value positioning prompt',
      frontmatter: {},
      profile: {
        skillName: 'customer-value-positioning',
        displayName: 'customer value positioning',
        description: 'customer value positioning',
        arguments: [],
        allowedTools: [],
        baseDir: skillDir,
        supportFiles: ['template.md'],
        examples: [],
        hasTemplate: true,
      },
    },
    paths: {
      jobHomeDir: tempDir,
      workspaceDir: tempDir,
      inputsDir: tempDir,
      outputsDir: tempDir,
      skillDir,
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
          id: 'call-read-template',
          name: 'read_skill_file',
          arguments: JSON.stringify({}),
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
    tools: createGenericTextTools(),
  });

  assert.equal(result.finalText, 'done');
  const toolMessage = client.calls[1]?.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content.includes('template.md'));
  assert.ok(toolMessage?.content.includes('客户价值定位模板'));
});

test('read_source_file reads supported text files from inputs subdirectory', async () => {
  const tempDir = createTempDir('tool-read-inputs-subdir-');
  const inputsDir = join(tempDir, 'inputs');
  const outputsDir = join(tempDir, 'outputs');
  const workspaceDir = join(tempDir, 'workspace');
  const profileDir = join(inputsDir, 'profile-analysis');
  writeTextFixture(tempDir, 'inputs/profile-analysis/customer-profile.md', '# 客户画像\n\n贝斯美关注审批效率。');
  writeTextFixture(tempDir, 'inputs/profile-analysis/opportunity-profile.md', '# 商机画像\n\n当前推进统一门户试点。');
  const context: ToolExecutionContext = {
    job: {
      jobId: 'job-read-inputs-subdir',
      skillName: 'customer-needs-todo-analysis',
      model: 'deepseek-v4-pro',
      requestText: '基于录音生成客户需求待办',
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
      skillName: 'customer-needs-todo-analysis',
      skillFilePath: `${tempDir}/customer-needs-todo-analysis/SKILL.md`,
      rawContent: '',
      promptContent: 'customer needs todo analysis prompt',
      frontmatter: {},
      profile: {
        skillName: 'customer-needs-todo-analysis',
        displayName: 'customer needs todo analysis',
        description: 'customer needs todo analysis',
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
      workspaceDir,
      inputsDir,
      outputsDir,
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
          id: 'call-read-profile-dir',
          name: 'read_source_file',
          arguments: JSON.stringify({ path: profileDir }),
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
    tools: createGenericTextTools(),
  });

  assert.equal(result.finalText, 'done');
  const toolMessage = client.calls[1]?.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content.includes('customer-profile.md'));
  assert.ok(toolMessage?.content.includes('opportunity-profile.md'));
  assert.ok(toolMessage?.content.includes('贝斯美关注审批效率'));
  assert.ok(toolMessage?.content.includes('统一门户试点'));
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
