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
import type {
  ConfirmationRequest,
  ContextFrame,
  ContextFrameSubject,
  ContextReferenceCandidate,
} from './agent-core.js';

interface FocusRow {
  run_id?: string;
  user_input?: string;
  intent_frame_json: string;
  context_subject_json?: string | null;
  evidence_refs_json?: string;
  created_at?: string;
}

interface ConfirmationRow {
  confirmation_id: string;
  run_id: string;
  tool_code: string;
  status: ConfirmationRequest['status'];
  title: string;
  summary: string;
  preview_json: string;
  request_input_json: string;
  created_at: string;
  decided_at: string | null;
}

export class AgentRunRepository {
  constructor(private readonly database: DatabaseSync) {}

  findContextFrame(conversationKey: string): ContextFrame | null {
    const rows = this.database
      .prepare(
        `
          SELECT run_id, intent_frame_json, evidence_refs_json
               , context_subject_json
          FROM agent_runs
          WHERE conversation_key = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 10
        `,
      )
      .all(conversationKey) as unknown as FocusRow[];

    for (const row of rows) {
      const evidenceRefs = parseEvidenceRefs(row.evidence_refs_json);
      const subject = parseContextSubject(row.context_subject_json) ?? resolveSubjectFromRun(row.intent_frame_json, evidenceRefs);
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

  findContextCandidates(conversationKey: string, limit = 12): ContextReferenceCandidate[] {
    const rows = this.database
      .prepare(
        `
          SELECT run_id, user_input, intent_frame_json, evidence_refs_json
               , context_subject_json, created_at
          FROM agent_runs
          WHERE conversation_key = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `,
      )
      .all(conversationKey, limit) as unknown as FocusRow[];

    const candidates: ContextReferenceCandidate[] = [];
    rows.forEach((row, index) => {
      const evidenceRefs = parseEvidenceRefs(row.evidence_refs_json);
      const parsedIntent = parseIntentFrame(row.intent_frame_json);
      const subject = parseContextSubject(row.context_subject_json) ?? resolveSubjectFromRun(row.intent_frame_json, evidenceRefs);
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

  findFocusedCompany(conversationKey: string): string | null {
    const row = this.database
      .prepare(
        `
          SELECT intent_frame_json
          FROM agent_runs
          WHERE conversation_key = ?
          ORDER BY created_at DESC, rowid DESC
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
    contextFrame?: ContextFrame | null;
    message: AgentChatMessage;
  }): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT OR REPLACE INTO agent_runs (
            run_id, trace_id, eid, app_id, conversation_key, scene_key, user_input,
            intent_frame_json, context_subject_json, task_plan_json, execution_state_json, evidence_refs_json,
            status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(input.contextFrame?.subject ?? null),
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
        INSERT OR REPLACE INTO agent_tool_calls (
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

  saveConfirmation(confirmation: ConfirmationRequest): void {
    this.database
      .prepare(
        `
          INSERT OR REPLACE INTO agent_confirmations (
            confirmation_id, run_id, tool_code, status, title, summary,
            preview_json, request_input_json, created_at, decided_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
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
      );
  }

  findPendingConfirmation(runId: string, confirmationId?: string): ConfirmationRequest | null {
    const row = confirmationId
      ? this.database
          .prepare(
            `
              SELECT *
              FROM agent_confirmations
              WHERE run_id = ? AND confirmation_id = ? AND status = 'pending'
              LIMIT 1
            `,
          )
          .get(runId, confirmationId)
      : this.database
          .prepare(
            `
              SELECT *
              FROM agent_confirmations
              WHERE run_id = ? AND status = 'pending'
              ORDER BY created_at DESC
              LIMIT 1
            `,
          )
          .get(runId);

    return row ? mapConfirmationRow(row as unknown as ConfirmationRow) : null;
  }

  resolveConfirmation(input: {
    runId: string;
    confirmationId: string;
    status: 'approved' | 'rejected';
    decidedAt?: string;
  }): ConfirmationRequest | null {
    const decidedAt = input.decidedAt ?? new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE agent_confirmations
          SET status = ?, decided_at = ?
          WHERE run_id = ? AND confirmation_id = ? AND status = 'pending'
        `,
      )
      .run(input.status, decidedAt, input.runId, input.confirmationId);

    const row = this.database
      .prepare(
        `
          SELECT *
          FROM agent_confirmations
          WHERE run_id = ? AND confirmation_id = ?
          LIMIT 1
        `,
      )
      .get(input.runId, input.confirmationId);

    return row ? mapConfirmationRow(row as unknown as ConfirmationRow) : null;
  }
}

function parseIntentFrame(value: string): IntentFrame | null {
  try {
    return JSON.parse(value) as IntentFrame;
  } catch {
    return null;
  }
}

function parseEvidenceRefs(value?: string): AgentEvidenceCard[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
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

function parseContextSubject(value?: string | null): ContextFrameSubject | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
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

function resolveSubjectFromRun(intentJson: string, evidenceRefs: AgentEvidenceCard[]): ContextFrameSubject | null {
  try {
    const intent = JSON.parse(intentJson) as IntentFrame;
    const target = intent.targets.find((item) => item.name?.trim());
    if (target) {
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

  const evidence = evidenceRefs.find((item) => item.anchorLabel?.trim());
  return evidence
    ? {
        kind: 'artifact',
        type: 'artifact_anchor',
        id: evidence.artifactId,
        name: evidence.anchorLabel,
      }
    : null;
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
  const preview = JSON.parse(row.preview_json);
  return {
    confirmationId: row.confirmation_id,
    runId: row.run_id,
    toolCode: row.tool_code,
    title: row.title,
    summary: row.summary,
    preview,
    debugPayload: preview,
    requestInput: JSON.parse(row.request_input_json),
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}
