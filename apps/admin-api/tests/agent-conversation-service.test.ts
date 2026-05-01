import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentConversationService } from '../src/agent-conversation-service.js';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { createInMemoryDatabase } from './test-helpers.js';

test('AgentConversationService persists conversation sessions by operatorOpenId', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const service = new AgentConversationService(repository);

  await service.upsertConversation({
    operatorOpenId: 'oid-a',
    conversation: {
      key: 'conv-openid-oid-a-user-001',
      label: '新会话',
      route: '/chat',
      group: '最近会话',
      lastMessage: '可以描述目标、选择场景或输入 slash 命令。',
      updatedAt: '刚刚',
      scene: 'chat',
    },
  });
  await service.upsertConversation({
    operatorOpenId: 'oid-b',
    conversation: {
      key: 'conv-openid-oid-b-user-001',
      label: '其他用户会话',
      route: '/chat',
      group: '最近会话',
      lastMessage: 'other',
      updatedAt: '刚刚',
      scene: 'chat',
    },
  });
  await service.upsertConversation({
    operatorOpenId: 'oid-a',
    conversation: {
      key: 'conv-openid-oid-a-user-001',
      label: '查客户苏州明纬',
      route: '/chat/customer-analysis',
      group: '最近会话',
      lastMessage: '查客户苏州明纬',
      updatedAt: '刚刚',
      scene: 'customer-analysis',
    },
  });

  const list = await service.listConversations('oid-a');
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]?.label, '查客户苏州明纬');
  assert.equal(list.items[0]?.route, '/chat/customer-analysis');

  await assert.rejects(() => service.listConversations(' '), /operatorOpenId 不能为空/);
});

test('AgentRunRepository touches conversation metadata when saving a chat run', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const service = new AgentConversationService(repository);

  await repository.saveRun({
    request: {
      conversationKey: 'conv-openid-oid-a-user-002',
      sceneKey: 'chat',
      query: '研究客户 苏州明纬自动化有限公司',
      tenantContext: { operatorOpenId: 'oid-a' },
    },
    runId: 'run-conversation-001',
    traceId: 'trace-conversation-001',
    eid: '21024647',
    appId: '501037729',
    intentFrame: {
      actionType: 'analyze',
      goal: '研究客户',
      targetType: 'company',
      targets: [{ type: 'company', id: 'company-001', name: '苏州明纬自动化有限公司' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.9,
      source: 'fallback',
    },
    taskPlan: {
      planId: 'plan-conversation-001',
      kind: 'company_research',
      title: '客户研究',
      status: 'completed',
      steps: [],
      evidenceRequired: false,
    },
    executionState: {
      runId: 'run-conversation-001',
      traceId: 'trace-conversation-001',
      status: 'completed',
      currentStepKey: null,
      message: '完成',
      startedAt: '2026-05-01T02:00:00.000Z',
      finishedAt: '2026-05-01T02:00:01.000Z',
    },
    toolCalls: [],
    evidence: [],
    message: {
      role: 'assistant',
      content: '完成。',
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '完成',
        references: [],
      },
    } as any,
  });

  const list = await service.listConversations('oid-a');
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]?.key, 'conv-openid-oid-a-user-002');
  assert.equal(list.items[0]?.label, '研究客户 苏州明纬自动化有限公司');
  assert.equal(list.items[0]?.lastMessage, '研究客户 苏州明纬自动化有限公司');
});
