import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AgentChatMessage,
  AgentChatRequest,
  AgentEvidenceCard,
  AgentToolCall,
  ExecutionState,
  IntentFrame,
  TaskPlan,
} from './contracts.js';

interface FocusRow {
  intent_frame_json: string;
}

export class AgentRunRepository {
  constructor(private readonly database: DatabaseSync) {}

  findFocusedCompany(conversationKey: string): string | null {
    const row = this.database
      .prepare(
        `
          SELECT intent_frame_json
          FROM agent_runs
          WHERE conversation_key = ?
          ORDER BY created_at DESC
          LIMIT 10
        `,
      )
      .all(conversationKey) as unknown as FocusRow[];

    for (const item of row) {
      try {
        const intent = JSON.parse(item.intent_frame_json) as IntentFrame;
        const company = intent.targets.find((target) => target.type === 'company')?.name;
        if (company) {
          return company;
        }
      } catch {
        // Ignore malformed historical rows.
      }
    }

    return null;
  }

  saveRun(input: {
    request: AgentChatRequest;
    runId: string;
    traceId: string;
    eid: string;
    appId: string;
    intentFrame: IntentFrame;
    taskPlan: TaskPlan;
    executionState: ExecutionState;
    toolCalls: AgentToolCall[];
    evidence: AgentEvidenceCard[];
    message: AgentChatMessage;
  }): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO agent_runs (
            run_id, trace_id, eid, app_id, conversation_key, scene_key, user_input,
            intent_frame_json, task_plan_json, execution_state_json, evidence_refs_json,
            status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.runId,
        input.traceId,
        input.eid,
        input.appId,
        input.request.conversationKey,
        input.request.sceneKey,
        input.request.query,
        JSON.stringify(input.intentFrame),
        JSON.stringify(input.taskPlan),
        JSON.stringify(input.executionState),
        JSON.stringify(input.evidence),
        input.executionState.status,
        now,
        now,
      );

    this.database
      .prepare(
        `
          INSERT INTO agent_messages (
            message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        input.runId,
        input.request.conversationKey,
        'user',
        input.request.query,
        JSON.stringify(input.request.attachments ?? []),
        '{}',
        now,
      );

    this.database
      .prepare(
        `
          INSERT INTO agent_messages (
            message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        input.runId,
        input.request.conversationKey,
        input.message.role,
        input.message.content,
        JSON.stringify(input.message.attachments ?? []),
        JSON.stringify(input.message.extraInfo),
        now,
      );

    const insertToolCall = this.database.prepare(
      `
        INSERT INTO agent_tool_calls (
          tool_call_id, run_id, tool_code, status, input_summary, output_summary,
          started_at, finished_at, error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const toolCall of input.toolCalls) {
      insertToolCall.run(
        toolCall.id,
        input.runId,
        toolCall.toolCode,
        toolCall.status,
        toolCall.inputSummary,
        toolCall.outputSummary,
        toolCall.startedAt,
        toolCall.finishedAt,
        toolCall.errorMessage,
      );
    }
  }
}
