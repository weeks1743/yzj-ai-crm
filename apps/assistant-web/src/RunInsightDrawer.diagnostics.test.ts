import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnosticRuns,
  buildFallbackDiagnosticRun,
  summarizeContextFlow,
  summarizeSelectedToolInput,
} from './RunInsightDrawer';

test('RunInsightDrawer marks bare collection queries as skipped context', () => {
  const flow = summarizeContextFlow({
    resolvedContext: {
      usedContext: false,
      usageMode: 'skipped_collection_query',
      reason: '本轮是对象集合查询，未承接历史上下文主体。',
    },
    semanticResolution: {
      selectedCandidate: {
        subject: {
          kind: 'record',
          type: 'contact',
          id: 'contact-lilingling-001',
          name: '李玲玲',
        },
      },
    },
  } as any);

  assert.equal(flow.summary, '未使用上下文：本轮是集合查询');
  assert.match(flow.details ?? '', /候选未承接：contact：李玲玲/);
});

test('RunInsightDrawer shows ignored ungrounded LLM target and empty filter source', () => {
  const summary = summarizeSelectedToolInput({
    filters: [],
    agentControl: {
      targetSanitization: {
        reasonCode: 'ignored_ungrounded_target',
        ignoredTargetName: '69f16bbd21bf2b00014fbc6f',
      },
    },
  });

  assert.match(summary, /查询过滤：无/);
  assert.match(summary, /过滤来源：无/);
  assert.match(summary, /已忽略未落在用户输入中的 LLM target：69f16bbd21bf2b00014fbc6f/);
});

test('RunInsightDrawer labels record search filter sources', () => {
  assert.match(
    summarizeSelectedToolInput({
      filters: [{ field: 'linked_customer_form_inst_id', value: 'customer-c1-001', operator: 'eq' }],
      agentControl: {
        searchExtraction: {
          filterSources: [{ source: 'relation_context', field: 'linked_customer_form_inst_id', value: 'customer-c1-001' }],
        },
      },
    }),
    /过滤来源：关系上下文绑定/,
  );

  assert.match(
    summarizeSelectedToolInput({
      filters: [{ field: 'customer_name', value: '安徽', operator: 'like' }],
      agentControl: {
        searchExtraction: {
          fallbackName: '安徽',
          filterSources: [{ source: 'name_fallback', field: 'customer_name', value: '安徽' }],
        },
      },
    }),
    /过滤来源：名称 fallback/,
  );

  assert.match(
    summarizeSelectedToolInput({
      filters: [{ field: 'province', value: '安徽', operator: 'eq' }],
      agentControl: {
        searchExtraction: {
          conditions: [{ field: 'province', label: '省', value: '安徽', source: 'explicit' }],
          filterSources: [{ source: 'explicit_condition', field: 'province', value: '安徽' }],
        },
      },
    }),
    /过滤来源：用户显式条件/,
  );
});

test('RunInsightDrawer prefers conversation diagnostics over latest local trace', () => {
  const runs = buildDiagnosticRuns({
    conversationKey: 'conv-001',
    runs: [],
    messages: [],
    toolCalls: [],
    confirmations: [],
    diagnostics: {
      summary: {
        totalRuns: 2,
        completedCount: 1,
        waitingCount: 1,
        failedCount: 0,
        attentionRunId: 'run-001',
        attentionTraceId: 'trace-001',
        attentionSeverity: 'warning',
        attentionTitle: '等待用户确认',
        attentionSummary: '系统正在等待确认。',
        latestRunId: 'run-002',
        latestTraceId: 'trace-002',
      },
      runs: [
        {
          runId: 'run-001',
          traceId: 'trace-001',
          userInput: '新增跟进记录',
          goal: '新增跟进记录',
          targetType: 'followup',
          status: 'waiting_confirmation',
          statusLabel: '等待确认',
          planTitle: '写回跟进记录',
          planKind: 'tool_confirmation',
          currentStepKey: 'confirm',
          evidenceCount: 0,
          toolCallCount: 1,
          failedToolCallCount: 0,
          pendingConfirmationCount: 1,
          createdAt: '2026-04-29T08:00:00.000Z',
          updatedAt: '2026-04-29T08:00:01.000Z',
          toolCalls: [],
          confirmations: [],
          steps: [{ key: 'state', title: '7. 最终状态', status: 'warning', statusLabel: '需关注', summary: '等待确认' }],
          issue: { severity: 'warning', title: '等待用户确认', summary: '系统正在等待确认。', stepKey: 'state' },
        },
        {
          runId: 'run-002',
          traceId: 'trace-002',
          userInput: '谢谢',
          goal: '回应用户',
          targetType: 'unknown',
          status: 'completed',
          statusLabel: '已完成',
          planTitle: '普通回复',
          planKind: 'unknown_clarify',
          currentStepKey: null,
          evidenceCount: 0,
          toolCallCount: 0,
          failedToolCallCount: 0,
          pendingConfirmationCount: 0,
          createdAt: '2026-04-29T08:01:00.000Z',
          updatedAt: '2026-04-29T08:01:01.000Z',
          toolCalls: [],
          confirmations: [],
          steps: [{ key: 'state', title: '7. 最终状态', status: 'success', statusLabel: '通过', summary: '已完成' }],
          issue: { severity: 'info', title: '本轮已完成', summary: '这个意图已经正常处理完成。', stepKey: 'state' },
        },
      ],
    },
  } as any, {
    traceId: 'trace-local',
    intentFrame: { goal: '本地最后一轮', targetType: 'unknown' },
    executionState: { status: 'completed' },
    taskPlan: {},
    toolCalls: [],
  } as any);

  assert.deepEqual(runs.map((item) => item.runId), ['run-001', 'run-002']);
  assert.equal(runs[0]?.issue.title, '等待用户确认');
});

test('RunInsightDrawer builds fallback diagnostic from local trace', () => {
  const run = buildFallbackDiagnosticRun({
    traceId: 'trace-local',
    intentFrame: { goal: '更新客户字段', actionType: 'write', targetType: 'customer' },
    executionState: { runId: 'run-local', status: 'waiting_confirmation', message: '等待确认', currentStepKey: 'confirm' },
    taskPlan: { title: '写回客户', kind: 'tool_confirmation' },
    selectedTool: {
      toolCode: 'record.customer.preview_update',
      reason: '写入前预览',
      input: { params: {} },
    },
    toolCalls: [],
    policyDecisions: [{ policyCode: 'record.preview_empty_payload_guard', action: 'block', reason: '空写入' }],
  } as any);

  assert.equal(run.runId, 'run-local');
  assert.equal(run.issue.severity, 'error');
  assert.match(run.issue.summary, /空写入守卫|写入参数/);
  assert.equal(run.steps.map((item) => item.key).join(','), 'intent,context,tool,input,tool-result,policy,state');
});
