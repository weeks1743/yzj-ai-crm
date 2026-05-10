import type {
  AssistantMetaQuestion,
  AssistantMetaQuestionCard,
} from './agent-api-provider';

export const DEFAULT_UPDATE_FIELD_VISIBLE_COUNT = 6;
export const UPDATE_FIELD_VISIBLE_COUNT_STEP = 5;

export function isEmptyMetaAnswer(value: unknown): boolean {
  return value === undefined
    || value === null
    || typeof value === 'string' && value.trim() === ''
    || Array.isArray(value) && value.length === 0;
}

export function shouldRenderMetaQuestionCard(input?: {
  status?: string;
  questionCard?: AssistantMetaQuestionCard;
} | null): boolean {
  return Boolean(input?.questionCard && input.status !== 'cancelled');
}

export function findLatestPendingQuestionInteractionId<T extends {
  message: {
    role: string;
    extraInfo?: {
      agentTrace?: {
        pendingInteraction?: {
          interactionId: string;
          status: string;
          questionCard?: AssistantMetaQuestionCard;
        } | null;
      };
    };
  };
}>(messages: T[]): string | undefined {
  return [...messages]
    .reverse()
    .find((item) => {
      const pending = item.message.extraInfo?.agentTrace?.pendingInteraction;
      return item.message.role === 'assistant'
        && pending?.status === 'pending'
        && shouldRenderMetaQuestionCard({
          status: pending.status,
          questionCard: pending.questionCard,
        });
    })
    ?.message.extraInfo?.agentTrace?.pendingInteraction?.interactionId;
}

export function filterUpdateFieldQuestions(input: {
  questions: AssistantMetaQuestion[];
  currentValues?: AssistantMetaQuestionCard['currentValues'];
  searchText?: string;
  showAll?: boolean;
  visibleCount?: number;
}): {
  matchedQuestions: AssistantMetaQuestion[];
  visibleQuestions: AssistantMetaQuestion[];
  hiddenCount: number;
  hasSearch: boolean;
} {
  const keyword = normalizeSearchText(input.searchText ?? '');
  const visibleCount = input.visibleCount ?? DEFAULT_UPDATE_FIELD_VISIBLE_COUNT;
  const orderedQuestions = sortUpdateFieldQuestions(input.questions, input.currentValues);
  const matchedQuestions = keyword
    ? orderedQuestions.filter((question) => {
        const current = input.currentValues?.[question.paramKey]?.value ?? '';
        return normalizeSearchText(`${question.label} ${question.paramKey} ${current}`).includes(keyword);
      })
    : orderedQuestions;
  const visibleQuestions = input.showAll || keyword
    ? matchedQuestions
    : matchedQuestions.slice(0, visibleCount);
  return {
    matchedQuestions,
    visibleQuestions,
    hiddenCount: Math.max(0, matchedQuestions.length - visibleQuestions.length),
    hasSearch: Boolean(keyword),
  };
}

function sortUpdateFieldQuestions(
  questions: AssistantMetaQuestion[],
  currentValues?: AssistantMetaQuestionCard['currentValues'],
): AssistantMetaQuestion[] {
  return questions
    .map((question, index) => ({ question, index }))
    .sort((left, right) => (
      getUpdateQuestionRank(left.question, currentValues) - getUpdateQuestionRank(right.question, currentValues)
      || left.index - right.index
    ))
    .map((item) => item.question);
}

function getUpdateQuestionRank(
  question: AssistantMetaQuestion,
  currentValues?: AssistantMetaQuestionCard['currentValues'],
): number {
  const hasCurrent = Boolean(currentValues?.[question.paramKey]?.value) || !isEmptyMetaAnswer(question.currentValue);
  return (question.required ? 0 : 100)
    + (hasCurrent ? 0 : 20)
    + getUpdateQuestionSemanticRank(question);
}

function getUpdateQuestionSemanticRank(question: AssistantMetaQuestion): number {
  const text = normalizeSearchText(`${question.label} ${question.paramKey}`);
  if (/status|stage|状态|阶段/.test(text)) {
    return 1;
  }
  if (/method|方式/.test(text)) {
    return 2;
  }
  if (/type|industry|类型|行业/.test(text)) {
    return 3;
  }
  if (/date|time|日期|时间/.test(text)) {
    return 4;
  }
  if (/phone|mobile|电话|手机/.test(text)) {
    return 5;
  }
  if (/owner|负责人|人员/.test(text)) {
    return 6;
  }
  if (/province|city|district|省|市|区/.test(text)) {
    return 7;
  }
  if (/remark|note|memo|备注|说明|描述/.test(text)) {
    return 8;
  }
  return 10;
}

export function pickChangedMetaQuestionAnswers(input: {
  questionCard: AssistantMetaQuestionCard;
  answers: Record<string, unknown>;
  selectedParamKeys?: Iterable<string>;
}): Record<string, unknown> {
  const selected = input.selectedParamKeys ? new Set(input.selectedParamKeys) : null;
  const questionsByParamKey = new Map(input.questionCard.questions.map((question) => [question.paramKey, question]));
  const changed: Record<string, unknown> = {};
  for (const [paramKey, value] of Object.entries(input.answers)) {
    if (selected && !selected.has(paramKey)) {
      continue;
    }
    if (isEmptyMetaAnswer(value)) {
      continue;
    }
    const question = questionsByParamKey.get(paramKey);
    if (question && isSameMetaAnswer(value, question.currentValue)) {
      continue;
    }
    changed[paramKey] = value;
  }
  return changed;
}

export function getMetaQuestionAnswerDisplay(input: {
  question: AssistantMetaQuestion;
  value: unknown;
  answerLabels?: Record<string, string>;
}): string {
  const label = input.answerLabels?.[input.question.paramKey];
  if (label) {
    return label;
  }
  const option = input.question.options?.find((item) => isSameMetaAnswer(item.value, input.value));
  if (option) {
    return option.label || option.description || String(option.value);
  }
  return stringifyMetaAnswer(input.value);
}

export function getMetaQuestionCurrentDisplay(
  questionCard: AssistantMetaQuestionCard,
  question: AssistantMetaQuestion,
): string {
  return questionCard.currentValues?.[question.paramKey]?.value
    ?? getMetaQuestionAnswerDisplay({ question, value: question.currentValue })
    ?? '';
}

export function isSameMetaAnswer(left: unknown, right: unknown): boolean {
  if (isEmptyMetaAnswer(left) && isEmptyMetaAnswer(right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function stringifyMetaAnswer(value: unknown): string {
  if (isEmptyMetaAnswer(value)) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(stringifyMetaAnswer).filter(Boolean).join('、');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['label', 'title', 'name', 'displayName', 'showName', 'value']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return '';
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}
