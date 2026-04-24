import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { ArtifactStore, guessMimeType } from './artifact-store.js';
import type {
  AppConfig,
  ChatCompletionClient,
  FetchLike,
  JobArtifact,
  JobEvent,
  LoadedSkill,
  StoredJobRecord,
  WebSearchClient,
} from './contracts.js';
import { inferPptxMode, type PptxMode } from './pptx-deck.js';
import { BadRequestError } from './errors.js';
import { isPathWithin } from './path-utils.js';
import { JobRepository } from './job-repository.js';
import {
  createCompanyResearchTools,
  createPptxTools,
  type ExecutionPaths,
  type ToolExecutionRecord,
  runToolLoop,
} from './tool-runtime.js';

function walkFiles(baseDir: string, currentDir = baseDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(baseDir, entryPath));
      continue;
    }

    results.push(resolve(entryPath));
  }

  return results.sort();
}

function isPassedQualityResult(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && 'passed' in value
    && (value as { passed?: unknown }).passed === true,
  );
}

function hasPreviewAfterPassedQa(toolExecutions: ToolExecutionRecord[]): boolean {
  let qaPassed = false;

  for (const execution of toolExecutions) {
    if (execution.name === 'pptx_quality_check') {
      qaPassed = isPassedQualityResult(execution.result);
      continue;
    }

    if (qaPassed && execution.name === 'pptx_render_previews') {
      return true;
    }
  }

  return false;
}

