import { randomUUID } from 'node:crypto';
import type {
  AgentActionType,
  AgentChatRequest,
  AgentExecutionStatus,
  AgentTargetType,
  IntentFrame,
  TaskPlan,
} from './contracts.js';

export function createTraceId(): string {
  return `trace-agent-${randomUUID().slice(0, 8)}`;
}

export function extractCompanyName(query: string): string {
  const normalized = query
    .replace(/^\/客户分析\s*/, '')
    .replace(/^\/计划\s*/, '')
    .trim();
  const bracketCompany = normalized.match(/[【\[]([^】\]]*(?:公司|集团|有限|股份)[^】\]]*)[】\]]/)?.[1];
  const bracketCandidate = cleanupCompanyName(bracketCompany ?? '');
  if (bracketCandidate) {
    return bracketCandidate;
  }

  const patterns = [
    /(?:研究|分析一下|分析|公司分析|客户分析)\s*(?:这家(?:公司|客户)|这个(?:公司|客户))?\s*([^，。！？\n]+)/,
    /(?:查询|查一下)\s*([^，。！？\n]+?)(?:客户|公司|联系人|$)/,
    /(?:给出|提供|展示|查看|打开)\s*([^，。！？\n]+?)(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = cleanupCompanyName(match?.[1] ?? '');
    if (candidate) {
      return candidate;
    }
  }

  const fallback = cleanupCompanyName(normalized);
  return fallback.includes('公司') || fallback.includes('集团') || fallback.includes('有限') ? fallback : '';
}

export function cleanupCompanyName(value: string): string {
  return value
    .replace(/^(?:研究|分析一下|分析|公司分析|客户分析)\s*/, '')
    .replace(/^(?:给出|提供|展示|查看|打开|查询|查一下)\s*/, '')
    .replace(/^这家(?:公司|客户)\s*/, '')
    .replace(/^这个(?:公司|客户)\s*/, '')
    .replace(/^(公司|客户)\s*/, '')
    .replace(/(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情)$/g, '')
    .replace(/^[：:，。！？、\s]+/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:，。！？、]+$/g, '')
    .trim();
}

export function inferFallbackIntent(
  input: Pick<AgentChatRequest, 'query' | 'attachments'>,
  focusedCompany?: string | null,
  reason = 'llm_unavailable',
): IntentFrame {
  const query = input.query.trim();
  const companyName = extractCompanyName(query) || focusedCompany || '';
  const hasAudio = (input.attachments ?? []).some((item) => item.type.includes('audio') || item.name.match(/\.(mp3|m4a|wav)$/i));
  const isArtifactQuestion =
    Boolean(focusedCompany || companyName) &&
    ['最近', '关注', '值得关注', '有什么', '客户联系人', '卡在哪里'].some((token) => query.includes(token)) &&
    !query.includes('研究');
  const isCompanyResearch =
    Boolean(companyName) &&
    isCompanyResearchQuery(query);

  if (hasAudio || query.includes('录音')) {
    return buildIntent({
      actionType: 'plan',
      goal: '录音材料整理',
      targetType: companyName ? 'company' : 'unknown',
      companyName,
      missingSlots: ['文字纪要'],
      confidence: 0.72,
      reason,
    });
  }

  if (isArtifactQuestion) {
    return buildIntent({
      actionType: 'query',
      goal: '检索已有 Artifact 并回答客户关注点',
      targetType: 'artifact',
      companyName,
      confidence: 0.78,
      reason,
    });
  }

  if (isCompanyResearch) {
    return buildIntent({
      actionType: 'analyze',
      goal: '研究目标公司并沉淀 Artifact',
      targetType: 'company',
      companyName,
      confidence: 0.82,
      reason,
    });
  }

  return buildIntent({
    actionType: 'clarify',
    goal: '澄清用户目标',
    targetType: companyName ? 'company' : 'unknown',
    companyName,
    missingSlots: companyName ? [] : ['目标对象或任务类型'],
    confidence: 0.42,
    reason,
  });
}

export function isCompanyResearchQuery(query: string): boolean {
  return /(?:研究|分析一下|分析\s*(?:这家|这个)?(?:公司|客户)|公司分析|客户分析|\/客户分析)/.test(query);
}

export function buildTaskPlan(intentFrame: IntentFrame): TaskPlan {
  const planId = `plan-${randomUUID().slice(0, 8)}`;

  if (intentFrame.missingSlots.includes('文字纪要') || intentFrame.goal.includes('录音')) {
    return {
      planId,
      kind: 'audio_not_supported',
      title: '录音整理 MVP 降级计划',
      status: 'paused',
      steps: [
        step('save-audio-placeholder', '保存附件占位', 'meta', ['meta.plan_builder'], 'succeeded'),
        step('wait-note', '等待用户补充文字纪要', 'meta', ['meta.clarify_card'], 'pending'),
      ],
      evidenceRequired: false,
    };
  }

  if (intentFrame.actionType === 'query') {
    return {
      planId,
      kind: 'artifact_search',
      title: 'Artifact 证据检索计划',
      status: 'running',
      steps: [
        step('resolve-focus', '解析会话焦点', 'meta', ['meta.clarify_card'], 'succeeded'),
        step('search-artifact', '检索 Artifact 证据', 'query', ['artifact.search'], 'pending'),
      ],
      evidenceRequired: true,
    };
  }

  if (intentFrame.actionType === 'analyze' && intentFrame.targetType === 'company') {
    return {
      planId,
      kind: 'company_research',
      title: '公司研究 Artifact 计划',
      status: 'running',
      steps: [
        step('build-intent', '生成 IntentFrame', 'meta', ['deepseek.intent_frame'], 'succeeded'),
        step('run-company-research', '调用公司研究 Skill', 'external', ['ext.company_research_pm'], 'pending'),
        step('persist-artifact', '沉淀 Markdown Artifact', 'meta', ['artifact.company_research'], 'pending'),
      ],
      evidenceRequired: true,
    };
  }

  return {
    planId,
    kind: 'unknown_clarify',
    title: '澄清计划',
    status: 'waiting_input',
    steps: [
      step('clarify', '请用户补充目标对象或任务类型', 'meta', ['meta.clarify_card'], 'pending'),
    ],
    evidenceRequired: false,
  };
}

function buildIntent(input: {
  actionType: AgentActionType;
  goal: string;
  targetType: AgentTargetType;
  companyName?: string;
  missingSlots?: string[];
  confidence: number;
  reason: string;
}): IntentFrame {
  return {
    actionType: input.actionType,
    goal: input.goal,
    targetType: input.targetType,
    targets: input.companyName
      ? [{ type: 'company', id: input.companyName, name: input.companyName }]
      : [],
    inputMaterials: [],
    constraints: [],
    missingSlots: input.missingSlots ?? [],
    confidence: input.confidence,
    source: 'fallback',
    fallbackReason: input.reason,
  };
}

function step(
  key: string,
  title: string,
  actionType: TaskPlan['steps'][number]['actionType'],
  toolRefs: string[],
  status: TaskPlan['steps'][number]['status'],
) {
  return {
    key,
    title,
    actionType,
    toolRefs,
    required: true,
    skippable: false,
    confirmationRequired: false,
    status,
  };
}

export function finishPlan(plan: TaskPlan, status: AgentExecutionStatus): TaskPlan {
  return {
    ...plan,
    status,
    steps: plan.steps.map((item) => ({
      ...item,
      status: item.status === 'pending' ? (status === 'completed' ? 'succeeded' : 'skipped') : item.status,
    })),
  };
}
