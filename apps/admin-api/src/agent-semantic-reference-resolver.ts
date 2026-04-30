import type { AgentChatRequest } from './contracts.js';
import type {
  AgentToolDefinition,
  ContextFrame,
  ContextFrameSubject,
  ContextReferenceCandidate,
  GenericIntentFrame,
  ReferenceResolution,
  SemanticReferenceResolution,
  SemanticResolutionCandidate,
} from './agent-core.js';

export interface SemanticEmbeddingProvider {
  providerName?: string;
  isConfigured?: () => boolean;
  embedTexts(texts: string[]): Promise<number[][]>;
}

const DEFAULT_THRESHOLD = 0.62;
const DEFAULT_MARGIN = 0.04;

export async function resolveSemanticReference(input: {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  contextFrame?: ContextFrame | null;
  contextCandidates?: ContextReferenceCandidate[];
  availableTools: AgentToolDefinition[];
  embeddingProvider?: SemanticEmbeddingProvider | null;
}): Promise<{
  intentFrame: GenericIntentFrame;
  resolvedContext: ReferenceResolution;
  semanticResolution: SemanticReferenceResolution;
}> {
  const candidates = buildCandidateList(input);
  const compatibleCandidates = candidates.filter((candidate) => isCandidateCompatible({
    intentFrame: input.intentFrame,
    candidate,
    availableTools: input.availableTools,
  }));
  const embeddingProvider = input.embeddingProvider ?? null;
  const providerName = embeddingProvider
    ? embeddingProvider.providerName ?? embeddingProvider.constructor.name ?? 'embedding_provider'
    : 'recency_fallback';
  const collectionQueryWithoutReference = isRecordCollectionQueryWithoutReference({
    query: input.request.query,
    intentFrame: input.intentFrame,
    availableTools: input.availableTools,
  });

  if (!compatibleCandidates.length) {
    const reason = candidates.length
      ? '存在历史上下文候选，但没有候选符合当前目标的通用工具绑定约束。'
      : '当前会话没有可用于语义承接的上下文候选。';
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason,
      providerName,
      candidates: [],
      selected: null,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: false,
      ...(collectionQueryWithoutReference
        ? {
            reason: '本轮是对象集合查询，未承接历史上下文主体。',
            usageMode: 'skipped_collection_query' as const,
            skipReasonCode: 'record.collection_query',
          }
        : {}),
    });
  }

  const strongTargetName = hasStrongTargetIdentity(input.intentFrame, input.request.query);
  const scoreResult = await scoreCandidates({
    request: input.request,
    intentFrame: input.intentFrame,
    candidates: compatibleCandidates,
    availableTools: input.availableTools,
    embeddingProvider,
  });
  const sorted = [...scoreResult.candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.recencyRank - b.recencyRank;
  });
  const selected = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const margin = selected && second ? selected.score - second.score : 1;
  const directTargetMatch = selected ? hasDirectTargetMatch({
    intentFrame: input.intentFrame,
    subject: selected.subject,
    availableTools: input.availableTools,
  }) : false;
  const metadataBindingMatch = selected ? hasStrongToolBinding({
    intentFrame: input.intentFrame,
    candidate: selected,
    availableTools: input.availableTools,
  }) : false;
  const embeddingWasUsed = scoreResult.scoreLabel === 'embedding';
  const lowConfidence = embeddingWasUsed && selected
    ? selected.score < DEFAULT_THRESHOLD && !(metadataBindingMatch && !strongTargetName)
    : false;
  const ambiguous = embeddingWasUsed && selected && second ? margin < DEFAULT_MARGIN : false;

  if (!selected) {
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason: '语义候选为空，未承接上下文。',
      providerName: scoreResult.providerName,
      candidates: sorted,
      selected: null,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: false,
    });
  }

  if (collectionQueryWithoutReference) {
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason: '本轮是对象集合查询，仅记录历史候选，不承接为当前上下文主体。',
      providerName: scoreResult.providerName,
      candidates: sorted,
      selected,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: false,
      usageMode: 'skipped_collection_query',
      skipReasonCode: 'record.collection_query',
    });
  }

  if (lowConfidence) {
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason: `语义相似度 ${formatScore(selected.score)} 低于阈值 ${DEFAULT_THRESHOLD}，未承接上下文。`,
      providerName: scoreResult.providerName,
      candidates: sorted,
      selected,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: !strongTargetName,
    });
  }

  if (ambiguous && !directTargetMatch) {
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason: `前两个候选分差 ${formatScore(margin)} 低于阈值 ${DEFAULT_MARGIN}，需要澄清后再承接。`,
      providerName: scoreResult.providerName,
      candidates: sorted,
      selected,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: true,
    });
  }

  if (strongTargetName && !directTargetMatch) {
    return buildResolutionOutput({
      intentFrame: input.intentFrame,
      reason: '当前输入已有明确目标名称，语义承接只记录候选，不覆盖目标。',
      providerName: scoreResult.providerName,
      candidates: sorted,
      selected,
      usedContext: false,
      targetWasOverridden: false,
      shouldClarify: false,
    });
  }

  const targetWasOverridden = shouldBindSubjectAsTargetIdentity({
    intentFrame: input.intentFrame,
    candidate: selected,
    availableTools: input.availableTools,
    query: input.request.query,
  });
  const nextIntentFrame = targetWasOverridden
    ? {
        ...input.intentFrame,
        target: {
          ...input.intentFrame.target,
          id: input.intentFrame.target.id || selected.subject.id,
          name: selected.subject.name,
        },
      }
    : input.intentFrame;

  return buildResolutionOutput({
    intentFrame: nextIntentFrame,
    reason: targetWasOverridden
    ? '已通过通用语义候选和工具元数据承接上下文，并补齐当前目标名称。'
      : metadataBindingMatch && !directTargetMatch
        ? '已通过工具元数据绑定承接上下文，当前目标名称保持不变。'
        : '已通过通用语义候选承接上下文，当前目标名称保持不变。',
    providerName: scoreResult.providerName,
    candidates: sorted,
    selected,
    usedContext: true,
    targetWasOverridden,
    shouldClarify: false,
  });
}

