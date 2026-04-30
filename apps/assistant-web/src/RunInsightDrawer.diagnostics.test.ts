import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeContextFlow, summarizeSelectedToolInput } from './RunInsightDrawer';

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
