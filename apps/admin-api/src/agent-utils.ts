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
    .replace(/^\/公司研究\s*/, '')
    .replace(/^\/客户分析\s*/, '')
    .replace(/^\/计划\s*/, '')
    .trim();
  const bracketCompany = normalized.match(/[【\[]([^】\]]*(?:公司|集团|有限|股份)[^】\]]*)[】\]]/)?.[1];
  const bracketCandidate = cleanupCompanyName(bracketCompany ?? '');
  if (isUsableCompanyName(bracketCandidate)) {
    return bracketCandidate;
  }

  const patterns = [
    /(?:公司研究|研究|分析一下|分析|公司分析|客户分析)\s*(?:这家(?:公司|客户)|这个(?:公司|客户))?\s*([^，。！？\n]+)/,
    /(?:查询|查一下)\s*([^，。！？\n]+?)(?:客户|公司|联系人|$)/,
    /(?:给出|提供|展示|查看|打开)\s*([^，。！？\n]+?)(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = cleanupCompanyName(match?.[1] ?? '');
    if (isUsableCompanyName(candidate)) {
      return candidate;
    }
  }

  const fallback = cleanupCompanyName(normalized);
  return isUsableCompanyName(fallback)
    && (fallback.includes('公司') || fallback.includes('集团') || fallback.includes('有限'))
    ? fallback
    : '';
}

export function cleanupCompanyName(value: string): string {
  return value
    .replace(/^(?:研究|分析一下|分析|公司分析|客户分析)\s*/, '')
    .replace(/^公司研究\s*/, '')
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

export function isPlaceholderCompanyName(value: string): boolean {
  const normalized = value
    .replace(/\s+/g, '')
    .replace(/[「」『』“”"'`]/g, '')
    .trim();
  if (!normalized) {
    return false;
  }

  const upper = normalized.toUpperCase();
  const placeholders = new Set([
    '输入公司全称',
    '请输入公司全称',
    '输入公司名称',
    '请输入公司名称',
    '公司全称',
    '公司名称',
    '公司名',
    '企业名称',
    '客户全称',
    '客户名称',
    '全称',
    '名称',
    '目标公司',
    '目标客户',
    '某公司',
    '某客户',
    '某某公司',
    '测试公司',
    '示例公司',
    '样例公司',
    'XX公司',
    'XXX公司',
    'XX有限公司',
    'XXX有限公司',
  ]);

  return placeholders.has(normalized)
    || placeholders.has(upper)
    || /^(?:请输入|输入|填写|补充)(?:目标)?(?:公司|企业|客户)?(?:全称|名称|名字)$/.test(normalized)
    || /^(?:目标|某|某某|测试|示例|样例)(?:公司|企业|客户)$/.test(normalized)
    || /^X{2,}(?:公司|企业|客户|有限公司)?$/i.test(normalized);
}

export function isUsableCompanyName(value: string): boolean {
  const normalized = value.replace(/\s+/g, '').trim();
  return Boolean(normalized)
    && normalized.length >= 2
    && !isPlaceholderCompanyName(normalized)
    && !/^(?:公司|企业|客户|研究|分析|公司研究|客户分析)$/.test(normalized);
}

export function isContextualQuestionQuery(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }
  return /[？?]$/.test(normalized)
    || /(?:什么|哪些|哪个|为何|为什么|怎么|如何|是否|能否|可否|有没有|多少|几|谁|吗|呢|怎么看|是什么|有什么)/.test(normalized);
}

export function inferFallbackIntent(
  input: Pick<AgentChatRequest, 'query' | 'attachments'>,
  focusedCompany?: string | null,
  reason = 'llm_unavailable',
): IntentFrame {
  const query = input.query.trim();
  const focusedCompanyName = isUsableCompanyName(cleanupCompanyName(focusedCompany ?? ''))
    ? cleanupCompanyName(focusedCompany ?? '')
    : '';
  const companyName = extractCompanyName(query) || focusedCompanyName;
  const hasAudio = (input.attachments ?? []).some((item) => item.type.includes('audio') || item.name.match(/\.(mp3|m4a|wav)$/i));
  const startsExplicitResearch = /^(?:\/公司研究|\/客户分析|公司研究|客户分析|研究|分析一下|分析)/.test(query);
  const isArtifactQuestion =
    Boolean(focusedCompany || companyName) &&
    isContextualQuestionQuery(query) &&
    !startsExplicitResearch;
  const isCompanyResearch =
    Boolean(companyName) &&
    isCompanyResearchQuery(query);

  if (hasAudio || query.includes('录音')) {
    return buildIntent({
      actionType: 'plan',
      goal: '生成录音资料包',
      targetType: companyName ? 'company' : 'unknown',
      companyName,
      confidence: 0.72,
      reason,
    });
  }

  if (isCompanyResearchQuery(query) && !companyName) {
    return buildIntent({
      actionType: 'analyze',
      goal: '研究目标公司并沉淀公司研究资料',
      targetType: 'company',
      companyName: '',
      missingSlots: ['公司全称'],
      confidence: 0.76,
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
      goal: '研究目标公司并沉淀公司研究资料',
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
  return /(?:研究|分析一下|分析\s*(?:这家|这个)?(?:公司|客户)|公司研究|公司分析|客户分析|\/公司研究|\/客户分析)/.test(query);
}

export function buildTaskPlan(intentFrame: IntentFrame): TaskPlan {
  const planId = `plan-${randomUUID().slice(0, 8)}`;

  if (intentFrame.missingSlots.includes('文字纪要') || intentFrame.goal.includes('录音')) {
    return {
      planId,
      kind: 'recording_material',
      title: '录音资料包处理计划',
      status: 'running',
      steps: [
        step('create-recording-task', '创建录音处理任务', 'query', ['artifact.recording_material.prepare'], 'pending'),
        step('materialize-recording', '生成可消费录音资料包', 'query', ['artifact.recording_material.prepare'], 'pending'),
      ],
      evidenceRequired: true,
    };
  }

  if (intentFrame.actionType === 'query') {
    return {
      planId,
      kind: 'artifact_search',
      title: '外部信息检索计划',
      status: 'running',
      steps: [
        step('resolve-focus', '解析会话焦点', 'meta', ['meta.clarify_card'], 'succeeded'),
        step('search-artifact', '检索外部信息资料', 'query', ['artifact.search'], 'pending'),
      ],
      evidenceRequired: true,
    };
  }

  if (intentFrame.actionType === 'analyze' && intentFrame.targetType === 'company') {
    return {
      planId,
      kind: 'company_research',
      title: '公司研究资料计划',
      status: 'running',
      steps: [
        step('build-intent', '生成 IntentFrame', 'meta', ['deepseek.intent_frame'], 'succeeded'),
        step('lookup-company-research', '查找已有公司研究', 'query', ['artifact.company_research.lookup'], 'pending'),
        step('run-company-research', '调用公司研究服务', 'external', ['ext.company_research_pm'], 'pending'),
        step('persist-artifact', '保存公司研究资料', 'meta', ['artifact.company_research'], 'pending'),
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
