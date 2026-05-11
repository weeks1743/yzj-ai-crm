import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type {
  AgentChatMessage,
  AgentChatRequest,
  AgentConfirmationAuditRow,
  AgentConfirmationListResponse,
  AgentConfirmationStatus,
  AgentEvidenceCard,
  AgentExecutionStatus,
  AgentObservedMessage,
  AgentToolCall,
  ExecutionState,
  IntentFrame,
  AgentRunDetailResponse,
  AgentRunListResponse,
  AgentRunSummary,
  ConversationSession,
  TaskPlan,
} from './contracts.js';
import type {
  AgentToolSelection,
  ConfirmationRequest,
  ContextFrame,
  ContextFrameSubject,
  ContextReferenceCandidate,
  PendingInteraction,
} from './agent-core.js';
import type { DatabaseConnection } from './database.js';

interface FocusRow extends QueryResultRow {
  run_id?: string;
  user_input?: string;
  intent_frame_json: unknown;
  context_subject_json?: unknown;
  evidence_refs_json?: unknown;
  created_at?: string;
}

interface ConfirmationRow extends QueryResultRow {
  confirmation_id: string;
  run_id: string;
  tool_code: string;
  status: ConfirmationRequest['status'];
  title: string;
  summary: string;
  preview_json: unknown;
  request_input_json: unknown;
  created_at: string;
  decided_at: string | null;
}

interface AgentRunListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  sceneKey?: string;
  conversationKey?: string;
  traceId?: string;
}

interface AgentConfirmationListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  runId?: string;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface AgentRunRow extends QueryResultRow {
  run_id: string;
  trace_id: string;
  eid: string;
  app_id: string;
  conversation_key: string;
  scene_key: string;
  user_input: string;
  intent_frame_json: unknown;
  context_subject_json: unknown;
  task_plan_json: unknown;
  execution_state_json: unknown;
  evidence_refs_json: unknown;
  status: string;
  created_at: string;
  updated_at: string;
  tool_call_count: string | number;
  failed_tool_call_count: string | number;
  pending_confirmation_count: string | number;
}

interface AgentMessageRow extends QueryResultRow {
  message_id: string;
  run_id: string;
  conversation_key: string;
  role: string;
  content: string;
  attachments_json: unknown;
  extra_info_json: unknown;
  created_at: string;
}

interface AgentConversationRow extends QueryResultRow {
  conversation_key: string;
  operator_open_id: string;
  label: string;
  route: string;
  group_name: string;
  last_message: string;
  updated_label: string;
  scene_key: string;
  created_at: string;
  updated_at: string;
}

interface AgentToolCallRow extends QueryResultRow {
  tool_call_id: string;
  run_id: string;
  tool_code: string;
  status: AgentToolCall['status'];
  input_summary: string;
  output_summary: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

interface PendingInteractionStateRow extends QueryResultRow {
  extra_info_json: unknown;
}

interface ConfirmationAuditRow extends ConfirmationRow {
  trace_id: string | null;
}

interface BackgroundRunRow extends QueryResultRow {
  run_id: string;
  trace_id: string;
  conversation_key: string;
  scene_key: string;
  intent_frame_json: unknown;
  task_plan_json: unknown;
  execution_state_json: unknown;
  context_subject_json: unknown;
}

export interface BackgroundRunCompletionInput {
  runId: string;
  status: Extract<AgentExecutionStatus, 'completed' | 'failed' | 'tool_unavailable'>;
  headline: string;
  content: string;
  references: string[];
  evidence: AgentEvidenceCard[];
  contextFrame?: ContextFrame | null;
  toolCalls: AgentToolCall[];
  currentStepKey?: string | null;
}

export class AgentRunRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async listConversations(operatorOpenId: string): Promise<ConversationSession[]> {
    const rows = await this.database.query<AgentConversationRow>(
      `
        SELECT *
        FROM ${this.database.table('agent_conversations')}
        WHERE operator_open_id = $1
        ORDER BY updated_at DESC, conversation_key DESC
      `,
      [operatorOpenId],
    );

    return rows.map(mapConversationRow);
  }

