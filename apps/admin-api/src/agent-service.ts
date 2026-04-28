import { randomUUID } from 'node:crypto';
import type {
  AgentChatMessage,
  AgentChatRequest,
  AgentChatResponse,
  AgentEvidenceCard,
  AgentExecutionStatus,
  AgentToolCall,
  AppConfig,
  ArtifactAnchor,
  ExecutionState,
  ExternalSkillJobResponse,
  IntentFrame,
  TaskPlan,
} from './contracts.js';
import { buildTaskPlan, createTraceId, finishPlan } from './agent-utils.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import type { IntentFrameService } from './intent-frame-service.js';
import { getErrorMessage } from './errors.js';

const COMPANY_RESEARCH_TOOL = 'ext.company_research_pm';
const COMPANY_RESEARCH_POLL_INTERVAL_MS = 1000;
const COMPANY_RESEARCH_MAX_WAIT_MS = 420_000;

type SkillJobWaitResult =
  | {
      status: 'succeeded';
      job: ExternalSkillJobResponse;
    }
  | {
      status: 'still_running';
      job: ExternalSkillJobResponse;
    };

export class AgentService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: AgentRunRepository;
      intentFrameService: IntentFrameService;
      externalSkillService: ExternalSkillService;
      artifactService: ArtifactService;
      companyResearchMaxWaitMs?: number;
    },
  ) {}

  async chat(request: AgentChatRequest): Promise<AgentChatResponse> {
    const runId = randomUUID();
    const traceId = createTraceId();
    const startedAt = new Date().toISOString();
    const eid = request.tenantContext?.eid?.trim() || this.options.config.yzj.eid;
    const appId = request.tenantContext?.appId?.trim() || this.options.config.yzj.appId;
    const focusedCompany = this.options.repository.findFocusedCompany(request.conversationKey);
    const intentFrame = await this.options.intentFrameService.createIntentFrame(request, focusedCompany);
    const taskPlan = buildTaskPlan(intentFrame);
    const toolCalls: AgentToolCall[] = [];

    let finalPlan = taskPlan;
    let status: AgentExecutionStatus = 'completed';
    let content = '';
    let headline = '';
    let references: string[] = [];
    let evidence: AgentEvidenceCard[] = [];
    let qdrantFilter: unknown;
    let attachments: AgentChatMessage['attachments'] = [];
    let currentStepKey: string | null = null;

    try {
      if (taskPlan.kind === 'company_research') {
        const result = await this.executeCompanyResearch({
          request,
          intentFrame,
          eid,
          appId,
          runId,
          toolCalls,
        });
        content = result.content;
        headline = result.headline;
        references = result.references;
        evidence = result.evidence;
        attachments = result.attachments;
        if ('status' in result) {
          status = result.status;
        }
        if ('currentStepKey' in result) {
          currentStepKey = result.currentStepKey;
        }
      } else if (taskPlan.kind === 'artifact_search') {
        const result = await this.executeArtifactSearch({
          request,
          intentFrame,
          eid,
          appId,
          runId,
          toolCalls,
        });
        content = result.content;
        headline = result.headline;
        references = result.references;
        evidence = result.evidence;
        qdrantFilter = result.qdrantFilter;
      } else if (taskPlan.kind === 'audio_not_supported') {
        status = 'paused';
        content = buildAudioNotSupportedContent(request);
        headline = '当前 MVP 暂不做录音转写';
        references = ['MVP 策略', '等待文字纪要'];
      } else {
        status = 'waiting_input';
        content = '我还需要你补充目标对象或希望完成的动作，例如“研究这家公司 XX有限公司”或“这个客户最近有什么值得关注”。';
        headline = '需要补充信息';
        references = ['meta.clarify_card'];
      }
    } catch (error) {
      status = 'tool_unavailable';
      content = `当前 Agent 框架已生成 IntentFrame 和 TaskPlan，但工具执行失败：${getErrorMessage(error)}`;
      headline = '工具暂不可用';
      references = ['Tool Registry', taskPlan.kind];
    }

    finalPlan = status === 'running' ? markPlanRunning(taskPlan, currentStepKey) : finishPlan(taskPlan, status);
    const executionState: ExecutionState = {
      runId,
      traceId,
      status,
      currentStepKey,
      message: headline,
      startedAt,
      finishedAt: status === 'running' ? null : new Date().toISOString(),
    };
    const message = buildMessage({
      sceneKey: request.sceneKey,
      content,
      attachments,
      headline,
      references,
      evidence,
      traceId,
      intentFrame,
      taskPlan: finalPlan,
      executionState,
      toolCalls,
      qdrantFilter,
    });

    this.options.repository.saveRun({
      request,
      runId,
      traceId,
      eid,
      appId,
      intentFrame,
      taskPlan: finalPlan,
      executionState,
      toolCalls,
      evidence,
      message,
    });

    return {
      success: true,
      data: {
        content: message.content,
        attachments: message.attachments,
        extraInfo: message.extraInfo,
      },
      message,
      intentFrame,
      taskPlan: finalPlan,
      executionState,
      toolCalls,
      traceId,
    };
  }

  private async executeCompanyResearch(input: {
    request: AgentChatRequest;
    intentFrame: IntentFrame;
    eid: string;
    appId: string;
    runId: string;
    toolCalls: AgentToolCall[];
  }) {
    const companyName = input.intentFrame.targets.find((item) => item.type === 'company')?.name;
    if (!companyName) {
      throw new Error('缺少公司名称，无法执行公司研究');
    }

    const skillCall = startToolCall(input.runId, COMPANY_RESEARCH_TOOL, companyName);
    input.toolCalls.push(skillCall);
    let markdown: string;
    let skillReference = 'company-research';
    let degradedReason: string | null = null;

    try {
      const job = await this.options.externalSkillService.createSkillJob(COMPANY_RESEARCH_TOOL, {
        requestText: `研究这家公司：${companyName}。输出业务定位、成长驱动、核心风险、销售切入点和来源引用，使用结构化 Markdown。`,
        model: this.options.config.deepseek.defaultModel,
      });
      const waitResult = await this.waitForSkillJob(job.jobId);
      if (waitResult.status === 'still_running') {
        markToolCallRunning(
          skillCall,
          `job=${waitResult.job.jobId}, status=${waitResult.job.status}, 已超过同步等待窗口`,
        );
        return buildCompanyResearchRunningResult(companyName, waitResult.job, this.companyResearchMaxWaitMs);
      }

      const finishedJob = waitResult.job;
      markdown = await this.resolveMarkdownFromJob(finishedJob);
      skillReference = finishedJob.jobId;
      finishToolCall(skillCall, 'succeeded', `job=${finishedJob.jobId}, artifacts=${finishedJob.artifacts.length}`);
    } catch (error) {
      if (!isCompanyResearchSkillUnavailable(error)) {
        finishToolCall(skillCall, 'failed', '公司研究 Skill 执行失败', error);
        throw error;
      }

      degradedReason = describeCompanyResearchUnavailable(error);
      markdown = buildCompanyResearchFallbackMarkdown(companyName, degradedReason);
      skillReference = 'company-research-fallback';
      finishToolCall(skillCall, 'failed', '公司研究 Skill 依赖缺失，已进入 MVP 降级 Artifact 链路', error);
    }

    const artifactCall = startToolCall(input.runId, 'artifact.company_research', companyName);
    input.toolCalls.push(artifactCall);
    const artifact = await this.options.artifactService.createCompanyResearchArtifact({
      eid: input.eid,
      appId: input.appId,
      title: degradedReason ? `${companyName} 公司研究（MVP降级）` : `${companyName} 公司研究`,
      markdown,
      sourceToolCode: COMPANY_RESEARCH_TOOL,
      anchors: [buildCompanyAnchor(companyName)],
      createdBy: 'agent-runtime',
      summary: summarizeMarkdown(markdown),
      sourceRefs: extractSourceRefs(markdown),
    });
    finishToolCall(artifactCall, 'succeeded', `${artifact.artifact.vectorStatus}, chunks=${artifact.artifact.chunkCount}`);

    const evidence = [
      {
        artifactId: artifact.artifact.artifactId,
        versionId: artifact.artifact.versionId,
        title: artifact.artifact.title,
        version: artifact.artifact.version,
        sourceToolCode: artifact.artifact.sourceToolCode,
        anchorLabel: companyName,
        snippet: summarizeMarkdown(markdown),
        vectorStatus: artifact.artifact.vectorStatus,
      },
    ];

    return {
      content: degradedReason
        ? `## 已生成降级 Artifact\n- 公司：**${companyName}**\n- 原因：${degradedReason}\n- Artifact：${artifact.artifact.title} v${artifact.artifact.version}\n- 向量状态：${artifact.artifact.vectorStatus}\n\n## 当前可验证内容\n${summarizeMarkdown(markdown)}\n\n## 下一步\n1. 配置 \`DEEPSEEK_API_KEY\` 与 \`ARK_API_KEY\` 后，公司研究 Skill 可恢复真实研究。\n2. 你仍可以继续问“这个客户最近有什么值得关注”，验证 Artifact 检索链路。\n3. 如需写入客户或跟进记录，后续必须先生成 preview 并由你确认。`
        : `## 公司研究已完成\n- 公司：**${companyName}**\n- Artifact：${artifact.artifact.title} v${artifact.artifact.version}\n- 向量状态：${artifact.artifact.vectorStatus}\n\n## 研究摘要\n${summarizeMarkdown(markdown)}\n\n## 下一步\n1. 可以继续问“这个客户最近有什么值得关注”。\n2. 如需写入客户或跟进记录，后续必须先生成 preview 并由你确认。`,
      headline: degradedReason ? '公司研究 Skill 不可用，已降级沉淀 Artifact' : '已通过 Agent 调用公司研究 Skill，并沉淀 Artifact',
      references: [skillReference, artifact.artifact.title],
      evidence,
      attachments: [
        {
          name: `${companyName}-公司研究.md`,
          url: '#agent-company-research',
          type: 'markdown',
        },
      ],
    };
  }

  private async executeArtifactSearch(input: {
    request: AgentChatRequest;
    intentFrame: IntentFrame;
    eid: string;
    appId: string;
    runId: string;
    toolCalls: AgentToolCall[];
  }) {
    const companyName = input.intentFrame.targets.find((item) => item.type === 'company')?.name;
    const call = startToolCall(input.runId, 'artifact.search', input.request.query);
    input.toolCalls.push(call);
    const search = await this.options.artifactService.search({
      eid: input.eid,
      appId: input.appId,
      query: input.request.query,
      anchors: companyName ? [buildCompanyAnchor(companyName)] : undefined,
      limit: 5,
    });
    finishToolCall(call, 'succeeded', `${search.vectorStatus}, evidence=${search.evidence.length}`);
    const evidence = search.evidence.map((item) => ({
      artifactId: item.artifactId,
      versionId: item.versionId,
      title: item.title,
      version: item.version,
      sourceToolCode: item.sourceToolCode,
      anchorLabel: item.anchorIds[0] ?? companyName ?? 'Artifact',
      snippet: item.snippet,
      score: item.score,
      vectorStatus: search.vectorStatus,
    }));

    return {
      content: evidence.length
        ? `## 基于已有 Artifact 的回答\n- 客户 / 公司：**${companyName ?? '当前会话对象'}**\n- 可引用证据：${evidence.length} 条\n\n${evidence.slice(0, 2).map((item) => `- ${item.snippet}`).join('\n')}`
        : '当前没有检索到可引用 Artifact。你可以先说“研究这家公司 XX有限公司”，生成公司研究 Artifact 后再继续追问。',
      headline: evidence.length ? '已从 Artifact 检索到可引用证据' : '暂无可用 Artifact 证据',
      references: evidence.map((item) => item.title),
      evidence,
      qdrantFilter: search.qdrantFilter,
    };
  }

  private get companyResearchMaxWaitMs(): number {
    return this.options.companyResearchMaxWaitMs ?? COMPANY_RESEARCH_MAX_WAIT_MS;
  }

  private async waitForSkillJob(jobId: string): Promise<SkillJobWaitResult> {
    let job = await this.options.externalSkillService.getSkillJob(jobId);
    const maxAttempts = Math.ceil(this.companyResearchMaxWaitMs / COMPANY_RESEARCH_POLL_INTERVAL_MS);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (job.status === 'succeeded') {
        return { status: 'succeeded', job };
      }
      if (job.status === 'failed') {
        throw new Error(job.error?.message ?? '公司研究 Skill 执行失败');
      }
      await new Promise((resolve) => setTimeout(resolve, COMPANY_RESEARCH_POLL_INTERVAL_MS));
      job = await this.options.externalSkillService.getSkillJob(jobId);
    }
    if (job.status === 'succeeded') {
      return { status: 'succeeded', job };
    }
    if (job.status === 'failed') {
      throw new Error(job.error?.message ?? '公司研究 Skill 执行失败');
    }
    return { status: 'still_running', job };
  }

  private async resolveMarkdownFromJob(job: ExternalSkillJobResponse): Promise<string> {
    const markdownArtifact = job.artifacts.find((item) => item.mimeType.includes('markdown')) ?? job.artifacts[0];
    if (markdownArtifact) {
      const { content } = await this.options.externalSkillService.getSkillJobArtifact(job.jobId, markdownArtifact.artifactId);
      const markdown = content.toString('utf8').trim();
      if (markdown) {
        return markdown;
      }
    }

    if (job.finalText?.trim()) {
      return job.finalText.trim();
    }

    throw new Error('公司研究 Skill 未返回 Markdown 内容');
  }
}

