import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentObservabilityService } from '../src/agent-observability-service.js';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { createInMemoryDatabase } from './test-helpers.js';

test('AgentObservabilityService lists run details and confirmation audit rows', async () => {
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  const service = new AgentObservabilityService(repository);
  const startedAt = '2026-04-29T08:00:00.000Z';
  const finishedAt = '2026-04-29T08:00:01.000Z';

  await repository.saveRun({
    request: {
      conversationKey: 'conv-observe-001',
      sceneKey: 'chat',
      query: '研究这家公司 上海松井机械有限公司',
      tenantContext: { operatorOpenId: 'open-chen' },
    },
    runId: 'run-observe-001',
    traceId: 'trace-observe-001',
    eid: '21024647',
    appId: '501037729',
    intentFrame: {
      actionType: 'analyze',
      goal: '研究公司',
      targetType: 'company',
      targets: [{ type: 'company', id: 'company-001', name: '上海松井机械有限公司' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.91,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-observe-001',
      kind: 'company_research',
      title: '公司研究',
      status: 'completed',
      steps: [
        {
          key: 'execute-tool',
          title: '执行公司研究',
          actionType: 'external',
          toolRefs: ['external.company_research'],
          required: true,
          skippable: false,
          confirmationRequired: false,
          status: 'succeeded',
        },
      ],
      evidenceRequired: true,
    },
    executionState: {
      runId: 'run-observe-001',
      traceId: 'trace-observe-001',
      status: 'completed',
      currentStepKey: null,
      message: '公司研究完成',
      startedAt,
      finishedAt,
    },
    toolCalls: [
      {
        id: 'tool-call-001',
        runId: 'run-observe-001',
        toolCode: 'external.company_research',
        status: 'succeeded',
        inputSummary: '上海松井机械有限公司',
        outputSummary: '已生成公司研究',
        startedAt,
        finishedAt,
        errorMessage: null,
      },
    ],
    evidence: [
      {
        artifactId: 'artifact-observe-001',
        versionId: 'version-observe-001',
        title: '上海松井机械有限公司研究',
        version: 1,
        sourceToolCode: 'external.company_research',
        anchorLabel: '上海松井机械有限公司',
        snippet: '公司研究摘要',
        score: 0.88,
        vectorStatus: 'indexed',
      },
    ],
    contextFrame: {
      subject: {
        kind: 'external_subject',
        type: 'company',
        id: 'company-001',
        name: '上海松井机械有限公司',
      },
      sourceRunId: 'run-observe-001',
      evidenceRefs: [],
      confidence: 0.9,
      resolvedBy: 'agent_run.intent_frame',
    },
    message: {
      role: 'assistant',
      content: '公司研究完成。',
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '公司研究完成',
        references: ['external.company_research'],
        evidence: [],
        agentTrace: {
          traceId: 'trace-observe-001',
          intentFrame: {},
          taskPlan: {},
          executionState: {},
          toolCalls: [],
        },
      },
    } as any,
  });

  await database.query(
    `
      INSERT INTO ${database.table('org_employees')} (
        eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at, raw_payload_json
      ) VALUES ($1, $2, $3, NULL, $4, NULL, NULL, NULL, 'active', $5, '{}'::jsonb)
    `,
    ['21024647', '501037729', 'open-chen', '陈伟棠', startedAt],
  );

  await repository.saveConfirmation({
    confirmationId: 'confirm-observe-001',
    runId: 'run-observe-001',
    toolCode: 'record.customer.preview_create',
    title: '确认创建客户',
    summary: '写入前确认',
    preview: { name: '上海松井机械有限公司' },
    debugPayload: { name: '上海松井机械有限公司' },
    requestInput: { name: '上海松井机械有限公司' },
    status: 'pending',
    createdAt: startedAt,
    decidedAt: null,
  });

  const list = await service.listRuns({ page: 1, pageSize: 10 });
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.traceId, 'trace-observe-001');
  assert.equal(list.items[0]?.operatorOpenId, 'open-chen');
  assert.equal(list.items[0]?.operatorName, '陈伟棠');
  assert.equal(list.items[0]?.evidenceCount, 1);
  assert.equal(list.items[0]?.pendingConfirmationCount, 1);

  const filtered = await service.listRuns({ traceId: 'trace-observe-001' });
  assert.equal(filtered.items[0]?.runId, 'run-observe-001');

  const filteredByOperator = await service.listRuns({ operatorName: '伟棠' });
  assert.equal(filteredByOperator.total, 1);
  assert.equal(filteredByOperator.items[0]?.operatorName, '陈伟棠');

  const filteredByMissingOperator = await service.listRuns({ operatorName: '不存在用户' });
  assert.equal(filteredByMissingOperator.total, 0);

  const filteredByStatus = await service.listRuns({ status: 'completed' });
  assert.equal(filteredByStatus.total, 1);

  const detail = await service.getRunDetail('run-observe-001');
  assert.equal(detail.run.operatorName, '陈伟棠');
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.toolCalls[0]?.toolCode, 'external.company_research');
  assert.equal(detail.contextSubject?.name, '上海松井机械有限公司');
  assert.equal(detail.confirmations[0]?.confirmationId, 'confirm-observe-001');

  const confirmations = await service.listConfirmations({ status: 'pending' });
  assert.equal(confirmations.total, 1);
  assert.equal(confirmations.items[0]?.traceId, 'trace-observe-001');
});

