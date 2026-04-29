import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentObservabilityService } from '../src/agent-observability-service.js';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { createInMemoryDatabase } from './test-helpers.js';

test('AgentObservabilityService lists run details and confirmation audit rows', () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const service = new AgentObservabilityService(repository);
  const startedAt = '2026-04-29T08:00:00.000Z';
  const finishedAt = '2026-04-29T08:00:01.000Z';

  repository.saveRun({
    request: {
      conversationKey: 'conv-observe-001',
      sceneKey: 'chat',
      query: '研究这家公司 上海松井机械有限公司',
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

  repository.saveConfirmation({
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

  const list = service.listRuns({ page: 1, pageSize: 10 });
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.traceId, 'trace-observe-001');
  assert.equal(list.items[0]?.evidenceCount, 1);
  assert.equal(list.items[0]?.pendingConfirmationCount, 1);

  const filtered = service.listRuns({ traceId: 'trace-observe-001' });
  assert.equal(filtered.items[0]?.runId, 'run-observe-001');

  const detail = service.getRunDetail('run-observe-001');
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.toolCalls[0]?.toolCode, 'external.company_research');
  assert.equal(detail.contextSubject?.name, '上海松井机械有限公司');
  assert.equal(detail.confirmations[0]?.confirmationId, 'confirm-observe-001');

  const confirmations = service.listConfirmations({ status: 'pending' });
  assert.equal(confirmations.total, 1);
  assert.equal(confirmations.items[0]?.traceId, 'trace-observe-001');
});
