import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { MainAgentRuntime } from '../src/agent-runtime.js';
import { AgentService } from '../src/agent-service.js';
import { createCrmAgentRuntimeParts } from '../src/crm-agent-pack.js';
import { AgentToolRegistry, GENERIC_TOOL_CONTRACTS } from '../src/tool-registry.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type { AgentChatMessage, AppConfig, ExecutionState, IntentFrame, ShadowObjectKey, TaskPlan } from '../src/contracts.js';

function recordIntent(
  objectKey: ShadowObjectKey,
  actionType: IntentFrame['actionType'] = 'query',
  name = `${objectKey} 测试对象`,
): IntentFrame {
  return {
    actionType,
    goal: `${actionType} ${objectKey}`,
    targetType: objectKey,
    targets: [{ type: objectKey, id: `${objectKey}-001`, name }],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.9,
    source: 'fallback',
  };
}

function companyIntent(companyName: string): IntentFrame {
  return {
    actionType: 'analyze',
    goal: '研究目标公司并沉淀 Artifact',
    targetType: 'company',
    targets: [{ type: 'company', id: companyName, name: companyName }],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.9,
    source: 'fallback',
  };
}

function seedCompanyContext(repository: AgentRunRepository, conversationKey: string, companyName: string): void {
  const taskPlan: TaskPlan = {
    planId: 'plan-context-seed',
    kind: 'tool_execution',
    title: '上下文种子',
    status: 'completed',
    steps: [],
    evidenceRequired: true,
  };
  const executionState: ExecutionState = {
    runId: 'run-context-seed',
    traceId: 'trace-context-seed',
    status: 'completed',
    currentStepKey: null,
    message: '上下文种子',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  const message: AgentChatMessage = {
    role: 'assistant',
    content: '公司研究已完成',
    attachments: [],
    extraInfo: {
      feedback: 'default',
      sceneKey: 'chat',
      headline: '公司研究已完成',
      references: ['company-research'],
      evidence: [
        {
          artifactId: 'artifact-context-seed',
          versionId: 'version-context-seed',
          title: `${companyName} 公司研究`,
          version: 1,
          sourceToolCode: 'ext.company_research_pm',
          anchorLabel: companyName,
          snippet: `${companyName} 公司研究摘要`,
          vectorStatus: 'indexed',
        },
      ],
      agentTrace: {
        traceId: 'trace-context-seed',
        intentFrame: companyIntent(companyName),
        taskPlan,
        executionState,
        toolCalls: [],
        pendingConfirmation: null,
        policyDecisions: [],
      },
    },
  };
  repository.saveRun({
    request: {
      conversationKey,
      sceneKey: 'chat',
      query: `研究这家公司 ${companyName}`,
    },
    runId: executionState.runId,
    traceId: executionState.traceId,
    eid: '21024647',
    appId: '501037729',
    intentFrame: companyIntent(companyName),
    taskPlan,
    executionState,
    toolCalls: [],
    evidence: message.extraInfo.evidence ?? [],
    message,
  });
}

function createAgentTestService(input: {
  config?: AppConfig;
  repository: AgentRunRepository;
  intentFrame: IntentFrame;
  shadowMetadataService?: unknown;
}) {
  const config = input.config ?? createTestConfig();
  const runtimeParts = createCrmAgentRuntimeParts({
    config,
    repository: input.repository,
    intentFrameService: {
      createIntentFrame: async () => input.intentFrame,
    } as any,
    shadowMetadataService: (input.shadowMetadataService ?? {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: input.intentFrame.targetType,
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: {},
      }),
      executeUpsert: async () => ({
        objectKey: input.intentFrame.targetType,
        operation: 'upsert',
        mode: 'live',
        writeMode: 'create',
        requestBody: {},
        formInstIds: ['form-001'],
      }),
    }) as any,
    externalSkillService: {
      createSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    } as any,
    artifactService: {
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  return {
    service: new AgentService({
      config,
      repository: input.repository,
      runtime: new MainAgentRuntime({
        config,
        registry: runtimeParts.registry,
        intentResolver: runtimeParts.intentResolver,
        planner: runtimeParts.planner,
      }),
    }),
    registry: runtimeParts.registry,
  };
}

test('Tool Registry exposes generic contracts and rejects scene tools', () => {
  assert.deepEqual([...GENERIC_TOOL_CONTRACTS], [
    'record.object.search',
    'record.object.get',
    'record.object.preview_create',
    'record.object.preview_update',
    'record.object.commit_create',
    'record.object.commit_update',
    'external.company_research',
    'artifact.search',
    'meta.clarify_card',
    'meta.candidate_selection',
    'meta.plan_builder',
    'meta.confirm_writeback',
  ]);

  const registry = new AgentToolRegistry();
  assert.throws(
    () => registry.register({
      code: 'scene.customer_research',
      type: 'meta',
      provider: 'test',
      description: 'invalid scene tool',
      whenToUse: 'never',
      inputSchema: {},
      outputSchema: {},
      riskLevel: 'low',
      confirmationPolicy: 'read_only',
      displayCardType: 'test',
      owner: 'test',
      enabled: true,
      execute: async () => ({
        status: 'completed',
        content: '',
        headline: '',
        references: [],
        toolCalls: [],
      }),
    }),
    /cannot register scene\.\* tools/,
  );
});

test('CRM agent pack maps four record objects without scene or delete tools', () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { registry } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer'),
  });
  const toolCodes = registry.list().map((tool) => tool.code).sort();

  for (const objectKey of ['customer', 'contact', 'opportunity', 'followup'] as const) {
    for (const operation of ['search', 'get', 'preview_create', 'preview_update', 'commit_create', 'commit_update']) {
      assert.ok(toolCodes.includes(`record.${objectKey}.${operation}`), `${objectKey}.${operation} should be registered`);
    }
  }

  assert.equal(toolCodes.some((code) => code.startsWith('scene.')), false);
  assert.equal(toolCodes.some((code) => code.includes('.delete')), false);
  assert.deepEqual(
    registry.get('record.customer.preview_create')?.recordCapability?.identityFields,
    ['customer_name'],
  );
  assert.equal(
    registry.get('record.customer.preview_create')?.recordCapability?.duplicateCheckPolicy?.enabled,
    true,
  );
});