test('AgentObservabilityService returns a full conversation process projection', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const service = new AgentObservabilityService(repository);
  const conversationKey = 'conv-openid-69e75eb5e4b0e65b61c014da-home';

  await repository.saveRun({
    request: {
      conversationKey,
      sceneKey: 'chat',
      query: '研究贝斯美',
    },
    runId: 'run-process-001',
    traceId: 'trace-process-001',
    eid: '21024647',
    appId: '501037649',
    intentFrame: {
      actionType: 'analyze',
      goal: '研究公司',
      targetType: 'company',
      targets: [{ type: 'company', id: 'company-001', name: '贝斯美' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.91,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-process-001',
      kind: 'company_research',
      title: '公司研究',
      status: 'completed',
      steps: [],
      evidenceRequired: true,
    },
    executionState: {
      runId: 'run-process-001',
      traceId: 'trace-process-001',
      status: 'completed',
      currentStepKey: null,
      message: '公司研究完成',
      startedAt: '2026-04-29T08:00:00.000Z',
      finishedAt: '2026-04-29T08:00:01.000Z',
    },
    toolCalls: [
      {
        id: 'tool-process-001',
        runId: 'run-process-001',
        toolCode: 'external.company_research',
        status: 'succeeded',
        inputSummary: '贝斯美',
        outputSummary: '已生成公司研究',
        startedAt: '2026-04-29T08:00:00.000Z',
        finishedAt: '2026-04-29T08:00:01.000Z',
        errorMessage: null,
      },
    ],
    evidence: [],
    contextFrame: null,
    message: {
      role: 'assistant',
      content: '公司研究完成。',
      attachments: [],
      extraInfo: { headline: '公司研究完成' },
    } as any,
  });

  await repository.saveRun({
    request: {
      conversationKey,
      sceneKey: 'chat',
      query: '新增跟进记录',
    },
    runId: 'run-process-002',
    traceId: 'trace-process-002',
    eid: '21024647',
    appId: '501037649',
    intentFrame: {
      actionType: 'write',
      goal: '新增跟进记录',
      targetType: 'followup',
      targets: [{ type: 'followup', name: '跟进记录' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.88,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-process-002',
      kind: 'record_write',
      title: '写回跟进记录',
      status: 'waiting_confirmation',
      steps: [],
      evidenceRequired: false,
    },
    executionState: {
      runId: 'run-process-002',
      traceId: 'trace-process-002',
      status: 'waiting_confirmation',
      currentStepKey: 'confirm',
      message: '等待确认',
      startedAt: '2026-04-29T08:02:00.000Z',
      finishedAt: null,
    },
    toolCalls: [
      {
        id: 'tool-process-002',
        runId: 'run-process-002',
        toolCode: 'record.followup.preview_create',
        status: 'succeeded',
        inputSummary: '跟进记录',
        outputSummary: '等待确认写回',
        startedAt: '2026-04-29T08:02:00.000Z',
        finishedAt: '2026-04-29T08:02:01.000Z',
        errorMessage: null,
      },
    ],
    evidence: [],
    contextFrame: null,
    message: {
      role: 'assistant',
      content: '请确认写回。',
      attachments: [],
      extraInfo: { headline: '等待确认' },
    } as any,
  });

  await repository.saveConfirmation({
    confirmationId: 'confirm-process-001',
    runId: 'run-process-002',
    toolCode: 'record.followup.preview_create',
    title: '确认新增跟进记录',
    summary: '写入前确认',
    preview: { content: '跟进记录' },
    debugPayload: { content: '跟进记录' },
    requestInput: { content: '跟进记录' },
    status: 'pending',
    createdAt: '2026-04-29T08:02:01.000Z',
    decidedAt: null,
  });

  const process = await service.getConversationProcess(conversationKey);
  assert.equal(process.conversationKey, conversationKey);
  assert.deepEqual(process.runs.map((item) => item.runId), ['run-process-001', 'run-process-002']);
  assert.deepEqual(process.messages.map((item) => item.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual(process.toolCalls.map((item) => item.id), ['tool-process-001', 'tool-process-002']);
  assert.equal(process.confirmations[0]?.confirmationId, 'confirm-process-001');
  assert.deepEqual(process.diagnostics?.runs.map((item) => item.runId), ['run-process-001', 'run-process-002']);
  assert.equal(process.diagnostics?.summary.totalRuns, 2);
  assert.equal(process.diagnostics?.summary.attentionRunId, 'run-process-002');
  assert.equal(process.diagnostics?.summary.attentionSeverity, 'warning');
  assert.equal(process.diagnostics?.runs[1]?.issue.title, '等待用户确认');
  assert.equal(process.diagnostics?.runs[1]?.steps.map((item) => item.key).join(','), 'intent,context,tool,input,tool-result,policy,state');

  const empty = await service.getConversationProcess('conv-empty');
  assert.equal(empty.conversationKey, 'conv-empty');
  assert.deepEqual(empty.runs, []);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.diagnostics?.summary.totalRuns, 0);
});

test('AgentObservabilityService diagnostics keep attention on an earlier failed run', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const service = new AgentObservabilityService(repository);
  const conversationKey = 'conv-diagnostics-earlier-failure';

  await repository.saveRun({
    request: {
      conversationKey,
      sceneKey: 'chat',
      query: '生成拜访准备',
    },
    runId: 'run-diagnostics-001',
    traceId: 'trace-diagnostics-001',
    eid: '21024647',
    appId: '501037649',
    intentFrame: {
      actionType: 'analyze',
      goal: '生成拜访准备',
      targetType: 'customer',
      targets: [{ type: 'customer', id: 'customer-001', name: '贝斯美' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.9,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-diagnostics-001',
      kind: 'tool_execution',
      title: '拜访准备',
      status: 'tool_unavailable',
      steps: [],
      evidenceRequired: true,
    },
    executionState: {
      runId: 'run-diagnostics-001',
      traceId: 'trace-diagnostics-001',
      status: 'tool_unavailable',
      currentStepKey: 'execute-tool',
      message: '下游技能不可用',
      startedAt: '2026-04-29T08:00:00.000Z',
      finishedAt: '2026-04-29T08:00:02.000Z',
    },
    toolCalls: [
      {
        id: 'tool-diagnostics-001',
        runId: 'run-diagnostics-001',
        toolCode: 'external.yunzhijia_visit_prep',
        status: 'failed',
        inputSummary: '贝斯美',
        outputSummary: '技能调用失败',
        startedAt: '2026-04-29T08:00:00.000Z',
        finishedAt: '2026-04-29T08:00:02.000Z',
        errorMessage: '缺少公司研究资料',
      },
    ],
    evidence: [],
    contextFrame: null,
    message: {
      role: 'assistant',
      content: '下游技能不可用。',
      attachments: [],
      extraInfo: { headline: '下游技能不可用' },
    } as any,
  });

  await repository.saveRun({
    request: {
      conversationKey,
      sceneKey: 'chat',
      query: '谢谢',
    },
    runId: 'run-diagnostics-002',
    traceId: 'trace-diagnostics-002',
    eid: '21024647',
    appId: '501037649',
    intentFrame: {
      actionType: 'clarify',
      goal: '回应用户',
      targetType: 'unknown',
      targets: [],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.7,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-diagnostics-002',
      kind: 'unknown_clarify',
      title: '普通回复',
      status: 'completed',
      steps: [],
      evidenceRequired: false,
    },
    executionState: {
      runId: 'run-diagnostics-002',
      traceId: 'trace-diagnostics-002',
      status: 'completed',
      currentStepKey: null,
      message: '已回复',
      startedAt: '2026-04-29T08:01:00.000Z',
      finishedAt: '2026-04-29T08:01:01.000Z',
    },
    toolCalls: [],
    evidence: [],
    contextFrame: null,
    message: {
      role: 'assistant',
      content: '不客气。',
      attachments: [],
      extraInfo: { headline: '已回复' },
    } as any,
  });

  const process = await service.getConversationProcess(conversationKey);
  assert.deepEqual(process.diagnostics?.runs.map((item) => item.runId), ['run-diagnostics-001', 'run-diagnostics-002']);
  assert.equal(process.diagnostics?.summary.latestRunId, 'run-diagnostics-002');
  assert.equal(process.diagnostics?.summary.attentionRunId, 'run-diagnostics-001');
  assert.equal(process.diagnostics?.summary.attentionSeverity, 'error');
  assert.equal(process.diagnostics?.runs[0]?.issue.stepKey, 'tool-result');
  assert.match(process.diagnostics?.runs[0]?.issue.summary ?? '', /缺少公司研究资料/);
});
