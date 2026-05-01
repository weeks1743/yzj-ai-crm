import type {
  AgentConversationListResponse,
  AgentConversationUpsertRequest,
  ConversationSession,
} from './contracts.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import { BadRequestError } from './errors.js';

export class AgentConversationService {
  constructor(private readonly repository: AgentRunRepository) {}

  async listConversations(operatorOpenId?: string): Promise<AgentConversationListResponse> {
    return {
      items: await this.repository.listConversations(normalizeOperatorOpenId(operatorOpenId)),
    };
  }

  async upsertConversation(request: AgentConversationUpsertRequest): Promise<ConversationSession> {
    return this.repository.upsertConversation({
      operatorOpenId: normalizeOperatorOpenId(request.operatorOpenId),
      conversation: normalizeConversation(request.conversation),
    });
  }
}

function normalizeOperatorOpenId(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestError('operatorOpenId 不能为空');
  }
  return normalized;
}

function normalizeConversation(value: unknown): ConversationSession {
  if (!value || typeof value !== 'object') {
    throw new BadRequestError('conversation 不能为空');
  }

  const candidate = value as Partial<ConversationSession>;
  return {
    key: normalizeString(candidate.key, 'conversation.key'),
    label: normalizeString(candidate.label, 'conversation.label'),
    route: normalizeString(candidate.route, 'conversation.route'),
    group: normalizeString(candidate.group, 'conversation.group'),
    lastMessage: normalizeString(candidate.lastMessage, 'conversation.lastMessage'),
    updatedAt: normalizeString(candidate.updatedAt, 'conversation.updatedAt'),
    scene: normalizeString(candidate.scene, 'conversation.scene'),
    ...(Number.isFinite(candidate.badgeCount) ? { badgeCount: Number(candidate.badgeCount) } : {}),
  };
}

function normalizeString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestError(`${fieldName} 不能为空`);
  }
  return value.trim();
}