  async upsertConversation(input: {
    operatorOpenId: string;
    conversation: ConversationSession;
  }): Promise<ConversationSession> {
    const now = new Date().toISOString();
    const conversation = input.conversation;
    const row = await this.database.queryOne<AgentConversationRow>(
      `
        INSERT INTO ${this.database.table('agent_conversations')} (
          conversation_key, operator_open_id, label, route, group_name, last_message,
          updated_label, scene_key, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (conversation_key) DO UPDATE SET
          operator_open_id = EXCLUDED.operator_open_id,
          label = EXCLUDED.label,
          route = EXCLUDED.route,
          group_name = EXCLUDED.group_name,
          last_message = EXCLUDED.last_message,
          updated_label = EXCLUDED.updated_label,
          scene_key = EXCLUDED.scene_key,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        conversation.key,
        input.operatorOpenId,
        conversation.label,
        conversation.route,
        conversation.group,
        conversation.lastMessage,
        conversation.updatedAt,
        conversation.scene,
        now,
        now,
      ],
    );

    return mapConversationRow(row);
  }

  async listRuns(query: AgentRunListQuery = {}): Promise<AgentRunListResponse> {
    const { page, pageSize, offset } = normalizePagination(query.page, query.pageSize);
    const where = buildRunWhere(query);
    const totalRow = await this.database.queryOne<CountRow>(
      `SELECT COUNT(*) AS total FROM ${this.database.table('agent_runs')} r ${where.sql}`,
      where.params,
    );
    const rows = await this.database.query<AgentRunRow>(
      `
        SELECT r.*,
               (SELECT COUNT(*) FROM ${this.database.table('agent_tool_calls')} t WHERE t.run_id = r.run_id) AS tool_call_count,
               (SELECT COUNT(*) FROM ${this.database.table('agent_tool_calls')} t WHERE t.run_id = r.run_id AND t.status = 'failed') AS failed_tool_call_count,
               (SELECT COUNT(*) FROM ${this.database.table('agent_confirmations')} c WHERE c.run_id = r.run_id AND c.status = 'pending') AS pending_confirmation_count
        FROM ${this.database.table('agent_runs')} r
        ${where.sql}
        ORDER BY r.created_at DESC, r.run_id DESC
        LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}
      `,
      [...where.params, pageSize, offset],
    );

    return {
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0),
      items: rows.map(mapRunSummary),
    };
  }

  async getRunDetail(runId: string): Promise<AgentRunDetailResponse | null> {
    const row = await this.database.queryMaybeOne<AgentRunRow>(
      `
        SELECT r.*,
               (SELECT COUNT(*) FROM ${this.database.table('agent_tool_calls')} t WHERE t.run_id = r.run_id) AS tool_call_count,
               (SELECT COUNT(*) FROM ${this.database.table('agent_tool_calls')} t WHERE t.run_id = r.run_id AND t.status = 'failed') AS failed_tool_call_count,
               (SELECT COUNT(*) FROM ${this.database.table('agent_confirmations')} c WHERE c.run_id = r.run_id AND c.status = 'pending') AS pending_confirmation_count
        FROM ${this.database.table('agent_runs')} r
        WHERE r.run_id = $1
        LIMIT 1
      `,
      [runId],
    );

    if (!row) {
      return null;
    }

    const intentFrame = parseJson<IntentFrame>(row.intent_frame_json, fallbackIntentFrame());
    const taskPlan = parseJson<TaskPlan>(row.task_plan_json, fallbackTaskPlan());
    const executionState = parseJson<ExecutionState>(row.execution_state_json, fallbackExecutionState(row));
    const messages = await this.database.query<AgentMessageRow>(
      `
        SELECT *
        FROM ${this.database.table('agent_messages')}
        WHERE run_id = $1
        ORDER BY created_at ASC, message_id ASC
      `,
      [runId],
    );
    const toolCalls = await this.database.query<AgentToolCallRow>(
      `
        SELECT *
        FROM ${this.database.table('agent_tool_calls')}
        WHERE run_id = $1
        ORDER BY started_at ASC, tool_call_id ASC
      `,
      [runId],
    );

    return {
      run: mapRunSummary(row),
      intentFrame,
      taskPlan,
      executionState,
      contextSubject: parseContextSubject(row.context_subject_json),
      evidenceRefs: parseEvidenceRefs(row.evidence_refs_json),
      messages: messages.map(mapObservedMessage),
      toolCalls: toolCalls.map(mapToolCallRow),
      confirmations: (await this.listConfirmations({ runId, page: 1, pageSize: 200 })).items,
    };
  }

  async listConfirmations(query: AgentConfirmationListQuery = {}): Promise<AgentConfirmationListResponse> {
    const { page, pageSize, offset } = normalizePagination(query.page, query.pageSize);
    const where = buildConfirmationWhere(query);
    const totalRow = await this.database.queryOne<CountRow>(
      `
        SELECT COUNT(*) AS total
        FROM ${this.database.table('agent_confirmations')} c
        LEFT JOIN ${this.database.table('agent_runs')} r ON r.run_id = c.run_id
        ${where.sql}
      `,
      where.params,
    );
    const rows = await this.database.query<ConfirmationAuditRow>(
      `
        SELECT c.*, r.trace_id
        FROM ${this.database.table('agent_confirmations')} c
        LEFT JOIN ${this.database.table('agent_runs')} r ON r.run_id = c.run_id
        ${where.sql}
        ORDER BY c.created_at DESC, c.confirmation_id DESC
        LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}
      `,
      [...where.params, pageSize, offset],
    );

    return {
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0),
      items: rows.map(mapConfirmationAuditRow),
    };
  }

  async findContextFrame(conversationKey: string): Promise<ContextFrame | null> {
    const rows = await this.database.query<FocusRow>(
      `
        SELECT run_id, user_input, intent_frame_json, evidence_refs_json, context_subject_json
        FROM ${this.database.table('agent_runs')}
        WHERE conversation_key = $1
        ORDER BY created_at DESC, run_id DESC
        LIMIT 10
      `,
      [conversationKey],
    );

    for (const row of rows) {
      const evidenceRefs = parseEvidenceRefs(row.evidence_refs_json);
      const subject = parseContextSubject(row.context_subject_json) ?? resolveSubjectFromRun({
        intentJson: row.intent_frame_json,
        evidenceRefs,
        userInput: row.user_input,
      });
      if (isOpaqueInternalIdExternalSubject(subject)) {
        continue;
      }
      if (subject?.name) {
        return {
          subject,
          sourceRunId: row.run_id,
          evidenceRefs,
          confidence: evidenceRefs.length ? 0.86 : 0.72,
          resolvedBy: evidenceRefs.length ? 'agent_run.evidence_refs' : 'agent_run.intent_frame',
        };
      }
    }

    return null;
  }

  async findContextCandidates(conversationKey: string, limit = 12): Promise<ContextReferenceCandidate[]> {
    const rows = await this.database.query<FocusRow>(
      `
        SELECT run_id, user_input, intent_frame_json, evidence_refs_json, context_subject_json, created_at
        FROM ${this.database.table('agent_runs')}
        WHERE conversation_key = $1
        ORDER BY created_at DESC, run_id DESC
        LIMIT $2
      `,
      [conversationKey, limit],
    );

    const candidates: ContextReferenceCandidate[] = [];
    rows.forEach((row, index) => {
      const evidenceRefs = parseEvidenceRefs(row.evidence_refs_json);
      const parsedIntent = parseIntentFrame(row.intent_frame_json);
      const subject = parseContextSubject(row.context_subject_json) ?? resolveSubjectFromRun({
        intentJson: row.intent_frame_json,
        evidenceRefs,
        userInput: row.user_input,
      });
      if (subject?.name) {
        candidates.push({
          candidateId: `${row.run_id ?? 'run'}:${subject.kind}:${subject.type ?? ''}:${subject.id ?? subject.name}`,
          subject,
          sourceRunId: row.run_id,
          evidenceRefs,
          text: buildCandidateText({
            subject,
            userInput: row.user_input,
            intentFrame: parsedIntent,
            evidenceRefs,
          }),
          recencyRank: index,
          confidence: evidenceRefs.length ? 0.86 : 0.72,
          source: row.context_subject_json ? 'context_subject' : 'intent_frame',
        });
      }

      for (const evidence of evidenceRefs) {
        if (!evidence.anchorLabel?.trim()) {
          continue;
        }
        candidates.push({
          candidateId: `${row.run_id ?? 'run'}:evidence:${evidence.artifactId}:${evidence.anchorLabel}`,
          subject: {
            kind: 'artifact',
            type: 'artifact_anchor',
            id: evidence.artifactId,
            name: evidence.anchorLabel,
          },
          sourceRunId: row.run_id,
          evidenceRefs: [evidence],
          text: buildCandidateText({
            subject: {
              kind: 'artifact',
              type: 'artifact_anchor',
              id: evidence.artifactId,
              name: evidence.anchorLabel,
            },
            userInput: row.user_input,
            intentFrame: parsedIntent,
            evidenceRefs: [evidence],
          }),
          recencyRank: index,
          confidence: 0.82,
          source: 'evidence',
        });
      }
    });

    return dedupeContextCandidates(candidates);
  }

  async findPendingInteractionState(input: {
    runId: string;
    conversationKey?: string;
    interactionId?: string;
  }): Promise<{ pendingInteraction: PendingInteraction; selectedTool?: AgentToolSelection } | null> {
    const clauses = ['run_id = $1', "role = 'assistant'"];
    const params: string[] = [input.runId];
    if (input.conversationKey?.trim()) {
      clauses.push(`conversation_key = $${params.length + 1}`);
      params.push(input.conversationKey.trim());
    }
    const rows = await this.database.query<PendingInteractionStateRow>(
      `
        SELECT extra_info_json
        FROM ${this.database.table('agent_messages')}
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, message_id DESC
        LIMIT 20
      `,
      params,
    );

    for (const row of rows) {
      const extraInfo = parseJson<Record<string, unknown>>(row.extra_info_json, {});
      const agentTrace = readRecord(extraInfo.agentTrace);
      const pendingInteraction = readRecord(agentTrace.pendingInteraction) as unknown as PendingInteraction | null;
      if (
        !pendingInteraction
        || pendingInteraction.status !== 'pending'
        || input.interactionId && pendingInteraction.interactionId !== input.interactionId
      ) {
        continue;
      }
      const selectedTool = readRecord(agentTrace.selectedTool) as unknown as AgentToolSelection | null;
      return {
        pendingInteraction,
        ...(selectedTool?.toolCode ? { selectedTool } : {}),
      };
    }

    return null;
  }

  async findTraceIdByRunId(runId: string): Promise<string | null> {
    const row = await this.database.queryMaybeOne<{ trace_id: string }>(
      `
        SELECT trace_id
        FROM ${this.database.table('agent_runs')}
        WHERE run_id = $1
        LIMIT 1
      `,
      [runId],
    );
    return row?.trace_id?.trim() || null;
  }

  async findFocusedCompany(conversationKey: string): Promise<string | null> {
    const row = await this.database.query<FocusRow>(
      `
        SELECT intent_frame_json
        FROM ${this.database.table('agent_runs')}
        WHERE conversation_key = $1
        ORDER BY created_at DESC, run_id DESC
        LIMIT 10
      `,
      [conversationKey],
    );

    for (const item of row) {
      try {
        const intent = parseJson<IntentFrame | null>(item.intent_frame_json, null);
        const company = intent?.targets.find((target) => target.type === 'company')?.name;
        if (company) {
          return company;
        }
      } catch {
        // Ignore malformed historical rows.
      }
    }

    return null;
  }

  async saveRun(input: {
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
    contextFrame?: ContextFrame | null;
    message: AgentChatMessage;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.database.query(
      `
        INSERT INTO ${this.database.table('agent_runs')} (
          run_id, trace_id, eid, app_id, conversation_key, scene_key, user_input,
          intent_frame_json, context_subject_json, task_plan_json, execution_state_json, evidence_refs_json,
          status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15)
        ON CONFLICT (run_id) DO UPDATE SET
          trace_id = EXCLUDED.trace_id,
          eid = EXCLUDED.eid,
          app_id = EXCLUDED.app_id,
          conversation_key = EXCLUDED.conversation_key,
          scene_key = EXCLUDED.scene_key,
          user_input = EXCLUDED.user_input,
          intent_frame_json = EXCLUDED.intent_frame_json,
          context_subject_json = EXCLUDED.context_subject_json,
          task_plan_json = EXCLUDED.task_plan_json,
          execution_state_json = EXCLUDED.execution_state_json,
          evidence_refs_json = EXCLUDED.evidence_refs_json,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.runId,
        input.traceId,
        input.eid,
        input.appId,
        input.request.conversationKey,
        input.request.sceneKey,
        input.request.query,
        JSON.stringify(input.intentFrame),
        JSON.stringify(input.contextFrame?.subject ?? null),
        JSON.stringify(input.taskPlan),
        JSON.stringify(input.executionState),
        JSON.stringify(input.evidence),
        input.executionState.status,
        now,
        now,
      ],
    );

    await this.database.query(
      `
        INSERT INTO ${this.database.table('agent_messages')} (
          message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      `,
      [
        randomUUID(),
        input.runId,
        input.request.conversationKey,
        'user',
        input.request.query,
        JSON.stringify(input.request.attachments ?? []),
        '{}',
        now,
      ],
    );

    await this.database.query(
      `
        INSERT INTO ${this.database.table('agent_messages')} (
          message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      `,
      [
        randomUUID(),
        input.runId,
        input.request.conversationKey,
        input.message.role,
        input.message.content,
        JSON.stringify(input.message.attachments ?? []),
        JSON.stringify(input.message.extraInfo),
        now,
      ],
    );

    await this.touchConversationFromRun(input.request, now);

    for (const toolCall of input.toolCalls) {
      await this.database.query(
        `
          INSERT INTO ${this.database.table('agent_tool_calls')} (
            tool_call_id, run_id, tool_code, status, input_summary, output_summary,
            started_at, finished_at, error_message
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (tool_call_id) DO UPDATE SET
            run_id = EXCLUDED.run_id,
            tool_code = EXCLUDED.tool_code,
            status = EXCLUDED.status,
            input_summary = EXCLUDED.input_summary,
            output_summary = EXCLUDED.output_summary,
            started_at = EXCLUDED.started_at,
            finished_at = EXCLUDED.finished_at,
            error_message = EXCLUDED.error_message
        `,
        [
          toolCall.id,
          input.runId,
          toolCall.toolCode,
          toolCall.status,
          toolCall.inputSummary,
          toolCall.outputSummary,
          toolCall.startedAt,
          toolCall.finishedAt,
          toolCall.errorMessage,
        ],
      );
    }
  }

  async completeBackgroundRun(input: BackgroundRunCompletionInput): Promise<boolean> {
    const now = new Date().toISOString();
    const row = await this.database.queryMaybeOne<BackgroundRunRow>(
      `
        SELECT run_id, trace_id, conversation_key, scene_key, intent_frame_json, task_plan_json, execution_state_json, context_subject_json
        FROM ${this.database.table('agent_runs')}
        WHERE run_id = $1
        LIMIT 1
      `,
      [input.runId],
    );
    if (!row) {
      return false;
    }

    const existingPlan = parseJson<TaskPlan>(row.task_plan_json, fallbackTaskPlan());
    const taskPlan = finishBackgroundTaskPlan(existingPlan, input.status);
    const existingExecution = parseJson<ExecutionState>(
      row.execution_state_json,
      fallbackExecutionState({
        ...row,
        eid: '',
        app_id: '',
        user_input: '',
        intent_frame_json: null,
        evidence_refs_json: [],
        status: input.status,
        created_at: now,
        updated_at: now,
        tool_call_count: 0,
        failed_tool_call_count: 0,
        pending_confirmation_count: 0,
      }),
    );
    const executionState: ExecutionState = {
      ...existingExecution,
      status: input.status,
      currentStepKey: input.currentStepKey ?? null,
      message: input.headline,
      finishedAt: now,
    };
    const contextSubject = input.contextFrame?.subject ?? parseContextSubject(row.context_subject_json);
    const intentFrame = parseJson<IntentFrame>(row.intent_frame_json, fallbackIntentFrame());
    const message: AgentChatMessage = {
      role: 'assistant',
      content: input.content,
      attachments: [],
      extraInfo: {
        feedback: 'default',
        sceneKey: row.scene_key,
        headline: input.headline,
        references: input.references,
        evidence: input.evidence,
        uiSurfaces: [],
        agentTrace: {
          traceId: row.trace_id,
          intentFrame,
          taskPlan,
          executionState,
          toolCalls: input.toolCalls,
          qdrantFilter: undefined,
          pendingConfirmation: null,
          pendingInteraction: null,
          continuationResolution: null,
          resolvedContext: null,
          semanticResolution: null,
          toolArbitration: null,
          policyDecisions: [],
        },
      },
    };

    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `
          UPDATE ${transaction.table('agent_runs')}
          SET task_plan_json = $2::jsonb,
              execution_state_json = $3::jsonb,
              evidence_refs_json = $4::jsonb,
              context_subject_json = $5::jsonb,
              status = $6,
              updated_at = $7
          WHERE run_id = $1
        `,
        [
          input.runId,
          JSON.stringify(taskPlan),
          JSON.stringify(executionState),
          JSON.stringify(input.evidence),
          JSON.stringify(contextSubject ?? null),
          input.status,
          now,
        ],
      );

      for (const toolCall of input.toolCalls) {
        await transaction.query(
          `
            INSERT INTO ${transaction.table('agent_tool_calls')} (
              tool_call_id, run_id, tool_code, status, input_summary, output_summary,
              started_at, finished_at, error_message
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (tool_call_id) DO UPDATE SET
              run_id = EXCLUDED.run_id,
              tool_code = EXCLUDED.tool_code,
              status = EXCLUDED.status,
              input_summary = EXCLUDED.input_summary,
              output_summary = EXCLUDED.output_summary,
              started_at = EXCLUDED.started_at,
              finished_at = EXCLUDED.finished_at,
              error_message = EXCLUDED.error_message
          `,
          [
            toolCall.id,
            input.runId,
            toolCall.toolCode,
            toolCall.status,
            toolCall.inputSummary,
            toolCall.outputSummary,
            toolCall.startedAt,
            toolCall.finishedAt,
            toolCall.errorMessage,
          ],
        );
      }

      await transaction.query(
        `
          INSERT INTO ${transaction.table('agent_messages')} (
            message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
          )
          VALUES ($1, $2, $3, 'assistant', $4, $5::jsonb, $6::jsonb, $7)
        `,
        [
          randomUUID(),
          input.runId,
          row.conversation_key,
          message.content,
          JSON.stringify([]),
          JSON.stringify(message.extraInfo),
          now,
        ],
      );

      await transaction.query(
        `
          UPDATE ${transaction.table('agent_conversations')}
          SET last_message = $2,
              updated_label = '刚刚',
              updated_at = $3
          WHERE conversation_key = $1
        `,
        [row.conversation_key, input.headline, now],
      );
    });
    return true;
  }

  private async touchConversationFromRun(request: AgentChatRequest, now: string): Promise<void> {
    const operatorOpenId = request.tenantContext?.operatorOpenId?.trim();
    if (!operatorOpenId) {
      return;
    }

    const label = buildConversationTitleFromQuery(request.query);
    await this.database.query(
      `
        INSERT INTO ${this.database.table('agent_conversations')} (
          conversation_key, operator_open_id, label, route, group_name, last_message,
          updated_label, scene_key, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, '最近会话', $5, '刚刚', $6, $7, $7)
        ON CONFLICT (conversation_key) DO UPDATE SET
          operator_open_id = EXCLUDED.operator_open_id,
          label = CASE
            WHEN ${this.database.table('agent_conversations')}.label = '新会话'
            THEN EXCLUDED.label
            ELSE ${this.database.table('agent_conversations')}.label
          END,
          route = EXCLUDED.route,
          group_name = EXCLUDED.group_name,
          last_message = EXCLUDED.last_message,
          updated_label = EXCLUDED.updated_label,
          scene_key = EXCLUDED.scene_key,
          updated_at = EXCLUDED.updated_at
      `,
      [
        request.conversationKey,
        operatorOpenId,
        label,
        routeFromSceneKey(request.sceneKey),
        request.query,
        request.sceneKey,
        now,
      ],
    );
  }

  async saveConfirmation(confirmation: ConfirmationRequest): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ${this.database.table('agent_confirmations')} (
          confirmation_id, run_id, tool_code, status, title, summary,
          preview_json, request_input_json, created_at, decided_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
        ON CONFLICT (confirmation_id) DO UPDATE SET
          run_id = EXCLUDED.run_id,
          tool_code = EXCLUDED.tool_code,
          status = EXCLUDED.status,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          preview_json = EXCLUDED.preview_json,
          request_input_json = EXCLUDED.request_input_json,
          created_at = EXCLUDED.created_at,
          decided_at = EXCLUDED.decided_at
      `,
      [
        confirmation.confirmationId,
        confirmation.runId,
        confirmation.toolCode,
        confirmation.status,
        confirmation.title,
        confirmation.summary,
        JSON.stringify(confirmation.preview),
        JSON.stringify(confirmation.requestInput),
        confirmation.createdAt,
        confirmation.decidedAt,
      ],
    );
  }

  async findPendingConfirmation(runId: string, confirmationId?: string): Promise<ConfirmationRequest | null> {
    const row = confirmationId
      ? await this.database.queryMaybeOne<ConfirmationRow>(
          `
            SELECT *
            FROM ${this.database.table('agent_confirmations')}
            WHERE run_id = $1 AND confirmation_id = $2 AND status = 'pending'
            LIMIT 1
          `,
          [runId, confirmationId],
        )
      : await this.database.queryMaybeOne<ConfirmationRow>(
          `
            SELECT *
            FROM ${this.database.table('agent_confirmations')}
            WHERE run_id = $1 AND status = 'pending'
            ORDER BY created_at DESC, confirmation_id DESC
            LIMIT 1
          `,
          [runId],
        );

    return row ? mapConfirmationRow(row) : null;
  }

  async findConfirmation(runId: string, confirmationId: string): Promise<ConfirmationRequest | null> {
    const row = await this.database.queryMaybeOne<ConfirmationRow>(
      `
        SELECT *
        FROM ${this.database.table('agent_confirmations')}
        WHERE run_id = $1 AND confirmation_id = $2
        LIMIT 1
      `,
      [runId, confirmationId],
    );

    return row ? mapConfirmationRow(row) : null;
  }

  async resolveConfirmation(input: {
    runId: string;
    confirmationId: string;
    status: 'approved' | 'rejected';
    decidedAt?: string;
  }): Promise<ConfirmationRequest | null> {
    const decidedAt = input.decidedAt ?? new Date().toISOString();
    await this.database.query(
      `
        UPDATE ${this.database.table('agent_confirmations')}
        SET status = $1, decided_at = $2
        WHERE run_id = $3 AND confirmation_id = $4 AND status = 'pending'
      `,
      [input.status, decidedAt, input.runId, input.confirmationId],
    );

    const row = await this.database.queryMaybeOne<ConfirmationRow>(
      `
        SELECT *
        FROM ${this.database.table('agent_confirmations')}
        WHERE run_id = $1 AND confirmation_id = $2
        LIMIT 1
      `,
      [input.runId, input.confirmationId],
    );

    return row ? mapConfirmationRow(row) : null;
  }
}

function isOpaqueInternalIdExternalSubject(subject?: ContextFrame['subject'] | null): boolean {
  if (!subject || subject.kind !== 'external_subject') {
    return false;
  }
  const value = `${subject.id ?? ''}${subject.name ?? ''}`.trim();
  return /^[0-9a-f]{20,}$/i.test(value);
}

function normalizePagination(pageValue?: number, pageSizeValue?: number) {
  const page = Number.isFinite(pageValue) && Number(pageValue) > 0
    ? Math.floor(Number(pageValue))
    : 1;
  const pageSize = Number.isFinite(pageSizeValue) && Number(pageSizeValue) > 0
    ? Math.min(Math.floor(Number(pageSizeValue)), 100)
    : 20;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

function buildRunWhere(query: AgentRunListQuery) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.status?.trim()) {
    clauses.push(`r.status = $${params.push(query.status.trim())}`);
  }
  if (query.sceneKey?.trim()) {
    clauses.push(`r.scene_key = $${params.push(query.sceneKey.trim())}`);
  }
  if (query.conversationKey?.trim()) {
    clauses.push(`r.conversation_key = $${params.push(query.conversationKey.trim())}`);
  }
  if (query.traceId?.trim()) {
    const traceId = query.traceId.trim();
    const traceIndex = params.push(traceId);
    const runIndex = params.push(traceId);
    clauses.push(`(r.trace_id = $${traceIndex} OR r.run_id = $${runIndex})`);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function buildConfirmationWhere(query: AgentConfirmationListQuery) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.status?.trim()) {
    clauses.push(`c.status = $${params.push(query.status.trim())}`);
  }
  if (query.runId?.trim()) {
    clauses.push(`c.run_id = $${params.push(query.runId.trim())}`);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function mapRunSummary(row: AgentRunRow): AgentRunSummary {
  const intentFrame = parseJson<IntentFrame | null>(row.intent_frame_json, null);
  const taskPlan = parseJson<TaskPlan | null>(row.task_plan_json, null);
  const executionState = parseJson<ExecutionState | null>(row.execution_state_json, null);
  const evidenceRefs = parseEvidenceRefs(row.evidence_refs_json);

  return {
    runId: row.run_id,
    traceId: row.trace_id,
    eid: row.eid,
    appId: row.app_id,
    conversationKey: row.conversation_key,
    sceneKey: row.scene_key,
    userInput: row.user_input,
    status: row.status as AgentExecutionStatus,
    goal: intentFrame?.goal ?? '-',
    targetType: intentFrame?.targetType ?? 'unknown',
    planTitle: taskPlan?.title ?? '-',
    planKind: taskPlan?.kind ?? 'unknown_clarify',
    currentStepKey: executionState?.currentStepKey ?? null,
    toolCallCount: Number(row.tool_call_count ?? 0),
    failedToolCallCount: Number(row.failed_tool_call_count ?? 0),
    pendingConfirmationCount: Number(row.pending_confirmation_count ?? 0),
    evidenceCount: evidenceRefs.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapObservedMessage(row: AgentMessageRow): AgentObservedMessage {
  return {
    messageId: row.message_id,
    runId: row.run_id,
    conversationKey: row.conversation_key,
    role: row.role,
    content: row.content,
    attachments: parseJson(row.attachments_json, []),
    extraInfo: parseJson(row.extra_info_json, {}),
    createdAt: row.created_at,
  };
}

function mapConversationRow(row: AgentConversationRow): ConversationSession {
  return {
    key: row.conversation_key,
    label: row.label,
    route: row.route,
    group: row.group_name,
    lastMessage: row.last_message,
    updatedAt: row.updated_label,
    scene: row.scene_key,
  };
}

function mapToolCallRow(row: AgentToolCallRow): AgentToolCall {
  return {
    id: row.tool_call_id,
    runId: row.run_id,
    toolCode: row.tool_code,
    status: row.status,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

function buildConversationTitleFromQuery(query: string) {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '新会话';
  }
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

function routeFromSceneKey(sceneKey: string) {
  return sceneKey === 'chat' ? '/chat' : `/chat/${sceneKey}`;
}

function mapConfirmationAuditRow(row: ConfirmationAuditRow): AgentConfirmationAuditRow {
  return {
    confirmationId: row.confirmation_id,
    runId: row.run_id,
    traceId: row.trace_id ?? '',
    toolCode: row.tool_code,
    status: row.status as AgentConfirmationStatus,
    title: row.title,
    summary: row.summary,
    preview: parseJson(row.preview_json, null),
    requestInput: parseJson(row.request_input_json, {}),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function fallbackIntentFrame(): IntentFrame {
  return {
    actionType: 'clarify',
    goal: '-',
    targetType: 'unknown',
    targets: [],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0,
    source: 'fallback',
    fallbackReason: '历史运行记录缺少可解析 IntentFrame',
  };
}

function fallbackTaskPlan(): TaskPlan {
  return {
    planId: 'unavailable',
    kind: 'unknown_clarify',
    title: '历史运行记录缺少可解析 TaskPlan',
    status: 'failed',
    steps: [],
    evidenceRequired: false,
  };
}

function fallbackExecutionState(row: AgentRunRow): ExecutionState {
  return {
    runId: row.run_id,
    traceId: row.trace_id,
    status: row.status as AgentExecutionStatus,
    currentStepKey: null,
    message: '历史运行记录缺少可解析 ExecutionState',
    startedAt: row.created_at,
    finishedAt: row.updated_at,
  };
}

function finishBackgroundTaskPlan(plan: TaskPlan, status: AgentExecutionStatus): TaskPlan {
  return {
    ...plan,
    status,
    steps: plan.steps.map((item) => {
      if (status === 'completed') {
        return { ...item, status: item.status === 'pending' || item.status === 'running' ? 'succeeded' : item.status };
      }
      if (status === 'failed' || status === 'tool_unavailable') {
        return { ...item, status: item.status === 'pending' || item.status === 'running' ? 'failed' : item.status };
      }
      return item;
    }),
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseIntentFrame(value: unknown): IntentFrame | null {
  if (value && typeof value === 'object') {
    return value as IntentFrame;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value) as IntentFrame;
  } catch {
    return null;
  }
}

function parseEvidenceRefs(value?: unknown): AgentEvidenceCard[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(isEvidenceRef);
  }
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEvidenceRef) : [];
  } catch {
    return [];
  }
}

function buildCandidateText(input: {
  subject: ContextFrameSubject;
  userInput?: string;
  intentFrame?: IntentFrame | null;
  evidenceRefs: AgentEvidenceCard[];
}): string {
  return [
    input.subject.kind,
    input.subject.type,
    input.subject.id,
    input.subject.name,
    input.userInput,
    input.intentFrame?.goal,
    input.intentFrame?.targetType,
    ...(input.intentFrame?.targets ?? []).flatMap((target) => [target.type, target.id, target.name]),
    ...input.evidenceRefs.flatMap((evidence) => [
      evidence.title,
      evidence.anchorLabel,
      evidence.snippet,
      evidence.sourceToolCode,
    ]),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n');
}

function dedupeContextCandidates(candidates: ContextReferenceCandidate[]): ContextReferenceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.subject.kind,
      candidate.subject.type ?? '',
      candidate.subject.id ?? '',
      candidate.subject.name?.replace(/\s+/g, '') ?? '',
    ].join(':');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseContextSubject(value?: unknown): ContextFrameSubject | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    const subject = value as ContextFrameSubject;
    return subject.name?.trim() ? subject : null;
  }
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const subject = parsed as ContextFrameSubject;
    return subject.name?.trim() ? subject : null;
  } catch {
    return null;
  }
}

function isEvidenceRef(value: unknown): value is AgentEvidenceCard {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as AgentEvidenceCard).title === 'string'
      && typeof (value as AgentEvidenceCard).anchorLabel === 'string',
  );
}

function resolveSubjectFromRun(input: {
  intentJson: unknown;
  evidenceRefs: AgentEvidenceCard[];
  userInput?: string;
}): ContextFrameSubject | null {
  try {
    const intent = typeof input.intentJson === 'string'
      ? JSON.parse(input.intentJson) as IntentFrame
      : input.intentJson as IntentFrame;
    const target = intent.targets.find((item) => item.name?.trim());
    if (target && shouldUseIntentTargetAsContextSubject(intent, target, input.userInput)) {
      return {
        kind: mapTargetKind(target.type),
        type: target.type,
        id: target.id,
        name: target.name,
      };
    }
  } catch {
    // Ignore malformed historical rows.
  }

  const evidence = input.evidenceRefs.find((item) => item.anchorLabel?.trim());
  return evidence
    ? {
        kind: 'artifact',
        type: 'artifact_anchor',
        id: evidence.artifactId,
        name: evidence.anchorLabel,
      }
    : null;
}

function shouldUseIntentTargetAsContextSubject(
  intent: IntentFrame,
  target: NonNullable<IntentFrame['targets'][number]>,
  userInput?: string,
): boolean {
  const name = target.name?.trim() ?? '';
  if (!name) {
    return false;
  }
  const inputText = userInput?.trim() ?? '';
  if (intent.actionType === 'query' && mapTargetKind(intent.targetType) === 'record') {
    if (!inputText.includes(name) && isLikelyBareRecordCollectionUserInput(inputText, intent.targetType)) {
      return false;
    }
    if (isOpaqueIdentifier(name) && !inputText.includes(name)) {
      return false;
    }
    if (!hasEntityNameSignal(name) && !inputText.includes(name)) {
      return false;
    }
    if (isLikelyCollectionIntentTarget(intent, target, inputText)) {
      return false;
    }
  }
  return true;
}

function isLikelyBareRecordCollectionUserInput(
  userInput: string,
  targetType: IntentFrame['targetType'],
): boolean {
  const compactInput = userInput.replace(/\s+/g, '');
  if (!compactInput) {
    return false;
  }
  const labelPattern = getRecordTargetLabelPattern(targetType);
  if (!labelPattern) {
    return false;
  }
  return new RegExp(`^(?:查询|查一下|查|查看|搜索|找一下|列出|看看|看下)(?:所有|全部|全量|全体)?(?:${labelPattern})(?:列表|清单|数据|信息|资料|记录)?$`).test(compactInput);
}

function getRecordTargetLabelPattern(targetType: IntentFrame['targetType']): string {
  if (targetType === 'customer') {
    return '客户|公司';
  }
  if (targetType === 'contact') {
    return '联系人';
  }
  if (targetType === 'opportunity') {
    return '商机|机会';
  }
  if (targetType === 'followup') {
    return '拜访记录|跟进记录|回访记录|跟进|拜访|回访';
  }
  return '';
}

function isLikelyCollectionIntentTarget(
  intent: IntentFrame,
  target: NonNullable<IntentFrame['targets'][number]>,
  userInput: string,
): boolean {
  const name = target.name?.trim() ?? '';
  if (!userInput || !name) {
    return false;
  }
  if (isOpaqueIdentifier(name)) {
    return false;
  }
  const compactInput = userInput.replace(/\s+/g, '');
  const compactName = name.replace(/\s+/g, '');
  return intent.actionType === 'query'
    && compactInput.includes(compactName)
    && compactInput.length <= compactName.length + 8
    && /^(?:查询|查一下|查|查看|搜索|找一下|打开|列出|看看|看下)/.test(compactInput);
}

function isOpaqueIdentifier(value: string): boolean {
  return /^[a-f0-9]{16,}$/i.test(value)
    || /^[A-Za-z0-9][A-Za-z0-9_-]{10,}$/.test(value);
}

function hasEntityNameSignal(value: string): boolean {
  return /(公司|集团|有限|股份|银行|医院|学校|大学|研究院|事务所|协会|中心|工厂|厂)$/.test(value)
    || /(公司|集团|有限|股份)/.test(value);
}

function mapTargetKind(type: IntentFrame['targetType']): ContextFrameSubject['kind'] {
  if (type === 'artifact') {
    return 'artifact';
  }
  if (type === 'company') {
    return 'external_subject';
  }
  if (type === 'unknown') {
    return 'unknown';
  }
  return 'record';
}

function mapConfirmationRow(row: ConfirmationRow): ConfirmationRequest {
  const preview = parseJson(row.preview_json, null);
  return {
    confirmationId: row.confirmation_id,
    runId: row.run_id,
    toolCode: row.tool_code,
    title: row.title,
    summary: row.summary,
    preview,
    debugPayload: preview,
    requestInput: parseJson(row.request_input_json, {}),
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}