function buildMessage(input: {
  sceneKey: string;
  content: string;
  attachments?: AgentChatMessage['attachments'];
  headline: string;
  references: string[];
  evidence: AgentEvidenceCard[];
  traceId: string;
  intentFrame: IntentFrame;
  taskPlan: TaskPlan;
  executionState: ExecutionState;
  toolCalls: AgentToolCall[];
  qdrantFilter?: unknown;
}): AgentChatMessage {
  return {
    role: 'assistant',
    content: input.content,
    attachments: input.attachments,
    extraInfo: {
      feedback: 'default',
      sceneKey: input.sceneKey,
      headline: input.headline,
      references: input.references,
      evidence: input.evidence,
      agentTrace: {
        traceId: input.traceId,
        intentFrame: input.intentFrame,
        taskPlan: input.taskPlan,
        executionState: input.executionState,
        toolCalls: input.toolCalls,
        qdrantFilter: input.qdrantFilter,
      },
    },
  };
}

function markPlanRunning(plan: TaskPlan, currentStepKey: string | null): TaskPlan {
  return {
    ...plan,
    status: 'running',
    steps: plan.steps.map((item) => ({
      ...item,
      status: currentStepKey && item.key === currentStepKey ? 'running' : item.status,
    })),
  };
}

function buildCompanyResearchRunningResult(
  companyName: string,
  job: ExternalSkillJobResponse,
  maxWaitMs: number,
): {
  status: AgentExecutionStatus;
  currentStepKey: string;
  content: string;
  headline: string;
  references: string[];
  evidence: AgentEvidenceCard[];
  attachments: AgentChatMessage['attachments'];
} {
  const waitedSeconds = Math.ceil(maxWaitMs / 1000);
  return {
    status: 'running',
    currentStepKey: 'run-company-research',
    content: [
      '## 公司研究仍在运行',
      `- 公司：**${companyName}**`,
      `- Skill Job：\`${job.jobId}\``,
      `- 当前状态：${job.status}`,
      `- 同步等待：已等待约 ${waitedSeconds} 秒，真实联网研究仍在 skill-runtime 中继续执行。`,
      '',
      '## 当前说明',
      '- 这不是工具不可用，也不是公司名缺失；Agent 已成功触发 company-research。',
      '- 本次响应先保留运行中状态，避免把长耗时研究误判成失败。',
      '- 任务完成后，可通过外部技能任务记录查看 Markdown 产物；后续再接入异步回填 Artifact。',
    ].join('\n'),
    headline: '公司研究任务仍在运行，可稍后查看产物',
    references: [job.jobId, 'company-research'],
    evidence: [],
    attachments: [],
  };
}