export class SkillExecutor {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: JobRepository;
      artifactStore: ArtifactStore;
      chatClient: ChatCompletionClient;
      webSearchClient: WebSearchClient;
      fetchImpl?: FetchLike;
    },
  ) {}

  private ensureAllowedInputPath(pathValue: string): string {
    if (!pathValue.startsWith('/')) {
      throw new BadRequestError(`附件路径必须是绝对路径: ${pathValue}`);
    }

    const normalized = resolve(pathValue);
    if (!this.options.config.runtime.allowedRoots.some((root) => isPathWithin(root, normalized))) {
      throw new BadRequestError(`附件路径不在允许目录内: ${pathValue}`, {
        allowedRoots: this.options.config.runtime.allowedRoots,
      });
    }

    return normalized;
  }

  private createExecutionPaths(job: StoredJobRecord, skill: LoadedSkill): ExecutionPaths {
    const jobHomeDir = join(this.options.config.storage.artifactDir, '_jobs', job.jobId);
    mkdirSync(jobHomeDir, { recursive: true });

    const workspaceDir = job.workingDirectory
      ? resolve(job.workingDirectory)
      : join(jobHomeDir, 'workspace');
    const inputsDir = join(jobHomeDir, 'inputs');
    const outputsDir = join(jobHomeDir, 'outputs');

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(inputsDir, { recursive: true });
    mkdirSync(outputsDir, { recursive: true });

    return {
      jobHomeDir,
      workspaceDir,
      inputsDir,
      outputsDir,
      skillDir: skill.profile.baseDir,
      artifactDir: this.options.config.storage.artifactDir,
    };
  }

  private stageAttachments(job: StoredJobRecord, paths: ExecutionPaths): string[] {
    const stagedPaths: string[] = [];

    for (const attachmentPath of job.attachments) {
      const sourcePath = this.ensureAllowedInputPath(attachmentPath);
      const stat = statSync(sourcePath, { throwIfNoEntry: false });
      if (!stat?.isFile()) {
        throw new BadRequestError(`附件不存在或不是文件: ${attachmentPath}`);
      }

      const destinationPath = join(paths.inputsDir, basename(sourcePath));
      copyFileSync(sourcePath, destinationPath);
      stagedPaths.push(destinationPath);
    }

    return stagedPaths;
  }

  private publishOutputArtifacts(jobId: string, outputDir: string): JobArtifact[] {
    const supportedExtensions = new Set(this.options.config.runtime.outputScanExtensions);
    const artifacts: JobArtifact[] = [];

    for (const filePath of walkFiles(outputDir)) {
      if (!supportedExtensions.has(extname(filePath).toLowerCase())) {
        continue;
      }

      const relativePath = relative(outputDir, filePath);
      artifacts.push(
        this.options.artifactStore.publishFile(
          jobId,
          filePath,
          relativePath.replace(/[\\/]+/g, '-'),
          guessMimeType(filePath),
        ),
      );
      this.options.repository.appendEvent(
        jobId,
        'artifact',
        `生成产物 ${relativePath}`,
        {
          filePath,
        },
      );
    }

    return artifacts;
  }

  private buildCompanyResearchPrompt(skill: LoadedSkill, stagedAttachments: string[], paths: ExecutionPaths, job: StoredJobRecord): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const attachmentBlock =
      stagedAttachments.length > 0
        ? stagedAttachments.map((item) => `- ${item}`).join('\n')
        : '- 无';

    return {
      systemPrompt: [
        `你正在执行 skill: ${skill.skillName}`,
        '',
        skill.promptContent,
        '',
        '执行约束：',
        `- 只允许使用这些工具：${['web_search', 'web_fetch_extract', 'read_skill_file', 'write_text_artifact'].join(', ')}`,
        '- 先规划检索主题，再搜索，再抓取页面，再整合来源与日期。',
        '- 必须在结束前调用 write_text_artifact 生成 markdown 报告。',
        '- 报告必须包含来源链接、日期和简明引用说明。',
        '- 为保证稳定性，请控制在最多 3 次 web_search 与最多 4 次 web_fetch_extract 内完成。',
        '- 优先选择最新、信息密度高的一手或权威来源，证据足够后立即收口。',
        `- 输出 artifact 建议文件名：company-research-${job.jobId}.md`,
        `- Job 输出目录：${paths.outputsDir}`,
        `- Job 附件目录：${paths.inputsDir}`,
      ].join('\n'),
      userPrompt: [
        `用户请求：${job.requestText}`,
        '',
        '当前附件：',
        attachmentBlock,
      ].join('\n'),
    };
  }

  private buildFreshDeckPrompt(skill: LoadedSkill, stagedAttachments: string[], paths: ExecutionPaths, job: StoredJobRecord): {
    systemPrompt: string;
    userPrompt: string;
  } {
    return {
      systemPrompt: [
        `你正在执行 skill: ${skill.skillName}`,
        '',
        skill.promptContent,
        '',
        '当前模式：fresh_deck',
        '目标：把输入材料压缩为 16:9、商务可用、默认 6-8 页的演示 deck。',
        '只允许使用这些工具：read_skill_file, read_source_file, pptx_plan_deck, pptx_render_deck, pptx_quality_check, pptx_render_previews。',
        '严格流程：',
        '1. 优先读取输入材料，不要凭空写内容。',
        '2. 调用 pptx_plan_deck 生成 deckSpec，必须形成独立 cover、summary、body、closing。',
        '3. 调用 pptx_render_deck 输出 final-deck.pptx。',
        '4. 调用 pptx_quality_check 做 saved-PPTX QA。',
        '5. 若 QA 未通过，修订 deckSpec 后再次 render，最多 2 轮返修。',
        '6. QA 通过后必须调用 pptx_render_previews 生成 PDF 与逐页 JPG，然后立即结束。',
        '版式约束：',
        '- 一页只做一件事，不要把原文整段塞进 slide。',
        '- 非 appendix 页不允许长段落，内容过密要拆页，不要缩小字号。',
        '- cover 必须是单独设计页，closing 不能复用普通内容页。',
        '- deckSpec 只允许使用标准字段：type、headline、goal、supportingPoints、evidence、visualKind、sourceNote。',
        '- 不要自造 left/right/cards/metrics 等字段；如果是 two_column_claim，左栏写入 supportingPoints，右栏写入 evidence。',
        '- 如果是 risk_summary，风险项写入 supportingPoints，持续跟踪项写入 evidence。',
        '- 如果是 kpi_strip，每个指标用“标签：数值”形式写入 supportingPoints/evidence。',
        '- 不允许读取 pptxgenjs.md，不允许生成任意 JS，也不要使用 XML/unpack 工具链。',
        `- 工作目录：${paths.workspaceDir}`,
        `- 输入目录：${paths.inputsDir}`,
        `- 输出目录：${paths.outputsDir}`,
        '- 最终输出文件名固定为 final-deck.pptx。',
      ].join('\n'),
      userPrompt: [
        `用户请求：${job.requestText}`,
        '',
        '可用输入文件：',
        ...(stagedAttachments.length > 0 ? stagedAttachments.map((item) => `- ${item}`) : ['- 无']),
      ].join('\n'),
    };
  }

  private buildTemplateFollowingPrompt(skill: LoadedSkill, stagedAttachments: string[], paths: ExecutionPaths, job: StoredJobRecord): {
    systemPrompt: string;
    userPrompt: string;
  } {
    return {
      systemPrompt: [
        `你正在执行 skill: ${skill.skillName}`,
        '',
        skill.promptContent,
        '',
        '当前模式：template_following',
        '目标：基于用户提供的 .pptx/.potx 模板，走受控 XML 工具链完成内容替换与出图。',
        '只允许通过工具修改文件，不允许假设 shell 可用。',
        '建议先读取 editing.md，然后读取输入材料，接着走 unpack -> edit -> clean -> pack -> quality_check -> render_previews。',
        '必须要求：',
        '- 输出目录中必须生成 final-deck.pptx。',
        '- QA 通过后必须生成 PDF 和 JPG 预览。',
        '- 如果用户同时提供了 markdown/txt/pdf 等材料，先用 read_source_file 或 read_workspace_file 获取内容，再映射到模板。',
        `- 工作目录：${paths.workspaceDir}`,
        `- 输入目录：${paths.inputsDir}`,
        `- 输出目录：${paths.outputsDir}`,
      ].join('\n'),
      userPrompt: [
        `用户请求：${job.requestText}`,
        '',
        '可用输入文件：',
        ...(stagedAttachments.length > 0 ? stagedAttachments.map((item) => `- ${item}`) : ['- 无']),
      ].join('\n'),
    };
  }

  private ensurePptxArtifacts(jobId: string): void {
    const artifacts = this.options.repository.listArtifacts(jobId);
    const hasPptx = artifacts.some((artifact) => artifact.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const hasPdf = artifacts.some((artifact) => artifact.mimeType === 'application/pdf');
    const hasJpg = artifacts.some((artifact) => artifact.mimeType === 'image/jpeg');

    if (!hasPptx) {
      throw new BadRequestError('pptx skill 未生成最终的 .pptx 产物');
    }
    if (!hasPdf || !hasJpg) {
      throw new BadRequestError('pptx skill 未生成完整预览产物（PDF/JPG）');
    }
  }

  async execute(job: StoredJobRecord, skill: LoadedSkill): Promise<{ finalText: string | null }> {
    const paths = this.createExecutionPaths(job, skill);
    const stagedAttachments = this.stageAttachments(job, paths);

    const emitEvent = (type: JobEvent['type'], message: string, data?: unknown) => {
      this.options.repository.appendEvent(job.jobId, type, message, data);
    };

    const publishTextArtifact = (fileName: string, content: string, mimeType?: string) => {
      const artifact = this.options.artifactStore.writeTextArtifact(job.jobId, fileName, content, mimeType);
      emitEvent('artifact', `生成产物 ${artifact.fileName}`, artifact);
      return artifact;
    };

    const publishFileArtifact = (sourcePath: string, fileName?: string, mimeType?: string) => {
      const artifact = this.options.artifactStore.publishFile(job.jobId, sourcePath, fileName, mimeType);
      emitEvent('artifact', `生成产物 ${artifact.fileName}`, artifact);
      return artifact;
    };

    const context = {
      job,
      skill,
      paths,
      webSearchClient: this.options.webSearchClient,
      fetchImpl: this.options.fetchImpl,
      emitEvent,
      publishTextArtifact,
      publishFileArtifact,
    };

    let systemPrompt = '';
    let userPrompt = '';
    let tools;
    let maxTurns: number | undefined;
    let stopWhen: ((state: {
      turn: number;
      messages: any[];
      toolExecutions: ToolExecutionRecord[];
    }) => { stop: boolean; finalText?: string | null } | null) | undefined;

    if (skill.skillName === 'company-research') {
      ({ systemPrompt, userPrompt } = this.buildCompanyResearchPrompt(skill, stagedAttachments, paths, job));
      tools = createCompanyResearchTools();
    } else if (skill.skillName === 'pptx') {
      const pptxMode = inferPptxMode(stagedAttachments);
      if (pptxMode === 'fresh_deck') {
        ({ systemPrompt, userPrompt } = this.buildFreshDeckPrompt(skill, stagedAttachments, paths, job));
        maxTurns = 24;
        stopWhen = ({ toolExecutions }) => {
          if (!hasPreviewAfterPassedQa(toolExecutions)) {
            return null;
          }

          return {
            stop: true,
            finalText: 'Deck generated, quality-checked, and preview artifacts rendered.',
          };
        };
      } else {
        ({ systemPrompt, userPrompt } = this.buildTemplateFollowingPrompt(skill, stagedAttachments, paths, job));
        maxTurns = 20;
        stopWhen = ({ toolExecutions }) => {
          if (!hasPreviewAfterPassedQa(toolExecutions)) {
            return null;
          }

          return {
            stop: true,
            finalText: 'Template-following deck updated, quality-checked, and preview artifacts rendered.',
          };
        };
      }

      tools = createPptxTools(pptxMode);
    } else {
      throw new BadRequestError(`当前 skill 尚不支持执行: ${skill.skillName}`);
    }

    const result = await runToolLoop({
      client: this.options.chatClient,
      model: job.model,
      systemPrompt,
      userPrompt,
      tools,
      context,
      maxTurns,
      stopWhen,
    });

    this.publishOutputArtifacts(job.jobId, paths.outputsDir);
    if (skill.skillName === 'company-research' && this.options.repository.listArtifacts(job.jobId).length === 0 && result.finalText?.trim()) {
      publishTextArtifact(`company-research-${job.jobId}.md`, result.finalText.trim());
    }

    if (skill.skillName === 'pptx') {
      this.ensurePptxArtifacts(job.jobId);
    }

    return {
      finalText: result.finalText,
    };
  }
}
