import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
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
import { DocmeeClient, type DocmeeAiLayoutResponse, type DocmeeOptionItem } from './docmee-client.js';
import { inferPptxMode, type PptxMode } from './pptx-deck.js';
import { BadRequestError, ExternalServiceError } from './errors.js';
import { isPathWithin } from './path-utils.js';
import { JobRepository } from './job-repository.js';
import {
  createCompanyResearchTools,
  createGenericTextTools,
  createPptxTools,
  type ExecutionPaths,
  type ToolExecutionRecord,
  runToolLoop,
} from './tool-runtime.js';
import {
  createPromptMetadata,
  createSuperPptRuntimeToken,
  DEFAULT_SUPER_PPT_PROMPT,
  type DocmeeLayoutState,
  runOfficialDocmeeLayoutFlow,
  resolveSuperPptPrompt,
} from './super-ppt-docmee.js';

const GENERIC_TEXT_SKILLS = new Set([
  'visit-conversation-understanding',
  'customer-needs-todo-analysis',
  'problem-statement',
  'customer-value-positioning',
]);
const SUPER_PPT_SKILL = 'super-ppt';
const SUPER_PPT_OFFICIAL_FLOW_TIMEOUT_MS = 600_000;
const SUPER_PPT_OFFICIAL_FLOW_INTERVAL_MS = 5_000;

function extractMarkdownSubject(markdown: string, attachmentPath: string): string {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }

  const fileName = basename(attachmentPath, extname(attachmentPath)).trim();
  return fileName || 'super-ppt';
}

function resolveDocmeeOptionValue(
  items: DocmeeOptionItem[],
  preferredValue: string,
  fallbackValue: string,
): string {
  const matchedItem = items.find((item) => item.value === preferredValue || item.name === preferredValue);
  return matchedItem?.value || fallbackValue || items[0]?.value;
}

function pickDocmeeMarkdownContent(payload: {
  text?: string;
  markdown?: string;
}, taskId: string): string {
  const content = payload.markdown?.trim() || payload.text?.trim() || '';
  if (!content) {
    throw new ExternalServiceError('Docmee 未返回可用的 Markdown 内容', {
      taskId,
      payload,
    });
  }

  return content;
}