function buildResolutionOutput(input: {
  intentFrame: GenericIntentFrame;
  reason: string;
  providerName: string;
  candidates: SemanticResolutionCandidate[];
  selected: SemanticResolutionCandidate | null;
  usedContext: boolean;
  targetWasOverridden: boolean;
  shouldClarify: boolean;
  usageMode?: ReferenceResolution['usageMode'];
  skipReasonCode?: string;
}): {
  intentFrame: GenericIntentFrame;
  resolvedContext: ReferenceResolution;
  semanticResolution: SemanticReferenceResolution;
} {
  const usageMode = input.usageMode ?? (input.usedContext ? 'used' : input.selected ? 'candidate_only' : 'none');
  return {
    intentFrame: input.intentFrame,
    resolvedContext: {
      usedContext: input.usedContext,
      reason: input.reason,
      subject: input.usedContext ? input.selected?.subject : undefined,
      sourceRunId: input.usedContext ? input.selected?.sourceRunId : undefined,
      evidenceRefs: input.usedContext ? input.selected?.evidenceRefs ?? [] : [],
      usageMode,
      ...(input.skipReasonCode ? { skipReasonCode: input.skipReasonCode } : {}),
    },
    semanticResolution: {
      usedSemantic: input.usedContext,
      shouldClarify: input.shouldClarify,
      reason: input.reason,
      selectedCandidate: input.selected ?? undefined,
      candidates: input.candidates.slice(0, 8),
      threshold: DEFAULT_THRESHOLD,
      margin: DEFAULT_MARGIN,
      embeddingProvider: input.providerName,
      targetWasOverridden: input.targetWasOverridden,
      usageMode,
      ...(input.skipReasonCode ? { skipReasonCode: input.skipReasonCode } : {}),
    },
  };
}

