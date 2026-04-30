import type {
  AgentChatRequest,
} from './contracts.js';
import type {
  AgentResumeDecision,
  AgentToolSelection,
  ContinuationResolution,
  PendingInteraction,
  RecordToolCapability,
} from './agent-core.js';
import type { AgentToolRegistry } from './tool-registry.js';

export interface PendingContinuationResult {
  decision?: AgentResumeDecision;
  resolution: ContinuationResolution;
}

export function resolvePendingContinuation(input: {
  request: AgentChatRequest;
  runId: string;
  pendingInteraction?: PendingInteraction | null;
  selectedTool?: AgentToolSelection | null;
  registry: AgentToolRegistry;
}): PendingContinuationResult {
  const pending = input.pendingInteraction;
  if (!pending || pending.status !== 'pending') {
    return {
      resolution: {
        usedContinuation: false,
        action: 'none',
        reason: '当前 LangGraph checkpoint 没有待恢复交互。',
      },
    };
  }

  const query = input.request.query.trim();

  if (pending.kind === 'confirmation') {
    if (isExplicitTaskSwitch(query)) {
      return startNewTask(input.runId, query, pending, '用户在确认等待态中明确切换到新任务。');
    }
    return {
      resolution: {
        usedContinuation: false,
        action: 'none',
        reason: '当前是写回确认等待态，普通输入不自动代替确认 API。',
        sourceInteractionId: pending.interactionId,
        toolCode: pending.toolCode,
      },
    };
  }

  if (pending.kind === 'candidate_selection') {
    const candidateDecision = resolveCandidateSelection(input, pending, query);
    if (candidateDecision) {
      return candidateDecision;
    }
    if (isExplicitTaskSwitch(query)) {
      return startNewTask(input.runId, query, pending, '用户在候选选择等待态中明确切换到新任务。');
    }
    return {
      resolution: {
        usedContinuation: false,
        action: 'none',
        reason: '仍在等待候选选择，需要用户说明更新已有记录或继续新建。',
        sourceInteractionId: pending.interactionId,
        toolCode: pending.toolCode,
      },
    };
  }

  const choiceDecision = resolveChoiceRouting({
    request: input.request,
    runId: input.runId,
    pending,
    query,
  });
  if (choiceDecision) {
    return choiceDecision;
  }

  if (isExplicitTaskSwitch(query)) {
    return startNewTask(input.runId, query, pending, '用户在补充信息等待态中明确切换到新任务。');
  }

  const mergedInput = mergeContinuationInput({
    request: input.request,
    pending,
    registry: input.registry,
  });

  return {
    decision: {
      runId: input.runId,
      action: 'provide_input',
      interactionId: pending.interactionId,
      query,
      mergedInput,
      reason: '普通下一轮输入被视为对当前等待态的补充。',
    },
    resolution: {
      usedContinuation: true,
      action: 'resume_pending_interaction',
      reason: '已使用 Tool Registry 元数据合并补充输入，并继续原工具预览。',
      sourceInteractionId: pending.interactionId,
      toolCode: pending.toolCode,
      mergedInput,
    },
  };
}

export function resolveProvidedInputContinuation(input: {
  request: AgentChatRequest;
  runId: string;
  pendingInteraction?: PendingInteraction | null;
  selectedTool?: AgentToolSelection | null;
  registry: AgentToolRegistry;
  interactionId: string;
  answers: Record<string, unknown>;
}): PendingContinuationResult {
  const pending = input.pendingInteraction;
  const query = input.request.query.trim();
  if (!pending || pending.status !== 'pending') {
    return {
      resolution: {
        usedContinuation: false,
        action: 'none',
        reason: '当前 LangGraph checkpoint 没有待恢复交互。',
      },
    };
  }
  if (pending.kind !== 'input_required') {
    return {
      decision: {
        runId: input.runId,
        action: 'wait_for_input',
        interactionId: pending.interactionId,
        query,
        reason: '当前等待态不是补字段卡，已拒绝把结构化卡片提交当作新的自然语言查询执行。',
      },
      resolution: {
        usedContinuation: false,
        action: 'wait_for_input',
        reason: '当前等待态不是补字段卡，已拒绝把结构化卡片提交当作新的自然语言查询执行。',
        sourceInteractionId: pending.interactionId,
        toolCode: pending.toolCode,
      },
    };
  }
  if (pending.interactionId !== input.interactionId) {
    return {
      decision: {
        runId: input.runId,
        action: 'wait_for_input',
        interactionId: pending.interactionId,
        query,
        reason: '这张补充卡已不是当前等待项。请使用最新的补充卡重新提交，系统不会把卡片字段摘要降级为客户查询。',
      },
      resolution: {
        usedContinuation: false,
        action: 'wait_for_input',
        reason: '结构化补充输入与当前等待态不匹配，已阻止重新规划为普通查询。',
        sourceInteractionId: pending.interactionId,
        toolCode: pending.toolCode,
      },
    };
  }

  const choiceDecision = resolveChoiceRouting({
    request: input.request,
    runId: input.runId,
    pending,
    query,
    answers: input.answers,
  });
  if (choiceDecision) {
    return choiceDecision;
  }

  const mergedInput = mergeContinuationInput({
    request: input.request,
    pending,
    registry: input.registry,
    answers: input.answers,
  });

  return {
    decision: {
      runId: input.runId,
      action: 'provide_input',
      interactionId: pending.interactionId,
      query,
      answers: input.answers,
      mergedInput,
      reason: '已使用 Meta Question Card 的结构化答案继续当前等待态。',
    },
    resolution: {
      usedContinuation: true,
      action: 'resume_pending_interaction',
      reason: '已使用 Meta Question Card 的结构化答案合并输入，并继续原工具预览。',
      sourceInteractionId: pending.interactionId,
      toolCode: pending.toolCode,
      mergedInput,
    },
  };
}