function buildCompanyAnchor(companyName: string): ArtifactAnchor {
  return {
    type: 'company',
    id: companyName,
    name: companyName,
    role: 'primary',
    confidence: 0.86,
    bindingStatus: 'unbound',
  };
}

function summarizeMarkdown(markdown: string): string {
  const sections = [
    { label: '公司概览', keywords: ['公司概览', '基本信息', '企业概况'] },
    { label: '业务定位', keywords: ['业务定位', '主营业务', '主要产品', '产品与服务'] },
    { label: '成长驱动', keywords: ['成长驱动', '增长驱动', '机会', '发展机会'] },
    { label: '核心风险', keywords: ['核心风险', '风险提示', '风险关注'] },
    { label: '销售切入', keywords: ['销售切入', '销售策略', '切入点', '渠道与销售'] },
  ];
  const sectionSummaries = sections
    .map((section) => {
      const text = extractSectionSummary(markdown, section.keywords);
      return text ? `- **${section.label}**：${text}` : '';
    })
    .filter(Boolean);

  if (sectionSummaries.length > 0) {
    return sectionSummaries.slice(0, 4).join('\n');
  }

  const fallbackLines = markdown
    .split('\n')
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .filter((line) => !isMarkdownNoiseLine(line));

  return fallbackLines.slice(0, 3).map((line) => `- ${line}`).join('\n') || '公司研究 Markdown 已生成。';
}

