import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { MainAgentRuntime } from '../src/agent-runtime.js';
import { AgentService } from '../src/agent-service.js';
import { arbitrateToolSemantic, type ToolArbitrationRule } from '../src/agent-tool-semantic-arbitrator.js';
import { buildMetaQuestionOptionsResponse, buildRecordSearchPageResponse, createCrmAgentRuntimeParts } from '../src/crm-agent-pack.js';
import { YzjApiError } from '../src/errors.js';
import { AgentToolRegistry, GENERIC_TOOL_CONTRACTS } from '../src/tool-registry.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type { AgentChatMessage, AppConfig, ExecutionState, IntentFrame, ShadowObjectKey, ShadowStandardizedField, TaskPlan } from '../src/contracts.js';
import type { AgentToolDefinition, GenericIntentFrame } from '../src/agent-core.js';
import type { OrgEmployeeCandidate } from '../src/org-sync-repository.js';

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

function companyWriteIntent(goal = '更新销售负责人为陈伟堂'): IntentFrame {
  return {
    actionType: 'write',
    goal,
    targetType: 'company',
    targets: [],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 1,
    source: 'llm',
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
    contextFrame: {
      subject: {
        kind: 'external_subject',
        type: 'company',
        id: companyName,
        name: companyName,
      },
      sourceRunId: executionState.runId,
      evidenceRefs: message.extraInfo.evidence ?? [],
      confidence: 0.9,
      resolvedBy: 'test.seed.company',
    },
    message,
  });
}

function seedRecordContext(
  repository: AgentRunRepository,
  input: {
    conversationKey: string;
    objectKey: ShadowObjectKey;
    formInstId: string;
    name: string;
  },
): void {
  const taskPlan: TaskPlan = {
    planId: 'plan-record-context-seed',
    kind: 'tool_execution',
    title: '记录上下文种子',
    status: 'completed',
    steps: [],
    evidenceRequired: false,
  };
  const executionState: ExecutionState = {
    runId: `run-${input.objectKey}-context-seed`,
    traceId: `trace-${input.objectKey}-context-seed`,
    status: 'completed',
    currentStepKey: null,
    message: '记录上下文种子',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  repository.saveRun({
    request: {
      conversationKey: input.conversationKey,
      sceneKey: 'chat',
      query: `查询${input.name}`,
    },
    runId: executionState.runId,
    traceId: executionState.traceId,
    eid: '21024647',
    appId: '501037729',
    intentFrame: recordIntent(input.objectKey, 'query', input.name),
    taskPlan,
    executionState,
    toolCalls: [],
    evidence: [],
    contextFrame: {
      subject: {
        kind: 'record',
        type: input.objectKey,
        id: input.formInstId,
        name: input.name,
      },
      sourceRunId: executionState.runId,
      evidenceRefs: [],
      confidence: 0.95,
      resolvedBy: 'test.seed.record',
    },
    message: {
      role: 'assistant',
      content: '记录查询已完成',
      attachments: [],
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '记录查询已完成',
        references: [`record.${input.objectKey}.search`],
        evidence: [],
        agentTrace: {
          traceId: executionState.traceId,
          intentFrame: recordIntent(input.objectKey, 'query', input.name),
          taskPlan,
          executionState,
          toolCalls: [],
          pendingConfirmation: null,
          policyDecisions: [],
        },
      },
    },
  });
}

function createAgentTestService(input: {
  config?: AppConfig;
  repository: AgentRunRepository;
  intentFrame: IntentFrame | ((request: { query: string }) => IntentFrame);
  shadowMetadataService?: unknown;
  orgSyncRepository?: unknown;
  externalSkillService?: unknown;
  artifactService?: unknown;
  companyResearchMaxWaitMs?: number;
}) {
  const config = input.config ?? createTestConfig();
  const resolveTestIntentFrame = (request: { query: string }) =>
    typeof input.intentFrame === 'function' ? input.intentFrame(request) : input.intentFrame;
  const runtimeParts = createCrmAgentRuntimeParts({
    config,
    repository: input.repository,
    intentFrameService: {
      createIntentFrame: async (request: { query: string }) => resolveTestIntentFrame(request),
    } as any,
    shadowMetadataService: (input.shadowMetadataService ?? {
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
        requestBody: { formCodeId: 'test-form', data: [{ widgetValue: { _S_NAME: '测试记录' } }] },
      }),
      executeUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        mode: 'live',
        writeMode: 'create',
        requestBody: { formCodeId: 'test-form', data: [{ widgetValue: { _S_NAME: '测试记录' } }] },
        formInstIds: ['form-001'],
      }),
    }) as any,
    orgSyncRepository: input.orgSyncRepository as any,
    externalSkillService: (input.externalSkillService ?? {
      createSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    }) as any,
    artifactService: (input.artifactService ?? {
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    }) as any,
    companyResearchMaxWaitMs: input.companyResearchMaxWaitMs,
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

function createCompanyResearchMocks(input: {
  companyName: string;
  calls?: Array<{ tool: string; input: unknown }>;
}) {
  const calls = input.calls ?? [];
  return {
    externalSkillService: {
      createSkillJob: async (_toolCode: string, payload: unknown) => {
        calls.push({ tool: 'external.company_research.job', input: payload });
        return { jobId: 'job-company-research-001', status: 'running', artifacts: [] };
      },
      getSkillJob: async () => ({
        jobId: 'job-company-research-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'ext.company_research_pm',
        model: null,
        status: 'succeeded',
        finalText: `# ${input.companyName} 公司研究\n\n## 研究摘要\n销售切入点：关注预算、组织变化和数字化项目。`,
        events: [],
        artifacts: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    },
    artifactService: {
      createCompanyResearchArtifact: async (payload: any) => {
        calls.push({ tool: 'artifact.company_research', input: payload });
        return {
          artifact: {
            artifactId: 'artifact-company-001',
            versionId: 'artifact-version-001',
            title: payload.title,
            version: 1,
            sourceToolCode: payload.sourceToolCode,
            vectorStatus: 'indexed',
            chunkCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
    calls,
  };
}

function createSearchField(input: Partial<ShadowStandardizedField> & Pick<ShadowStandardizedField, 'fieldCode' | 'label' | 'widgetType'>): ShadowStandardizedField {
  return {
    fieldCode: input.fieldCode,
    label: input.label,
    widgetType: input.widgetType,
    required: false,
    readOnly: false,
    edit: true,
    view: true,
    writePolicy: 'promptable',
    isSystemField: false,
    provenance: {
      sources: ['public_view_form_def'],
      truthSource: 'public_view_form_def',
    },
    multi: false,
    options: [],
    ...input,
  } as ShadowStandardizedField;
}

function createEmployeeCandidate(input: {
  openId: string;
  name: string;
  phone?: string;
  email?: string;
}): OrgEmployeeCandidate {
  return {
    eid: '21024647',
    appId: '501037729',
    openId: input.openId,
    uid: `${input.openId}-uid`,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    jobTitle: null,
    status: '1',
    syncedAt: '2026-04-29T00:00:00.000Z',
  };
}

function createEmployeeLookup(candidates: OrgEmployeeCandidate[]) {
  return {
    findEmployees: ({ keyword, limit }: { keyword: string; limit?: number }) => {
      const normalized = keyword.trim().toLowerCase();
      return candidates
        .filter((candidate) =>
          candidate.name?.toLowerCase().includes(normalized)
          || candidate.openId.toLowerCase() === normalized
          || candidate.uid?.toLowerCase() === normalized
          || candidate.phone === keyword
          || candidate.email?.toLowerCase() === normalized,
        )
        .slice(0, limit ?? 20);
    },
  };
}

function createCustomerSearchFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: '_S_NAME',
      label: '客户名称',
      widgetType: 'textWidget',
      readOnly: true,
      edit: false,
      isSystemField: true,
      semanticSlot: 'customer_name',
      searchParameterKey: '_S_NAME',
    }),
    createSearchField({
      fieldCode: 'Pw_0',
      label: '省',
      widgetType: 'publicOptBoxWidget',
      semanticSlot: 'province',
      searchParameterKey: 'province',
      enumBinding: {
        kind: 'public_option',
        referId: null,
        source: 'field_binding_workbook',
        resolutionStatus: 'resolved',
        acceptedValueShape: 'array<{title,dicId}>',
        resolvedEntryCount: 2,
      },
      options: [
        { title: '安徽', dicId: 'dic-province-ah' },
        { title: '浙江', dicId: 'dic-province-zj' },
      ],
    }),
    createSearchField({
      fieldCode: 'Ra_0',
      label: '客户状态',
      widgetType: 'radioWidget',
      semanticSlot: 'customer_status',
      searchParameterKey: 'customer_status',
      options: [{ title: '潜在客户', key: 'potential', value: '潜在客户' }],
    }),
    createSearchField({
      fieldCode: 'Ra_3',
      label: '客户类型',
      widgetType: 'radioWidget',
      semanticSlot: 'customer_type',
      searchParameterKey: 'customer_type',
      options: [{ title: 'VIP客户', key: 'vip', value: 'VIP客户' }],
    }),
    createSearchField({
      fieldCode: 'Industry_0',
      label: '行业',
      widgetType: 'radioWidget',
      semanticSlot: 'industry',
      searchParameterKey: 'industry',
      options: [{ title: '制造业', key: 'manufacturing', value: '制造业' }],
    }),
    createSearchField({
      fieldCode: 'Nu_1',
      label: '联系人手机',
      widgetType: 'numberWidget',
      searchParameterKey: 'Nu_1',
    }),
    createSearchField({
      fieldCode: '_S_DISABLE',
      label: '启用状态',
      widgetType: 'switchWidget',
      searchParameterKey: '_S_DISABLE',
      readOnly: true,
      edit: false,
      isSystemField: true,
    }),
  ];
}

function createOpportunityWriteFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: 'Mo_0',
      label: '商机预算（元）',
      widgetType: 'numberWidget',
      writeParameterKey: 'opportunity_budget',
    }),
    createSearchField({
      fieldCode: 'Da_0',
      label: '预计成交时间',
      widgetType: 'dateWidget',
      writeParameterKey: 'expected_close_date',
    }),
    createSearchField({
      fieldCode: 'Ra_0',
      label: '销售阶段',
      widgetType: 'radioWidget',
      writeParameterKey: 'sales_stage',
      options: [{ title: '初期沟通', key: 'initial', value: '初期沟通' }],
    }),
    createSearchField({
      fieldCode: 'Ps_0',
      label: '销售负责人',
      widgetType: 'personSelectWidget',
      writeParameterKey: 'owner_open_id',
    }),
  ];
}

function createCustomerWritePersonFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: '_S_NAME',
      label: '客户名称',
      widgetType: 'textWidget',
      writeParameterKey: 'customer_name',
    }),
    createSearchField({
      fieldCode: 'Ps_service',
      label: '售后服务代表',
      widgetType: 'personSelectWidget',
      writeParameterKey: 'service_rep_open_id',
    }),
  ];
}

function createFollowupWriteFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: 'Ra_1',
      label: '跟进方式',
      widgetType: 'radioWidget',
      writeParameterKey: 'followup_method',
      options: [{ title: '电话', key: 'phone', value: '电话' }],
    }),
    createSearchField({
      fieldCode: 'Bd_customer',
      label: '客户编号',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_customer_form_inst_id',
      relationBinding: {
        kind: 'basic_data',
        formCodeId: 'customer-form',
        modelName: '客户',
        displayCol: '_S_NAME',
      },
    }),
    createSearchField({
      fieldCode: 'Ps_owner',
      label: '跟进负责人',
      widgetType: 'personSelectWidget',
      writeParameterKey: 'owner_open_id',
    }),
    createSearchField({
      fieldCode: 'Ta_0',
      label: '跟进记录',
      widgetType: 'textAreaWidget',
      writeParameterKey: 'followup_record',
    }),
  ];
}

function createCustomerLookupFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: '_S_NAME',
      label: '客户名称',
      widgetType: 'textWidget',
      searchParameterKey: 'customer_name',
      writeParameterKey: 'customer_name',
    }),
    ...createCustomerSearchFields(),
  ];
}

async function runCustomerSearchExtractionCase(query: string, fields = createCustomerSearchFields()) {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', ''),
    shadowMetadataService: {
      getObject: () => ({ fields }),
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchInput = input;
        return { records: [] };
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
    conversationKey: `conv-record-search-extraction-${Math.random().toString(16).slice(2)}`,
    sceneKey: 'chat',
    query,
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  return { response, searchInput };
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

test('Tool Semantic Arbitrator supports non-CRM conflict groups without runtime changes', () => {
  const registry = new AgentToolRegistry();
  const execute: AgentToolDefinition['execute'] = async () => ({
    status: 'completed',
    content: '',
    headline: '',
    references: [],
    toolCalls: [],
  });
  registry.register({
    code: 'external.vendor_registry_probe',
    type: 'external',
    provider: 'fake-registry',
    description: 'Fake internal registry probe',
    whenToUse: 'Fake test probe',
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'low',
    confirmationPolicy: 'read_only',
    displayCardType: 'fake-probe',
    owner: 'test',
    enabled: true,
    semanticProfile: {
      subjectTypes: ['vendor'],
      intentCodes: ['provide_info'],
      conflictGroups: ['fake_profile_lookup'],
      priority: 80,
      risk: 'low_cost',
      clarifyLabel: '查看内部供应商档案',
      readOnlyProbe: true,
    },
    execute,
  });
  registry.register({
    code: 'external.vendor_research',
    type: 'external',
    provider: 'fake-research',
    description: 'Fake external research',
    whenToUse: 'Fake research',
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'medium',
    confirmationPolicy: 'asset_only',
    displayCardType: 'fake-research',
    owner: 'test',
    enabled: true,
    semanticProfile: {
      subjectTypes: ['vendor'],
      intentCodes: ['provide_info'],
      conflictGroups: ['fake_profile_lookup'],
      priority: 40,
      risk: 'high_cost',
      clarifyLabel: '进行供应商研究',
    },
    execute,
  });
  const intentFrame: GenericIntentFrame = {
    actionType: 'query',
    goal: '提供供应商信息',
    target: {
      kind: 'external_subject',
      objectType: 'vendor',
      name: '测试供应商',
    },
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.8,
    source: 'fallback',
    legacyIntentFrame: {
      actionType: 'query',
      goal: '提供供应商信息',
      targetType: 'unknown',
      targets: [],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.8,
      source: 'fallback',
    },
  };
  const rules: ToolArbitrationRule[] = [
    {
      ruleCode: 'fake.vendor_profile_lookup',
      conflictGroup: 'fake_profile_lookup',
      match: () => ({
        mode: 'ambiguous',
        intentCode: 'provide_info',
        subjectType: 'vendor',
        subjectName: '测试供应商',
        reason: 'fake ambiguous vendor profile lookup',
      }),
      buildToolInput: ({ match }) => ({ subjectName: match.subjectName }),
    },
  ];

  const decision = arbitrateToolSemantic({
    query: '给出 测试供应商 信息',
    intentFrame,
    availableTools: registry.list(),
    rules,
  });

  assert.equal(decision?.selectedTool.toolCode, 'external.vendor_registry_probe');
  assert.equal(decision?.trace.conflictGroup, 'fake_profile_lookup');
  assert.deepEqual(decision?.trace.candidateTools.map((item) => item.toolCode), [
    'external.vendor_registry_probe',
    'external.vendor_research',
  ]);
  assert.deepEqual(
    ((decision?.selectedTool.input.agentControl as any)?.toolArbitrationProbe as any)?.candidateToolCodes,
    ['external.vendor_registry_probe', 'external.vendor_research'],
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
  assert.equal(response.message.extraInfo.uiSurfaces?.[0]?.kind, 'record-search-results');
  assert.equal(response.message.extraInfo.uiSurfaces?.[0]?.summary.displayMode, 'card');
  assert.equal(response.message.extraInfo.uiSurfaces?.[0]?.pagination?.endpoint, '/api/agent/record-search-page');
  assert.doesNotMatch(response.message.content, /```json/);
});

test('Agent runtime opens record detail from hidden client action without exposing formInstId in query', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let getInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('opportunity', 'query', '打开商机：数字化经营项目'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async (_objectKey: ShadowObjectKey, input: any) => {
        getInput = input;
        return {
          record: {
            formInstId: input.formInstId,
            fields: [{ title: '机会名称', value: '数字化经营项目' }],
            rawRecord: {},
          },
        };
      },
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-client-action-open-record',
    sceneKey: 'chat',
    query: '打开商机：数字化经营项目',
    clientAction: {
      type: 'record.open',
      objectKey: 'opportunity',
      formInstId: 'opportunity-live-001',
      title: '数字化经营项目',
    },
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.opportunity.get');
  assert.equal(getInput.formInstId, 'opportunity-live-001');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.input.formInstId, 'opportunity-live-001');
});

test('Agent runtime returns A2UI surfaces for empty, single, and multi record search results', async () => {
  const cases: Array<{
    records: any[];
    displayMode: 'empty' | 'card' | 'list';
  }> = [
    { records: [], displayMode: 'empty' },
    {
      records: [
        {
          formInstId: 'customer-form-001',
          fields: [{ title: '客户名称', value: '测试客户 A' }],
          rawRecord: {},
        },
      ],
      displayMode: 'card',
    },
    {
      records: [
        {
          formInstId: 'customer-form-001',
          fields: [{ title: '客户名称', value: '测试客户 A' }],
          rawRecord: {},
        },
        {
          formInstId: 'customer-form-002',
          fields: [{ title: '客户名称', value: '测试客户 B' }],
          rawRecord: {},
        },
      ],
      displayMode: 'list',
    },
  ];

  for (const item of cases) {
    const repository = new AgentRunRepository(createInMemoryDatabase());
    const { service } = createAgentTestService({
      repository,
      intentFrame: recordIntent('customer', 'query'),
      shadowMetadataService: {
        executeSearch: async () => ({
          objectKey: 'customer',
          operation: 'search',
          mode: 'live',
          requestBody: {},
          pageNumber: 1,
          pageSize: 5,
          totalPages: 1,
          totalElements: item.records.length,
          records: item.records,
        }),
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
      conversationKey: `conv-record-a2ui-${item.displayMode}`,
      sceneKey: 'chat',
      query: '查询客户 测试客户',
      tenantContext: { operatorOpenId: 'operator-001' },
    });
    const surface = response.message.extraInfo.uiSurfaces?.[0];

    assert.equal(response.executionState.status, 'completed');
    assert.equal(surface?.protocol, 'a2ui');
    assert.equal(surface?.version, 'v0.9');
    assert.equal(surface?.catalogId, 'local://yzj-crm/record-result/v1');
    assert.equal(surface?.summary.displayMode, item.displayMode);
    assert.equal(surface?.pagination?.request.searchInput.pageSize, 5);
    assert.equal(surface?.commands.some((command: any) => command.updateComponents), true);
    assert.doesNotMatch(response.message.content, /```json/);
  }
});

test('Record A2UI pagination endpoint returns one live page with the same view model shape', async () => {
  let capturedInput: any = null;
  const response = await buildRecordSearchPageResponse({
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        capturedInput = input;
        return {
          objectKey: 'customer',
          operation: 'search',
          mode: 'live',
          requestBody: {},
          pageNumber: input.pageNumber,
          pageSize: input.pageSize,
          totalPages: 3,
          totalElements: 12,
          records: [
            {
              formInstId: 'customer-form-006',
              fields: [{ title: '客户名称', value: '第六个客户' }],
              rawRecord: {},
            },
          ],
        };
      },
    } as any,
    request: {
      objectKey: 'customer',
      toolCode: 'record.customer.search',
      searchInput: {
        filters: [{ field: 'province', value: '安徽', operator: 'eq' }],
        operatorOpenId: 'operator-001',
        pageNumber: 2,
        pageSize: 5,
      },
    },
  });

  assert.equal(capturedInput.pageNumber, 2);
  assert.equal(capturedInput.pageSize, 5);
  assert.equal(response.result.displayMode, 'list');
  assert.equal(response.result.records[0]?.title, '第六个客户');
  assert.equal(response.result.pagination?.endpoint, '/api/agent/record-search-page');
  assert.deepEqual(response.result.pagination?.request.searchInput.filters, [
    { field: 'province', value: '安徽', operator: 'eq' },
  ]);
});