function resolveChoiceRouting(input: {
  request: AgentChatRequest;
  runId: string;
  pending: PendingInteraction;
  query: string;
  answers?: Record<string, unknown>;
}): PendingContinuationResult | null {
  const routing = readChoiceRouting(input.pending.partialInput);
  if (!routing) {
    return null;
  }
  const answerParamKey = routing.answerParamKey || 'next_action';
  const selectedKey = resolveChoiceKey({
    rawAnswer: input.answers?.[answerParamKey],
    query: input.query,
    choices: routing.choices,
  });
  if (!selectedKey) {
    if (isUnavailableExistingResearchRequest(input.query, input.answers?.[answerParamKey])) {
      return {
        decision: {
          runId: input.runId,
          action: 'wait_for_input',
          interactionId: input.pending.interactionId,
          query: input.query,
          reason: '“查看已有研究”能力尚未定义为可路由工具，继续等待用户选择查看客户信息或进行公司研究。',
        },
        resolution: {
          usedContinuation: false,
          action: 'wait_for_input',
          reason: '“查看已有研究”能力尚未定义为可路由工具，继续等待用户选择查看客户信息或进行公司研究。',
          sourceInteractionId: input.pending.interactionId,
          toolCode: input.pending.toolCode,
        },
      };
    }
    return null;
  }
  const choice = routing.choices[selectedKey];
  if (!choice?.toolCode) {
    return null;
  }
  return {
    decision: {
      runId: input.runId,
      action: 'route_tool',
      interactionId: input.pending.interactionId,
      query: input.query,
      toolCode: choice.toolCode,
      mergedInput: readObject(choice.input),
      reason: choice.reason || '用户通过结构化问题卡选择了下一步工具。',
    },
    resolution: {
      usedContinuation: true,
      action: 'route_tool',
      reason: choice.reason || '用户通过结构化问题卡选择了下一步工具。',
      sourceInteractionId: input.pending.interactionId,
      toolCode: choice.toolCode,
      mergedInput: readObject(choice.input),
    },
  };
}

function resolveChoiceKey(input: {
  rawAnswer: unknown;
  query: string;
  choices: Record<string, { aliases?: string[] }>;
}): string {
  if (typeof input.rawAnswer === 'string' && input.rawAnswer.trim()) {
    const answer = input.rawAnswer.trim();
    if (input.choices[answer]) {
      return answer;
    }
    const matchedByAnswer = findChoiceKeyFromQuery(answer, input.choices);
    if (matchedByAnswer) {
      return matchedByAnswer;
    }
  }
  return findChoiceKeyFromQuery(input.query, input.choices);
}

function isUnavailableExistingResearchRequest(query: string, rawAnswer: unknown): boolean {
  const text = `${query}\n${typeof rawAnswer === 'string' ? rawAnswer : ''}`.replace(/\s+/g, '');
  return /(查看|看|打开)?已有研究|历史研究|已有资料/.test(text);
}

function readChoiceRouting(value: unknown): {
  answerParamKey?: string;
  choices: Record<string, {
    toolCode?: string;
    input?: unknown;
    reason?: string;
    aliases?: string[];
  }>;
} | null {
  const root = readObject(value);
  const agentControl = readObject(root.agentControl);
  const routing = readObject(agentControl.choiceRouting);
  const choices = readObject(routing.choices);
  if (!Object.keys(choices).length) {
    return null;
  }
  return {
    answerParamKey: typeof routing.answerParamKey === 'string' ? routing.answerParamKey : undefined,
    choices: choices as Record<string, {
      toolCode?: string;
      input?: unknown;
      reason?: string;
      aliases?: string[];
    }>,
  };
}

