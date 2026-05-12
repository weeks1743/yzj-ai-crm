import type {
  AgentConversationProcessResponse,
  AgentConfirmationListResponse,
  AgentRunDetailResponse,
  AgentRunListResponse,
} from './contracts.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import { NotFoundError } from './errors.js';

export interface AgentRunListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  sceneKey?: string;
  conversationKey?: string;
  traceId?: string;
  operatorName?: string;
}

export interface AgentConfirmationListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  runId?: string;
}

export class AgentObservabilityService {
  constructor(private readonly repository: AgentRunRepository) {}

  async listRuns(query: AgentRunListQuery): Promise<AgentRunListResponse> {
    return this.repository.listRuns(query);
  }

  async getRunDetail(runId: string): Promise<AgentRunDetailResponse> {
    const detail = await this.repository.getRunDetail(runId);
    if (!detail) {
      throw new NotFoundError(`未找到 Agent 运行记录：${runId}`);
    }
    return detail;
  }

  async getConversationProcess(conversationKey: string): Promise<AgentConversationProcessResponse> {
    return this.repository.getConversationProcess(conversationKey);
  }

  async listConfirmations(query: AgentConfirmationListQuery): Promise<AgentConfirmationListResponse> {
    return this.repository.listConfirmations(query);
  }
}
