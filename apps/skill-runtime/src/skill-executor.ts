import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
  SupportedDeepseekModel,
  WebSearchClient,
} from './contracts.js';
import { inferPptxMode, type PptxMode } from './pptx-deck.js';
import { BadRequestError, ExternalServiceError } from './errors.js';
import { isPathWithin } from './path-utils.js';
import { JobRepository } from './job-repository.js';
import { ReportCanvasClient } from './report-canvas-client.js';
import {
  createCompanyResearchTools,
  createGenericTextTools,
  createPptxTools,
  type ExecutionPaths,
  type ToolExecutionRecord,
  runToolLoop,
} from './tool-runtime.js';

const GENERIC_TEXT_SKILLS = new Set([
  'visit-conversation-understanding',
  'customer-needs-todo-analysis',
  'customer-value-positioning',
  'yunzhijia-visit-prep',
]);
const REPORT_GENERATION_SKILL = 'report-generation';

function extractMarkdownSubject(markdown: string, attachmentPath: string): string {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }

  const fileName = basename(attachmentPath, extname(attachmentPath)).trim();
  return fileName || 'report';
}

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
      reportCanvasClient: ReportCanvasClient;
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

  private async publishOutputArtifacts(jobId: string, outputDir: string): Promise<JobArtifact[]> {
    const supportedExtensions = new Set(this.options.config.runtime.outputScanExtensions);
    const artifacts: JobArtifact[] = [];

    for (const filePath of walkFiles(outputDir)) {
      if (!supportedExtensions.has(extname(filePath).toLowerCase())) {
        continue;
      }

      const relativePath = relative(outputDir, filePath);
      artifacts.push(
        await this.options.artifactStore.publishFile(
          jobId,
          filePath,
          relativePath.replace(/[\\/]+/g, '-'),
          guessMimeType(filePath),
        ),
      );
      await this.options.repository.appendEvent(
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
        '- 为保证稳定性，请控制在最多 2 次 web_search 与最多 2 次 web_fetch_extract 内完成。',
        '- 已获得公司主体、业务定位、主要产品和 2 条以上来源后，立即调用 write_text_artifact 收口。',
        '- 如果无法从公开来源确认目标公司主体，或没有可靠公开资料支撑，请不要编造业务定位、产品、风险或销售建议。',
        '- 查不到有效资料时，仍需调用 write_text_artifact 写入简短 Markdown，明确写出“未检索到「目标公司名」的有效公开公司信息”，并说明未生成公司研究资料。',
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

  private buildGenericTextPrompt(skill: LoadedSkill, stagedAttachments: string[], paths: ExecutionPaths, job: StoredJobRecord): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const supportFileHints = [];
    if (skill.profile.hasTemplate) {
      supportFileHints.push('- 如需固定结构，请先读取 template.md。');
    }
    if (skill.profile.examples.length > 0) {
      supportFileHints.push(`- 如需把握输出语气或结构，只读取这些示例文件：${skill.profile.examples.join('、')}。`);
    }

    return {
      systemPrompt: [
        `你正在执行 skill: ${skill.skillName}`,
        '',
        skill.promptContent,
        '',
        '执行约束：',
        '- 只允许使用这些工具：read_skill_file, read_source_file, write_text_artifact。',
        '- 必须产出结构化 markdown，不要输出闲聊式答复。',
        '- 如果用户提供了附件，优先读取附件后再组织内容；没有附件时，直接基于 requestText 生成。',
        '- 只能读取“可用输入文件”清单中的具体文件路径，不要把输入目录、输出目录或工作目录当作文件读取。',
        '- 如技能自带 template.md 或 examples，可按需读取，但不要把模板说明原样照抄到最终结果中。',
        '- 必须在结束前调用 write_text_artifact 生成 markdown 产物。',
        `- 输出 artifact 建议文件名：${skill.skillName}-${job.jobId}.md`,
        `- Job 输出目录：${paths.outputsDir}`,
        ...supportFileHints,
      ].join('\n'),
      userPrompt: [
        `用户请求：${job.requestText}`,
        '',
        '可用输入文件：',
        ...(stagedAttachments.length > 0 ? stagedAttachments.map((item) => `- ${item}`) : ['- 无']),
      ].join('\n'),
    };
  }

  private async ensurePptxArtifacts(jobId: string): Promise<void> {
    const artifacts = await this.options.repository.listArtifacts(jobId);
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

  private assertMarkdownAttachment(skillName: string, stagedAttachments: string[]): string {
    if (stagedAttachments.length !== 1) {
      throw new BadRequestError(`${skillName} 当前只支持 1 个 markdown 附件`);
    }

    const attachmentPath = stagedAttachments[0]!;
    if (extname(attachmentPath).toLowerCase() !== '.md') {
      throw new BadRequestError(`${skillName} 当前只支持 .md 附件`);
    }

    return attachmentPath;
  }

  private async executeReportGeneration(input: {
    job: StoredJobRecord;
    stagedAttachments: string[];
    emitEvent: (type: JobEvent['type'], message: string, data?: unknown) => Promise<void>;
    publishTextArtifact: (fileName: string, content: string, mimeType?: string) => Promise<JobArtifact>;
  }): Promise<{ finalText: string | null }> {
    const sourceAttachment = this.assertMarkdownAttachment(REPORT_GENERATION_SKILL, input.stagedAttachments);
    const sourceMarkdownRaw = readFileSync(sourceAttachment, 'utf8');
    const sourceMarkdown = sourceMarkdownRaw.trim();
    if (!sourceMarkdown) {
      throw new BadRequestError('report-generation 附件内容为空');
    }

    const subject = extractMarkdownSubject(sourceMarkdown, sourceAttachment);
    await input.emitEvent('message', '报告 Canvas 生成请求已提交', {
      subject,
      sourceAttachment,
    });

    const created = await this.options.reportCanvasClient.generate({
      markdown: sourceMarkdown,
      query: input.job.requestText,
      ttlMinutes: 1440,
    });
    const transientOpenUrl = `${this.options.config.reportCanvas.publicBaseUrl.replace(/\/+$/, '')}/embed/${encodeURIComponent(created.sessionId)}`;

    await input.emitEvent('message', '报告 Canvas 会话已创建', {
      sessionId: created.sessionId,
      openUrl: transientOpenUrl,
      statusUrl: created.statusUrl,
      resultUrl: created.resultUrl,
    });

    const startedAt = Date.now();
    let latestStatus = await this.options.reportCanvasClient.getStatus(created.sessionId);
    while (
      latestStatus.status !== 'complete'
      && latestStatus.status !== 'error'
      && Date.now() - startedAt < this.options.config.reportCanvas.timeoutMs
    ) {
      await input.emitEvent('message', '报告 Canvas 生成中', {
        sessionId: created.sessionId,
        status: latestStatus.status,
        stage: latestStatus.stage,
        progress: latestStatus.progress,
      });
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, this.options.config.reportCanvas.pollIntervalMs);
      });
      latestStatus = await this.options.reportCanvasClient.getStatus(created.sessionId);
    }

    if (latestStatus.status === 'error') {
      throw new ExternalServiceError(latestStatus.error?.message || '报告 Canvas 生成失败', {
        sessionId: created.sessionId,
        status: latestStatus,
      });
    }

    if (latestStatus.status !== 'complete') {
      throw new ExternalServiceError('报告 Canvas 生成超时，请稍后重试', {
        sessionId: created.sessionId,
        status: latestStatus,
        timeoutMs: this.options.config.reportCanvas.timeoutMs,
      });
    }

    const result = await this.options.reportCanvasClient.getResult(created.sessionId);
    if (result.status !== 'complete' || !('code' in result) || !result.code?.trim()) {
      throw new ExternalServiceError('报告 Canvas 已完成但未返回报告代码', {
        sessionId: created.sessionId,
        result,
      });
    }

    await input.publishTextArtifact(
      `report-generation-${input.job.jobId}-source.md`,
      sourceMarkdownRaw,
      'text/markdown',
    );
    const codeArtifact = await input.publishTextArtifact(
      `report-generation-${input.job.jobId}-report.jsx`,
      result.code,
      'text/plain',
    );
    const metadataArtifact = await input.publishTextArtifact(
      `report-generation-${input.job.jobId}.json`,
      JSON.stringify(
        {
          sessionId: created.sessionId,
          transientSessionId: created.sessionId,
          subject,
          openUrl: transientOpenUrl,
          transientOpenUrl,
          sourceAttachment,
          codeArtifactId: codeArtifact.artifactId,
          created,
          status: latestStatus,
          result: {
            sessionId: result.sessionId,
            status: result.status,
            embedUrl: result.embedUrl,
            metadata: result.metadata,
          },
        },
        null,
        2,
      ),
      'application/json',
    );

    await input.emitEvent('report_ready', '报告已生成，可在新页面打开', {
      sessionId: created.sessionId,
      transientSessionId: created.sessionId,
      subject,
      openUrl: transientOpenUrl,
      transientOpenUrl,
      artifactId: metadataArtifact.artifactId,
      codeArtifactId: codeArtifact.artifactId,
      metadataArtifactId: metadataArtifact.artifactId,
      generatedAt: result.metadata.generatedAt,
      codeLength: result.metadata.codeLength,
    });

    return {
      finalText: `报告已生成：${subject}\n${transientOpenUrl}`,
    };
  }

  async execute(job: StoredJobRecord, skill: LoadedSkill): Promise<{ finalText: string | null }> {
    const paths = this.createExecutionPaths(job, skill);
    const stagedAttachments = this.stageAttachments(job, paths);

    const emitEvent = async (type: JobEvent['type'], message: string, data?: unknown) => {
      await this.options.repository.appendEvent(job.jobId, type, message, data);
    };

    const publishTextArtifact = async (fileName: string, content: string, mimeType?: string) => {
      const artifact = await this.options.artifactStore.writeTextArtifact(job.jobId, fileName, content, mimeType);
      await emitEvent('artifact', `生成产物 ${artifact.fileName}`, artifact);
      return artifact;
    };

    const publishFileArtifact = async (sourcePath: string, fileName?: string, mimeType?: string) => {
      const artifact = await this.options.artifactStore.publishFile(job.jobId, sourcePath, fileName, mimeType);
      await emitEvent('artifact', `生成产物 ${artifact.fileName}`, artifact);
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

    if (skill.skillName === REPORT_GENERATION_SKILL) {
      return this.executeReportGeneration({
        job,
        stagedAttachments,
        emitEvent,
        publishTextArtifact,
      });
    }

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
      maxTurns = 8;
      stopWhen = ({ messages, toolExecutions }) => {
        if (!toolExecutions.some((item) => item.name === 'write_text_artifact')) {
          return null;
        }

        const lastAssistantMessage = [...messages]
          .reverse()
          .find((item) => item.role === 'assistant' && typeof item.content === 'string' && item.content.trim());
        if (!lastAssistantMessage?.content?.trim()) {
          return null;
        }

        return {
          stop: true,
          finalText: lastAssistantMessage.content.trim(),
        };
      };
    } else if (GENERIC_TEXT_SKILLS.has(skill.skillName)) {
      ({ systemPrompt, userPrompt } = this.buildGenericTextPrompt(skill, stagedAttachments, paths, job));
      tools = createGenericTextTools();
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

    const model = job.model as SupportedDeepseekModel | null;
    if (!model) {
      throw new BadRequestError(`当前 skill 缺少可用模型: ${skill.skillName}`);
    }

    const result = await runToolLoop({
      client: this.options.chatClient,
      model,
      systemPrompt,
      userPrompt,
      tools,
      context,
      maxTurns,
      stopWhen,
    });

    await this.publishOutputArtifacts(job.jobId, paths.outputsDir);
    if (
      (skill.skillName === 'company-research' || GENERIC_TEXT_SKILLS.has(skill.skillName))
      && (await this.options.repository.listArtifacts(job.jobId)).length === 0
      && result.finalText?.trim()
    ) {
      await publishTextArtifact(`${skill.skillName}-${job.jobId}.md`, result.finalText.trim());
    }

    if (skill.skillName === 'pptx') {
      await this.ensurePptxArtifacts(job.jobId);
    }

    return {
      finalText: result.finalText,
    };
  }
}