function findChoiceKeyFromQuery(
  query: string,
  choices: Record<string, { aliases?: string[] }>,
): string {
  const normalized = query.replace(/\s+/g, '').trim();
  if (!normalized) {
    return '';
  }
  for (const [key, choice] of Object.entries(choices)) {
    const aliases = Array.isArray(choice.aliases) ? choice.aliases : [];
    if (aliases.some((alias) => alias && normalized.includes(alias.replace(/\s+/g, '').trim()))) {
      return key;
    }
  }
  return '';
}

function resolveCandidateSelection(
  input: {
    request: AgentChatRequest;
    runId: string;
    selectedTool?: AgentToolSelection | null;
    registry: AgentToolRegistry;
  },
  pending: PendingInteraction,
  query: string,
): PendingContinuationResult | null {
  const baseInput = cloneRecord(pending.partialInput ?? input.selectedTool?.input ?? {});
  const formInstId = extractFormInstId(query);
  const wantsUpdate = /(更新|修改|用已有|选择已有|选已有|第一条|第1条|这条|已有记录)/.test(query);
  const wantsCreate = /(仍要新建|继续新建|还是新建|新建一条|创建新|保留新建)/.test(query);

  if (!wantsUpdate && !wantsCreate) {
    return null;
  }

  const sourceToolCode = pending.toolCode ?? input.selectedTool?.toolCode ?? '';
  const toolCode = wantsUpdate
    ? sourceToolCode.replace('.preview_create', '.preview_update')
    : sourceToolCode;
  const mergedInput = wantsUpdate
    ? {
        ...baseInput,
        mode: 'update',
        ...(formInstId ? { formInstId } : {}),
      }
    : disableDuplicateCheck({
        ...baseInput,
        mode: 'create',
      });
  const action = wantsUpdate ? 'update_existing' : 'create_new';

  return {
    decision: {
      runId: input.runId,
      action: 'select_candidate',
      interactionId: pending.interactionId,
      query,
      decision: action,
      toolCode,
      mergedInput,
      reason: wantsUpdate ? '用户选择更新已有候选记录。' : '用户明确仍要新建记录。',
    },
    resolution: {
      usedContinuation: true,
      action: 'select_candidate',
      reason: wantsUpdate ? '候选选择已解析为更新已有记录。' : '候选选择已解析为继续新建，并关闭本次重复拦截。',
      sourceInteractionId: pending.interactionId,
      toolCode,
      mergedInput,
    },
  };
}

function mergeContinuationInput(input: {
  request: AgentChatRequest;
  pending: PendingInteraction;
  registry: AgentToolRegistry;
  answers?: Record<string, unknown>;
}): Record<string, unknown> {
  const baseInput = cloneRecord(input.pending.partialInput ?? {});
  const tool = input.pending.toolCode ? input.registry.get(input.pending.toolCode) : undefined;
  const capability = tool?.recordCapability;
  const params = cloneRecord(readObject(baseInput.params));

  if (capability) {
    const questionParams = new Set(
      input.pending.questionCard?.questions
        .map((question) => question.paramKey)
        .filter(Boolean) ?? [],
    );
    const answeredParams = new Set(
      Object.entries(input.answers ?? {})
        .filter(([, value]) => !isEmptyAnswer(value))
        .map(([paramKey]) => paramKey),
    );
    mergeStructuredAnswers({
      params,
      answers: input.answers ?? {},
      pending: input.pending,
      capability,
    });

    for (const paramKey of capability.previewInputPolicy?.writableParams ?? []) {
      const value = extractLabeledParamValue(input.request.query, paramKey, capability);
      if (value !== undefined && (!hasMeaningfulValue(params[paramKey]) || (questionParams.has(paramKey) && !answeredParams.has(paramKey)))) {
        params[paramKey] = value;
      }
    }
  }

  return {
    ...baseInput,
    ...(Object.keys(params).length ? { params } : {}),
    ...(input.request.tenantContext?.operatorOpenId
      ? { operatorOpenId: input.request.tenantContext.operatorOpenId }
      : {}),
  };
}

function mergeStructuredAnswers(input: {
  params: Record<string, unknown>;
  answers: Record<string, unknown>;
  pending: PendingInteraction;
  capability: RecordToolCapability;
}): void {
  const writable = new Set(input.capability.previewInputPolicy?.writableParams ?? []);
  const questionParams = new Set(
    input.pending.questionCard?.questions
      .map((question) => question.paramKey)
      .filter(Boolean) ?? [],
  );
  for (const [paramKey, rawValue] of Object.entries(input.answers)) {
    if (!writable.has(paramKey) && !questionParams.has(paramKey)) {
      continue;
    }
    if (isEmptyAnswer(rawValue)) {
      continue;
    }
    input.params[paramKey] = rawValue;
  }
}