test('Agent runtime routes record query through record search tool', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchedObject: ShadowObjectKey | null = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        searchedObject = objectKey;
        return { records: [{ formInstId: 'customer-form-001', name: '测试客户' }] };
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-record-search',
    sceneKey: 'chat',
    query: '查询客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.equal(searchedObject, 'customer');
});

test('Agent runtime previews record writeback before approve or reject decision', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let executeUpsertCount = 0;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form' },
      }),
      executeUpsert: async () => {
        executeUpsertCount += 1;
        return {
          objectKey: 'customer',
          operation: 'upsert',
          mode: 'live',
          writeMode: 'create',
          requestBody: { formCodeId: 'customer-form' },
          formInstIds: ['customer-live-001'],
        };
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-record-confirm-approve',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  assert.equal(preview.executionState.status, 'waiting_confirmation');
  assert.equal(preview.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_create');
  assert.ok(pending);
  assert.equal(executeUpsertCount, 0);

  const approved = await service.chat({
    conversationKey: 'conv-record-confirm-approve',
    sceneKey: 'chat',
    query: '确认写回',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: preview.executionState.runId,
      action: 'confirm_writeback',
      decision: 'approve',
      confirmationId: pending?.confirmationId,
    },
  });

  assert.equal(approved.executionState.status, 'completed');
  assert.equal(approved.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.commit_create');
  assert.equal(executeUpsertCount, 1);
});

test('Agent runtime resolves contextual record create and builds metadata-driven preview input', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const companyName = '绍兴贝斯美化工股份有限公司';
  seedCompanyContext(repository, 'conv-context-create', companyName);
  let searchFilterValue = '';
  let previewParams: Record<string, unknown> | null = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '这个客户'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchFilterValue = input.filters?.[0]?.value ?? '';
        return { records: [] };
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewParams = input.params;
        return {
          objectKey: 'customer',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: [],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: true,
          requestBody: { formCodeId: 'customer-form' },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-create',
    sceneKey: 'chat',
    query: '录入这个客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, true);
  assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.subject?.name, companyName);
  assert.equal(searchFilterValue, companyName);
  assert.deepEqual(previewParams, { customer_name: companyName });
  assert.equal(Object.prototype.hasOwnProperty.call(previewParams ?? {}, '_S_TITLE'), false);
  assert.ok(response.message.extraInfo.agentTrace.pendingConfirmation);
});

test('Agent runtime stops contextual record create when duplicate candidates exist', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const companyName = '绍兴贝斯美化工股份有限公司';
  seedCompanyContext(repository, 'conv-context-duplicate', companyName);
  let previewCalled = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '这个客户'),
    shadowMetadataService: {
      executeSearch: async () => ({
        records: [
          {
            formInstId: 'customer-existing-001',
            title: companyName,
            raw: {},
            fields: [],
            fieldMap: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        previewCalled = true;
        throw new Error('duplicate guard should stop preview');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-duplicate',
    sceneKey: 'chat',
    query: '录入这个客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_selection');
  assert.match(response.message.content, /发现疑似重复记录/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
  assert.equal(previewCalled, false);
  assert.equal(response.toolCalls.some((item) => item.toolCode === 'record.customer.search'), true);
});

test('Agent runtime explains readonly preview blockers from record tools', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: ['_S_TITLE'],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: { formCodeId: 'customer-form' },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-readonly-preview',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /只读字段：_S_TITLE/);
  assert.match(response.message.extraInfo.headline, /写入参数被工具契约阻断/);
});

test('Agent runtime cancels record writeback on reject decision', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let executeUpsertCount = 0;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form' },
      }),
      executeUpsert: async () => {
        executeUpsertCount += 1;
        throw new Error('reject should not execute writeback');
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-record-confirm-reject',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  const rejected = await service.chat({
    conversationKey: 'conv-record-confirm-reject',
    sceneKey: 'chat',
    query: '取消写回',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: preview.executionState.runId,
      action: 'confirm_writeback',
      decision: 'reject',
      confirmationId: pending?.confirmationId,
    },
  });

  assert.equal(rejected.executionState.status, 'cancelled');
  assert.equal(rejected.message.extraInfo.agentTrace.pendingConfirmation?.status, 'rejected');
  assert.equal(executeUpsertCount, 0);
});
