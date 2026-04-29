import type {
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
}

export interface AgentConfirmationListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  runId?: string;
}

export class AgentObservabilityService {
  constructor(private readonly repository: AgentRunRepository) {}

  listRuns(query: AgentRunListQuery): AgentRunListResponse {
    return this.repository.listRuns(query);
  }

  getRunDetail(runId: string): AgentRunDetailResponse {
    const detail = this.repository.getRunDetail(runId);
    if (!detail) {
      throw new NotFoundError(`未找到 Agent 运行记录：${runId}`);
    }
    return detail;
  }

  listConfirmations(query: AgentConfirmationListQuery): AgentConfirmationListResponse {
    return this.repository.listConfirmations(query);
  }
}