function startNewTask(
  runId: string,
  query: string,
  pending: PendingInteraction,
  reason: string,
): PendingContinuationResult {
  return {
    decision: {
      runId,
      action: 'start_new_task',
      interactionId: pending.interactionId,
      query,
      reason,
    },
    resolution: {
      usedContinuation: false,
      action: 'start_new_task',
      reason,
      sourceInteractionId: pending.interactionId,
      toolCode: pending.toolCode,
    },
  };
}

function isExplicitTaskSwitch(query: string): boolean {
  return /(先查|查一下|查询|查客户|查联系人|查商机|查跟进|搜索|找一下|打开|详情|先看|帮我查|帮我搜|先研究|研究这家公司|分析这家公司|有什么风险|值得关注|最近有什么|新增|新建|创建|录入|写入)/.test(query);
}

function extractLabeledParamValue(query: string, paramKey: string, capability: RecordToolCapability): string | undefined {
  const labels = Array.from(
    new Set([
      capability.fieldLabels?.[paramKey],
      paramKey,
      ...buildParamKeyVariants(paramKey),
      ...buildLabelVariants(capability.fieldLabels?.[paramKey]),
    ].filter((item): item is string => Boolean(item?.trim()))),
  );

  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`${escaped}\\s*(?:改成|改为|更新为|调整为|设置为|设为|变更为|变为|为|是|=|：|:)\\s*([^，。；;\\n]+)`),
      new RegExp(`(?:更新|修改|变更|调整|设置|改|关联|绑定|选择)\\s*(?:这个|该|当前)?[^，。；;\\n]{0,12}?${escaped}\\s*(?:到|至|成|为)?\\s*([^，。；;\\n]+)`),
    ];
    for (const pattern of patterns) {
      const matched = query.match(pattern);
      if (matched?.[1]?.trim()) {
        return trimContinuationValue(matched[1]);
      }
    }
  }

  const labelText = labels.join('|');
  if (/手机|电话|联系方式|phone/i.test(labelText)) {
    return query.match(/1[3-9]\d{9}/)?.[0];
  }

  return undefined;
}

function trimContinuationValue(value: string): string {
  return value
    .replace(/\s+[\u4e00-\u9fa5A-Za-z_]{2,20}\s*(?:为|是|=|：|:).*$/, '')
    .trim();
}

function buildLabelVariants(label?: string): string[] {
  if (!label) {
    return [];
  }
  return [
    label.replace(/姓名$/, ''),
    label.includes('姓名') ? '姓名' : '',
    label.includes('手机') ? '手机' : '',
    label.includes('手机') || label.includes('电话') ? '电话' : '',
    label.includes('手机') || label.includes('电话') ? '手机号' : '',
    label.includes('客户') ? '客户信息' : '',
    label.includes('客户') ? '客户名称' : '',
    label.includes('客户') ? '客户编号' : '',
    label.includes('客户') ? '绑定客户' : '',
    label.includes('客户') ? '选择客户' : '',
    label.includes('联系人') ? '联系人信息' : '',
    label.includes('商机') ? '商机信息' : '',
  ].filter((item) => item && item !== label);
}

function buildParamKeyVariants(paramKey: string): string[] {
  if (/phone|mobile|tel/i.test(paramKey)) {
    return ['电话', '手机号', '联系方式'];
  }
  return [];
}

function hasMeaningfulValue(value: unknown): boolean {
  return !(value === undefined
    || value === null
    || typeof value === 'string' && value.trim() === ''
    || Array.isArray(value) && value.length === 0);
}

function isEmptyAnswer(value: unknown): boolean {
  return value === undefined
    || value === null
    || typeof value === 'string' && value.trim() === ''
    || Array.isArray(value) && value.length === 0;
}

function disableDuplicateCheck(input: Record<string, unknown>): Record<string, unknown> {
  const agentControl = readObject(input.agentControl);
  return {
    ...input,
    agentControl: {
      ...agentControl,
      duplicateCheck: {
        ...readObject(agentControl.duplicateCheck),
        enabled: false,
      },
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function extractFormInstId(query: string): string | undefined {
  return query.match(/formInstId[:：=]?\s*([A-Za-z0-9_-]+)/)?.[1]
    ?? query.match(/表单实例[:：=]?\s*([A-Za-z0-9_-]+)/)?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
