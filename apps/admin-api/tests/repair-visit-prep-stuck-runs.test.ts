import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseConnection } from '../src/database.js';
import type { ExternalSkillJobResponse, TaskPlan } from '../src/contracts.js';
import {
  parseVisitPrepJobId,
  repairVisitPrepStuckRuns,
  type VisitPrepSkillJobReader,
} from '../scripts/repair-visit-prep-stuck-runs.js';
import { createInMemoryDatabase } from './test-helpers.js';

test('parseVisitPrepJobId reads job id from running tool output summary', () => {
  assert.equal(
    parseVisitPrepJobId('job=ead9549e-dba2-42ea-ba4d-bc26cc820175, status=running'),
    'ead9549e-dba2-42ea-ba4d-bc26cc820175',
  );
  assert.equal(parseVisitPrepJobId('status=running'), null);
});

test('repairVisitPrepStuckRuns dry-runs, applies, and is idempotent', async () => {
  const database = createInMemoryDatabase();
  const fixture = await seedVisitPrepStuckRun(database);
  const markdown = '# 绍兴贝斯美化工股份有限公司 拜访讲解准备\n\n## 客户画像速览\n已生成。';
  const skillReader = createSkillReader(fixture.jobId, markdown);

  const dryRun = await repairVisitPrepStuckRuns({
    database,
    externalSkillService: skillReader,
    traceIds: [fixture.traceId],
  });
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.scanned, 1);
  assert.equal(dryRun.repairable, 1);
  assert.equal(dryRun.repaired, 0);
  assert.equal(await readRunStatus(database, fixture.runId), 'running');

  const applied = await repairVisitPrepStuckRuns({
    database,
    externalSkillService: skillReader,
    apply: true,
    traceIds: [fixture.traceId],
  });
  assert.equal(applied.apply, true);
  assert.equal(applied.scanned, 1);
  assert.equal(applied.repairable, 1);
  assert.equal(applied.repaired, 1);

  const run = await database.queryOne<{ status: string; task_plan_json: TaskPlan; execution_state_json: any }>(
    `SELECT status, task_plan_json, execution_state_json FROM ${database.table('agent_runs')} WHERE run_id = $1`,
    [fixture.runId],
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.task_plan_json.status, 'completed');
  assert.equal(run.execution_state_json.status, 'completed');
  assert.equal(run.execution_state_json.currentStepKey, null);

  const toolCall = await database.queryOne<{ status: string; output_summary: string; finished_at: string | null }>(
    `SELECT status, output_summary, finished_at FROM ${database.table('agent_tool_calls')} WHERE tool_call_id = $1`,
    [fixture.visitPrepToolCallId],
  );
  assert.equal(toolCall.status, 'succeeded');
  assert.match(toolCall.output_summary, /artifacts=1/);
  assert.ok(toolCall.finished_at);

  const assistantMessage = await database.queryOne<{ content: string; attachments_json: any[]; extra_info_json: any }>(
    `SELECT content, attachments_json, extra_info_json FROM ${database.table('agent_messages')} WHERE message_id = $1`,
    [fixture.assistantMessageId],
  );
  assert.doesNotMatch(assistantMessage.content, /客户拜访准备已生成/);
  assert.match(assistantMessage.content, /客户画像速览/);
  assert.equal(assistantMessage.content, markdown);
  assert.equal(assistantMessage.attachments_json[0]?.name, 'yunzhijia-visit-prep-job-visit-prep-stuck.md');
  assert.equal(assistantMessage.extra_info_json.headline, '客户拜访准备已生成');
  assert.equal(assistantMessage.extra_info_json.agentTrace.executionState.status, 'completed');

  const repeated = await repairVisitPrepStuckRuns({
    database,
    externalSkillService: skillReader,
    apply: true,
    traceIds: [fixture.traceId],
  });
  assert.equal(repeated.scanned, 0);
  assert.equal(repeated.repaired, 0);
});

