import type { AgentChatRequest, AppConfig, IntentFrame } from './contracts.js';
import type { DeepSeekChatClient } from './deepseek-chat-client.js';
import { cleanupCompanyName, extractCompanyName, inferFallbackIntent, isCompanyResearchQuery } from './agent-utils.js';
import { getErrorMessage } from './errors.js';

export class IntentFrameService {
  constructor(
    private readonly options: {
      config: AppConfig;
      chatClient: DeepSeekChatClient;
    },
  ) {}

  async createIntentFrame(input: AgentChatRequest, focusedCompany?: string | null): Promise<IntentFrame> {
    if (!this.options.chatClient.isConfigured()) {
      return inferFallbackIntent(input, focusedCompany, 'deepseek_not_configured');
    }

    try {
      const raw = await this.options.chatClient.completeJson([
        {
          role: 'system',
          content: [
            '你是业务无关的 Agent 意图解析器，只输出 JSON。',
            '字段: actionType(query/analyze/write/plan/export/clarify), goal, targetType(company/customer/opportunity/contact/followup/artifact/unknown), targets, inputMaterials, constraints, missingSlots, confidence。',
            '不要输出 markdown，不要解释。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            query: input.query,
            sceneKey: input.sceneKey,
            focusedCompany,
            attachments: input.attachments ?? [],
          }),
        },
      ]);
      return normalizeIntent(JSON.parse(raw), input, focusedCompany);
    } catch (error) {
      return inferFallbackIntent(input, focusedCompany, `llm_failed:${getErrorMessage(error)}`);
    }
  }
}

function normalizeIntent(value: any, input: AgentChatRequest, focusedCompany?: string | null): IntentFrame {
  const queryCompanyName = extractCompanyName(input.query);
  const materialCompanyName = extractCompanyNameFromMaterials(value?.inputMaterials);
  const repairedCompanyName = queryCompanyName || materialCompanyName || '';
  const targets: IntentFrame['targets'] = Array.isArray(value?.targets)
    ? value.targets
        .map((item: any) => ({
          type: normalizeTargetType(item?.type),
          id: cleanupCompanyName(String(item?.id || item?.name || '').trim()),
          name: cleanupCompanyName(String(item?.name || item?.id || '').trim()),
        }))
        .filter((item: { id: string; name: string }) => item.id && item.name)
    : [];
  const hasCompanyResearchVerb = isCompanyResearchQuery(input.query);
  if (hasCompanyResearchVerb && repairedCompanyName) {
    const repairedTarget = { type: 'company' as const, id: repairedCompanyName, name: repairedCompanyName };
    const companyTargetIndex = targets.findIndex((item) => item.type === 'company');
    if (companyTargetIndex >= 0) {
      targets[companyTargetIndex] = repairedTarget;
    } else {
      targets.unshift(repairedTarget);
    }
  } else if (!targets.length && repairedCompanyName) {
    targets.push({ type: 'company', id: repairedCompanyName, name: repairedCompanyName });
  }
  if (!targets.length && focusedCompany && value?.actionType === 'query') {
    targets.push({ type: 'company', id: focusedCompany, name: focusedCompany });
  }

  const actionType = hasCompanyResearchVerb && repairedCompanyName
    ? 'analyze'
    : ['query', 'analyze', 'write', 'plan', 'export', 'clarify'].includes(value?.actionType)
    ? value.actionType
    : 'clarify';
  const targetType = hasCompanyResearchVerb && repairedCompanyName
    ? 'company'
    : ['company', 'customer', 'opportunity', 'contact', 'followup', 'artifact', 'unknown'].includes(value?.targetType)
    ? value.targetType
    : targets[0]?.type ?? 'unknown';

  return {
    actionType,
    goal: String(value?.goal || '理解用户目标').trim(),
    targetType,
    targets,
    inputMaterials: Array.isArray(value?.inputMaterials) ? value.inputMaterials.map(String) : [],
    constraints: Array.isArray(value?.constraints) ? value.constraints.map(String) : [],
    missingSlots: Array.isArray(value?.missingSlots) ? value.missingSlots.map(String) : [],
    confidence: Number.isFinite(Number(value?.confidence)) ? Math.max(0, Math.min(1, Number(value.confidence))) : 0.6,
    source: 'llm',
  };
}

function normalizeTargetType(value: unknown): IntentFrame['targetType'] {
  return ['company', 'customer', 'opportunity', 'contact', 'followup', 'artifact', 'unknown'].includes(String(value))
    ? String(value) as IntentFrame['targetType']
    : 'unknown';
}

function extractCompanyNameFromMaterials(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }

  for (const item of value) {
    const candidate = cleanupCompanyName(String(item ?? ''));
    if (candidate && (candidate.includes('公司') || candidate.includes('集团') || candidate.includes('有限'))) {
      return candidate;
    }
  }

  return '';
}
