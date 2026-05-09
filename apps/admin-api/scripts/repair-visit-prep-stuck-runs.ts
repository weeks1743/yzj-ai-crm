import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type {
  AgentAttachment,
  AgentChatMessage,
  AgentExecutionStatus,
  AgentToolCall,
  ExternalSkillJobArtifact,
  ExternalSkillJobResponse,
  TaskPlan,
} from '../src/contracts.js';
import { loadAppConfig } from '../src/config.js';
import { type DatabaseConnection, type DatabaseQueryContext, openDatabase } from '../src/database.js';
import { ExternalSkillService } from '../src/external-skill-service.js';
import { getErrorMessage } from '../src/errors.js';

const VISIT_PREP_RUNTIME_TOOL = 'ext.yunzhijia_visit_prep';

interface StuckRunRow {
  run_id: string;
  trace_id: string;
  conversation_key: string;
  user_input: string;
  intent_frame_json: unknown;
  context_subject_json: unknown;
  task_plan_json: unknown;
  execution_state_json: unknown;
  visit_prep_tool_call_id: string;
  visit_prep_output_summary: string;
  visit_prep_started_at: string;
}

interface AgentMessageRow {
  message_id: string;
  role: string;
  content: string;
  attachments_json: unknown;
  extra_info_json: unknown;
  created_at: string;
}