function buildCandidateList(input: {
  contextFrame?: ContextFrame | null;
  contextCandidates?: ContextReferenceCandidate[];
}): ContextReferenceCandidate[] {
  const candidates = [...(input.contextCandidates ?? [])];
  const subject = input.contextFrame?.subject;
  if (subject?.name) {
    candidates.unshift({
      candidateId: `current:${input.contextFrame?.sourceRunId ?? subject.id ?? subject.name}`,
      subject,
      sourceRunId: input.contextFrame?.sourceRunId,
      evidenceRefs: input.contextFrame?.evidenceRefs ?? [],
      text: buildSubjectText(subject, input.contextFrame?.evidenceRefs ?? []),
      recencyRank: 0,
      confidence: input.contextFrame?.confidence ?? 0.72,
      source: 'context_subject',
    });
  }

  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    if (!candidate.subject.name?.trim()) {
      return false;
    }
    const key = [
      candidate.subject.kind,
      candidate.subject.type ?? '',
      candidate.subject.id ?? '',
      normalizeText(candidate.subject.name),
    ].join(':');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return coalesceEntityCandidates(deduped);
}

function coalesceEntityCandidates(candidates: ContextReferenceCandidate[]): ContextReferenceCandidate[] {
  const groups = new Map<string, ContextReferenceCandidate[]>();
  const passthrough: ContextReferenceCandidate[] = [];
  for (const candidate of candidates) {
    const name = candidate.subject.name ?? '';
    if (!hasEntityNameSignal(name)) {
      passthrough.push(candidate);
      continue;
    }
    const key = [
      candidate.sourceRunId ?? '',
      normalizeText(name),
    ].join(':');
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const merged = [...groups.values()].map(mergeEntityCandidateGroup);
  return [...merged, ...passthrough].sort((left, right) => left.recencyRank - right.recencyRank);
}

function mergeEntityCandidateGroup(group: ContextReferenceCandidate[]): ContextReferenceCandidate {
  if (group.length === 1) {
    return group[0]!;
  }
  const preferred = [...group].sort((left, right) => (
    getCandidateSourcePriority(left) - getCandidateSourcePriority(right)
  ))[0]!;
  const evidenceRefs = group.flatMap((candidate) => candidate.evidenceRefs ?? []);
  const sourcePriority = Math.min(...group.map(getCandidateSourcePriority));
  return {
    ...preferred,
    candidateId: group.map((candidate) => candidate.candidateId).join('|'),
    sourceRunId: preferred.sourceRunId ?? group.find((candidate) => candidate.sourceRunId)?.sourceRunId,
    evidenceRefs: dedupeEvidenceRefs(evidenceRefs),
    text: group.map((candidate) => candidate.text).filter(Boolean).join('\n'),
    recencyRank: Math.min(...group.map((candidate) => candidate.recencyRank)),
    confidence: Math.max(...group.map((candidate) => candidate.confidence)),
    source: sourcePriority === 0
      ? 'context_subject'
      : sourcePriority === 1
        ? 'intent_frame'
        : preferred.source,
  };
}

function getCandidateSourcePriority(candidate: ContextReferenceCandidate): number {
  if (candidate.source === 'context_subject') {
    return 0;
  }
  if (candidate.source === 'intent_frame') {
    return 1;
  }
  if (candidate.subject.kind === 'external_subject') {
    return 2;
  }
  if (candidate.subject.kind === 'record') {
    return 3;
  }
  if (candidate.source === 'evidence' || candidate.source === 'artifact_anchor') {
    return 4;
  }
  return 5;
}

function dedupeEvidenceRefs(evidenceRefs: ContextFrame['evidenceRefs']): ContextFrame['evidenceRefs'] {
  const seen = new Set<string>();
  return evidenceRefs.filter((evidence) => {
    const key = `${evidence.artifactId}:${evidence.versionId}:${evidence.anchorLabel}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function scoreCandidates(input: {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  candidates: ContextReferenceCandidate[];
  availableTools: AgentToolDefinition[];
  embeddingProvider?: SemanticEmbeddingProvider | null;
}): Promise<{
  providerName: string;
  scoreLabel: SemanticResolutionCandidate['scoreLabel'];
  candidates: SemanticResolutionCandidate[];
}> {
  const configured = Boolean(input.embeddingProvider?.isConfigured?.() ?? input.embeddingProvider);
  const queryText = buildQueryText(input.request, input.intentFrame);
  if (input.embeddingProvider && configured) {
    try {
      const vectors = await input.embeddingProvider.embedTexts([
        queryText,
        ...input.candidates.map((candidate) => candidate.text),
      ]);
      const [queryVector, ...candidateVectors] = vectors;
      if (queryVector?.length && candidateVectors.length === input.candidates.length) {
        return {
          providerName: input.embeddingProvider.providerName ?? input.embeddingProvider.constructor.name ?? 'embedding_provider',
          scoreLabel: 'embedding',
          candidates: input.candidates.map((candidate, index) => {
            const directMatch = hasDirectTargetMatch({
              intentFrame: input.intentFrame,
              subject: candidate.subject,
              availableTools: input.availableTools,
            });
            const embeddingScore = cosineSimilarity(queryVector, candidateVectors[index] ?? []);
            const score = directMatch ? Math.max(embeddingScore, 0.98) : embeddingScore;
            return {
              ...candidate,
              score,
              scoreLabel: directMatch ? 'direct_match' : 'embedding',
              reasons: [
                directMatch ? 'direct_target_match' : 'embedding_similarity',
                score >= 0.78 ? 'embedding_strong_match' : 'embedding_ranked',
                `recency_rank:${candidate.recencyRank}`,
              ],
            };
          }),
        };
      }
    } catch (error) {
      return {
        providerName: `${input.embeddingProvider.providerName ?? 'embedding_provider'}_failed`,
        scoreLabel: 'recency',
        candidates: scoreByRecency(input.candidates, `embedding_failed:${error instanceof Error ? error.message : String(error)}`),
      };
    }
  }

  return {
    providerName: 'recency_fallback',
    scoreLabel: 'recency',
    candidates: scoreByRecency(input.candidates, 'embedding_unavailable'),
  };
}

function scoreByRecency(candidates: ContextReferenceCandidate[], reason: string): SemanticResolutionCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    score: Math.max(0.5, 0.84 - candidate.recencyRank * 0.04 + Math.min(candidate.confidence, 1) * 0.08),
    scoreLabel: 'recency',
    reasons: [reason, `recency_rank:${candidate.recencyRank}`, `confidence:${formatScore(candidate.confidence)}`],
  }));
}

function buildQueryText(request: AgentChatRequest, intentFrame: GenericIntentFrame): string {
  return [
    request.query,
    intentFrame.goal,
    intentFrame.target.kind,
    intentFrame.target.objectType,
    intentFrame.target.name,
    ...intentFrame.inputMaterials,
    ...intentFrame.constraints,
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n');
}

function buildSubjectText(subject: ContextFrameSubject, evidenceRefs: ContextFrame['evidenceRefs']): string {
  return [
    subject.kind,
    subject.type,
    subject.id,
    subject.name,
    ...evidenceRefs.flatMap((item) => [item.title, item.anchorLabel, item.snippet, item.sourceToolCode]),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n');
}

function isCandidateCompatible(input: {
  intentFrame: GenericIntentFrame;
  candidate: ContextReferenceCandidate;
  availableTools: AgentToolDefinition[];
}): boolean {
  const target = input.intentFrame.target;
  const subjectType = input.candidate.subject.type;
  if (!subjectType) {
    return target.kind === 'unknown' || target.kind === 'artifact';
  }

  if (target.kind === 'record' && target.objectType) {
    if (subjectType === 'artifact_anchor' && !hasEntityNameSignal(input.candidate.subject.name ?? '')) {
      return false;
    }
    const capabilities = findRecordCapabilities(input.availableTools, target.objectType);
    if (!capabilities.length) {
      return subjectType === target.objectType || input.candidate.subject.kind === 'record';
    }
    return capabilities.some((capability) => {
      const accepted = capability.subjectBinding?.acceptedSubjectTypes ?? [];
      return accepted.includes(subjectType) || subjectType === target.objectType;
    });
  }

  if (target.kind === 'external_subject') {
    return input.candidate.subject.kind === 'external_subject'
      || input.candidate.subject.kind === 'artifact'
      || subjectType === target.objectType;
  }

  if (target.kind === 'artifact') {
    return true;
  }

  return true;
}

function shouldBindSubjectAsTargetIdentity(input: {
  intentFrame: GenericIntentFrame;
  candidate: SemanticResolutionCandidate;
  availableTools: AgentToolDefinition[];
  query?: string;
}): boolean {
  if (hasStrongTargetIdentity(input.intentFrame, input.query)) {
    return false;
  }
  const target = input.intentFrame.target;
  if (target.kind === 'record' && target.objectType) {
    const capabilities = findRecordCapabilities(input.availableTools, target.objectType);
    if (!capabilities.length) {
      return input.candidate.subject.type === target.objectType;
    }
    return capabilities.some((capability) => {
      const accepted = capability.subjectBinding?.acceptedSubjectTypes ?? [];
      return capability.subjectBinding?.identityFromSubject === true
        && Boolean(input.candidate.subject.type && accepted.includes(input.candidate.subject.type));
    });
  }
  return target.kind === 'external_subject' || target.kind === 'artifact' || target.kind === 'unknown';
}

function hasStrongToolBinding(input: {
  intentFrame: GenericIntentFrame;
  candidate: SemanticResolutionCandidate;
  availableTools: AgentToolDefinition[];
}): boolean {
  const target = input.intentFrame.target;
  const subjectType = input.candidate.subject.type;
  if (!subjectType || target.kind !== 'record' || !target.objectType) {
    return false;
  }
  if (subjectType === target.objectType) {
    return true;
  }
  const capabilities = findRecordCapabilities(input.availableTools, target.objectType);
  return capabilities.some((capability) => capability.subjectBinding?.acceptedSubjectTypes?.includes(subjectType));
}

function findRecordCapabilities(availableTools: AgentToolDefinition[], objectType: string) {
  const prefix = `record.${objectType}.`;
  return availableTools
    .filter((tool) => tool.code.startsWith(prefix) && tool.recordCapability)
    .map((tool) => tool.recordCapability!);
}

function hasStrongTargetIdentity(intentFrame: GenericIntentFrame, query?: string): boolean {
  const name = normalizeText(intentFrame.target.name ?? '');
  if (!name) {
    return false;
  }
  if (query && name === normalizeText(query)) {
    return false;
  }
  const targetLabels = [
    intentFrame.target.kind,
    intentFrame.target.objectType,
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .map(normalizeText);
  if (targetLabels.includes(name)) {
    return false;
  }
  if (/[A-Za-z0-9][A-Za-z0-9_-]{2,}/.test(name)) {
    return true;
  }
  return countCjk(name) >= 5 && hasEntityNameSignal(name);
}

function hasDirectTargetMatch(input: {
  intentFrame: GenericIntentFrame;
  subject: ContextFrameSubject;
  availableTools: AgentToolDefinition[];
}): boolean {
  const target = normalizeText(input.intentFrame.target.name ?? '');
  if (isGenericRecordTargetLabel(input.intentFrame, input.availableTools)) {
    return false;
  }
  const subject = input.subject;
  const subjectName = normalizeText(subject.name ?? '');
  if (!target || !subjectName) {
    return false;
  }
  if (!hasDistinctiveLength(target) && !hasDistinctiveLength(subjectName)) {
    return false;
  }
  return subjectName.includes(target) || target.includes(subjectName);
}

function isRecordCollectionQueryWithoutReference(input: {
  query?: string;
  intentFrame: GenericIntentFrame;
  availableTools: AgentToolDefinition[];
}): boolean {
  const target = input.intentFrame.target;
  if (input.intentFrame.actionType !== 'query' || target.kind !== 'record' || !target.objectType) {
    return false;
  }
  const query = input.query?.trim() ?? '';
  if (!query) {
    return false;
  }
  if (!hasCollectionReadSignal(query)) {
    return false;
  }
  if (isBareRecordCollectionQueryText(query, target.objectType, input.availableTools)) {
    return true;
  }
  if (hasExplicitContextReference(query)) {
    return false;
  }
  return false;
}

function hasCollectionReadSignal(query: string): boolean {
  return /(?:查询|查一下|查|查看|搜索|找一下|打开|列出|看看|看下|list|search|show)/i.test(query)
    || /(?:列表|清单|所有|全部|全量|记录|数据|信息|资料)/.test(query);
}

function hasExplicitContextReference(query: string): boolean {
  return /(?:这个|该|当前|刚才|上一|上个|前面|上面|其|它|他|她|this|that|current|previous)/i.test(query)
    || /(?:的)\s*[\p{Script=Han}A-Za-z0-9_ -]{1,20}$/u.test(query);
}

function isBareRecordCollectionQueryText(
  query: string,
  objectType: string,
  availableTools: AgentToolDefinition[],
): boolean {
  const labels = buildRecordObjectLabels(objectType, availableTools)
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join('|');
  if (!labels) {
    return false;
  }
  const text = query.replace(/^\/\S+\s*/, '').trim();
  const operation = '(?:查询|查一下|查|查看|搜索|找一下|打开|列出|看看|看下|list|search|show)';
  const scope = '(?:所有|全部|全量|全体)?';
  const suffix = '(?:列表|清单|数据|信息|资料|记录)?';
  return new RegExp(`^${operation}\\s*${scope}\\s*(?:的)?\\s*(?:${labels})\\s*${suffix}$`, 'i').test(text);
}

function isGenericRecordTargetLabel(intentFrame: GenericIntentFrame, availableTools: AgentToolDefinition[]): boolean {
  const targetName = normalizeText(intentFrame.target.name ?? '');
  if (!targetName) {
    return true;
  }
  const labels = buildGenericTargetLabels(intentFrame, availableTools);
  return labels.has(targetName);
}

function buildRecordObjectLabels(objectType: string, availableTools: AgentToolDefinition[]): string[] {
  const labels = new Set<string>([objectType]);
  for (const capability of findRecordCapabilities(availableTools, objectType)) {
    for (const label of capability.objectLabels ?? []) {
      if (label.trim()) {
        labels.add(label.trim());
      }
    }
  }
  return [...labels];
}

function buildGenericTargetLabels(intentFrame: GenericIntentFrame, availableTools: AgentToolDefinition[]): Set<string> {
  const labels = new Set<string>();
  const add = (value?: string) => {
    const normalized = normalizeText(value ?? '');
    if (normalized) {
      labels.add(normalized);
      const singular = normalized.replace(/(?:名称|姓名|编号|信息|资料|列表|详情|数据)$/, '');
      if (singular) {
        labels.add(singular);
      }
    }
  };
  add(intentFrame.target.kind);
  add(intentFrame.target.objectType);
  if (intentFrame.target.kind === 'record' && intentFrame.target.objectType) {
    for (const capability of findRecordCapabilities(availableTools, intentFrame.target.objectType)) {
      for (const label of capability.objectLabels ?? []) {
        add(label);
      }
      for (const identityField of capability.identityFields ?? []) {
        add(identityField);
        add(capability.fieldLabels?.[identityField]);
      }
    }
  }
  return labels;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDistinctiveLength(value: string): boolean {
  return /[A-Za-z0-9][A-Za-z0-9_-]{2,}/.test(value) || countCjk(value) >= 4;
}

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。！？、；;:："'“”‘’()[\]{}<>《》【】]/g, '')
    .trim()
    .toLowerCase();
}

function countCjk(value: string): number {
  return [...value].filter((char) => /\p{Script=Han}/u.test(char)).length;
}

function hasEntityNameSignal(value: string): boolean {
  return /(公司|集团|有限|股份|银行|医院|学校|大学|研究院|事务所|协会|中心|工厂|厂)$/.test(value)
    || /(公司|集团|有限|股份)/.test(value);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function formatScore(value: number): string {
  return value.toFixed(3);
}
