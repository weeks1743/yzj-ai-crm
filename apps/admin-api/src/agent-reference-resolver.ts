import type {
  ContextFrame,
  GenericIntentFrame,
  ReferenceResolution,
} from './agent-core.js';
import type { AgentChatRequest } from './contracts.js';

const CONTEXT_REFERENCE_PATTERN =
  /(这个|这个客户|这个公司|这家公司|该客户|该公司|上面这个|刚才这个|刚才那家|前面这个|前面那家)/;

const REFERENCE_NAME_PATTERN =
  /^(这个|这个客户|这个公司|这家公司|该客户|该公司|上面这个|刚才这个|刚才那家|前面这个|前面那家|客户|公司)$/;

export function resolveContextReference(input: {
  request: AgentChatRequest;
  intentFrame: GenericIntentFrame;
  contextFrame?: ContextFrame | null;
}): {
  intentFrame: GenericIntentFrame;
  resolvedContext: ReferenceResolution;
} {
  const contextFrame = input.contextFrame ?? null;
  const subject = contextFrame?.subject;
  const query = input.request.query.trim();
  const targetName = input.intentFrame.target.name?.trim();
  const hasReference = CONTEXT_REFERENCE_PATTERN.test(query)
    || Boolean(targetName && REFERENCE_NAME_PATTERN.test(targetName));

  if (!subject?.name || !hasReference) {
    return {
      intentFrame: input.intentFrame,
      resolvedContext: {
        usedContext: false,
        reason: subject?.name ? '当前输入未包含可承接的短指代。' : '当前会话没有可承接的上下文主体。',
        subject,
        sourceRunId: contextFrame?.sourceRunId,
        evidenceRefs: contextFrame?.evidenceRefs ?? [],
      },
    };
  }

  const shouldReplaceName = !targetName || REFERENCE_NAME_PATTERN.test(targetName) || query.length <= 12;
  if (!shouldReplaceName) {
    return {
      intentFrame: input.intentFrame,
      resolvedContext: {
        usedContext: false,
        reason: '当前输入已有明确目标名称，未使用上下文覆盖。',
        subject,
        sourceRunId: contextFrame?.sourceRunId,
        evidenceRefs: contextFrame?.evidenceRefs ?? [],
      },
    };
  }

  return {
    intentFrame: {
      ...input.intentFrame,
      target: {
        ...input.intentFrame.target,
        name: subject.name,
        id: input.intentFrame.target.id || subject.id,
      },
    },
    resolvedContext: {
      usedContext: true,
      reason: '检测到短指代，已使用会话上下文主体补齐目标名称。',
      subject,
      sourceRunId: contextFrame?.sourceRunId,
      evidenceRefs: contextFrame?.evidenceRefs ?? [],
    },
  };
}