interface AgentToolCallRow {
  tool_call_id: string;
  run_id: string;
  tool_code: string;
  status: string;
  input_summary: string;
  output_summary: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

export interface VisitPrepSkillJobReader {
  getSkillJob(jobId: string): Promise<ExternalSkillJobResponse>;
  getSkillJobArtifact(jobId: string, artifactId: string): Promise<{
    artifact: ExternalSkillJobArtifact;
    content: Buffer;
  }>;
}

export interface VisitPrepStuckRunRepairSummary {
  apply: boolean;
  scanned: number;
  repairable: number;
  repaired: number;
  skipped: Array<{
    runId: string;
    traceId: string;
    jobId?: string;
    reason: string;
  }>;
  repairedRuns: Array<{
    runId: string;
    traceId: string;
    jobId: string;
    artifactFileName?: string;
  }>;
}

export async function repairVisitPrepStuckRuns(input: {
  database: DatabaseConnection;
  externalSkillService: VisitPrepSkillJobReader;
  apply?: boolean;
  traceIds?: string[];
}): Promise<VisitPrepStuckRunRepairSummary> {
  const apply = input.apply === true;
  const rows = await findStuckVisitPrepRuns(input.database, input.traceIds ?? []);
  const summary: VisitPrepStuckRunRepairSummary = {
    apply,
    scanned: rows.length,
    repairable: 0,
    repaired: 0,
    skipped: [],
    repairedRuns: [],
  };

  for (const row of rows) {
    const jobId = parseVisitPrepJobId(row.visit_prep_output_summary);
    if (!jobId) {
      summary.skipped.push({
        runId: row.run_id,
        traceId: row.trace_id,
        reason: '未能从 tool call outputSummary 解析 Skill jobId',
      });
      continue;
    }

    const job = await input.externalSkillService.getSkillJob(jobId);
    if (job.status !== 'succeeded') {
      summary.skipped.push({
        runId: row.run_id,
        traceId: row.trace_id,
        jobId,
        reason: `Skill job 当前状态为 ${job.status}`,
      });
      continue;
    }

    const assistantMessage = await findAssistantMessage(input.database, row.run_id);
    if (!assistantMessage) {
      summary.skipped.push({
        runId: row.run_id,
        traceId: row.trace_id,
        jobId,
        reason: '未找到可回写的 assistant message',
      });
      continue;
    }

    const toolCalls = await findToolCalls(input.database, row.run_id);
    const markdownResult = await resolveVisitPrepMarkdown(input.externalSkillService, job);
    const repaired = buildCompletedVisitPrepRepair({
      row,
      assistantMessage,
      toolCalls,
      job,
      markdown: markdownResult.markdown,
    });
    summary.repairable += 1;

    if (apply) {
      await applyVisitPrepRepair(input.database, repaired);
      summary.repaired += 1;
    }

    summary.repairedRuns.push({
      runId: row.run_id,
      traceId: row.trace_id,
      jobId,
      artifactFileName: markdownResult.artifact?.fileName,
    });
  }

  return summary;
}

export function parseVisitPrepJobId(outputSummary: string): string | null {
  return outputSummary.match(/\bjob=([0-9a-f-]{8,})\b/i)?.[1] ?? null;
}

async function findStuckVisitPrepRuns(
  database: DatabaseConnection,
  traceIds: string[],
): Promise<StuckRunRow[]> {
  const params: unknown[] = [VISIT_PREP_RUNTIME_TOOL];
  const traceFilter = traceIds.length
    ? `AND r.trace_id = ANY($${params.push(traceIds)}::text[])`
    : '';
  return database.query<StuckRunRow>(
    `
      SELECT
        r.run_id,
        r.trace_id,
        r.conversation_key,
        r.user_input,
        r.intent_frame_json,
        r.context_subject_json,
        r.task_plan_json,
        r.execution_state_json,
        tc.tool_call_id AS visit_prep_tool_call_id,
        tc.output_summary AS visit_prep_output_summary,
        tc.started_at AS visit_prep_started_at
      FROM ${database.table('agent_runs')} r
      JOIN ${database.table('agent_tool_calls')} tc
        ON tc.run_id = r.run_id
      WHERE r.status = 'running'
        AND tc.tool_code = $1
        AND tc.status = 'running'
        ${traceFilter}
      ORDER BY r.created_at ASC
    `,
    params,
  );
}

async function findAssistantMessage(
  database: DatabaseConnection,
  runId: string,
): Promise<AgentMessageRow | null> {
  return database.queryMaybeOne<AgentMessageRow>(
    `
      SELECT message_id, role, content, attachments_json, extra_info_json, created_at
      FROM ${database.table('agent_messages')}
      WHERE run_id = $1 AND role = 'assistant'
      ORDER BY created_at DESC, message_id DESC
      LIMIT 1
    `,
    [runId],
  );
}

async function findToolCalls(database: DatabaseConnection, runId: string): Promise<AgentToolCallRow[]> {
  return database.query<AgentToolCallRow>(
    `
      SELECT tool_call_id, run_id, tool_code, status, input_summary, output_summary, started_at, finished_at, error_message
      FROM ${database.table('agent_tool_calls')}
      WHERE run_id = $1
      ORDER BY started_at ASC, tool_call_id ASC
    `,
    [runId],
  );
}

async function resolveVisitPrepMarkdown(
  externalSkillService: VisitPrepSkillJobReader,
  job: ExternalSkillJobResponse,
): Promise<{ markdown: string; artifact?: ExternalSkillJobArtifact }> {
  const artifact = job.artifacts.find((item) => item.mimeType.includes('markdown') || item.fileName.toLowerCase().endsWith('.md'))
    ?? job.artifacts[0];
  if (artifact) {
    const payload = await externalSkillService.getSkillJobArtifact(job.jobId, artifact.artifactId);
    const markdown = payload.content.toString('utf8').trim();
    if (markdown) {
      return { markdown, artifact: payload.artifact };
    }
  }

  const finalText = job.finalText?.trim();
  if (finalText) {
    return { markdown: finalText };
  }

  throw new Error(`Skill job ${job.jobId} 已成功但没有可用 Markdown`);
}

function buildCompletedVisitPrepRepair(input: {
  row: StuckRunRow;
  assistantMessage: AgentMessageRow;
  toolCalls: AgentToolCallRow[];
  job: ExternalSkillJobResponse;
  markdown: string;
}) {
  const now = new Date().toISOString();
  const taskPlan = markTaskPlanCompleted(readJsonObject<TaskPlan>(input.row.task_plan_json));
  const executionState = {
    ...readJsonObject<Record<string, unknown>>(input.row.execution_state_json),
    status: 'completed' satisfies AgentExecutionStatus,
    currentStepKey: null,
    message: '客户拜访准备已生成',
    finishedAt: now,
  };
  const attachments = buildRuntimeMarkdownAttachments(input.job);
  const content = buildCompletedVisitPrepContent(input.row, input.markdown);
  const toolCalls = input.toolCalls.map((toolCall): AgentToolCall => {
    if (toolCall.tool_call_id !== input.row.visit_prep_tool_call_id) {
      return mapToolCallRow(toolCall);
    }
    return {
      ...mapToolCallRow(toolCall),
      status: 'succeeded',
      outputSummary: `job=${input.job.jobId}, artifacts=${input.job.artifacts.length}`,
      finishedAt: input.job.updatedAt || now,
      errorMessage: null,
    };
  });
  const extraInfo = buildRepairedExtraInfo({
    rawExtraInfo: input.assistantMessage.extra_info_json,
    taskPlan,
    executionState,
    toolCalls,
  });

  return {
    runId: input.row.run_id,
    traceId: input.row.trace_id,
    conversationKey: input.row.conversation_key,
    toolCallId: input.row.visit_prep_tool_call_id,
    messageId: input.assistantMessage.message_id,
    taskPlan,
    executionState,
    content,
    attachments,
    extraInfo,
    toolCallOutputSummary: `job=${input.job.jobId}, artifacts=${input.job.artifacts.length}`,
    toolCallFinishedAt: input.job.updatedAt || now,
    updatedAt: now,
  };
}

function markTaskPlanCompleted(plan: TaskPlan): TaskPlan {
  return {
    ...plan,
    status: 'completed',
    steps: plan.steps.map((step) => ({
      ...step,
      status: step.status === 'pending' ? 'succeeded' : step.status,
    })),
  };
}

function buildCompletedVisitPrepContent(row: StuckRunRow, markdown: string): string {
  const subject = readJsonObject<{ name?: string } | null>(row.context_subject_json, null);
  const companyName = subject?.name?.trim();
  return [
    '## 客户拜访准备已生成',
    companyName ? `- 公司：**${companyName}**` : '',
    '- 资料沉淀：本轮对话结果，未创建资料资产。',
    '',
    markdown,
  ].filter(Boolean).join('\n');
}

function buildRepairedExtraInfo(input: {
  rawExtraInfo: unknown;
  taskPlan: TaskPlan;
  executionState: Record<string, unknown>;
  toolCalls: AgentToolCall[];
}): AgentChatMessage['extraInfo'] {
  const extraInfo = readJsonObject<Record<string, unknown>>(input.rawExtraInfo);
  const agentTrace = readJsonObject<Record<string, unknown>>(extraInfo.agentTrace ?? {});
  return {
    ...extraInfo,
    feedback: extraInfo.feedback === 'default' ? 'default' : 'default',
    sceneKey: typeof extraInfo.sceneKey === 'string' ? extraInfo.sceneKey : 'chat',
    headline: '客户拜访准备已生成',
    references: Array.isArray(extraInfo.references)
      ? extraInfo.references
      : ['公司研究资料', '客户拜访准备助手'],
    evidence: [],
    uiSurfaces: Array.isArray(extraInfo.uiSurfaces) ? extraInfo.uiSurfaces : [],
    agentTrace: {
      ...agentTrace,
      taskPlan: input.taskPlan,
      executionState: input.executionState,
      toolCalls: input.toolCalls,
    },
  } as AgentChatMessage['extraInfo'];
}

function buildRuntimeMarkdownAttachments(job: ExternalSkillJobResponse): AgentAttachment[] {
  return job.artifacts
    .filter((artifact) => artifact.mimeType.includes('markdown') || artifact.fileName.toLowerCase().endsWith('.md'))
    .map((artifact) => ({
      name: artifact.fileName,
      url: artifact.downloadPath,
      type: artifact.mimeType || 'text/markdown',
      size: artifact.byteSize,
    }));
}

function mapToolCallRow(row: AgentToolCallRow): AgentToolCall {
  return {
    id: row.tool_call_id,
    runId: row.run_id,
    toolCode: row.tool_code,
    status: row.status as AgentToolCall['status'],
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

async function applyVisitPrepRepair(
  database: DatabaseConnection,
  repair: ReturnType<typeof buildCompletedVisitPrepRepair>,
): Promise<void> {
  await database.transaction(async (tx) => {
    await applyVisitPrepRepairInTransaction(tx, repair);
  });
}

async function applyVisitPrepRepairInTransaction(
  database: DatabaseQueryContext,
  repair: ReturnType<typeof buildCompletedVisitPrepRepair>,
): Promise<void> {
  await database.query(
    `
      UPDATE ${database.table('agent_runs')}
      SET task_plan_json = $2::jsonb,
          execution_state_json = $3::jsonb,
          evidence_refs_json = '[]'::jsonb,
          status = 'completed',
          updated_at = $4
      WHERE run_id = $1 AND status = 'running'
    `,
    [
      repair.runId,
      JSON.stringify(repair.taskPlan),
      JSON.stringify(repair.executionState),
      repair.updatedAt,
    ],
  );
  await database.query(
    `
      UPDATE ${database.table('agent_tool_calls')}
      SET status = 'succeeded',
          output_summary = $2,
          finished_at = $3,
          error_message = NULL
      WHERE tool_call_id = $1
    `,
    [repair.toolCallId, repair.toolCallOutputSummary, repair.toolCallFinishedAt],
  );
  await database.query(
    `
      UPDATE ${database.table('agent_messages')}
      SET content = $2,
          attachments_json = $3::jsonb,
          extra_info_json = $4::jsonb
      WHERE message_id = $1
    `,
    [
      repair.messageId,
      repair.content,
      JSON.stringify(repair.attachments),
      JSON.stringify(repair.extraInfo),
    ],
  );
  await database.query(
    `
      UPDATE ${database.table('agent_conversations')}
      SET last_message = $2,
          updated_at = $3
      WHERE conversation_key = $1
    `,
    [repair.conversationKey, repair.content.slice(0, 500), repair.updatedAt],
  );
}

function readJsonObject<T>(value: unknown, fallback?: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback ?? ({} as T);
    }
  }
  if (value && typeof value === 'object') {
    return value as T;
  }
  return fallback ?? ({} as T);
}

function parseArgs(argv: string[]): { apply: boolean; traceIds: string[] } {
  const traceIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--apply') {
      continue;
    }
    if (arg === '--trace' && argv[index + 1]) {
      traceIds.push(argv[index + 1]!);
      index += 1;
      continue;
    }
    if (arg.startsWith('--trace=')) {
      traceIds.push(arg.slice('--trace='.length));
    }
  }
  return {
    apply: argv.includes('--apply'),
    traceIds,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadAppConfig();
  const database = await openDatabase(config.storage.postgresUrl, config.storage.postgresSchema);
  try {
    const summary = await repairVisitPrepStuckRuns({
      database,
      externalSkillService: new ExternalSkillService({ config }),
      apply: args.apply,
      traceIds: args.traceIds,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(getErrorMessage(error));
    process.exitCode = 1;
  });
}