function isDocmeeTemplateLayoutFailure(error: unknown): boolean {
  if (!(error instanceof ExternalServiceError)) {
    return false;
  }

  const detailsText = (() => {
    try {
      return JSON.stringify(error.details ?? {});
    } catch {
      return String(error.details ?? '');
    }
  })().toLowerCase();
  const combined = `${error.message}\n${detailsText}`.toLowerCase();
  return combined.includes('模板解析失败')
    || combined.includes('classification result must include at least one content page');
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
      docmeeClient: DocmeeClient;
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
        '- 为保证稳定性，请控制在最多 2 次 web_search 与最多 2 次 web_fetch_extract 内完成。',
        '- 已获得公司主体、业务定位、主要产品和 2 条以上来源后，立即调用 write_text_artifact 收口。',
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
      supportFileHints.push('- 如需把握输出语气或结构，可按需读取 examples/ 下的示例。');
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
        '- 如技能自带 template.md 或 examples，可按需读取，但不要把模板说明原样照抄到最终结果中。',
        '- 必须在结束前调用 write_text_artifact 生成 markdown 产物。',
        `- 输出 artifact 建议文件名：${skill.skillName}-${job.jobId}.md`,
        `- Job 输出目录：${paths.outputsDir}`,
        `- Job 附件目录：${paths.inputsDir}`,
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

  private assertSuperPptAttachment(stagedAttachments: string[]): string {
    if (stagedAttachments.length !== 1) {
      throw new BadRequestError('super-ppt 当前只支持 1 个 markdown 附件');
    }

    const attachmentPath = stagedAttachments[0]!;
    if (extname(attachmentPath).toLowerCase() !== '.md') {
      throw new BadRequestError('super-ppt 当前只支持 .md 附件');
    }

    return attachmentPath;
  }

  private async executeSuperPpt(input: {
    job: StoredJobRecord;
    paths: ExecutionPaths;
    stagedAttachments: string[];
    emitEvent: (type: JobEvent['type'], message: string, data?: unknown) => void;
    publishTextArtifact: (fileName: string, content: string, mimeType?: string) => JobArtifact;
    publishFileArtifact: (sourcePath: string, fileName?: string, mimeType?: string) => JobArtifact;
  }): Promise<{ finalText: string | null }> {
    const sourceAttachment = this.assertSuperPptAttachment(input.stagedAttachments);
    const sourceMarkdownRaw = readFileSync(sourceAttachment, 'utf8');
    const sourceMarkdown = sourceMarkdownRaw.trim();
    if (!sourceMarkdown) {
      throw new BadRequestError('super-ppt 附件内容为空');
    }

    const subject = extractMarkdownSubject(sourceMarkdown, sourceAttachment);
    const resolvedPrompt = resolveSuperPptPrompt(input.job.presentationPrompt?.trim() || DEFAULT_SUPER_PPT_PROMPT);
    const runtimeToken = await createSuperPptRuntimeToken(this.options.docmeeClient, input.job.jobId);

    input.emitEvent('message', 'Docmee createTask 已开始', {
      subject,
      sourceAttachment,
      promptFallbackApplied: resolvedPrompt.isFallbackApplied,
    });
    const task = await this.options.docmeeClient.createTask({
      type: 2,
      files: [
        {
          fileName: basename(sourceAttachment),
          file: readFileSync(sourceAttachment),
          mimeType: 'text/markdown; charset=utf-8',
        },
      ],
    }, runtimeToken);

    const optionPayload = await this.options.docmeeClient.options(runtimeToken);
    const scene = resolveDocmeeOptionValue(optionPayload.scene, '公司介绍', '公司介绍');
    const audience = resolveDocmeeOptionValue(optionPayload.audience, '大众', '大众');
    const lang = resolveDocmeeOptionValue(optionPayload.lang, 'zh', 'zh');

    input.emitEvent('message', 'Docmee 大纲生成中', {
      taskId: task.id,
      scene,
      audience,
      lang,
    });
    const generated = await this.options.docmeeClient.generateContent({
      id: task.id,
      stream: true,
      outlineType: 'JSON',
      questionMode: false,
      isNeedAsk: false,
      length: 'short',
      scene,
      audience,
      lang,
      prompt: resolvedPrompt.effectivePrompt,
      aiSearch: false,
      isGenImg: false,
    }, runtimeToken);
    if (typeof generated.result === 'undefined') {
      throw new ExternalServiceError('Docmee 未返回结构化大纲结果', {
        taskId: task.id,
        generated,
      });
    }

    input.emitEvent('message', 'Docmee AI 智能布局排版中', {
      taskId: task.id,
      templateId: input.job.templateId,
    });
    let docmeeFlow = 'official-v2-main-flow';
    let aiLayout: DocmeeAiLayoutResponse = {
      streamLog: '',
      events: [],
      finalEventData: undefined,
      inferredMarkdown: null,
      inferredHtml: null,
      inferredStatus: null,
      aborted: false,
    };
    let latestData: Record<string, unknown> | null = null;
    let convertResult: Record<string, unknown> | null = null;
    let latestDataError: string | null = null;
    let convertResultError: string | null = null;
    let finalMarkdownSource = 'markdown_generate_after_official_layout';
    let convertStatus: string | null = null;
    let finalMarkdown = '';
    let officialLayoutState: DocmeeLayoutState | null = null;
    let officialFlowError: {
      message: string;
      details?: unknown;
    } | null = null;

    try {
      const officialFlow = await runOfficialDocmeeLayoutFlow({
        docmeeClient: this.options.docmeeClient,
        taskId: task.id,
        runtimeToken,
        data: generated.result,
        templateId: input.job.templateId ?? undefined,
        timeoutMs: SUPER_PPT_OFFICIAL_FLOW_TIMEOUT_MS,
        intervalMs: SUPER_PPT_OFFICIAL_FLOW_INTERVAL_MS,
      });
      aiLayout = officialFlow.aiLayout;
      latestData = officialFlow.latestData;
      convertResult = officialFlow.convertResult;
      latestDataError = officialFlow.latestDataError;
      convertResultError = officialFlow.convertResultError;
      officialLayoutState = officialFlow.layoutState;
      convertStatus = officialFlow.layoutState.status;

      input.emitEvent('message', 'Docmee AI 布局已完成，开始生成最终 Markdown', {
        taskId: task.id,
        layoutStatus: officialFlow.layoutState.status,
        layoutSource: officialFlow.layoutState.source,
        templateId: input.job.templateId,
      });
      const markdownGenerated = await this.options.docmeeClient.generateContent({
        id: task.id,
        stream: false,
        outlineType: 'MD',
        questionMode: false,
        isNeedAsk: false,
        length: 'short',
        scene,
        audience,
        lang,
        prompt: resolvedPrompt.effectivePrompt,
        aiSearch: false,
        isGenImg: false,
      }, runtimeToken);
      finalMarkdown = pickDocmeeMarkdownContent(markdownGenerated, task.id);
    } catch (error) {
      officialFlowError = {
        message: error instanceof Error ? error.message : String(error),
        details: error instanceof ExternalServiceError ? error.details : undefined,
      };
      latestDataError = officialFlowError.message;

      if (input.job.templateId && isDocmeeTemplateLayoutFailure(error)) {
        input.emitEvent('error', 'Docmee 模板解析失败，已停止本次带模板生成', {
          taskId: task.id,
          templateId: input.job.templateId,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw new ExternalServiceError(
          'Docmee 模板解析失败：当前模板未识别到可用内容页，请在企业PPT模板中更换或修复模板后重试。',
          {
            taskId: task.id,
            templateId: input.job.templateId,
            cause: error instanceof ExternalServiceError ? error.details : error,
          },
        );
      }

      input.emitEvent('error', 'Docmee 官方链路未完成，已停止本次生成，未执行降级链路', {
        taskId: task.id,
        templateId: input.job.templateId,
        reason: officialFlowError.message,
        officialFlowError: officialFlowError.details ?? null,
      });
      throw new ExternalServiceError(
        'Docmee 官方链路未完成，已停止本次生成，未执行降级 PPT。请检查模板兼容性或等待布局任务完成后重试。',
        {
          taskId: task.id,
          templateId: input.job.templateId,
          officialFlowError,
          cause: error instanceof ExternalServiceError ? error.details : error,
        },
      );
    }

    input.emitEvent('message', 'Docmee PPT 生成中', {
      taskId: task.id,
      templateId: input.job.templateId,
      finalMarkdownSource,
    });
    const pptInfo = await this.options.docmeeClient.generatePptx({
      id: task.id,
      markdown: finalMarkdown,
      templateId: input.job.templateId ?? undefined,
    }, runtimeToken);
    const pptId = pptInfo.id?.trim();
    if (!pptId) {
      throw new ExternalServiceError('Docmee 未返回 pptId', {
        taskId: task.id,
        pptInfo,
      });
    }

    const downloaded = await this.options.docmeeClient.downloadPptxBinary(pptId, runtimeToken);
    const pptFileName = `super-ppt-${input.job.jobId}.pptx`;
    const pptFilePath = join(input.paths.outputsDir, pptFileName);
    writeFileSync(pptFilePath, downloaded.file);

    const pptArtifact = input.publishFileArtifact(
      pptFilePath,
      pptFileName,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    const sourceMarkdownArtifact = input.publishTextArtifact(
      `super-ppt-${input.job.jobId}-source.md`,
      sourceMarkdownRaw,
      'text/markdown',
    );
    const contentOutlineArtifact = input.publishTextArtifact(
      `super-ppt-${input.job.jobId}-content-outline.json`,
      JSON.stringify(generated.result, null, 2),
      'application/json',
    );
    const aiLayoutLogArtifact = input.publishTextArtifact(
      `super-ppt-${input.job.jobId}-ai-layout.log`,
      aiLayout.streamLog,
      'text/plain',
    );
    const finalMarkdownArtifact = input.publishTextArtifact(
      `super-ppt-${input.job.jobId}-final-markdown.md`,
      finalMarkdown,
      'text/markdown',
    );
    input.publishTextArtifact(
      `super-ppt-${input.job.jobId}.json`,
      JSON.stringify(
        {
          docmeeFlow,
          taskId: task.id,
          pptId,
          subject: pptInfo.subject || subject,
          scene,
          audience,
          lang,
          sourceAttachment,
          sourceMarkdownArtifactId: sourceMarkdownArtifact.artifactId,
          contentOutlineArtifactId: contentOutlineArtifact.artifactId,
          aiLayoutLogArtifactId: aiLayoutLogArtifact.artifactId,
          finalMarkdownArtifactId: finalMarkdownArtifact.artifactId,
          sourceMarkdownCharLength: sourceMarkdownRaw.length,
          sourceMarkdownLineCount: sourceMarkdownRaw.split(/\r?\n/).length,
          prompt: createPromptMetadata(this.options.config, resolvedPrompt),
          requestedTemplateId: input.job.templateId,
          latestData,
          latestDataError,
          convertResult,
          convertResultError,
          officialLayoutState,
          officialFlowError,
          generated,
          aiLayout: {
            finalEventData: aiLayout.finalEventData,
            inferredMarkdown: aiLayout.inferredMarkdown,
            inferredHtml: aiLayout.inferredHtml,
            inferredStatus: aiLayout.inferredStatus,
            eventCount: aiLayout.events.length,
            aborted: aiLayout.aborted ?? false,
          },
          finalMarkdownSource,
          convertStatus,
          pptInfo,
          downloadMetadata: downloaded.metadata,
        },
        null,
        2,
      ),
      'application/json',
    );

    input.emitEvent('presentation_ready', 'PPT 已生成，可进入编辑器继续修改', {
      pptId,
      subject: pptInfo.subject || subject,
      templateId: pptInfo.templateId || downloaded.metadata.templateId || input.job.templateId || null,
      coverUrl: pptInfo.coverUrl || downloaded.metadata.coverUrl || null,
      animation: false,
      artifactId: pptArtifact.artifactId,
      docmeeFlow,
      convertStatus,
    });

    return {
      finalText: `PPT 已生成：${pptInfo.subject || subject}（pptId: ${pptId}）`,
    };
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

    if (skill.skillName === SUPER_PPT_SKILL) {
      return this.executeSuperPpt({
        job,
        paths,
        stagedAttachments,
        emitEvent,
        publishTextArtifact,
        publishFileArtifact,
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

    this.publishOutputArtifacts(job.jobId, paths.outputsDir);
    if (
      (skill.skillName === 'company-research' || GENERIC_TEXT_SKILLS.has(skill.skillName))
      && this.options.repository.listArtifacts(job.jobId).length === 0
      && result.finalText?.trim()
    ) {
      publishTextArtifact(`${skill.skillName}-${job.jobId}.md`, result.finalText.trim());
    }

    if (skill.skillName === 'pptx') {
      this.ensurePptxArtifacts(job.jobId);
    }

    return {
      finalText: result.finalText,
    };
  }
}
