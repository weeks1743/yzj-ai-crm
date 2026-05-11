import type { AssistantEvidenceCard } from './agent-api-provider';

type EvidenceCardKind = NonNullable<AssistantEvidenceCard['kind']>;

const recordingMaterialSourceToolCodes = new Set([
  'tongyi.audio.recording_material',
]);

const imageEnabledSourceToolCodes = new Set([
  'external.company_research',
  'ext.company_research_pm',
  'ext.visit_conversation_understanding',
  'ext.customer_needs_todo_analysis',
  'ext.customer_value_positioning_pm',
  'ext.yunzhijia_visit_prep',
]);

const companyResearchSourceToolCodes = new Set([
  'external.company_research',
  'ext.company_research_pm',
]);

const visitPrepSourceToolCodes = new Set([
  'ext.yunzhijia_visit_prep',
]);

export function isLikelyInternalEvidenceId(value?: string | null): boolean {
  const normalized = (value ?? '').replace(/\s+/g, '').trim();
  if (!normalized) {
    return false;
  }
  return /^[0-9a-f]{16,64}$/i.test(normalized)
    || /^[0-9a-f]{16,64}的(?:商机|机会|商机跟进记录|跟进记录|拜访记录|回访记录)$/i.test(normalized)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized)
    || /^(?:artifact|anchor|chunk|record|form|customer|contact|opportunity|followup)[-_][A-Za-z0-9_-]+$/i.test(normalized);
}

export function sanitizeEvidenceText(value?: string | null): string {
  return (value ?? '')
    .replace(/\b(?:artifactId|anchorId|chunkId|formInstId|openId)\s*[：:=]\s*[A-Za-z0-9_-]{8,64}\b/gi, '')
    .replace(/\b(?:artifact|anchor|chunk|record|form|customer|contact|opportunity|followup)[-_][A-Za-z0-9_-]{8,64}\b/gi, '')
    .replace(/\b[0-9a-f]{16,64}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRecordingMaterialEvidenceCard(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  const kind = item.kind as EvidenceCardKind | undefined;
  if (kind === 'recording_material') {
    return true;
  }
  return recordingMaterialSourceToolCodes.has(item.sourceToolCode.trim());
}

export function isRecordingEvidenceCard(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  return isRecordingMaterialEvidenceCard(item);
}

export function isCompanyResearchEvidenceCard(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  const kind = item.kind as EvidenceCardKind | undefined;
  return kind === 'company_research' || companyResearchSourceToolCodes.has(item.sourceToolCode.trim());
}

export function isVisitPrepEvidenceCard(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  const kind = item.kind as EvidenceCardKind | undefined;
  return kind === 'analysis_material' && visitPrepSourceToolCodes.has(item.sourceToolCode.trim());
}

export function isReportableEvidenceCard(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  return isCompanyResearchEvidenceCard(item) || isVisitPrepEvidenceCard(item);
}

export function canGenerateEvidenceImage(
  item: Pick<AssistantEvidenceCard, 'kind' | 'sourceToolCode'>,
): boolean {
  const kind = item.kind as EvidenceCardKind | undefined;
  return isCompanyResearchEvidenceCard(item)
    || kind === 'analysis_material'
    || imageEnabledSourceToolCodes.has(item.sourceToolCode.trim());
}

export function compactEvidenceSnippet(value?: string | null): string {
  const normalized = sanitizeEvidenceText(value);
  if (!normalized) {
    return '已整理为公司研究资料，可查看完整研究。';
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

export function getEvidenceCardTitle(item: AssistantEvidenceCard): string {
  const title = sanitizeEvidenceText(item.title);
  if (title && !isLikelyInternalEvidenceId(title)) {
    return title;
  }
  const anchorLabel = sanitizeEvidenceText(item.anchorLabel);
  if (isRecordingMaterialEvidenceCard(item)) {
    return anchorLabel && !isLikelyInternalEvidenceId(anchorLabel)
      ? `${anchorLabel} 录音资料包`
      : '录音资料包';
  }
  if (item.kind === 'analysis_material') {
    if (item.sourceToolCode === 'ext.yunzhijia_visit_prep') {
      return anchorLabel && !isLikelyInternalEvidenceId(anchorLabel)
        ? `${anchorLabel} 客户拜访准备`
        : '客户拜访准备资料';
    }
    return anchorLabel && !isLikelyInternalEvidenceId(anchorLabel)
      ? `${anchorLabel} 分析资料`
      : '分析资料';
  }
  return anchorLabel && !isLikelyInternalEvidenceId(anchorLabel)
    ? `${anchorLabel} 公司研究`
    : '公司研究资料';
}