function extractSectionSummary(markdown: string, keywords: string[]): string {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex((line) => {
    const normalized = cleanMarkdownLine(line);
    return /^#{1,4}\s*/.test(line.trim()) && keywords.some((keyword) => normalized.includes(keyword));
  });
  if (startIndex < 0) {
    return '';
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^#{1,4}\s+/.test(line.trim())) {
      break;
    }
    const cleaned = cleanMarkdownLine(line);
    if (!cleaned || isMarkdownNoiseLine(cleaned)) {
      continue;
    }
    sectionLines.push(cleaned);
    if (sectionLines.join(' ').length > 120) {
      break;
    }
  }

  return truncateText(sectionLines.join('；'), 140);
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/-{3,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^>+\s*/, '')
    .replace(/[·\s]+$/g, '')
    .trim();
}

function isMarkdownNoiseLine(line: string): boolean {
  return !line
    || /^[:\-\s|]+$/.test(line)
    || ['项目', '内容', '公司名称', '英文名', '成立时间', '注册资本'].some((token) => line === token)
    || ['生成时间', '研究目的', '研究方法', '方法：', '公开信息检索'].some((token) => line.includes(token));
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function extractSourceRefs(markdown: string) {
  const lines = markdown
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.includes('http') || item.includes('来源'));
  return lines.slice(0, 6).map((line) => ({ title: line.slice(0, 80), source: 'company-research-skill' }));
}

function isCompanyResearchSkillUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error);
  return [
    'skill 依赖未满足',
    'SKILL Runtime 服务当前不可达',
    '暂不可执行',
  ].some((pattern) => message.includes(pattern));
}

function describeCompanyResearchUnavailable(error: unknown): string {
  const message = getErrorMessage(error);
  if (message.includes('依赖未满足') || message.includes('暂不可执行')) {
    return 'company-research 外部技能依赖未满足，当前本机缺少 DEEPSEEK_API_KEY / ARK_API_KEY。';
  }
  if (message.includes('SKILL Runtime 服务当前不可达')) {
    return 'skill-runtime 服务当前不可达，无法调用 company-research 外部技能。';
  }
  return `company-research 外部技能暂不可用：${message}`;
}

function buildCompanyResearchFallbackMarkdown(companyName: string, reason: string): string {
  return `# ${companyName} 公司研究（MVP降级）

## 运行说明

本次 Agent 已完成 IntentFrame 与 TaskPlan 生成，但真实公司研究 Skill 未执行。

- 目标公司：${companyName}
- 降级原因：${reason}
- 当前处理：生成可追踪 Markdown Artifact，用于验证 MongoDB 持久化、Qdrant 向量化、Evidence Card 与后续对话引用链路。

## 当前可用结论

- 已识别用户意图为公司研究。
- 已将公司作为 Artifact 的 primary anchor 绑定，后续同租户同应用下可按该公司名称检索。
- 本降级 Artifact 不包含联网研究结论，不能替代真实尽调或销售研究材料。

## 恢复真实研究所需配置

- DEEPSEEK_API_KEY：用于公司研究 Skill 的模型推理。
- ARK_API_KEY：用于 company-research 依赖的外部研究能力。
- skill-runtime：需保持服务可访问。

## 写回边界

本次不会写入客户主数据。任何客户、联系人、跟进记录写回都必须先生成 preview，并由用户确认后执行。`;
}

function buildAudioNotSupportedContent(request: AgentChatRequest): string {
  return `## 当前 MVP 暂不做录音转写\n- 原始请求：${request.query}\n- 处理结果：已生成 Agent 计划，但需要你补充文字纪要后才能继续整理。\n\n后续如果要补客户信息或写跟进记录，仍会先生成 preview，再由你确认。`;
}

function startToolCall(runId: string, toolCode: string, inputSummary: string): AgentToolCall {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    runId,
    toolCode,
    status: 'running',
    inputSummary,
    outputSummary: '',
    startedAt: now,
    finishedAt: null,
    errorMessage: null,
  };
}

function markToolCallRunning(toolCall: AgentToolCall, outputSummary: string): void {
  toolCall.status = 'running';
  toolCall.outputSummary = outputSummary;
  toolCall.finishedAt = null;
  toolCall.errorMessage = null;
}

function finishToolCall(toolCall: AgentToolCall, status: AgentToolCall['status'], outputSummary: string, error?: unknown): void {
  toolCall.status = status;
  toolCall.outputSummary = outputSummary;
  toolCall.finishedAt = new Date().toISOString();
  toolCall.errorMessage = error ? getErrorMessage(error) : null;
}