test('Agent runtime clears stale A2UI surfaces when the next tool waits for input', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: ({ query }) => query.includes('修改') || query.includes('改为')
      ? recordIntent('customer', 'write', '这个客户')
      : recordIntent('customer', 'query', ''),
    shadowMetadataService: {
      getObject: () => ({ fields: createCustomerSearchFields() }),
      executeSearch: async () => ({
        objectKey: 'customer',
        operation: 'search',
        mode: 'live',
        requestBody: {},
        pageNumber: 1,
        pageSize: 5,
        totalPages: 1,
        totalElements: 1,
        records: [
          {
            formInstId: 'customer-ahyy-001',
            fields: [{ title: '客户名称', value: '安徽艳阳电气集团有限公司' }],
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: ['allocation_status'],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: {} }] },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const search = await service.chat({
    conversationKey: 'conv-stale-a2ui-surface',
    sceneKey: 'chat',
    query: '查询安徽艳阳电气客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(search.message.extraInfo.uiSurfaces?.[0]?.summary.displayMode, 'card');

  const waiting = await service.chat({
    conversationKey: 'conv-stale-a2ui-surface',
    sceneKey: 'chat',
    query: '将分配状态修改为已分配',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(waiting.executionState.status, 'waiting_input');
  assert.equal(waiting.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_update');
  assert.equal(waiting.message.extraInfo.uiSurfaces?.length, 0);
  assert.doesNotMatch(waiting.message.content, /已查询到客户/);
});

test('Agent runtime extracts metadata-driven record search filters before title fallback', async () => {
  const cases: Array<{
    query: string;
    expectedFilter: Record<string, unknown>;
  }> = [
    {
      query: '查询安徽省的客户',
      expectedFilter: { field: 'province', value: '安徽', operator: 'eq' },
    },
    {
      query: '查询所有安徽省客户',
      expectedFilter: { field: 'province', value: '安徽', operator: 'eq' },
    },
    {
      query: '查询安徽省所有客户',
      expectedFilter: { field: 'province', value: '安徽', operator: 'eq' },
    },
    {
      query: '查询客户状态为潜在客户的客户',
      expectedFilter: { field: 'customer_status', value: '潜在客户', operator: 'eq' },
    },
    {
      query: '查询行业为制造业的客户',
      expectedFilter: { field: 'industry', value: '制造业', operator: 'eq' },
    },
    {
      query: '查询联系人手机为 13800138000 的客户',
      expectedFilter: { field: 'Nu_1', value: '13800138000' },
    },
    {
      query: '查询启用客户',
      expectedFilter: { field: '_S_DISABLE', value: '1', operator: 'eq' },
    },
  ];

  for (const item of cases) {
    const { response, searchInput } = await runCustomerSearchExtractionCase(item.query);

    assert.equal(response.executionState.status, 'completed');
    assert.deepEqual(searchInput.filters, [item.expectedFilter], item.query);
    assert.equal(
      searchInput.filters.some((filter: { field?: string }) => filter.field === '_S_NAME' || filter.field === 'customer_name'),
      false,
      item.query,
    );
    const searchExtraction = (response.message.extraInfo.agentTrace.selectedTool?.input.agentControl as any)?.searchExtraction;
    assert.equal(searchExtraction.conditions.length, 1, item.query);
    assert.equal(searchExtraction.conditions[0]?.field, item.expectedFilter.field, item.query);
  }
});

test('Agent runtime keeps customer name fallback when field value is not a standalone condition', async () => {
  const { response, searchInput } = await runCustomerSearchExtractionCase('查询安徽艳阳电气客户');

  assert.equal(response.executionState.status, 'completed');
  assert.deepEqual(searchInput.filters, [
    {
      field: 'customer_name',
      value: '安徽艳阳电气',
      operator: 'like',
    },
  ]);
});

test('Agent runtime treats collection scope words as unfiltered record search', async () => {
  const cases = ['查询所有客户', '查询全部客户', '查询客户列表'];

  for (const query of cases) {
    const { response, searchInput } = await runCustomerSearchExtractionCase(query);

    assert.equal(response.executionState.status, 'completed', query);
    assert.deepEqual(searchInput.filters, [], query);
    assert.equal(searchInput.pageNumber, 1, query);
    assert.equal(searchInput.pageSize, 5, query);
    assert.equal(
      response.message.extraInfo.agentTrace.selectedTool?.input.agentControl,
      undefined,
      query,
    );
  }
});

test('Agent runtime keeps pagination words out of record title fallback', async () => {
  const { response, searchInput } = await runCustomerSearchExtractionCase('查询所有客户，第2页，每页10条');

  assert.equal(response.executionState.status, 'completed');
  assert.deepEqual(searchInput.filters, []);
  assert.equal(searchInput.pageNumber, 2);
  assert.equal(searchInput.pageSize, 10);
});

test('Agent runtime clarifies ambiguous implicit record search field instead of title fallback', async () => {
  const fields = [
    ...createCustomerSearchFields(),
    createSearchField({
      fieldCode: 'Ra_9',
      label: '客户等级',
      widgetType: 'radioWidget',
      searchParameterKey: 'customer_level',
      options: [{ title: 'VIP客户', key: 'vip-level', value: 'VIP客户' }],
    }),
  ];
  const { response, searchInput } = await runCustomerSearchExtractionCase('查询VIP客户', fields);

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(searchInput, null);
  assert.match(response.message.content, /同时命中多个可查询字段/);
  const searchExtraction = (response.message.extraInfo.agentTrace.selectedTool?.input.agentControl as any)?.searchExtraction;
  assert.equal(searchExtraction.ambiguities[0]?.candidateFields.length, 2);
  assert.equal(searchExtraction.fallbackName, undefined);
});

test('Agent runtime probes existing customer before ambiguous company info request', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchInput = input;
        return {
          records: [
            {
              formInstId: 'customer-ahyy-001',
              title: '安徽艳阳电气集团有限公司',
              fields: [{ title: '客户名称', value: '安徽艳阳电气集团有限公司' }],
              rawRecord: {},
            },
          ],
        };
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
    conversationKey: 'conv-ambiguous-company-info-probe',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const question = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.equal(searchInput.agentControl, undefined);
  assert.equal(searchInput.filters?.[0]?.field, 'customer_name');
  assert.equal(searchInput.filters?.[0]?.value, '安徽艳阳电气集团有限公司');
  assert.match(response.message.content, /已找到已有客户/);
  assert.equal(question?.paramKey, 'next_action');
  assert.equal(question?.options?.some((item) => item.label === '查看客户信息'), true);
  assert.equal(question?.options?.some((item) => item.label === '查看已有研究'), false);
  assert.equal(question?.options?.some((item) => item.label === '进行公司研究'), true);
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.ruleCode, 'crm.subject_profile_lookup');
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.action, 'clarify');
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.probeResult?.count, 1);
  assert.equal(
    response.message.extraInfo.agentTrace.toolArbitration?.candidateTools.some((item) => item.toolCode === 'artifact.search'),
    false,
  );
  assert.equal(
    response.message.extraInfo.agentTrace.policyDecisions?.some((item) => item.policyCode === 'tool.semantic_arbitration_probe'),
    true,
  );
});

test('Agent runtime does not route unavailable existing research choice to company research', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let researchCalls = 0;
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({
        records: [
          {
            formInstId: 'customer-ahyy-001',
            title: '安徽艳阳电气集团有限公司',
            fields: [{ title: '客户名称', value: '安徽艳阳电气集团有限公司' }],
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    externalSkillService: {
      createSkillJob: async () => {
        researchCalls += 1;
        throw new Error('should not research unavailable existing research request');
      },
      getSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-unavailable-existing-research-choice',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;

  const response = await service.chat({
    conversationKey: 'conv-unavailable-existing-research-choice',
    sceneKey: 'chat',
    query: '查看已有研究',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        next_action: '查看已有研究',
      },
    },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.equal(response.message.extraInfo.agentTrace.continuationResolution?.action, 'wait_for_input');
  assert.match(response.message.extraInfo.agentTrace.continuationResolution?.reason ?? '', /尚未定义/);
  assert.match(response.message.content, /能力暂未开放/);
  assert.equal(researchCalls, 0);
});

test('Agent runtime routes ambiguous company info choice to customer get', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let getInput: any = null;
  const longTailMarker = '完整输出尾部标记-END';
  const longRecordPayload = `${'完整输出字段-'.repeat(700)}${longTailMarker}`;
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({
        records: [
          {
            formInstId: 'customer-ahyy-001',
            title: '安徽艳阳电气集团有限公司',
            fields: [{ title: '客户名称', value: '安徽艳阳电气集团有限公司' }],
            rawRecord: {},
          },
        ],
      }),
      executeGet: async (_objectKey: ShadowObjectKey, input: any) => {
        getInput = input;
        return {
          record: {
            formInstId: 'customer-ahyy-001',
            fields: [
              { title: '客户名称', value: '安徽艳阳电气集团有限公司' },
              { title: '客户状态', value: '销售线索阶段' },
              { title: '完整字段', value: longRecordPayload },
            ],
            rawRecord: {
              longRecordPayload,
            },
          },
        };
      },
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-ambiguous-company-info-view',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;

  const response = await service.chat({
    conversationKey: 'conv-ambiguous-company-info-view',
    sceneKey: 'chat',
    query: '查看客户信息',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        next_action: '查看客户信息',
      },
    },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.continuationResolution?.action, 'route_tool');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.get');
  assert.equal(getInput.formInstId, 'customer-ahyy-001');
  assert.match(response.message.content, /已查询到客户/);
  assert.doesNotMatch(response.message.content, /```json/);
  assert.doesNotMatch(response.message.content, new RegExp(longTailMarker));
  assert.equal(response.message.extraInfo.uiSurfaces?.[0]?.kind, 'record-detail');
  assert.equal(response.message.extraInfo.uiSurfaces?.[0]?.summary.displayMode, 'card');
  assert.match(
    JSON.stringify(response.message.extraInfo.uiSurfaces?.[0]?.rawResult),
    new RegExp(longTailMarker),
  );
});

test('Agent runtime routes ambiguous company info choice to company research', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const researchMocks = createCompanyResearchMocks({ companyName: '安徽艳阳电气集团有限公司' });
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({
        records: [
          {
            formInstId: 'customer-ahyy-001',
            title: '安徽艳阳电气集团有限公司',
            fields: [{ title: '客户名称', value: '安徽艳阳电气集团有限公司' }],
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    externalSkillService: researchMocks.externalSkillService,
    artifactService: researchMocks.artifactService,
  });

  const waiting = await service.chat({
    conversationKey: 'conv-ambiguous-company-info-research',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;

  const response = await service.chat({
    conversationKey: 'conv-ambiguous-company-info-research',
    sceneKey: 'chat',
    query: '进行公司研究',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        next_action: 'company_research',
      },
    },
  });

  const artifactCall = researchMocks.calls.find((item) => item.tool === 'artifact.company_research');
  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.continuationResolution?.action, 'route_tool');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'external.company_research');
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.conflictGroup, 'subject_profile_lookup');
  assert.match(response.message.content, /公司研究已完成/);
  assert.equal((artifactCall?.input as any)?.title, '安徽艳阳电气集团有限公司 公司研究');
});

test('Agent runtime asks before company research when ambiguous customer probe has no hit', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const researchCalls: Array<{ tool: string; input: unknown }> = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    externalSkillService: {
      createSkillJob: async () => {
        researchCalls.push({ tool: 'external.company_research.job', input: {} });
        throw new Error('should not auto research');
      },
      getSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-ambiguous-company-info-no-hit',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const question = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.match(response.message.content, /未查到已有客户/);
  assert.equal(question?.options?.some((item) => item.value === 'company_research'), true);
  assert.equal(researchCalls.length, 0);
});

test('Agent runtime keeps explicit customer info request on record search', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searched = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => {
        searched = true;
        return { records: [] };
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
    conversationKey: 'conv-explicit-customer-info',
    sceneKey: 'chat',
    query: '查看 安徽艳阳电气 客户资料',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.action, 'direct_tool');
  assert.equal(searched, true);
});

test('Agent runtime keeps explicit company research on company research tool', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchCount = 0;
  const researchMocks = createCompanyResearchMocks({ companyName: '安徽艳阳电气集团有限公司' });
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async () => {
        searchCount += 1;
        return { records: [] };
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    externalSkillService: researchMocks.externalSkillService,
    artifactService: researchMocks.artifactService,
  });

  const response = await service.chat({
    conversationKey: 'conv-explicit-company-research',
    sceneKey: 'chat',
    query: '研究 安徽艳阳电气集团有限公司',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'external.company_research');
  assert.equal(response.message.extraInfo.agentTrace.toolArbitration?.action, 'direct_tool');
  assert.equal(searchCount, 0);
});

test('Agent runtime previews record writeback before approve or reject decision', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let executeUpsertCount = 0;
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
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        executeUpsertCount += 1;
        return {
          objectKey: 'customer',
          operation: 'upsert',
          mode: 'live',
          writeMode: 'create',
          requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
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
  assert.equal(pending?.userPreview?.summaryRows[0]?.label, '客户名称');
  assert.equal(pending?.userPreview?.summaryRows[0]?.value, '测试客户');
  assert.match(preview.message.content, /客户名称：测试客户/);
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
  assert.match(approved.message.content, /已写入字段/);
  assert.match(approved.message.content, /建议继续补充/);
  assert.equal(executeUpsertCount, 1);
});

test('Agent runtime surfaces tool execution exceptions without HTTP-level failure', async () => {
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
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        throw new Error('上游记录系统暂时不可用');
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-record-tool-error',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  const approved = await service.chat({
    conversationKey: 'conv-record-tool-error',
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

  assert.equal(approved.executionState.status, 'tool_unavailable');
  assert.equal(approved.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.commit_create');
  assert.match(approved.message.content, /未生成本地替代结果/);
  assert.match(approved.message.content, /上游记录系统暂时不可用/);
  assert.equal(
    approved.message.extraInfo.agentTrace.policyDecisions?.some((item) => item.policyCode === 'runtime.tool_execution_error'),
    true,
  );
});

test('Agent runtime exposes upstream writeback diagnostics in content and trace', async () => {
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
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        throw new YzjApiError('写入轻云单据失败', {
          status: 200,
          payload: {
            success: false,
            errorCode: 0,
            data: {
              hasException: true,
              formInstIds: [null],
              exceptions: {
                '0': '1101032:主表单控件输入值类型错误',
              },
            },
          },
        });
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-record-upstream-diagnostic',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  const approved = await service.chat({
    conversationKey: 'conv-record-upstream-diagnostic',
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
  const failedToolCall = approved.message.extraInfo.agentTrace.toolCalls[0] as any;

  assert.equal(approved.executionState.status, 'tool_unavailable');
  assert.match(approved.message.content, /调试信息/);
  assert.match(approved.message.content, /1101032:主表单控件输入值类型错误/);
  assert.match(failedToolCall.outputSummary, /hasException=true/);
  assert.match(failedToolCall.outputSummary, /1101032:主表单控件输入值类型错误/);
  assert.equal(failedToolCall.errorDetails?.code, 'YZJ_API_ERROR');
  assert.deepEqual(failedToolCall.errorDetails?.details?.payload?.data?.exceptions, {
    '0': '1101032:主表单控件输入值类型错误',
  });
  assert.equal(
    approved.message.extraInfo.agentTrace.policyDecisions?.some((item) => (
      item.policyCode === 'runtime.tool_execution_error'
      && item.reason.includes('1101032:主表单控件输入值类型错误')
    )),
    true,
  );
});

test('Agent runtime retries transient duplicate check failure before record preview', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchAttempts = 0;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        searchAttempts += 1;
        if (searchAttempts === 1) {
          throw new Error('查询轻云单据列表失败');
        }
        return { records: [] };
      },
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
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-duplicate-check-retry',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(searchAttempts, 2);
  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[0]?.toolCode, 'record.customer.search');
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[0]?.status, 'succeeded');
  assert.ok(response.message.extraInfo.agentTrace.pendingConfirmation);
});

test('Agent runtime preserves filled input when duplicate check remains unavailable', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        throw new Error('查询轻云单据列表失败');
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('duplicate guard should stop preview');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-duplicate-check-unavailable',
    sceneKey: 'chat',
    query: '新增客户 测试客户 联系人姓名：陈丽 联系人手机：13612952100 启用状态：启用 客户类型：普通客户 客户状态：销售线索阶段 客户是否分配：未分配',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pendingInteraction = response.message.extraInfo.agentTrace.pendingInteraction;

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /写前查重暂时不可用/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[0]?.toolCode, 'record.customer.search');
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[0]?.status, 'failed');
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[1]?.toolCode, 'record.customer.preview_create');
  assert.equal(response.message.extraInfo.agentTrace.toolCalls[1]?.status, 'skipped');
  assert.equal(
    response.message.extraInfo.agentTrace.policyDecisions?.some((item) => item.policyCode === 'record.duplicate_check_unavailable'),
    true,
  );
  assert.equal(pendingInteraction?.toolCode, 'record.customer.preview_create');
  assert.equal((pendingInteraction?.partialInput?.params as Record<string, unknown>)?.contact_name, '陈丽');
  assert.equal((pendingInteraction?.partialInput?.params as Record<string, unknown>)?.contact_phone, '13612952100');
});

test('Agent runtime reuses successful duplicate check while collecting missing fields', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let executeSearchCount = 0;
  const required = ['contact_name'];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        executeSearchCount += 1;
        return { records: [] };
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        const params = input.params ?? {};
        const missing = required.filter((paramKey) => params[paramKey] === undefined);
        return {
          objectKey: 'customer',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: missing,
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: missing.length === 0,
          requestBody: {
            formCodeId: 'customer-form',
            data: [{ widgetValue: missing.length === 0 ? { _S_NAME: '测试客户', Te_5: params.contact_name } : { _S_NAME: '测试客户' } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-duplicate-check-cache',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;

  const continued = await service.chat({
    conversationKey: 'conv-duplicate-check-cache',
    sceneKey: 'chat',
    query: '联系人姓名：陈丽',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        contact_name: '陈丽',
      },
    },
  });

  assert.equal(executeSearchCount, 1);
  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(continued.message.extraInfo.agentTrace.toolCalls[0]?.toolCode, 'record.customer.search');
  assert.equal(continued.message.extraInfo.agentTrace.toolCalls[0]?.status, 'skipped');
  assert.match(continued.message.extraInfo.agentTrace.toolCalls[0]?.outputSummary ?? '', /复用当前等待态/);
});

test('Agent runtime does not tight-retry rate-limited duplicate check and surfaces upstream message', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let executeSearchCount = 0;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        executeSearchCount += 1;
        throw new YzjApiError('查询轻云单据列表失败', {
          status: 200,
          payload: {
            data: null,
            error: '请求过于频繁',
            errorCode: 10000429,
            success: false,
          },
        });
      },
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('duplicate guard should stop preview');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-duplicate-check-rate-limited',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(executeSearchCount, 1);
  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /message=请求过于频繁/);
  assert.match(response.message.extraInfo.agentTrace.toolCalls[0]?.outputSummary ?? '', /message=请求过于频繁/);
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
          requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: companyName } }] },
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

test('Agent runtime surfaces missing required record fields with user-readable labels', async () => {
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
        missingRequiredParams: ['customer_status', 'contact_phone'],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-missing-required-preview',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /客户状态/);
  assert.match(response.message.content, /联系人手机/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
});

test('Agent runtime returns Meta Question Card with field options for missing enum fields', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      getObject: () => ({
        fields: [
          {
            fieldCode: 'Ra_0',
            label: '客户状态',
            widgetType: 'radioWidget',
            writeParameterKey: 'customer_status',
            options: [
              { title: '销售线索阶段', value: '销售线索阶段', key: 'lead' },
              { title: '已成交客户', value: '已成交客户', key: 'won' },
            ],
          },
          {
            fieldCode: 'Ra_3',
            label: '客户类型',
            widgetType: 'radioWidget',
            writeParameterKey: 'customer_type',
            options: [
              { title: '普通客户', value: '普通客户', key: 'normal' },
              { title: 'VIP客户', value: 'VIP客户', key: 'vip' },
            ],
          },
        ],
      }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'customer',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: ['customer_status', 'customer_type'],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-question-card-options',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  const questionCard = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard;
  assert.equal(response.executionState.status, 'waiting_input');
  assert.ok(questionCard);
  assert.equal(questionCard?.toolCode, 'record.customer.preview_create');
  assert.equal(questionCard?.questions.find((item) => item.paramKey === 'customer_status')?.type, 'single_select');
  assert.deepEqual(
    questionCard?.questions.find((item) => item.paramKey === 'customer_status')?.options?.map((item) => item.label),
    ['销售线索阶段', '已成交客户'],
  );
});

test('Agent runtime resumes waiting input from structured Meta Question answers', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const previewInputs: any[] = [];
  const required = ['contact_name', 'contact_phone', 'enabled_state', 'customer_type', 'customer_status', 'Ra_1'];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      getObject: () => ({
        fields: [
          { fieldCode: 'Te_5', label: '联系人姓名', widgetType: 'textWidget', writeParameterKey: 'contact_name', options: [] },
          { fieldCode: 'Nu_1', label: '联系人手机', widgetType: 'numberWidget', writeParameterKey: 'contact_phone', options: [] },
          {
            fieldCode: '_S_DISABLE',
            label: '启用状态',
            widgetType: 'switchWidget',
            writeParameterKey: 'enabled_state',
            options: [
              { title: '开启', value: '开启', key: '1' },
              { title: '关闭', value: '关闭', key: '0' },
            ],
          },
          { fieldCode: 'Ra_3', label: '客户类型', widgetType: 'radioWidget', writeParameterKey: 'customer_type', options: [{ title: '普通客户', value: '普通客户', key: 'normal' }] },
          { fieldCode: 'Ra_0', label: '客户状态', widgetType: 'radioWidget', writeParameterKey: 'customer_status', options: [{ title: '销售线索阶段', value: '销售线索阶段', key: 'lead' }] },
          { fieldCode: 'Ra_1', label: '客户是否分配', widgetType: 'radioWidget', writeParameterKey: 'Ra_1', options: [{ title: '已分配', value: '已分配', key: 'assigned' }] },
        ],
      }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewInputs.push(input);
        const params = input.params ?? {};
        const missing = required.filter((paramKey) => params[paramKey] === undefined);
        return {
          objectKey: 'customer',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: missing,
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: missing.length === 0,
          requestBody: {
            formCodeId: 'customer-form',
            data: [{ widgetValue: missing.length === 0 ? { _S_NAME: '测试客户', Te_5: params.contact_name } : { _S_NAME: '测试客户' } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-question-card-resume',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  const enabledStateQuestion = pending?.questionCard?.questions.find((item) => item.paramKey === 'enabled_state');
  assert.deepEqual(enabledStateQuestion?.options?.map((item) => item.value), ['1', '0']);

  const continued = await service.chat({
    conversationKey: 'conv-question-card-resume',
    sceneKey: 'chat',
    query: '联系人姓名：陈丽，联系人手机：13612952100，启用状态：开启，客户类型：普通客户，客户状态：销售线索阶段，客户是否分配：已分配',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        contact_name: '陈丽',
        contact_phone: '13612952100',
        enabled_state: '1',
        customer_type: '普通客户',
        customer_status: '销售线索阶段',
        Ra_1: '已分配',
      },
    },
  });

  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(continued.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_create');
  assert.equal(continued.message.extraInfo.agentTrace.continuationResolution?.action, 'resume_pending_interaction');
  assert.equal(previewInputs.at(-1)?.params.contact_name, '陈丽');
  assert.equal(previewInputs.at(-1)?.params.enabled_state, '1');
  assert.equal(previewInputs.at(-1)?.params.customer_status, '销售线索阶段');
  assert.equal(
    continued.message.extraInfo.agentTrace.pendingConfirmation?.userPreview?.summaryRows.find((row) => row.paramKey === 'enabled_state')?.value,
    '开启',
  );
});

test('Agent runtime blocks ready record preview when write payload is empty', async () => {
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
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: {} }] },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-empty-preview-guard',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /写入预览被守卫阻断/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
  assert.equal(
    response.message.extraInfo.agentTrace.policyDecisions?.some((item) => item.policyCode === 'record.preview_empty_payload_guard'),
    true,
  );
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
  assert.match(response.message.content, /标题/);
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
        requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: '测试客户' } }] },
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

test('Agent runtime binds contextual record id for update preview without asking user for formInstId', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  seedRecordContext(repository, {
    conversationKey: 'conv-contextual-customer-update',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '安徽艳阳电气集团有限公司',
  });
  const previewInputs: any[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      getObject: () => ({
        fields: [
          {
            fieldCode: 'Pw_0',
            label: '省',
            widgetType: 'publicOptBoxWidget',
            writeParameterKey: 'province',
            options: [{ title: '安徽', dicId: 'dic-province-ah' }],
          },
          {
            fieldCode: 'Pw_1',
            label: '市',
            widgetType: 'publicOptBoxWidget',
            writeParameterKey: 'city',
            options: [{ title: '合肥', dicId: 'dic-city-hf' }],
          },
          {
            fieldCode: 'Pw_2',
            label: '区',
            widgetType: 'publicOptBoxWidget',
            writeParameterKey: 'district',
            options: [{ title: '蜀山区', dicId: 'dic-district-ss' }],
          },
        ],
      }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewInputs.push(input);
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
          requestBody: {
            formCodeId: 'customer-form',
            data: [{ widgetValue: { Pw_0: [{ title: '安徽', dicId: 'dic-province-ah' }] } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-contextual-customer-update',
    sceneKey: 'chat',
    query: '这是安徽客户，请修改省市区信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_update');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-live-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { province: '安徽' });
  assert.equal(response.message.content.includes('form_inst_id'), false);
  assert.equal(
    response.message.extraInfo.agentTrace.pendingConfirmation?.userPreview?.summaryRows.find((row) => row.paramKey === 'province')?.value,
    '安徽',
  );
});

test('Agent runtime hides internal formInstId requirement when update has no record context', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let previewCalled = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        previewCalled = true;
        throw new Error('update identity guard should stop preview');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-update-no-record-context',
    sceneKey: 'chat',
    query: '修改客户状态为潜在客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /需要先确定要修改的记录/);
  assert.equal(response.message.content.includes('form_inst_id'), false);
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard, undefined);
  assert.equal(previewCalled, false);
});

test('Agent runtime extracts metadata-driven opportunity update fields from current record context', async () => {
  const owner = createEmployeeCandidate({
    openId: 'open-chen-weitang',
    name: '陈伟堂',
    phone: '13800000001',
    email: 'chenweitang@example.com',
  });
  const cases: Array<{
    query: string;
    expectedParams: Record<string, unknown>;
    widgetValue: Record<string, unknown>;
  }> = [
    {
      query: '更新预算为5000000',
      expectedParams: { opportunity_budget: 5000000 },
      widgetValue: { Mo_0: 5000000 },
    },
    {
      query: '更新商机预算改成500万',
      expectedParams: { opportunity_budget: 5000000 },
      widgetValue: { Mo_0: 5000000 },
    },
    {
      query: '预计成交时间为2026-06-30',
      expectedParams: { expected_close_date: '2026-06-30' },
      widgetValue: { Da_0: '2026-06-30' },
    },
    {
      query: '销售阶段改为初期沟通',
      expectedParams: { sales_stage: 'initial' },
      widgetValue: { Ra_0: 'initial' },
    },
    {
      query: '更新销售负责人为陈伟堂',
      expectedParams: {
        owner_open_id: {
          open_id: 'open-chen-weitang',
          name: '陈伟堂',
          phone: '13800000001',
          email: 'chenweitang@example.com',
        },
      },
      widgetValue: { Ps_0: ['open-chen-weitang'] },
    },
  ];

  for (const item of cases) {
    const repository = new AgentRunRepository(createInMemoryDatabase());
    const conversationKey = `conv-opportunity-update-${Math.random().toString(16).slice(2)}`;
    let previewInput: any = null;
    seedRecordContext(repository, {
      conversationKey,
      objectKey: 'opportunity',
      formInstId: 'opportunity-live-001',
      name: '数字化经营项目',
    });
    const { service } = createAgentTestService({
      repository,
      intentFrame: recordIntent('opportunity', 'write', '这个商机'),
      shadowMetadataService: {
        getObject: () => ({ fields: createOpportunityWriteFields() }),
        executeSearch: async () => ({ records: [] }),
        executeGet: async () => ({ record: null }),
        previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
          previewInput = input;
          return {
            objectKey: 'opportunity',
            operation: 'upsert',
            unresolvedDictionaries: [],
            resolvedDictionaryMappings: [],
            missingRequiredParams: [],
            blockedReadonlyParams: [],
            missingRuntimeInputs: [],
            validationErrors: [],
            readyToSend: true,
            requestBody: {
              formCodeId: 'opportunity-form',
              data: [{ widgetValue: item.widgetValue }],
            },
          };
        },
        executeUpsert: async () => {
          throw new Error('not used');
        },
      },
      orgSyncRepository: createEmployeeLookup([owner]),
    });

    const response = await service.chat({
      conversationKey,
      sceneKey: 'chat',
      query: item.query,
      tenantContext: { operatorOpenId: 'operator-001' },
    });

    assert.equal(response.executionState.status, 'waiting_confirmation', item.query);
    assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.opportunity.preview_update', item.query);
    assert.equal(previewInput.formInstId, 'opportunity-live-001', item.query);
    assert.deepEqual(previewInput.params, item.expectedParams, item.query);
    if (item.query.includes('销售负责人')) {
      assert.match(response.message.content, /陈伟堂/);
      assert.equal(response.message.content.includes('open-chen-weitang'), false);
    }
    assert.equal(
      response.message.extraInfo.agentTrace.policyDecisions?.some((policy) => policy.policyCode === 'record.preview_empty_payload_guard'),
      false,
      item.query,
    );
  }
});

test('Agent runtime keeps context-bound opportunity update when LLM mislabels write target as company', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-opportunity-owner-context-write';
  const owner = createEmployeeCandidate({
    openId: 'open-chen-weitang',
    name: '陈伟堂',
    phone: '13800000001',
    email: 'chenweitang@example.com',
  });
  let previewInput: any = null;
  seedRecordContext(repository, {
    conversationKey,
    objectKey: 'opportunity',
    formInstId: 'opportunity-live-001',
    name: '数字化经营项目',
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyWriteIntent(),
    shadowMetadataService: {
      getObject: () => ({ fields: createOpportunityWriteFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewInput = input;
        return {
          objectKey: 'opportunity',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: [],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: true,
          requestBody: {
            formCodeId: 'opportunity-form',
            data: [{ widgetValue: { Ps_0: ['open-chen-weitang'] } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: createEmployeeLookup([owner]),
  });

  const response = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '更新销售负责人为陈伟堂',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.equal(response.message.extraInfo.agentTrace.intentFrame.targetType, 'opportunity');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.opportunity.preview_update');
  assert.equal(previewInput.formInstId, 'opportunity-live-001');
  assert.deepEqual(previewInput.params, {
    owner_open_id: {
      open_id: 'open-chen-weitang',
      name: '陈伟堂',
      phone: '13800000001',
      email: 'chenweitang@example.com',
    },
  });
});

test('Agent runtime asks for clarification when personSelectWidget value matches multiple employees', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-opportunity-owner-ambiguous';
  const employees = [
    createEmployeeCandidate({
      openId: 'open-chen-weirong',
      name: '陈伟荣',
      phone: '13800000002',
      email: 'chenweirong@example.com',
    }),
    createEmployeeCandidate({
      openId: 'open-chen-weigang',
      name: '陈伟刚',
      phone: '13800000003',
      email: 'chenweigang@example.com',
    }),
  ];
  let previewInput: any = null;
  let previewCallCount = 0;
  seedRecordContext(repository, {
    conversationKey,
    objectKey: 'opportunity',
    formInstId: 'opportunity-live-001',
    name: '数字化经营项目',
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('opportunity', 'write', '这个商机'),
    shadowMetadataService: {
      getObject: () => ({ fields: createOpportunityWriteFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewCallCount += 1;
        previewInput = input;
        return {
          objectKey: 'opportunity',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: [],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: true,
          requestBody: {
            formCodeId: 'opportunity-form',
            data: [{ widgetValue: { Ps_0: [input.params.owner_open_id.open_id] } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: createEmployeeLookup(employees),
  });

  const waiting = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '更新销售负责人为陈伟',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  const question = pending?.questionCard?.questions[0];

  assert.equal(waiting.executionState.status, 'waiting_input');
  assert.equal(previewCallCount, 0);
  assert.equal(question?.type, 'reference');
  assert.equal(question?.lookup?.source, 'employee');
  assert.deepEqual(
    question?.options?.map((option) => option.value),
    ['open-chen-weirong', 'open-chen-weigang'],
  );
  assert.deepEqual(
    question?.options?.map((option) => option.label),
    ['陈伟荣 · 13800000002 · chenweirong@example.com', '陈伟刚 · 13800000003 · chenweigang@example.com'],
  );
  assert.equal(question?.options?.some((option) => option.label.includes('open-chen')), false);

  const continued = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '选择陈伟刚',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        owner_open_id: 'open-chen-weigang',
      },
    },
  });

  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(previewCallCount, 1);
  assert.deepEqual(previewInput.params, {
    owner_open_id: {
      open_id: 'open-chen-weigang',
      name: '陈伟刚',
      phone: '13800000003',
      email: 'chenweigang@example.com',
    },
  });
});

test('Agent runtime blocks personSelectWidget preview when employee lookup has no match', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-opportunity-owner-not-found';
  let previewCalled = false;
  seedRecordContext(repository, {
    conversationKey,
    objectKey: 'opportunity',
    formInstId: 'opportunity-live-001',
    name: '数字化经营项目',
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('opportunity', 'write', '这个商机'),
    shadowMetadataService: {
      getObject: () => ({ fields: createOpportunityWriteFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        previewCalled = true;
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: createEmployeeLookup([]),
  });

  const response = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '更新销售负责人为不存在的人',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const question = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(previewCalled, false);
  assert.equal(question?.type, 'reference');
  assert.equal(question?.lookup?.source, 'employee');
  assert.match(response.message.content, /未在组织员工表中找到/);
  assert.equal(
    response.message.extraInfo.agentTrace.policyDecisions?.some((policy) => policy.policyCode === 'record.person_resolution_not_found'),
    true,
  );
});

test('Agent runtime resolves personSelectWidget fields generically beyond opportunity owner', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const serviceRep = createEmployeeCandidate({
    openId: 'open-service-rep-1',
    name: '陈伟堂',
    phone: '13800000001',
    email: 'chenweitang@example.com',
  });
  let previewInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '测试客户'),
    shadowMetadataService: {
      getObject: () => ({ fields: createCustomerWritePersonFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewInput = input;
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
          requestBody: {
            formCodeId: 'customer-form',
            data: [{ widgetValue: { _S_NAME: input.params.customer_name, Ps_service: [input.params.service_rep_open_id.open_id] } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: createEmployeeLookup([serviceRep]),
  });

  const response = await service.chat({
    conversationKey: 'conv-customer-service-rep-person-resolution',
    sceneKey: 'chat',
    query: '新增客户 测试客户 售后服务代表为陈伟堂',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.deepEqual(previewInput.params.service_rep_open_id, {
    open_id: 'open-service-rep-1',
    name: '陈伟堂',
    phone: '13800000001',
    email: 'chenweitang@example.com',
  });
  assert.equal(response.message.content.includes('open-service-rep-1'), false);
});

test('Agent runtime marks missing followup reference fields as remote lookup questions', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '跟进记录'),
    shadowMetadataService: {
      listObjects: () => [
        { objectKey: 'customer', formCodeId: 'customer-form' },
        { objectKey: 'followup', formCodeId: 'followup-form' },
      ],
      getObject: () => ({ fields: createFollowupWriteFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'followup',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: ['followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'followup_record'],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: {
          formCodeId: 'followup-form',
          data: [{ widgetValue: {} }],
        },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-followup-reference-lookup-card',
    sceneKey: 'chat',
    query: '新增跟进记录',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const questions = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions ?? [];
  const customerQuestion = questions.find((question) => question.paramKey === 'linked_customer_form_inst_id');
  const ownerQuestion = questions.find((question) => question.paramKey === 'owner_open_id');
  const methodQuestion = questions.find((question) => question.paramKey === 'followup_method');

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(customerQuestion?.type, 'reference');
  assert.equal(customerQuestion?.lookup?.source, 'record');
  assert.equal(customerQuestion?.lookup?.targetObjectKey, 'customer');
  assert.equal(customerQuestion?.lookup?.allowFreeText, false);
  assert.equal(ownerQuestion?.type, 'reference');
  assert.equal(ownerQuestion?.lookup?.source, 'employee');
  assert.equal(ownerQuestion?.lookup?.allowFreeText, false);
  assert.equal(methodQuestion?.type, 'single_select');
});

test('Agent meta question options search employees and customer records', async () => {
  const employees = [
    createEmployeeCandidate({
      openId: 'open-chen-1',
      name: '陈伟荣',
      phone: '13800000002',
      email: 'chenweirong@example.com',
    }),
  ];
  const searchInputs: any[] = [];
  const shadowMetadataService = {
    listObjects: () => [
      { objectKey: 'customer', formCodeId: 'customer-form' },
      { objectKey: 'followup', formCodeId: 'followup-form' },
    ],
    getObject: (objectKey: ShadowObjectKey) => ({
      fields: objectKey === 'followup' ? createFollowupWriteFields() : createCustomerLookupFields(),
    }),
    executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
      searchInputs.push(input);
      const hasProvinceFilter = input.filters?.some((filter: any) => filter.field === 'province');
      const hasNameFilter = input.filters?.some((filter: any) => filter.field === 'customer_name');
      return {
        records: [
          ...(hasProvinceFilter ? [{
            formInstId: 'customer-ah-province-001',
            fields: [{ title: '客户名称', value: '合肥样板客户' }, { title: '省', value: '安徽' }],
            rawRecord: {},
          }] : []),
          ...(hasNameFilter ? [{
            formInstId: 'customer-ah-name-001',
            fields: [{ title: '客户名称', value: '安徽好客户' }],
            rawRecord: {},
          }] : []),
        ],
        totalElements: 1,
        pageNumber: 1,
        pageSize: input.pageSize,
        totalPages: 1,
      };
    },
  };

  const employeeResponse = await buildMetaQuestionOptionsResponse({
    config: createTestConfig(),
    shadowMetadataService: shadowMetadataService as any,
    orgSyncRepository: createEmployeeLookup(employees),
    request: {
      toolCode: 'record.followup.preview_create',
      paramKey: 'owner_open_id',
      keyword: '陈',
      pageSize: 10,
    },
  });
  assert.deepEqual(employeeResponse.options.map((option) => option.value), ['open-chen-1']);
  assert.equal(employeeResponse.options[0]?.source, 'employee');
  assert.match(employeeResponse.options[0]?.label ?? '', /陈伟荣/);

  const customerResponse = await buildMetaQuestionOptionsResponse({
    config: createTestConfig(),
    shadowMetadataService: shadowMetadataService as any,
    orgSyncRepository: createEmployeeLookup([]),
    request: {
      toolCode: 'record.followup.preview_create',
      paramKey: 'linked_customer_form_inst_id',
      keyword: '安徽',
      pageSize: 10,
      tenantContext: { operatorOpenId: 'operator-001' },
    },
  });
  assert.equal(customerResponse.options.length, 2);
  assert.deepEqual(
    customerResponse.options.map((option) => option.value),
    ['customer-ah-province-001', 'customer-ah-name-001'],
  );
  assert.equal(customerResponse.options.every((option) => option.source === 'record'), true);
  assert.equal(searchInputs.some((input) => input.filters?.some((filter: any) => filter.field === 'province')), true);
  assert.equal(searchInputs.some((input) => input.filters?.some((filter: any) => filter.field === 'customer_name')), true);
});

test('Agent runtime requires selecting basicDataWidget candidates before followup preview', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const owner = createEmployeeCandidate({
    openId: 'open-followup-owner',
    name: '陈伟堂',
    phone: '13800000001',
    email: 'chenweitang@example.com',
  });
  let previewCallCount = 0;
  let previewInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '跟进记录'),
    shadowMetadataService: {
      listObjects: () => [
        { objectKey: 'customer', formCodeId: 'customer-form' },
        { objectKey: 'followup', formCodeId: 'followup-form' },
      ],
      getObject: (objectKey: ShadowObjectKey) => ({
        fields: objectKey === 'followup' ? createFollowupWriteFields() : createCustomerLookupFields(),
      }),
      executeSearch: async () => ({
        records: [{
          formInstId: 'customer-ah-001',
          fields: [{ title: '客户名称', value: '安徽好客户' }],
          rawRecord: {},
        }],
        totalElements: 1,
        pageNumber: 1,
        pageSize: 10,
        totalPages: 1,
      }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewCallCount += 1;
        previewInput = input;
        const params = input.params ?? {};
        const missing = ['linked_customer_form_inst_id', 'owner_open_id']
          .filter((paramKey) => params[paramKey] === undefined);
        return {
          objectKey: 'followup',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: missing,
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: missing.length === 0,
          requestBody: {
            formCodeId: 'followup-form',
            data: [{ widgetValue: missing.length ? {} : { Bd_customer: [params.linked_customer_form_inst_id], Ps_owner: [params.owner_open_id.open_id] } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: createEmployeeLookup([owner]),
  });

  const waiting = await service.chat({
    conversationKey: 'conv-followup-reference-selection',
    sceneKey: 'chat',
    query: '新增跟进记录',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  const blocked = await service.chat({
    conversationKey: 'conv-followup-reference-selection',
    sceneKey: 'chat',
    query: '客户编号：安徽，跟进负责人：陈伟堂',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        linked_customer_form_inst_id: '安徽',
        owner_open_id: 'open-followup-owner',
      },
    },
  });

  assert.equal(blocked.executionState.status, 'waiting_input');
  assert.equal(previewCallCount, 1);
  const blockedQuestion = blocked.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];
  assert.equal(blockedQuestion?.paramKey, 'linked_customer_form_inst_id');
  assert.equal(blockedQuestion?.lookup?.source, 'record');
  assert.deepEqual(blockedQuestion?.options?.map((option) => option.value), ['customer-ah-001']);

  const continued = await service.chat({
    conversationKey: 'conv-followup-reference-selection',
    sceneKey: 'chat',
    query: '选择安徽好客户',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: blocked.executionState.runId,
      action: 'provide_input',
      interactionId: blocked.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: {
        linked_customer_form_inst_id: 'customer-ah-001',
      },
    },
  });

  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(previewCallCount, 2);
  assert.equal(previewInput.params.linked_customer_form_inst_id, 'customer-ah-001');
  assert.equal(previewInput.params.owner_open_id.open_id, 'open-followup-owner');
});

test('Agent runtime resumes persisted followup question card without parsing option descriptions as search', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const owner = createEmployeeCandidate({
    openId: 'open-followup-owner',
    name: '陈伟棠',
    phone: '13612952187',
    email: 'weitang_chen@example.com',
  });
  let previewInput: any = null;
  const shadowMetadataService = {
    listObjects: () => [
      { objectKey: 'customer', formCodeId: 'customer-form' },
      { objectKey: 'followup', formCodeId: 'followup-form' },
    ],
    getObject: (objectKey: ShadowObjectKey) => ({
      fields: objectKey === 'followup' ? createFollowupWriteFields() : createCustomerLookupFields(),
    }),
    executeSearch: async () => ({ records: [] }),
    executeGet: async () => ({ record: null }),
    previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
      previewInput = input;
      const params = input.params ?? {};
      const missing = ['linked_customer_form_inst_id', 'owner_open_id', 'followup_method', 'followup_record']
        .filter((paramKey) => params[paramKey] === undefined);
      return {
        objectKey: 'followup',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: missing,
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: missing.length === 0,
        requestBody: {
          formCodeId: 'followup-form',
          data: [{ widgetValue: missing.length ? {} : { Bd_customer: [params.linked_customer_form_inst_id], Ps_owner: [params.owner_open_id.open_id], Tx_record: params.followup_record } }],
        },
      };
    },
    executeUpsert: async () => {
      throw new Error('not used');
    },
  };
  const createService = () => createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '跟进记录'),
    shadowMetadataService,
    orgSyncRepository: createEmployeeLookup([owner]),
  }).service;

  const waiting = await createService().chat({
    conversationKey: 'conv-followup-persisted-question-resume',
    sceneKey: 'chat',
    query: '新增跟进记录',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  assert.ok(pending?.questionCard);

  const resumed = await createService().chat({
    conversationKey: 'conv-followup-persisted-question-resume',
    sceneKey: 'chat',
    query: '跟进负责人：陈伟棠，客户编号：安徽艳阳电气集团有限公司，客户状态：商机阶段客户，跟进方式：上门，跟进记录：已上门拜访',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        linked_customer_form_inst_id: 'customer-ah-001',
        owner_open_id: 'open-followup-owner',
        followup_method: '上门',
        followup_record: '已上门拜访',
      },
    },
  });

  assert.equal(resumed.executionState.status, 'waiting_confirmation');
  assert.equal(previewInput.params.linked_customer_form_inst_id, 'customer-ah-001');
  assert.equal(previewInput.params.owner_open_id.open_id, 'open-followup-owner');
  assert.equal(previewInput.params.followup_record, '已上门拜访');
  assert.doesNotMatch(resumed.message.content, /已识别到字段「客户状态」/);
});

test('Agent runtime rejects stale meta question submissions instead of replanning as record search', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: ({ query }) => query.includes('跟进')
      ? recordIntent('followup', 'write', '跟进记录')
      : recordIntent('customer', 'query', '客户'),
    shadowMetadataService: {
      listObjects: () => [
        { objectKey: 'customer', formCodeId: 'customer-form' },
        { objectKey: 'followup', formCodeId: 'followup-form' },
      ],
      getObject: (objectKey: ShadowObjectKey) => ({
        fields: objectKey === 'followup' ? createFollowupWriteFields() : createCustomerLookupFields(),
      }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'followup',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: ['followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'followup_record'],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: false,
        requestBody: {
          formCodeId: 'followup-form',
          data: [{ widgetValue: {} }],
        },
      }),
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-stale-meta-question-submit',
    sceneKey: 'chat',
    query: '新增跟进记录',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const stalePending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  assert.ok(stalePending?.questionCard);

  const latestWaiting = await service.chat({
    conversationKey: 'conv-stale-meta-question-submit',
    sceneKey: 'chat',
    query: '查询客户状态为商机阶段客户的客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.match(latestWaiting.message.content, /已识别到字段「客户状态」/);

  const staleSubmit = await service.chat({
    conversationKey: 'conv-stale-meta-question-submit',
    sceneKey: 'chat',
    query: '跟进负责人：陈伟棠，客户编号：安徽艳阳电气集团有限公司，客户状态：商机阶段客户，跟进方式：上门',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: stalePending!.interactionId,
      answers: {
        linked_customer_form_inst_id: 'customer-ah-001',
        owner_open_id: 'open-followup-owner',
        followup_method: '上门',
      },
    },
  });

  assert.equal(staleSubmit.executionState.status, 'waiting_input');
  assert.match(staleSubmit.message.content, /这张补充卡已不是当前等待项/);
  assert.doesNotMatch(staleSubmit.message.content, /已识别到字段「客户状态」/);
});

test('Agent run repository prefers persisted context subject over legacy intent fallback', () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  seedRecordContext(repository, {
    conversationKey: 'conv-persisted-context',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '上海松井机械有限公司',
  });

  const context = repository.findContextFrame('conv-persisted-context');

  assert.equal(context?.subject?.type, 'customer');
  assert.equal(context?.subject?.id, 'customer-live-001');
  assert.equal(context?.subject?.name, '上海松井机械有限公司');
});

test('Agent run repository skips opaque external id context and keeps recent record subject', () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-skip-opaque-external-context';
  const formInstId = '69f16bc40f31d40001b288bd';
  seedRecordContext(repository, {
    conversationKey,
    objectKey: 'opportunity',
    formInstId,
    name: '数字化经营项目',
  });
  seedCompanyContext(repository, conversationKey, formInstId);

  const context = repository.findContextFrame(conversationKey);

  assert.equal(context?.subject?.kind, 'record');
  assert.equal(context?.subject?.type, 'opportunity');
  assert.equal(context?.subject?.id, formInstId);
});

test('Agent runtime uses subject-bound relation filter for contextual contact search', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  seedRecordContext(repository, {
    conversationKey: 'conv-contextual-contact-search',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '上海松井机械有限公司',
  });
  let receivedFilters: Array<{ field: string; value: string; operator: string }> = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('contact', 'query', '这个'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        receivedFilters = input.filters ?? [];
        return { records: [] };
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
    conversationKey: 'conv-contextual-contact-search',
    sceneKey: 'chat',
    query: '查询这个客户的联系人',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.contact.search');
  assert.deepEqual(receivedFilters, [
    {
      field: 'linked_customer_form_inst_id',
      value: 'customer-live-001',
      operator: 'eq',
    },
  ]);
});

test('Agent runtime keeps subject-bound parent context after child record write', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  seedRecordContext(repository, {
    conversationKey: 'conv-child-write-parent-context',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '上海松井机械有限公司',
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('contact', 'write', '王松井'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        objectKey: 'contact',
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: { formCodeId: 'contact-form', data: [{ widgetValue: { _S_NAME: '王松井' } }] },
      }),
      executeUpsert: async () => ({
        objectKey: 'contact',
        operation: 'upsert',
        mode: 'live',
        writeMode: 'create',
        requestBody: { formCodeId: 'contact-form', data: [{ widgetValue: { _S_NAME: '王松井' } }] },
        formInstIds: ['contact-live-001'],
      }),
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-child-write-parent-context',
    sceneKey: 'chat',
    query: '新增联系人 王松井 手机：13612952187 启用状态：启用 关联客户：customer-live-001',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  const approved = await service.chat({
    conversationKey: 'conv-child-write-parent-context',
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
  const context = repository.findContextFrame('conv-child-write-parent-context');
  assert.equal(context?.subject?.type, 'customer');
  assert.equal(context?.subject?.id, 'customer-live-001');
  assert.equal(context?.subject?.name, '上海松井机械有限公司');
});

test('Agent runtime summarizes customer journey from current context', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  seedRecordContext(repository, {
    conversationKey: 'conv-context-summary',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '上海松井机械有限公司',
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '这个客户'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => ({
        objectKey,
        operation: 'search',
        mode: 'live',
        requestBody: {},
        pageNumber: 1,
        pageSize: 5,
        totalPages: 1,
        totalElements: objectKey === 'contact' ? 2 : objectKey === 'opportunity' ? 1 : 1,
        records: objectKey === 'contact'
          ? [
              {
                formInstId: 'contact-001',
                fields: [
                  { title: '联系人姓名', value: '王松井' },
                  { title: '手机', value: '13612952187' },
                ],
                rawRecord: {},
              },
              {
                formInstId: 'contact-002',
                fields: [
                  { title: '联系人姓名', value: '赵影子' },
                  { title: '手机', value: '13800000000' },
                ],
                rawRecord: {},
              },
            ]
          : objectKey === 'opportunity'
            ? [
                {
                  formInstId: 'opp-001',
                  fields: [
                    { title: '机会名称', value: '松井年度采购项目' },
                    { title: '销售阶段', value: '方案沟通' },
                    { title: '预计成交时间', value: '2026-06-30' },
                  ],
                  rawRecord: {},
                },
              ]
            : [
                {
                  formInstId: 'followup-001',
                  fields: [
                    { title: '跟进记录', value: '已完成方案演示' },
                    { title: '跟进方式', value: '现场拜访' },
                  ],
                  rawRecord: {},
                },
              ],
      }),
      executeGet: async () => ({
        record: {
          formInstId: 'customer-live-001',
          fields: [
            { title: '客户名称', value: '上海松井机械有限公司' },
            { title: '客户编码', value: 'KH-20260422-001' },
            { title: '客户状态', value: '已成交客户' },
            { title: '客户类型', value: '合作伙伴' },
            { title: '销售负责人', value: '陈伟堂' },
            { title: '最后跟进日期', value: '2026-04-25' },
            { title: '下次回访日期', value: '2026-05-15 上午' },
            { title: '省', value: '' },
            { title: '市', value: '' },
            { title: '区', value: '' },
          ],
          rawRecord: {},
        },
      }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-summary',
    sceneKey: 'chat',
    query: '请从金蝶苏州销售员视角，列出这个客户的客户旅程',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.match(response.message.content, /客户旅程摘要/);
  assert.match(response.message.content, /上海松井机械有限公司/);
  assert.match(response.message.content, /联系人：2 条/);
  assert.match(response.message.content, /商机：1 条/);
  assert.match(response.message.content, /跟进记录：1 条/);
  assert.match(response.message.content, /建议继续补充省、市、区/);
});