async function seedVisitPrepStuckRun(database: DatabaseConnection) {
  const now = '2026-05-09T12:39:37.668Z';
  const runId = 'run-visit-prep-stuck';
  const traceId = 'trace-agent-stuck';
  const conversationKey = 'conv-visit-prep-stuck';
  const jobId = 'ead9549e-dba2-42ea-ba4d-bc26cc820175';
  const visitPrepToolCallId = 'tool-visit-prep-stuck';
  const assistantMessageId = 'message-assistant-stuck';
  const taskPlan: TaskPlan = {
    planId: 'plan-stuck',
    kind: 'tool_execution',
    title: 'external 工具执行计划',
    status: 'running',
    evidenceRequired: false,
    steps: [
      {
        key: 'build-intent',
        title: '生成 IntentFrame',
        status: 'succeeded',
        required: true,
        skippable: false,
        actionType: 'meta',
        toolRefs: ['meta.plan_builder'],
        confirmationRequired: false,
      },
      {
        key: 'execute-tool',
        title: '执行工具或生成预览',
        status: 'pending',
        required: true,
        skippable: false,
        actionType: 'external',
        toolRefs: ['external.yunzhijia_visit_prep'],
        confirmationRequired: false,
      },
    ],
  };
	  const executionState = {
	    runId,
	    traceId,
	    status: 'running',
	    message: '客户拜访准备任务处理中',
    startedAt: now,
    finishedAt: null,
    currentStepKey: 'execute-tool',
  };
  const toolCalls = [
    {
      id: 'tool-customer-search',
      runId,
      toolCode: 'record.customer.search',
      status: 'succeeded',
      inputSummary: '贝斯美',
      outputSummary: 'records=1, total=1',
      startedAt: now,
      finishedAt: now,
      errorMessage: null,
    },
    {
      id: visitPrepToolCallId,
      runId,
	      toolCode: 'ext.yunzhijia_visit_prep',
	      status: 'running',
	      inputSummary: '绍兴贝斯美化工股份有限公司',
	      outputSummary: `job=${jobId}, status=running`,
      startedAt: now,
      finishedAt: null,
      errorMessage: null,
    },
  ];
  const extraInfo = {
	    feedback: 'default',
	    sceneKey: 'chat',
	    headline: '客户拜访准备任务处理中',
    references: ['客户拜访准备助手'],
    evidence: [],
    uiSurfaces: [],
    agentTrace: {
      traceId,
      taskPlan,
      executionState,
      toolCalls,
      selectedTool: {
        toolCode: 'external.yunzhijia_visit_prep',
        reason: '显性调用',
        input: { customerName: '贝斯美' },
        confidence: 0.9,
      },
    },
  };

  await database.query(
    `
      INSERT INTO ${database.table('agent_runs')} (
        run_id, trace_id, eid, app_id, conversation_key, scene_key, user_input,
        intent_frame_json, context_subject_json, task_plan_json, execution_state_json,
        evidence_refs_json, status, created_at, updated_at
      )
      VALUES ($1, $2, '21024647', '501037649', $3, 'chat', '/拜访准备 贝斯美',
        $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, '[]'::jsonb, 'running', $8, $8)
    `,
    [
      runId,
      traceId,
      conversationKey,
      JSON.stringify({ goal: '为拜访贝斯美做准备', targetType: 'company' }),
      JSON.stringify({ kind: 'external_subject', type: 'company', name: '绍兴贝斯美化工股份有限公司' }),
      JSON.stringify(taskPlan),
      JSON.stringify(executionState),
      now,
    ],
  );
  await database.query(
    `
      INSERT INTO ${database.table('agent_messages')} (
        message_id, run_id, conversation_key, role, content, attachments_json, extra_info_json, created_at
      )
      VALUES
        ('message-user-stuck', $1, $2, 'user', '/拜访准备 贝斯美', '[]'::jsonb, '{}'::jsonb, $3),
	        ($4, $1, $2, 'assistant', '## 客户拜访准备处理中', '[]'::jsonb, $5::jsonb, $3)
    `,
    [runId, conversationKey, now, assistantMessageId, JSON.stringify(extraInfo)],
  );
  await database.query(
    `
      INSERT INTO ${database.table('agent_conversations')} (
        conversation_key, operator_open_id, label, route, group_name, last_message, updated_label, scene_key, created_at, updated_at
      )
	      VALUES ($1, 'operator-001', '贝斯美', '/chat', '默认', '## 客户拜访准备处理中', '贝斯美', 'chat', $2, $2)
    `,
    [conversationKey, now],
  );
  for (const toolCall of toolCalls) {
    await database.query(
      `
        INSERT INTO ${database.table('agent_tool_calls')} (
          tool_call_id, run_id, tool_code, status, input_summary, output_summary, started_at, finished_at, error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        toolCall.id,
        toolCall.runId,
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

  return { runId, traceId, jobId, visitPrepToolCallId, assistantMessageId };
}

function createSkillReader(jobId: string, markdown: string): VisitPrepSkillJobReader {
  const job: ExternalSkillJobResponse = {
    jobId,
    skillCode: 'ext.yunzhijia_visit_prep',
    runtimeSkillName: 'yunzhijia-visit-prep',
    model: 'deepseek-v4-flash',
    status: 'succeeded',
    finalText: '拜访准备摘要',
    events: [],
    artifacts: [{
      artifactId: 'artifact-md-001',
      jobId,
      fileName: 'yunzhijia-visit-prep-job-visit-prep-stuck.md',
      mimeType: 'text/markdown',
      byteSize: Buffer.byteLength(markdown),
      createdAt: '2026-05-09T12:40:03.630Z',
      downloadPath: `/api/external-skills/jobs/${jobId}/artifacts/artifact-md-001`,
    }],
    error: null,
    createdAt: '2026-05-09T12:38:26.956Z',
    updatedAt: '2026-05-09T12:40:03.630Z',
  };
  return {
    getSkillJob: async () => job,
    getSkillJobArtifact: async () => ({
      artifact: job.artifacts[0]!,
      content: Buffer.from(markdown),
    }),
  };
}

async function readRunStatus(database: DatabaseConnection, runId: string): Promise<string> {
  const row = await database.queryOne<{ status: string }>(
    `SELECT status FROM ${database.table('agent_runs')} WHERE run_id = $1`,
    [runId],
  );
  return row.status;
}
