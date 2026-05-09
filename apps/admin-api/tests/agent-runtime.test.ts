import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function pollutedRecordQueryIntent(
  objectKey: ShadowObjectKey,
  pollutedTarget: string,
  targetType: IntentFrame['targets'][number]['type'] = 'company',
): IntentFrame {
  return {
    actionType: 'query',
    goal: `查询 ${objectKey}`,
    targetType: objectKey,
    targets: [{ type: targetType, id: pollutedTarget, name: pollutedTarget }],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.96,
    source: 'llm',
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

async function seedCompanyContext(repository: AgentRunRepository, conversationKey: string, companyName: string): Promise<void> {
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
  await repository.saveRun({
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

async function seedRecordContext(
  repository: AgentRunRepository,
  input: {
    conversationKey: string;
    objectKey: ShadowObjectKey;
    formInstId: string;
    name: string;
  },
): Promise<void> {
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
  await repository.saveRun({
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

async function saveRunWithoutContext(
  repository: AgentRunRepository,
  input: {
    conversationKey: string;
    runId: string;
    query: string;
    intentFrame: IntentFrame;
  },
): Promise<void> {
  const taskPlan: TaskPlan = {
    planId: `${input.runId}-plan`,
    kind: 'tool_execution',
    title: '无上下文测试运行',
    status: 'completed',
    steps: [],
    evidenceRequired: false,
  };
  const executionState: ExecutionState = {
    runId: input.runId,
    traceId: `${input.runId}-trace`,
    status: 'completed',
    currentStepKey: null,
    message: '无上下文测试运行完成',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };

  await repository.saveRun({
    request: {
      conversationKey: input.conversationKey,
      sceneKey: 'chat',
      query: input.query,
    },
    runId: executionState.runId,
    traceId: executionState.traceId,
    eid: '21024647',
    appId: '501037729',
    intentFrame: input.intentFrame,
    taskPlan,
    executionState,
    toolCalls: [],
    evidence: [],
    contextFrame: null,
    message: {
      role: 'assistant',
      content: '无上下文测试运行完成',
      attachments: [],
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '无上下文测试运行完成',
        references: [],
        evidence: [],
        agentTrace: {
          traceId: executionState.traceId,
          intentFrame: input.intentFrame,
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
	  recordingTaskService?: unknown;
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
      createAnalysisMaterialArtifact: async () => {
        throw new Error('not used');
      },
      findLatestCompanyResearchArtifact: async () => null,
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
      getArtifact: async () => {
        throw new Error('not used');
      },
	    }) as any,
	    recordingTaskService: input.recordingTaskService as any,
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
        finalText: `# ${input.companyName} 公司研究\n\n## 公司概览\n${input.companyName} 是本次公司研究目标。\n\n## 业务定位\n公开资料显示其业务需要结合行业与经营范围继续核实。\n\n## 核心风险\n关注公开披露完整性、行业周期和经营信息更新。`,
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

function createCustomerUpdateFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: '_S_NAME',
      label: '客户名称',
      widgetType: 'textWidget',
      semanticSlot: 'customer_name',
      searchParameterKey: 'customer_name',
      writeParameterKey: 'customer_name',
    }),
    createSearchField({
      fieldCode: 'Ra_0',
      label: '客户状态',
      widgetType: 'radioWidget',
      semanticSlot: 'customer_status',
      searchParameterKey: 'customer_status',
      writeParameterKey: 'customer_status',
      options: [
        { title: '潜在客户', key: 'potential', value: '潜在客户' },
        { title: '成交', key: 'won', value: '成交' },
      ],
    }),
    createSearchField({
      fieldCode: 'Industry_0',
      label: '行业',
      widgetType: 'textWidget',
      semanticSlot: 'industry',
      searchParameterKey: 'industry',
      writeParameterKey: 'industry',
    }),
    createSearchField({
      fieldCode: 'Ps_owner',
      label: '负责人',
      widgetType: 'personSelectWidget',
      writeParameterKey: 'owner_open_id',
    }),
  ];
}

function createContactUpdateFields(): ShadowStandardizedField[] {
  return [
    createSearchField({
      fieldCode: '_S_NAME',
      label: '联系人姓名',
      widgetType: 'textWidget',
      searchParameterKey: 'contact_name',
      writeParameterKey: 'contact_name',
    }),
    createSearchField({
      fieldCode: 'Nu_0',
      label: '手机',
      widgetType: 'numberWidget',
      searchParameterKey: 'mobile_phone',
      writeParameterKey: 'mobile_phone',
    }),
    createSearchField({
      fieldCode: '_S_DISABLE',
      label: '启用状态',
      widgetType: 'switchWidget',
      searchParameterKey: 'enabled_state',
      writeParameterKey: 'enabled_state',
    }),
    createSearchField({
      fieldCode: 'Bd_customer',
      label: '关联客户',
      widgetType: 'basicDataWidget',
      searchParameterKey: 'linked_customer_form_inst_id',
      writeParameterKey: 'linked_customer_form_inst_id',
      relationBinding: {
        kind: 'basic_data',
        formCodeId: 'customer-form',
        modelName: '客户',
        displayCol: '_S_NAME',
      },
    }),
    createSearchField({
      fieldCode: 'Pw_0',
      label: '省',
      widgetType: 'publicOptBoxWidget',
      searchParameterKey: 'province',
      writeParameterKey: 'province',
      options: [{ title: '安徽', key: 'anhui', value: '安徽' }],
    }),
    createSearchField({
      fieldCode: 'Te_office',
      label: '办公电话',
      widgetType: 'textWidget',
      searchParameterKey: 'office_phone',
      writeParameterKey: 'office_phone',
    }),
  ];
}

function createUpdateLiveRecord(
  objectKey: ShadowObjectKey,
  formInstId: string,
  name: string,
  extraFields: Array<{
    codeId: string;
    title: string;
    type?: string;
    value: unknown;
    rawValue?: unknown;
  }> = [],
): any {
  const title = objectKey === 'contact'
    ? '联系人姓名'
    : objectKey === 'opportunity'
      ? '机会名称'
      : objectKey === 'followup'
        ? '跟进记录'
        : '客户名称';
  const codeId = objectKey === 'customer' || objectKey === 'contact' ? '_S_NAME' : '_S_TITLE';
  const fields = [
    {
      codeId,
      title,
      type: 'textWidget',
      value: name,
      rawValue: name,
      parentCodeId: null,
    },
    ...extraFields.map((field) => ({
      codeId: field.codeId,
      title: field.title,
      type: field.type ?? 'textWidget',
      value: field.value,
      rawValue: field.rawValue ?? field.value,
      parentCodeId: null,
    })),
  ];
  return {
    formInstId,
    important: Object.fromEntries(fields.map((field) => [field.title, field.value])),
    fields,
    fieldMap: Object.fromEntries(fields.map((field) => [field.codeId, field])),
    rawRecord: {
      [codeId]: name,
      [title]: name,
      ...Object.fromEntries(extraFields.flatMap((field) => [
        [field.codeId, field.rawValue ?? field.value],
        [field.title, field.value],
      ])),
    },
  };
}

function createVisitPrepCompanyResearchDetail(input: {
  companyName: string;
  artifactId?: string;
  version?: number;
  markdown?: string;
  customerId?: string;
  customerName?: string;
}) {
  const artifactId = input.artifactId ?? 'artifact-company-research-001';
  const version = input.version ?? 1;
  const anchors = [
    ...(input.customerId
      ? [{
          type: 'customer' as const,
          id: input.customerId,
          name: input.customerName ?? input.companyName,
          role: 'primary' as const,
        }]
      : []),
    {
      type: 'company' as const,
      id: input.companyName,
      name: input.companyName,
      role: input.customerId ? 'related' as const : 'primary' as const,
    },
  ];
  return {
    artifact: {
      artifactId,
      versionId: `${artifactId}-v${version}`,
      kind: 'company_research' as const,
      title: `${input.companyName} 公司研究`,
      version,
      sourceToolCode: 'ext.company_research_pm',
      vectorStatus: 'indexed' as const,
      anchors,
      chunkCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    markdown: input.markdown ?? `# ${input.companyName} 公司研究\n\n## 公司概览\n贝斯美是化工制造企业。`,
    summary: `${input.companyName} 公司研究摘要`,
  };
}

function createReadyPreviewResponse(objectKey: ShadowObjectKey, input: any) {
  return {
    objectKey,
    operation: 'upsert',
    unresolvedDictionaries: [],
    resolvedDictionaryMappings: [],
    missingRequiredParams: [],
    blockedReadonlyParams: [],
    missingRuntimeInputs: [],
    validationErrors: [],
    readyToSend: true,
    requestBody: {
      formCodeId: `${objectKey}-form`,
      data: [{ widgetValue: input.params ?? {} }],
    },
  };
}

function createUpdateScenarioService(input: {
  objectKey: ShadowObjectKey;
  intentName?: string;
  fields: ShadowStandardizedField[];
  searchRecords?: any[];
  searchRecordsByObject?: Partial<Record<ShadowObjectKey, any[]>>;
  getRecordsById?: Record<string, any>;
  executeGetThrows?: boolean;
  orgEmployees?: OrgEmployeeCandidate[];
}) {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const searchInputs: Array<{ objectKey: ShadowObjectKey; input: any }> = [];
  const previewInputs: any[] = [];
  const recordsByObject: Partial<Record<ShadowObjectKey, any[]>> = {
    [input.objectKey]: input.searchRecords ?? [],
    ...(input.searchRecordsByObject ?? {}),
  };
  const fieldsByObject: Partial<Record<ShadowObjectKey, ShadowStandardizedField[]>> = {
    [input.objectKey]: input.fields,
    customer: input.objectKey === 'customer' ? input.fields : createCustomerUpdateFields(),
  };
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent(input.objectKey, 'write', input.intentName ?? ''),
    shadowMetadataService: {
      listObjects: () => [
        { objectKey: 'customer', formCodeId: 'customer-form' },
        { objectKey: 'contact', formCodeId: 'contact-form' },
        { objectKey: 'opportunity', formCodeId: 'opportunity-form' },
        { objectKey: 'followup', formCodeId: 'followup-form' },
      ],
      getObject: (objectKey: ShadowObjectKey) => ({ fields: fieldsByObject[objectKey] ?? [] }),
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        searchInputs.push({ objectKey, input: searchInput });
        return { records: recordsByObject[objectKey] ?? [] };
      },
      executeGet: async (_objectKey: ShadowObjectKey, getInput: any) => {
        if (input.executeGetThrows) {
          throw new Error('get failed');
        }
        return { record: input.getRecordsById?.[String(getInput.formInstId ?? '')] ?? null };
      },
      previewUpsert: async (objectKey: ShadowObjectKey, previewInput: any) => {
        previewInputs.push(previewInput);
        return createReadyPreviewResponse(objectKey, previewInput);
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
    orgSyncRepository: input.orgEmployees ? createEmployeeLookup(input.orgEmployees) : undefined,
  });
  return { repository, service, searchInputs, previewInputs };
}

function assertNoInternalUpdateText(content: string): void {
  assert.equal(/formInstId|form_inst_id|readyToSend|record\.[a-z_]+\.preview_update/.test(content), false);
  assert.equal(/[0-9a-f]{20,}/i.test(content), false);
}

function assertUpdateFieldPicker(
  response: Awaited<ReturnType<AgentService['chat']>>,
  targetName: string,
  paramKeys: string[],
): void {
  const questionCard = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard;
  assert.equal(questionCard?.layout, 'update_field_picker');
  assert.equal(questionCard?.targetSummary?.value, targetName);
  for (const paramKey of paramKeys) {
    assert.ok(
      questionCard?.questions.some((question) => question.paramKey === paramKey),
      `expected update field picker question for ${paramKey}`,
    );
  }
  assertNoInternalUpdateText(response.message.content);
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
    'external.yunzhijia_visit_prep',
    'artifact.search',
    'artifact.recording_material.prepare',
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

test('Agent runtime routes recording followup client action to followup preview before recording material tool', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let previewObject: ShadowObjectKey | null = null;
  let previewInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '贝斯美拜访'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (objectKey: ShadowObjectKey, input: any) => {
        previewObject = objectKey;
        previewInput = input;
        return {
          objectKey,
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: ['linked_customer_form_inst_id', 'linked_opportunity_form_inst_id'],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: false,
          requestBody: {
            formCodeId: 'followup-form-001',
            data: [{ widgetValue: { Ta_0: input.params?.followup_record } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-recording-followup-preview',
    sceneKey: 'chat',
    query: '基于录音资料包「贝斯美拜访.mp3」新增拜访记录。跟进方式：电话，跟进负责人：open-followup-owner。正式写入前必须补齐客户和商机，并等待我确认后再写入。',
    clientAction: {
      type: 'record.preview_create',
      objectKey: 'followup',
      source: {
        kind: 'recording_material',
        recordingTaskId: 'recording-task-842f8e39',
        artifactId: 'artifact-recording-material-001',
        fileName: '贝斯美拜访.mp3',
        anchors: {},
      },
    },
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.followup.preview_create');
  assert.notEqual(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'artifact.recording_material.prepare');
  assert.equal(previewObject, 'followup');
  assert.equal(previewInput.params.followup_record, '基于录音资料包「贝斯美拜访.mp3」新增拜访记录');
  assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input as any).agentControl.source.kind, 'recording_material');
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.toolCode, 'record.followup.preview_create');
  assert.doesNotMatch(response.message.content, /录音处理已接入/);
});

test('Agent runtime keeps recording source while requiring followup archive anchors', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const previewInputs: any[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '贝斯美拜访'),
    shadowMetadataService: {
      getObject: () => ({ fields: createFollowupWriteFields() }),
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (objectKey: ShadowObjectKey, input: any) => {
        previewInputs.push(input);
        return {
          objectKey,
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: [],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: true,
          requestBody: {
            formCodeId: 'followup-form-001',
            data: [{ widgetValue: input.params ?? {} }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-recording-followup-requires-anchors',
    sceneKey: 'chat',
    query: '基于录音资料包「贝斯美拜访.mp3」新增拜访记录。跟进方式：电话，跟进负责人：open-followup-owner。',
    clientAction: {
      type: 'record.preview_create',
      objectKey: 'followup',
      source: {
        kind: 'recording_material',
        recordingTaskId: 'recording-task-842f8e39',
        fileName: '贝斯美拜访.mp3',
        sourceFileMd5: 'md5-bsm',
        anchors: {
          customer: 'customer-bsm-001',
        },
      },
    },
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  const pendingInteraction = preview.message.extraInfo.agentTrace.pendingInteraction;
  assert.equal(preview.executionState.status, 'waiting_input');
  assert.equal(preview.message.extraInfo.agentTrace.pendingConfirmation, null);
  assert.ok(pendingInteraction?.missingRows?.some((row) => row.paramKey === 'linked_opportunity_form_inst_id'));
  assert.equal((pendingInteraction?.partialInput as any)?.agentControl?.source?.kind, 'recording_material');

  const continued = await service.chat({
    conversationKey: 'conv-recording-followup-requires-anchors',
    sceneKey: 'chat',
    query: '商机：opportunity-bsm-001',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: preview.executionState.runId,
      action: 'provide_input',
      interactionId: pendingInteraction!.interactionId,
      answers: {
        linked_opportunity_form_inst_id: 'opportunity-bsm-001',
      },
    },
  });

  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.params.linked_opportunity_form_inst_id, 'opportunity-bsm-001');
  assert.equal((continued.message.extraInfo.agentTrace.pendingConfirmation?.requestInput as any)?.agentControl?.source?.recordingTaskId, 'recording-task-842f8e39');
});

test('Agent runtime does not create duplicate followup for archived recording task', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let previewCalled = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '贝斯美拜访'),
    recordingTaskService: {
      getTask: async () => ({
        taskId: 'recording-task-archived',
        eid: 'eid',
        appId: 'app',
        status: 'succeeded',
        serviceTaskId: 'audio-task-archived',
        file: {
          fileName: '贝斯美拜访.mp3',
          mimeType: 'audio/mpeg',
          size: 1,
          md5: 'md5-bsm',
        },
        anchors: {
          customer: 'customer-bsm-001',
          opportunity: 'opportunity-bsm-001',
          followup: 'followup-bsm-001',
        },
        stages: [],
        material: {
          available: true,
          artifactId: 'artifact-recording-formal',
          path: '/tmp/tongyi/md5-bsm/recording-material.md',
        },
        archive: {
          status: 'archived',
          artifactId: 'artifact-recording-formal',
          followupId: 'followup-bsm-001',
          customerId: 'customer-bsm-001',
          opportunityId: 'opportunity-bsm-001',
          sourceFileMd5: 'md5-bsm',
        },
        playback: { available: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      archiveTask: async () => {
        throw new Error('not used');
      },
    },
    shadowMetadataService: {
      previewUpsert: async () => {
        previewCalled = true;
        throw new Error('not used');
      },
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-recording-followup-archived-idempotent',
    sceneKey: 'chat',
    query: '基于录音资料包「贝斯美拜访.mp3」新增拜访记录。',
    clientAction: {
      type: 'record.preview_create',
      objectKey: 'followup',
      source: {
        kind: 'recording_material',
        recordingTaskId: 'recording-task-archived',
        fileName: '贝斯美拜访.mp3',
        sourceFileMd5: 'md5-bsm',
      },
    },
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(previewCalled, false);
  assert.match(response.message.content, /已存在拜访记录/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
});

test('Agent runtime archives recording material after confirmed followup create', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let archiveInput: any = null;
  let executeInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'write', '拜访记录'),
    recordingTaskService: {
      archiveTask: async (input: any) => {
        archiveInput = input;
        return {
          taskId: input.taskId,
          eid: 'eid',
          appId: 'app',
          status: 'succeeded',
          serviceTaskId: 'audio-task-001',
          file: {
            fileName: '贝斯美拜访.mp3',
            mimeType: 'audio/mpeg',
            size: 1,
            md5: 'md5-bsm',
          },
          anchors: {
            customer: input.customerId,
            opportunity: input.opportunityId,
            followup: input.followupId,
          },
          stages: [],
          material: {
            available: true,
            artifactId: 'artifact-recording-formal',
            path: '/tmp/tongyi/md5-bsm/recording-material.md',
          },
          playback: { available: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    },
    shadowMetadataService: {
      getObject: () => ({ fields: createFollowupWriteFields() }),
      previewUpsert: async (objectKey: string, input: any) => ({
        objectKey,
        operation: 'upsert',
        unresolvedDictionaries: [],
        resolvedDictionaryMappings: [],
        missingRequiredParams: [],
        blockedReadonlyParams: [],
        missingRuntimeInputs: [],
        validationErrors: [],
        readyToSend: true,
        requestBody: {
          formCodeId: 'followup-form-001',
          data: [{ widgetValue: input.params ?? {} }],
        },
      }),
      executeUpsert: async (_objectKey: string, input: any) => {
        executeInput = input;
        return {
          objectKey: 'followup',
          operation: 'upsert',
          mode: 'live',
          writeMode: 'create',
          requestBody: { formCodeId: 'followup-form-001', data: [{ widgetValue: input.params ?? {} }] },
          formInstIds: ['followup-bsm-001'],
        };
      },
    },
  });

  const preview = await service.chat({
    conversationKey: 'conv-recording-followup-archive',
    sceneKey: 'chat',
    query: '基于录音资料包「贝斯美拜访.mp3」新增拜访记录。跟进方式：电话，跟进负责人：open-followup-owner。正式写入前必须补齐客户和商机，并等待我确认后再写入。',
    clientAction: {
      type: 'record.preview_create',
      objectKey: 'followup',
      source: {
        kind: 'recording_material',
        recordingTaskId: 'recording-task-842f8e39',
        fileName: '贝斯美拜访.mp3',
        sourceFileMd5: 'md5-bsm',
        anchors: {
          customer: 'customer-bsm-001',
          opportunity: 'opportunity-bsm-001',
        },
      },
    },
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const pending = preview.message.extraInfo.agentTrace.pendingConfirmation;

  assert.equal(preview.executionState.status, 'waiting_confirmation');
  assert.ok(pending);

  const approved = await service.chat({
    conversationKey: 'conv-recording-followup-archive',
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
  assert.equal(approved.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.followup.commit_create');
  assert.equal(executeInput.agentControl, undefined);
  assert.deepEqual(archiveInput, {
    taskId: 'recording-task-842f8e39',
    customerId: 'customer-bsm-001',
    opportunityId: 'opportunity-bsm-001',
    followupId: 'followup-bsm-001',
    createdBy: 'operator-001',
  });
  assert.equal(
    approved.message.extraInfo.agentTrace.toolCalls.some((item) => item.toolCode === 'artifact.recording_material.archive'),
    true,
  );
  assert.match(approved.message.content, /录音资料归档/);
});

test('Agent runtime keeps direct audio requests on recording material tool', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('followup', 'query', '拜访录音'),
  });

  const response = await service.chat({
    conversationKey: 'conv-direct-recording-material',
    sceneKey: 'chat',
    query: '帮我处理这段拜访录音',
    attachments: [{ name: 'visit.mp3', type: 'audio/mpeg', url: '#attachment', size: 1024 }],
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'artifact.recording_material.prepare');
  assert.match(response.message.content, /录音处理已接入/);
});

test('Agent runtime routes complex multi-source customer questions to context summary atomic calls', async (t) => {
  const complexQueries = [
    '贝斯美这个客户现在到底值不值得重点推进？请结合公司研究、商机、最近拜访录音和待办情况给我判断。',
    '帮我判断贝斯美这次拜访后，当前商机的赢单概率有没有变化，为什么？',
    '贝斯美下次拜访我应该怎么开场、问哪些问题、推什么价值点？',
    '贝斯美目前最大的推进阻塞是什么？是客户问题、我们方案、预算、关键人，还是时机？',
    '请帮我整理贝斯美的客户经营简报，给老板看：背景、机会、客户诉求、风险、下一步。',
  ];

  for (const query of complexQueries) {
    await t.test(query, async () => {
      const repository = new AgentRunRepository(createInMemoryDatabase());
      const artifactKinds: string[] = [];
      const { service } = createAgentTestService({
        repository,
        intentFrame: recordIntent('customer', 'query', '贝斯美'),
        shadowMetadataService: {
          executeSearch: async (objectKey: ShadowObjectKey) => {
            if (objectKey === 'customer') {
              return {
                records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '贝斯美' }] }],
                totalElements: 1,
              };
            }
            if (objectKey === 'opportunity') {
              return {
                records: [{ formInstId: 'opportunity-bsm-001', fields: [{ title: '商机名称', value: '贝斯美数字化升级' }] }],
                totalElements: 1,
              };
            }
            if (objectKey === 'followup') {
              return {
                records: [{ formInstId: 'followup-bsm-001', fields: [{ title: '跟进记录', value: '客户关注审批周期和试点预算' }] }],
                totalElements: 1,
              };
            }
            return { records: [], totalElements: 0 };
          },
          executeGet: async () => ({
            record: {
              formInstId: 'customer-bsm-001',
              fields: [
                { title: '客户名称', value: '贝斯美' },
                { title: '客户状态', value: '推进中' },
              ],
            },
          }),
        },
        artifactService: {
          search: async (input: any) => {
            const kind = input.kinds?.[0] ?? 'company_research';
            artifactKinds.push(kind);
            return {
              query: input.query,
              vectorStatus: 'searched',
              qdrantFilter: {},
              evidence: [{
                artifactId: `artifact-${kind}`,
                versionId: `version-${kind}`,
                kind,
                title: kind === 'company_research'
                  ? '贝斯美公司研究'
                  : kind === 'recording_material'
                    ? '贝斯美拜访.mp3 录音资料包'
                    : '贝斯美拜访 - 问题陈述',
                version: 1,
                sourceToolCode: kind === 'analysis_material' ? 'ext.problem_statement_pm' : 'test',
                anchorTypes: ['customer'],
                anchorIds: ['贝斯美'],
                snippet: `${kind} 命中资料片段。`,
                score: 0.8,
              }],
            };
          },
        },
      });

      const response = await service.chat({
        conversationKey: `conv-context-${Buffer.from(query).toString('hex').slice(0, 8)}`,
        sceneKey: 'chat',
        query,
        tenantContext: { operatorOpenId: 'operator-001' },
      });

      assert.equal(response.executionState.status, 'completed');
      assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
      assert.deepEqual(artifactKinds, ['company_research', 'recording_material', 'analysis_material']);
      assert.equal(
        response.message.extraInfo.agentTrace.toolCalls.some((item) => item.toolCode === 'record.opportunity.search'),
        true,
      );
      assert.equal(
        response.message.extraInfo.agentTrace.toolCalls.filter((item) => item.toolCode === 'artifact.search').length,
        3,
      );
      assert.match(response.message.content, /公司研究/);
      assert.match(response.message.content, /拜访录音/);
      assert.match(response.message.content, /分析结果/);
    });
  }
});

test('Agent runtime anchors visit demand summary with real customer name and focuses answer', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const artifactSearches: Array<{ kind: string; anchors: unknown; limit: number | undefined }> = [];
  const buildEvidence = (
    kind: 'company_research' | 'recording_material' | 'analysis_material',
    index: number,
    title: string,
    sourceToolCode: string,
    snippet: string,
    score: number,
  ) => ({
    artifactId: `artifact-${sourceToolCode}-${index}`,
    versionId: `version-${sourceToolCode}-${index}`,
    kind,
    title,
    version: 1,
    sourceToolCode,
    anchorTypes: kind === 'company_research' ? ['company'] : ['customer'],
    anchorIds: kind === 'company_research' ? ['绍兴贝斯美化工股份有限公司'] : ['customer-bsm-001'],
    snippet,
    score,
  });
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        if (objectKey === 'customer') {
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '绍兴贝斯美化工股份有限公司' }] }],
            totalElements: 1,
          };
        }
        if (objectKey === 'opportunity') {
          return {
            records: [{ formInstId: 'opportunity-bsm-001', fields: [{ title: '商机名称', value: '云之家协同办公平台' }] }],
            totalElements: 1,
          };
        }
        if (objectKey === 'followup') {
          return {
            records: [{ formInstId: 'followup-bsm-001', fields: [{ title: '跟进记录', value: '基于录音资料包「贝斯美拜访.mp3」新增拜访记录' }] }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [
            { title: '客户名称', value: '绍兴贝斯美化工股份有限公司' },
            { title: '客户状态', value: '商机阶段客户' },
          ],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => {
        const kind = input.kinds?.[0] ?? 'company_research';
        artifactSearches.push({ kind, anchors: input.anchors, limit: input.limit });
        const evidence = kind === 'analysis_material'
          ? [
              buildEvidence('analysis_material', 1, '贝斯美拜访 - 客户需求工作待办分析', 'ext.customer_needs_todo_analysis', [
                '# 客户需求工作待办分析',
                '## 项目/场景背景',
                '客户需求：需要采购、合同、费用报销流程与 ERP 自动对接；关注海外员工多语言和移动端兼容；希望 AI 知识库降低重复咨询。',
              ].join('\n'), 0.9),
              buildEvidence('analysis_material', 2, '贝斯美拜访 - 客户价值定位', 'ext.customer_value_positioning_pm', '价值定位：云之家可围绕协同办公和流程统一提供价值。', 0.88),
              buildEvidence('analysis_material', 3, '贝斯美拜访 - 拜访会话理解', 'ext.visit_conversation_understanding', '会话摘要：客户提出采购申请、费用报销、项目费用统计、海外多语言、AI 知识库等需求。', 0.86),
              buildEvidence('analysis_material', 4, '贝斯美拜访 - 客户价值定位', 'ext.customer_value_positioning_pm', '定位声明：可从移动办公和全球组织协同切入。', 0.84),
              buildEvidence('analysis_material', 5, '贝斯美拜访 - 客户价值定位', 'ext.customer_value_positioning_pm', '待补充的材料/证据：需销售后续补充预算与决策链。', 0.82),
              buildEvidence('analysis_material', 6, '贝斯美拜访 - 问题陈述', 'ext.problem_statement_pm', [
                '# 问题陈述',
                '已确认的需求：客户希望打通采购、合同、费用报销流程与 ERP 自动对接。',
                '关键问题：海外员工需要多语言和移动端兼容，AI 知识库要降低重复咨询。',
              ].join('\n'), 0.8),
            ]
          : [
              buildEvidence(
                kind,
                1,
                kind === 'recording_material' ? '贝斯美拜访.mp3 录音资料包' : '绍兴贝斯美化工股份有限公司 公司研究',
                'test',
                kind === 'recording_material'
                  ? '会话摘要：客户提出采购申请、费用报销、项目费用统计、海外多语言、AI 知识库等需求。'
                  : '公司研究：贝斯美处于数字化和全球化经营阶段。',
                0.9,
              ),
            ];
        return {
          query: input.query,
          vectorStatus: 'searched',
          qdrantFilter: {},
          evidence: evidence.slice(0, input.limit ?? 5),
        };
      },
      getArtifact: async (artifactId: string) => ({
        artifact: {
          artifactId,
          versionId: `version-${artifactId}`,
          version: 1,
          kind: 'analysis_material',
          title: '贝斯美拜访 - 客户需求工作待办分析',
          sourceToolCode: 'ext.customer_needs_todo_analysis',
          vectorStatus: 'indexed',
          anchors: [],
          chunkCount: 6,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        markdown: [
          '# 客户需求工作待办分析',
          '',
          '## 一、客户核心需求',
          '',
          '### 需求 1：云之家与金蝶云星空 ERP 深度集成',
          '- 背景：客户需要采购、合同、费用报销流程与 ERP 自动对接。',
          '- 目标：减少重复录入，提升审批和财务处理效率。',
          '',
          '### 需求 2：全流程业务场景线上化覆盖',
          '- 背景：客户希望覆盖采购申请、合同审批、费用报销、考勤等流程。',
          '- 目标：把线下流程迁移到统一协同平台。',
          '',
          '### 需求 3：企业级 AI 知识库与智能化应用',
          '- 背景：客户希望 AI 知识库降低重复咨询。',
          '- 目标：让员工能自助获取制度、流程和业务知识。',
          '',
          '### 需求 4：多语言与海外分支适配',
          '- 背景：海外员工需要多语言和移动端兼容。',
          '- 关注点：海外组织使用体验和全球协同效率。',
          '',
          '### 需求 5：组织架构按投资关系设计，数据权限隔离',
          '- 背景：客户存在集团、多主体和投资关系组织。',
          '- 关注点：不同组织之间要做数据权限隔离。',
          '',
          '### 需求 6：研发项目费用化管理与财务系统打通',
          '- 背景：客户需要统计研发项目费用。',
          '- 目标：研发费用管理结果要能进入财务系统。',
        ].join('\n'),
      }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-visit-needs',
    sceneKey: 'chat',
    query: '贝斯美上次拜访客户主要提了什么需求',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.match(response.message.content, /客户主要需求/);
  assert.match(response.message.content, /需求 1：云之家与金蝶云星空 ERP 深度集成/);
  assert.match(response.message.content, /需求 2：全流程业务场景线上化覆盖/);
  assert.match(response.message.content, /需求 3：企业级 AI 知识库与智能化应用/);
  assert.match(response.message.content, /需求 4：多语言与海外分支适配/);
  assert.match(response.message.content, /需求 5：组织架构按投资关系设计，数据权限隔离/);
  assert.match(response.message.content, /需求 6：研发项目费用化管理与财务系统打通/);
  assert.doesNotMatch(response.message.content, /拜访需求摘要/);
  assert.doesNotMatch(response.message.content, /证据来源/);
  assert.doesNotMatch(response.message.content, /记录系统补充/);
  assert.doesNotMatch(response.message.content, /公司研究背景/);
  assert.doesNotMatch(response.message.content, /贝斯美拜访 - 问题陈述/);
  assert.doesNotMatch(response.message.content, /贝斯美拜访 - 拜访会话理解/);
  assert.doesNotMatch(response.message.content, /价值定位：云之家可围绕协同办公/);
  assert.doesNotMatch(response.message.content, /项目\/场景背景/);
  assert.doesNotMatch(response.message.content, /待补充的材料\/证据/);
  assert.doesNotMatch(response.message.content, /客户编码/);
  const analysisSearch = artifactSearches.find((item) => item.kind === 'analysis_material');
  assert.equal(analysisSearch?.limit, 10);
  const companySearch = artifactSearches.find((item) => item.kind === 'company_research');
  assert.deepEqual(companySearch?.anchors, [
    {
      type: 'company',
      id: '绍兴贝斯美化工股份有限公司',
      name: '绍兴贝斯美化工股份有限公司',
      role: 'primary',
      confidence: 0.86,
      bindingStatus: 'unbound',
    },
    {
      type: 'company',
      id: '贝斯美',
      name: '贝斯美',
      role: 'primary',
      confidence: 0.86,
      bindingStatus: 'unbound',
    },
  ]);
});

test('Agent runtime falls back to visit demand snippets when full analysis artifact cannot be read', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        if (objectKey === 'customer') {
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '贝斯美' }] }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [{ title: '客户名称', value: '贝斯美' }],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => {
        const kind = input.kinds?.[0] ?? 'company_research';
        return {
          query: input.query,
          vectorStatus: 'searched',
          qdrantFilter: {},
          evidence: kind === 'analysis_material'
            ? [{
                artifactId: 'artifact-needs-fallback',
                versionId: 'version-needs-fallback',
                kind: 'analysis_material',
                title: '贝斯美拜访 - 客户需求工作待办分析',
                version: 1,
                sourceToolCode: 'ext.customer_needs_todo_analysis',
                anchorTypes: ['customer'],
                anchorIds: ['customer-bsm-001'],
                snippet: '客户需求：需要采购、合同、费用报销流程与 ERP 自动对接；关注海外员工多语言。',
                score: 0.9,
              }]
            : [],
        };
      },
      getArtifact: async () => {
        throw new Error('artifact store offline');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-visit-needs-fallback',
    sceneKey: 'chat',
    query: '贝斯美上次拜访客户主要提了什么需求',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.match(response.message.content, /采购、合同、费用报销流程与 ERP 自动对接/);
  assert.equal(
    response.message.extraInfo.agentTrace.toolCalls.some((item) => item.toolCode === 'artifact.get' && item.status === 'failed'),
    true,
  );
});

test('Agent runtime uses followup records when visit demand evidence snippets are not enough', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        if (objectKey === 'customer') {
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '贝斯美' }] }],
            totalElements: 1,
          };
        }
        if (objectKey === 'followup') {
          return {
            records: [{
              formInstId: 'followup-bsm-001',
              fields: [{
                title: '跟进记录',
                value: '客户明确希望审批流程、采购合同和费用报销能与 ERP 打通，并关注海外多语言支持。',
              }],
            }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [{ title: '客户名称', value: '贝斯美' }],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => {
        const kind = input.kinds?.[0] ?? 'company_research';
        return {
          query: input.query,
          vectorStatus: 'searched',
          qdrantFilter: {},
          evidence: kind === 'analysis_material'
            ? [{
                artifactId: 'artifact-needs-noise',
                versionId: 'version-needs-noise',
                kind: 'analysis_material',
                title: '贝斯美拜访 - 客户需求工作待办分析',
                version: 1,
                sourceToolCode: 'ext.customer_needs_todo_analysis',
                anchorTypes: ['customer'],
                anchorIds: ['customer-bsm-001'],
                snippet: '后续动作建议：可基于本资料包继续执行客户需求工作待办分析。',
                score: 0.9,
              }]
            : [],
        };
      },
      getArtifact: async () => {
        throw new Error('artifact store offline');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-context-visit-needs-followup-fallback',
    sceneKey: 'chat',
    query: '贝斯美上次拜访客户主要提了什么需求',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.match(response.message.content, /审批流程、采购合同和费用报销能与 ERP 打通/);
  assert.match(response.message.content, /海外多语言支持/);
  assert.doesNotMatch(response.message.content, /当前资料中没有抽到明确需求条目/);
  assert.doesNotMatch(response.message.content, /记录系统补充/);
});

test('Agent runtime does not treat internal maintenance suggestions as customer visit needs', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: {
      actionType: 'query',
      goal: '总结客户上次沟通提到的需求和关注点',
      targetType: 'followup',
      targets: [{ type: 'followup', id: 'followup-bsm-001', name: '贝斯美上次沟通' }],
      inputMaterials: [],
      constraints: ['上次沟通'],
      missingSlots: [],
      confidence: 0.88,
      source: 'llm',
    },
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        if (objectKey === 'customer') {
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '贝斯美' }] }],
            totalElements: 1,
          };
        }
        if (objectKey === 'followup') {
          return {
            records: [{
              formInstId: 'followup-bsm-001',
              fields: [{ title: '跟进记录', value: '已完成拜访记录整理，暂无明确客户诉求。' }],
            }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [
            { title: '客户名称', value: '贝斯美' },
            { title: '客户状态', value: '商机阶段客户' },
          ],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => ({
        query: input.query,
        vectorStatus: 'searched',
        qdrantFilter: {},
        evidence: [],
      }),
      getArtifact: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-visit-needs-ignore-internal-maintenance',
    sceneKey: 'chat',
    query: '客户上回沟通里最在意哪些事项',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.input.summaryType, 'visit_needs');
  assert.match(response.message.content, /暂未抽到明确需求条目/);
  assert.doesNotMatch(response.message.content, /建议下一步/);
  assert.doesNotMatch(response.message.content, /建议继续补充省、市、区/);
});

test('Agent runtime semantic intent keeps next visit planning as next-step summary', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: {
      actionType: 'query',
      goal: '规划贝斯美下次拜访的开场、问题和价值点',
      targetType: 'customer',
      targets: [{ type: 'customer', id: 'customer-bsm-001', name: '贝斯美' }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.9,
      source: 'llm',
    },
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey) => {
        if (objectKey === 'customer') {
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '贝斯美' }] }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [{ title: '客户名称', value: '贝斯美' }],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => ({
        query: input.query,
        vectorStatus: 'searched',
        qdrantFilter: {},
        evidence: [],
      }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-semantic-next-step-visit',
    sceneKey: 'chat',
    query: '下次去见这个客户，我应该先聊什么、问什么',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.input.summaryType, 'next_step');
});

test('Agent runtime routes visit focus question to context summary without clarification', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const customerSearchValues: string[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: {
      actionType: 'query',
      goal: '了解贝斯美的拜访重点',
      targetType: 'company',
      targets: [],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.9,
      source: 'llm',
    },
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, input: any) => {
        if (objectKey === 'customer') {
          customerSearchValues.push(String(input.filters?.[0]?.value ?? ''));
          return {
            records: [{ formInstId: 'customer-bsm-001', fields: [{ title: '客户名称', value: '绍兴贝斯美化工股份有限公司' }] }],
            totalElements: 1,
          };
        }
        if (objectKey === 'followup') {
          return {
            records: [{ formInstId: 'followup-bsm-001', fields: [{ title: '跟进记录', value: '客户重点关注 ERP 对接、多语言和 AI 知识库。' }] }],
            totalElements: 1,
          };
        }
        return { records: [], totalElements: 0 };
      },
      executeGet: async () => ({
        record: {
          formInstId: 'customer-bsm-001',
          fields: [{ title: '客户名称', value: '绍兴贝斯美化工股份有限公司' }],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => {
        const kind = input.kinds?.[0] ?? 'company_research';
        return {
          query: input.query,
          vectorStatus: 'searched',
          qdrantFilter: {},
          evidence: kind === 'recording_material'
            ? [
                {
                  artifactId: 'artifact-recording-bsm',
                  versionId: 'version-recording-bsm',
                  kind: 'recording_material',
                  title: '贝斯美拜访.mp3 录音资料包',
                  version: 1,
                  sourceToolCode: 'tongyi.audio.recording_material',
                  anchorTypes: ['customer'],
                  anchorIds: ['customer-bsm-001'],
                  snippet: '## 后续动作建议\n- 可基于本资料包继续执行拜访会话理解、客户需求工作待办分析。',
                  score: 0.92,
                },
                {
                  artifactId: 'artifact-recording-bsm',
                  versionId: 'version-recording-bsm',
                  kind: 'recording_material',
                  title: '贝斯美拜访.mp3 录音资料包',
                  version: 1,
                  sourceToolCode: 'tongyi.audio.recording_material',
                  anchorTypes: ['customer'],
                  anchorIds: ['customer-bsm-001'],
                  snippet: '## 关键主题\n- 云之家与金蝶 ERP 深度集成\n- 采购申请、合同审批和费用报销流程自动化\n- 多语言与海外分支适配\n- AI 知识库降低重复咨询',
                  score: 0.86,
                },
              ]
            : [],
        };
      },
      getArtifact: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-visit-focus-question',
    sceneKey: 'chat',
    query: '贝斯美 拜访重点有哪些',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.input.summaryType, 'visit_needs');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.input.dataSourceScope, 'combined');
  assert.equal(customerSearchValues[0], '贝斯美');
  assert.match(response.message.content, /采购申请、合同审批和费用报销流程自动化/);
  assert.match(response.message.content, /多语言与海外分支适配/);
  assert.doesNotMatch(response.message.content, /当前未检索到正式拜访分析结果/);
  assert.doesNotMatch(response.message.content, /分析资料状态/);
  assert.doesNotMatch(response.message.content, /目标对象或任务类型/);
});

test('Agent runtime carries unique customer lookup into visit needs summary in new conversations', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-new-visit-needs-after-customer-lookup';
  const customerId = 'customer-bsm-001';
  const customerName = '绍兴贝斯美化工股份有限公司';
  const customerSearchValues: string[] = [];
  let customerSearchCount = 0;
  const unknownIntent = (query: string): IntentFrame => ({
    actionType: 'clarify',
    goal: '澄清用户目标',
    targetType: 'unknown',
    targets: [],
    inputMaterials: [],
    constraints: [],
    missingSlots: ['目标对象或任务类型'],
    confidence: 0.42,
    source: 'fallback',
    fallbackReason: `test:${query}`,
  });
  const customerRecord = {
    formInstId: customerId,
    important: { 标题: customerName },
    fields: [{ title: '客户名称', value: customerName }],
    fieldMap: {},
    rawRecord: {},
  };
  const { service } = createAgentTestService({
    repository,
    intentFrame: ({ query }) => unknownIntent(query),
    shadowMetadataService: {
      getObject: (objectKey: ShadowObjectKey) => ({
        fields: objectKey === 'customer' ? createCustomerSearchFields() : [],
      }),
      executeSearch: async (objectKey: ShadowObjectKey, input: any) => {
        if (objectKey === 'customer') {
          const value = String(input.filters?.[0]?.value ?? '');
          customerSearchValues.push(value);
          customerSearchCount += 1;
          return {
            objectKey,
            operation: 'search',
            mode: 'live',
            requestBody: {},
            pageNumber: 1,
            pageSize: 5,
            totalPages: customerSearchCount === 1 ? 0 : 1,
            totalElements: customerSearchCount === 1 ? 0 : 1,
            records: customerSearchCount === 1 ? [] : [customerRecord],
          };
        }
        if (objectKey === 'opportunity') {
          return {
            objectKey,
            operation: 'search',
            mode: 'live',
            requestBody: {},
            pageNumber: 1,
            pageSize: 5,
            totalPages: 1,
            totalElements: 1,
            records: [{
              formInstId: 'opportunity-bsm-001',
              fields: [{ title: '商机名称', value: '贝斯美云之家协同项目' }],
              fieldMap: {},
              rawRecord: {},
            }],
          };
        }
        if (objectKey === 'followup') {
          return {
            objectKey,
            operation: 'search',
            mode: 'live',
            requestBody: {},
            pageNumber: 1,
            pageSize: 5,
            totalPages: 1,
            totalElements: 1,
            records: [{
              formInstId: 'followup-bsm-001',
              fields: [{ title: '跟进记录', value: '客户重点关注 ERP 对接、多语言和 AI 知识库。' }],
              fieldMap: {},
              rawRecord: {},
            }],
          };
        }
        return {
          objectKey,
          operation: 'search',
          mode: 'live',
          requestBody: {},
          pageNumber: 1,
          pageSize: 5,
          totalPages: 0,
          totalElements: 0,
          records: [],
        };
      },
      executeGet: async () => ({
        objectKey: 'customer',
        operation: 'get',
        mode: 'live',
        requestBody: {},
        record: {
          ...customerRecord,
          fields: [
            { title: '客户名称', value: customerName },
            { title: '客户状态', value: '商机阶段客户' },
          ],
        },
      }),
    },
    artifactService: {
      search: async (input: any) => {
        const kind = input.kinds?.[0] ?? 'company_research';
        return {
          query: input.query,
          vectorStatus: 'searched',
          qdrantFilter: {},
          evidence: kind === 'analysis_material'
            ? [{
                artifactId: 'artifact-bsm-needs',
                versionId: 'version-bsm-needs',
                kind: 'analysis_material',
                title: '贝斯美拜访 - 客户需求工作待办分析',
                version: 1,
                sourceToolCode: 'ext.customer_needs_todo_analysis',
                anchorTypes: ['customer'],
                anchorIds: [customerId],
                snippet: '需求 4：多语言与海外分支适配。',
                score: 0.92,
              }]
            : [],
        };
      },
      getArtifact: async () => ({
        artifact: {
          artifactId: 'artifact-bsm-needs',
          versionId: 'version-bsm-needs',
          version: 1,
          kind: 'analysis_material',
          title: '贝斯美拜访 - 客户需求工作待办分析',
          sourceToolCode: 'ext.customer_needs_todo_analysis',
          vectorStatus: 'indexed',
          anchors: [],
          chunkCount: 6,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        markdown: [
          '# 客户需求工作待办分析',
          '',
          '## 一、客户核心需求',
          '',
          '### 需求 1：云之家与 ERP 深度集成',
          '- 背景：客户需要采购、合同、费用报销流程与 ERP 自动对接。',
          '- 目标：减少重复录入。',
          '',
          '### 需求 2：企业级 AI 知识库',
          '- 背景：客户希望 AI 知识库降低重复咨询。',
          '- 目标：员工自助获取制度和流程知识。',
        ].join('\n'),
      }),
    },
  });

  const first = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '贝斯美上次拜访客户主要提了什么需求',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(first.executionState.status, 'waiting_input');
  assert.equal(first.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.equal(customerSearchValues[0], '贝斯美');

  const lookup = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '查询 贝斯美客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(lookup.executionState.status, 'completed');
  assert.equal(lookup.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.search');
  assert.equal(customerSearchValues[1], '贝斯美');

  const context = await repository.findContextFrame(conversationKey);
  assert.equal(context?.subject?.type, 'customer');
  assert.equal(context?.subject?.id, customerId);
  assert.equal(context?.subject?.name, customerName);

  const followup = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '贝斯美上次拜访客户主要提了什么需求',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(followup.executionState.status, 'completed');
  assert.equal(followup.message.extraInfo.agentTrace.selectedTool?.toolCode, 'meta.context_summary');
  assert.equal(
    followup.message.extraInfo.agentTrace.toolCalls.some((item) => item.toolCode === 'record.customer.search'),
    false,
  );
  assert.match(followup.message.content, /需求 1：云之家与 ERP 深度集成/);
  assert.match(followup.message.content, /需求 2：企业级 AI 知识库/);
  assert.doesNotMatch(followup.message.content, /需要先确定客户主体/);
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

test('Agent runtime hides formInstId and uses record important title for customer cards', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const formInstId = '69faf11ad03e580001fd4508';
  const customerName = '江苏友升汽车科技有限公司';
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '江苏友升'),
    shadowMetadataService: {
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
            formInstId,
            important: { 标题: customerName },
            fields: [],
            fieldMap: {},
            rawRecord: { important: { 标题: customerName } },
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-record-important-title',
    sceneKey: 'chat',
    query: '查询江苏友升',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const surface = response.message.extraInfo.uiSurfaces?.[0];
  const recordResult = surface?.commands.find((command: any) => command.updateDataModel)?.updateDataModel.value as any;

  assert.equal(response.executionState.status, 'completed');
  assert.equal(recordResult?.record?.title, customerName);
  assert.equal(recordResult?.record?.formInstId, formInstId);
  assert.match(response.message.content, new RegExp(customerName));
  assert.doesNotMatch(response.message.content, new RegExp(formInstId));
});

test('Agent runtime falls back to query name instead of exposing formInstId when record has no display title', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const formInstId = '69faf11ad03e580001fd4508';
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', '江苏友升'),
    shadowMetadataService: {
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
            formInstId,
            important: {},
            fields: [],
            fieldMap: {},
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-record-query-title-fallback',
    sceneKey: 'chat',
    query: '查询江苏友升',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const surface = response.message.extraInfo.uiSurfaces?.[0];
  const recordResult = surface?.commands.find((command: any) => command.updateDataModel)?.updateDataModel.value as any;

  assert.equal(response.executionState.status, 'completed');
  assert.equal(recordResult?.record?.title, '江苏友升');
  assert.equal(recordResult?.record?.formInstId, formInstId);
  assert.match(response.message.content, /江苏友升/);
  assert.doesNotMatch(response.message.content, new RegExp(formInstId));
});

test('Agent runtime uses important summary fields for customer list display', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', ''),
    shadowMetadataService: {
      executeSearch: async () => ({
        objectKey: 'customer',
        operation: 'search',
        mode: 'live',
        requestBody: {},
        pageNumber: 1,
        pageSize: 5,
        totalPages: 2,
        totalElements: 8,
        records: [
          {
            formInstId: '69faf11ad03e580001fd4508',
            important: {
              标题: '江苏友升汽车科技有限公司',
              客户状态: '商机阶段客户',
              客户类型: '直客',
              省: '江苏省',
              市: '无锡市',
              负责人: '陈伟棠',
            },
            fields: [],
            fieldMap: {},
            rawRecord: {},
          },
          {
            formInstId: '69faf11ad03e580001fd4509',
            important: {
              标题: '上海品宏企业管理有限公司',
              客户状态: '销售线索阶段',
              省: '上海市',
              负责人: '李敏',
            },
            fields: [],
            fieldMap: {},
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-record-important-list',
    sceneKey: 'chat',
    query: '查询客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const surface = response.message.extraInfo.uiSurfaces?.[0];
  const recordResult = surface?.commands.find((command: any) => command.updateDataModel)?.updateDataModel.value as any;
  const firstRecord = recordResult?.records?.[0];

  assert.equal(response.executionState.status, 'completed');
  assert.equal(recordResult?.displayMode, 'list');
  assert.equal(firstRecord?.title, '江苏友升汽车科技有限公司');
  assert.deepEqual(firstRecord?.tags, ['商机阶段客户', '直客']);
  assert.equal(firstRecord?.subtitle, '江苏省 / 无锡市');
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '客户状态' && field.value === '商机阶段客户'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '省' && field.value === '江苏省'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '市' && field.value === '无锡市'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '负责人' && field.value === '陈伟棠'));
  assert.notEqual(firstRecord?.title, '客户记录');
});

test('Agent runtime displays customer list fields synthesized from live widget values without leaking openId', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const ownerOpenId = '69e75eb5e4b0e65b61c014da';
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'query', ''),
    shadowMetadataService: {
      executeSearch: async () => ({
        objectKey: 'customer',
        operation: 'search',
        mode: 'live',
        requestBody: {},
        pageNumber: 1,
        pageSize: 5,
        totalPages: 2,
        totalElements: 8,
        records: [
          {
            formInstId: '69f150a897fc79000112488c',
            important: {},
            fields: [
              {
                codeId: '_S_NAME',
                title: '客户名称',
                value: `联系人姓名：陈晨联系人手机：13612952103启用状态：启用客户类型：普通客户客户状态：销售线索阶段客户是否分配：已分配负责人：${ownerOpenId}`,
              },
              { codeId: 'Ra_0', title: '客户状态', value: '销售线索阶段' },
              { codeId: 'Ra_3', title: '客户类型', value: '普通客户' },
              { codeId: 'Pw_0', title: '省', value: ['江苏'] },
              { codeId: 'Pw_1', title: '市', value: ['南通市'] },
              { codeId: 'Ps_0', title: '负责人', value: '已绑定人员' },
            ],
            fieldMap: {},
            rawRecord: {},
          },
        ],
      }),
      executeGet: async () => ({ record: null }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-record-widget-value-list',
    sceneKey: 'chat',
    query: '查询客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const surface = response.message.extraInfo.uiSurfaces?.[0];
  const recordResult = surface?.commands.find((command: any) => command.updateDataModel)?.updateDataModel.value as any;
  const firstRecord = recordResult?.records?.[0];

  assert.equal(response.executionState.status, 'completed');
  assert.equal(recordResult?.displayMode, 'list');
  assert.doesNotMatch(firstRecord?.title ?? '', new RegExp(ownerOpenId));
  assert.deepEqual(firstRecord?.tags, ['销售线索阶段', '普通客户']);
  assert.equal(firstRecord?.subtitle, '江苏 / 南通市');
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '客户状态' && field.value === '销售线索阶段'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '省' && field.value === '江苏'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '市' && field.value === '南通市'));
  assert.ok(firstRecord?.primaryFields.some((field: any) => field.label === '负责人' && field.value === '已绑定人员'));
});

test('Record A2UI view model hides ID-derived opportunity titles and department IDs', async () => {
  const formInstId = '69e75eb5e4b0e65b61c014da';
  const departmentId = '69faf11ad03e580001fd4508';
  const response = await buildRecordSearchPageResponse({
    shadowMetadataService: {
      executeSearch: async () => ({
        objectKey: 'opportunity',
        operation: 'search',
        mode: 'live',
        requestBody: {},
        pageNumber: 1,
        pageSize: 5,
        totalPages: 1,
        totalElements: 1,
        records: [
          {
            formInstId,
            important: { 标题: `${formInstId}的商机` },
            fields: [
              { codeId: '_S_TITLE', title: '标题', value: `${formInstId}的商机` },
              { codeId: 'De_0', title: '所属部门', value: departmentId },
              { codeId: 'Bd_0', title: '客户编号', value: { formInstId: 'customer-form-001', id: 'customer-form-001' } },
            ],
            rawRecord: {},
          },
        ],
      }),
    } as any,
    request: {
      objectKey: 'opportunity',
      toolCode: 'record.opportunity.search',
      queryText: '查询商机',
      searchInput: {
        filters: [],
        operatorOpenId: 'operator-001',
        pageNumber: 1,
        pageSize: 5,
      },
    },
  });

  const record = response.result.record;
  assert.equal(record?.title, '商机记录');
  assert.equal(record?.primaryFields.some((field) => field.value.includes(formInstId)), false);
  assert.equal(record?.secondaryFields.some((field) => field.value.includes(departmentId)), false);
  assert.equal(record?.relationFields.some((field) => /customer-form-001/.test(field.value)), false);
  assert.ok(record?.relationFields.some((field) => field.label === '客户编号' && field.value === '已关联客户'));
  assert.ok(record?.secondaryFields.some((field) => field.label === '所属部门' && field.value === '已选择部门'));
});

test('Record A2UI view model promotes relation fields for associated CRM objects', async () => {
  const cases: Array<{
    objectKey: ShadowObjectKey;
    fields: Array<{ title: string; value: unknown }>;
    expectedFields: Array<{ label: string; value: string }>;
    expectedSubtitlePart: string;
  }> = [
    {
      objectKey: 'contact',
      fields: [
        { title: '联系人姓名', value: '李玲玲' },
        { title: '关联客户', value: { showName: '安徽艳阳电气', formInstId: 'customer-ah-001' } },
        { title: '手机', value: '13612952011' },
      ],
      expectedFields: [{ label: '关联客户', value: '安徽艳阳电气' }],
      expectedSubtitlePart: '安徽艳阳电气',
    },
    {
      objectKey: 'opportunity',
      fields: [
        { title: '机会名称', value: '苏州ERP升级项目' },
        { title: '客户编号', value: { showName: '苏州恒达机电有限公司', formInstId: 'customer-sz-001' } },
        { title: '联系人', value: { _S_NAME: '陈燕', formInstId: 'contact-sz-001' } },
      ],
      expectedFields: [
        { label: '客户编号', value: '苏州恒达机电有限公司' },
        { label: '联系人', value: '陈燕' },
      ],
      expectedSubtitlePart: '苏州恒达机电有限公司',
    },
    {
      objectKey: 'followup',
      fields: [
        { title: '跟进记录', value: '电话沟通ERP升级预算' },
        { title: '客户编号', value: { showName: '苏州恒达机电有限公司', formInstId: 'customer-sz-001' } },
        { title: '商机', value: { _S_TITLE: '苏州ERP升级项目', formInstId: 'opportunity-sz-001' } },
      ],
      expectedFields: [
        { label: '客户编号', value: '苏州恒达机电有限公司' },
        { label: '商机', value: '苏州ERP升级项目' },
      ],
      expectedSubtitlePart: '苏州恒达机电有限公司',
    },
  ];

  for (const item of cases) {
    const response = await buildRecordSearchPageResponse({
      shadowMetadataService: {
        executeSearch: async () => ({
          objectKey: item.objectKey,
          operation: 'search',
          mode: 'live',
          requestBody: {},
          pageNumber: 1,
          pageSize: 5,
          totalPages: 1,
          totalElements: 1,
          records: [
            {
              formInstId: `${item.objectKey}-form-001`,
              fields: item.fields,
              rawRecord: {},
            },
          ],
        }),
      } as any,
      request: {
        objectKey: item.objectKey,
        toolCode: `record.${item.objectKey}.search`,
        searchInput: {
          filters: [],
          operatorOpenId: 'operator-001',
          pageNumber: 1,
          pageSize: 5,
        },
      },
    });

    const record = response.result.records[0];
    assert.ok(record);
    for (const expected of item.expectedFields) {
      assert.ok(
        record.primaryFields.some((field) => field.label === expected.label && field.value === expected.value),
        `${item.objectKey} should expose ${expected.label}=${expected.value}`,
      );
      assert.ok(
        record.relationFields.some((field) => field.label === expected.label && field.value === expected.value),
        `${item.objectKey} should expose relation field ${expected.label}=${expected.value}`,
      );
    }
    assert.match(record.subtitle ?? '', new RegExp(item.expectedSubtitlePart));
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
  const cases = ['查询所有客户', '查询全部客户', '查询所有的客户', '查询客户列表'];

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

test('Agent runtime does not use previous customer context for scoped collection search', async () => {
  const cases = ['查询所有客户', '查询全部客户', '查询所有的客户'];

  for (const query of cases) {
    const repository = new AgentRunRepository(createInMemoryDatabase());
    const conversationKey = `conv-scoped-collection-${query}`;
    await seedRecordContext(repository, {
      conversationKey,
      objectKey: 'customer',
      formInstId: 'customer-ah-001',
      name: '安徽艳阳电气集团有限公司',
    });
    let searchInput: any = null;
    const { service } = createAgentTestService({
      repository,
      intentFrame: recordIntent('customer', 'query', '客户'),
      shadowMetadataService: {
        getObject: () => ({ fields: createCustomerSearchFields() }),
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
      conversationKey,
      sceneKey: 'chat',
      query,
      tenantContext: { operatorOpenId: 'operator-001' },
    });

    assert.equal(response.executionState.status, 'completed', query);
    assert.deepEqual(searchInput?.filters, [], query);
    assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false, query);
    assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usageMode, 'skipped_collection_query', query);
    assert.equal((await repository.getRunDetail(response.executionState.runId))?.contextSubject, null, query);
  }
});

test('Agent runtime ignores ungrounded LLM targets for bare collection search payloads', async () => {
  const cases: Array<{ objectKey: ShadowObjectKey; query: string; pollutedTarget: string; previousName: string }> = [
    { objectKey: 'customer', query: '查询客户', pollutedTarget: '69f16bbd21bf2b00014fbc6f', previousName: '苏州恒达机电有限公司' },
    { objectKey: 'contact', query: '查询联系人', pollutedTarget: 'stale-contact-id-001', previousName: '李玲玲' },
    { objectKey: 'opportunity', query: '查询商机', pollutedTarget: 'stale-opportunity-id-001', previousName: '苏州ERP升级项目' },
    { objectKey: 'followup', query: '查询拜访记录', pollutedTarget: 'stale-followup-id-001', previousName: '报价后回访记录' },
  ];

  for (const item of cases) {
    const repository = new AgentRunRepository(createInMemoryDatabase());
    const conversationKey = `conv-polluted-collection-${item.objectKey}`;
    await seedRecordContext(repository, {
      conversationKey,
      objectKey: item.objectKey,
      formInstId: item.pollutedTarget,
      name: item.previousName,
    });
    let searchInput: any = null;
    const { service } = createAgentTestService({
      repository,
      intentFrame: pollutedRecordQueryIntent(item.objectKey, item.pollutedTarget),
      shadowMetadataService: {
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
      conversationKey,
      sceneKey: 'chat',
      query: item.query,
      tenantContext: { operatorOpenId: 'operator-001' },
    });

    assert.equal(response.executionState.status, 'completed', item.query);
    assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, `record.${item.objectKey}.search`, item.query);
    assert.deepEqual(searchInput?.filters, [], item.query);
    const selectedInput = response.message.extraInfo.agentTrace.selectedTool?.input as any;
    assert.equal(selectedInput?.agentControl?.searchExtraction?.fallbackName, undefined, item.query);
    assert.equal(selectedInput?.agentControl?.targetSanitization?.reasonCode, 'ignored_ungrounded_target', item.query);
    assert.equal(selectedInput?.agentControl?.targetSanitization?.ignoredTargetName, item.pollutedTarget, item.query);
    assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false, item.query);
    assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usageMode, 'skipped_collection_query', item.query);
    assert.equal((await repository.getRunDetail(response.executionState.runId))?.contextSubject, null, item.query);
    assert.equal(
      (await repository.findContextCandidates(conversationKey)).some((candidate) => candidate.sourceRunId === response.executionState.runId),
      false,
      item.query,
    );
  }
});

test('Agent runtime lets explicit user query text win over stale LLM target fallback', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: pollutedRecordQueryIntent('customer', '苏州恒达机电有限公司'),
    shadowMetadataService: {
      getObject: () => ({ fields: createCustomerSearchFields() }),
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
    conversationKey: 'conv-explicit-query-over-stale-target',
    sceneKey: 'chat',
    query: '查询客户 安徽艳阳电气',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  const filters = Array.isArray(searchInput?.filters) ? searchInput.filters : [];
  assert.equal(filters.some((filter: { value?: unknown }) => filter.value === '安徽艳阳电气'), true);
  assert.equal(filters.some((filter: { value?: unknown }) => filter.value === '苏州恒达机电有限公司'), false);
  const selectedInput = response.message.extraInfo.agentTrace.selectedTool?.input as any;
  const filterSources = selectedInput?.agentControl?.searchExtraction?.filterSources ?? [];
  assert.equal(
    filterSources.some((source: { source?: string }) => source.source === 'explicit_condition' || source.source === 'name_fallback'),
    true,
  );
  assert.equal(selectedInput?.agentControl?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
  assert.equal(selectedInput?.agentControl?.targetSanitization?.ignoredTargetName, '苏州恒达机电有限公司');
});

test('Agent runtime persists record context only for unique search results', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-search-context-persistence';
  await seedRecordContext(repository, {
    conversationKey,
    objectKey: 'customer',
    formInstId: 'customer-old-001',
    name: '旧上下文客户有限公司',
  });
  let searchRecords: unknown[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: ({ query }) => recordIntent('customer', 'query', query.includes('安徽') ? '安徽艳阳电气' : '客户'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: searchRecords }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => {
        throw new Error('not used');
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  searchRecords = [];
  const emptySearch = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '查询客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(emptySearch.executionState.status, 'completed');
  assert.equal((await repository.getRunDetail(emptySearch.executionState.runId))?.contextSubject, null);

  searchRecords = [
    { formInstId: 'customer-a-001', fields: [{ title: '客户名称', value: '客户 A' }], rawRecord: {} },
    { formInstId: 'customer-b-001', fields: [{ title: '客户名称', value: '客户 B' }], rawRecord: {} },
  ];
  const multiSearch = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '查询客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(multiSearch.executionState.status, 'completed');
  assert.equal((await repository.getRunDetail(multiSearch.executionState.runId))?.contextSubject, null);

  searchRecords = [
    { formInstId: 'customer-ah-001', fields: [{ title: '客户名称', value: '安徽艳阳电气' }], rawRecord: {} },
  ];
  const uniqueSearch = await service.chat({
    conversationKey,
    sceneKey: 'chat',
    query: '查询客户 安徽艳阳电气',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(uniqueSearch.executionState.status, 'completed');
  const uniqueContext = (await repository.getRunDetail(uniqueSearch.executionState.runId))?.contextSubject;
  assert.equal(uniqueContext?.type, 'customer');
  assert.equal(uniqueContext?.id, 'customer-ah-001');
  assert.equal(uniqueContext?.name, '安徽艳阳电气');
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

test('Agent runtime routes company info request to external info by default', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchCalled = false;
  let artifactInput: any = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('安徽艳阳电气集团有限公司'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchCalled = true;
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
    artifactService: {
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      search: async (input: any) => {
        artifactInput = input;
        return {
          evidence: [{
            artifactId: 'artifact-ahyy-001',
            versionId: 'version-ahyy-001',
            title: '安徽艳阳电气集团有限公司 公司研究',
            version: 1,
            sourceToolCode: 'ext.company_research_pm',
            anchorIds: ['安徽艳阳电气集团有限公司'],
            snippet: '公开资料显示其公司信息来自外部信息资料。',
            score: 0.91,
          }],
          qdrantFilter: {},
          vectorStatus: 'searched',
          query: input.query,
        };
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-company-info-external-default',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'artifact.search');
  assert.equal(searchCalled, false);
  assert.equal(artifactInput.anchors?.[0]?.id, '安徽艳阳电气');
  assert.match(response.message.content, /外部信息/);
});

test('Agent runtime does not auto-run company research for company info request', async () => {
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

  const response = await service.chat({
    conversationKey: 'conv-company-info-no-auto-research',
    sceneKey: 'chat',
    query: '给出 安徽艳阳电气 公司信息',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'artifact.search');
  assert.match(response.message.content, /当前没有检索到可引用外部信息/);
  assert.equal(researchCalls, 0);
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
  await seedCompanyContext(repository, 'conv-context-create', companyName);
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

test('Agent runtime cancels pending input interaction by natural language', async () => {
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

  const preview = await service.chat({
    conversationKey: 'conv-cancel-pending-input',
    sceneKey: 'chat',
    query: '新增客户 测试客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(preview.executionState.status, 'waiting_input');
  assert.equal(preview.message.extraInfo.agentTrace.pendingInteraction?.status, 'pending');

  const cancelled = await service.chat({
    conversationKey: 'conv-cancel-pending-input',
    sceneKey: 'chat',
    query: '取消录入',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(cancelled.executionState.status, 'cancelled');
  assert.equal(cancelled.message.extraInfo.agentTrace.pendingInteraction?.status, 'cancelled');
  assert.equal(cancelled.message.extraInfo.agentTrace.pendingInteraction?.questionCard, undefined);
  assert.equal(cancelled.message.extraInfo.agentTrace.continuationResolution?.action, 'cancel_interaction');
  assert.match(cancelled.message.content, /已取消本次录入/);
});

test('Agent runtime does not treat create command text as customer name', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let searchCount = 0;
  let previewParams: Record<string, unknown> | null = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '新增客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        searchCount += 1;
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
          missingRequiredParams: ['customer_name', 'contact_name'],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: false,
          requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: {} }] },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-create-command-is-not-name',
    sceneKey: 'chat',
    query: '新增客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_create');
  assert.deepEqual(previewParams, {});
  assert.equal(searchCount, 0);
  assert.doesNotMatch(response.message.content, /客户名称：新增客户/);
  assert.match(response.message.content, /客户名称/);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
});

test('Agent runtime strips customer create command prefix from customer name', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let previewParams: Record<string, unknown> | null = null;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '绍兴贝斯美化工股份有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async (_objectKey: ShadowObjectKey, input: any) => {
        previewParams = input.params;
        return {
          objectKey: 'customer',
          operation: 'upsert',
          unresolvedDictionaries: [],
          resolvedDictionaryMappings: [],
          missingRequiredParams: ['contact_name'],
          blockedReadonlyParams: [],
          missingRuntimeInputs: [],
          validationErrors: [],
          readyToSend: false,
          requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { _S_NAME: input.params?.customer_name } }] },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-create-customer-prefix-stripped',
    sceneKey: 'chat',
    query: '新增客户 绍兴贝斯美化工股份有限公司',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(previewParams?.customer_name, '绍兴贝斯美化工股份有限公司');
  assert.notEqual(previewParams?.customer_name, '新增客户绍兴贝斯美化工股份有限公司');
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
  assert.match(response.message.content, /还没有识别到可写入内容/);
  assert.equal(response.message.content.includes('record.customer.preview_create'), false);
  assert.equal(response.message.content.includes('readyToSend'), false);
  assert.equal(response.message.extraInfo.agentTrace.pendingConfirmation, null);
  assert.equal(
    response.message.extraInfo.agentTrace.policyDecisions?.some((item) => item.policyCode === 'record.preview_empty_payload_guard'),
    true,
  );
});

test('Agent runtime stops contextual record create when duplicate candidates exist', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const companyName = '绍兴贝斯美化工股份有限公司';
  await seedCompanyContext(repository, 'conv-context-duplicate', companyName);
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
  await seedRecordContext(repository, {
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
  let searchCalled = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '客户'),
    shadowMetadataService: {
      executeSearch: async () => {
        searchCalled = true;
        return { records: [] };
      },
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
  assert.match(response.message.content, /需要先确定要更新的客户/);
  assert.equal(response.message.content.includes('record.customer.preview_update'), false);
  assert.equal(response.message.content.includes('form_inst_id'), false);
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard, undefined);
  assert.equal(searchCalled, false);
  assert.equal(previewCalled, false);
});

test('Agent runtime locates customer by name before update preview when no record context exists', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const searchInputs: any[] = [];
  const previewInputs: any[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '绍兴贝斯美化工股份有限公司'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchInputs.push(input);
        return {
          records: [{
            formInstId: 'customer-bsm-001',
            important: { 客户名称: '绍兴贝斯美化工股份有限公司' },
            fields: [
              { codeId: '_S_NAME', title: '客户名称', type: 'textWidget', value: '绍兴贝斯美化工股份有限公司', rawValue: '绍兴贝斯美化工股份有限公司', parentCodeId: null },
            ],
            fieldMap: {},
            rawRecord: { _S_NAME: '绍兴贝斯美化工股份有限公司' },
          }],
        };
      },
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
            data: [{ widgetValue: { industry: input.params?.industry } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-update-name-lookup',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美化工股份有限公司 将行业更新为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_confirmation');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'record.customer.preview_update');
  assert.equal(searchInputs.at(-1)?.filters?.[0]?.value, '绍兴贝斯美化工股份有限公司');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
  assert.equal(response.message.content.includes('record.customer.preview_update'), false);
  assert.equal(response.message.content.includes('formInstId'), false);
});

test('Agent runtime binds named customer and asks for update fields before preview', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const searchInputs: any[] = [];
  const previewInputs: any[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '客户'),
    shadowMetadataService: {
      executeSearch: async (_objectKey: ShadowObjectKey, input: any) => {
        searchInputs.push(input);
        return {
          records: [{
            formInstId: 'customer-bsm-001',
            important: { 客户名称: '绍兴贝斯美化工股份有限公司' },
            fields: [
              { codeId: '_S_NAME', title: '客户名称', type: 'textWidget', value: '绍兴贝斯美化工股份有限公司', rawValue: '绍兴贝斯美化工股份有限公司', parentCodeId: null },
            ],
            fieldMap: {},
            rawRecord: { _S_NAME: '绍兴贝斯美化工股份有限公司' },
          }],
        };
      },
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
            data: [{ widgetValue: { industry: input.params?.industry } }],
          },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const start = await service.chat({
    conversationKey: 'conv-update-name-then-fields',
    sceneKey: 'chat',
    query: '更新客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(start.executionState.status, 'waiting_input');
  assert.match(start.message.content, /需要先确定要更新的客户/);
  assert.equal(searchInputs.length, 0);
  assert.equal(previewInputs.length, 0);

  const named = await service.chat({
    conversationKey: 'conv-update-name-then-fields',
    sceneKey: 'chat',
    query: '绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(named.executionState.status, 'waiting_input');
  assert.match(named.message.content, /还需要说明要修改什么/);
  assert.match(named.message.content, /绍兴贝斯美化工股份有限公司/);
  assert.equal(named.message.content.includes('record.customer.preview_update'), false);
  assert.equal(named.message.content.includes('readyToSend'), false);
  assert.equal(named.message.extraInfo.agentTrace.pendingInteraction?.kind, 'input_required');
  assert.equal(searchInputs.at(-1)?.filters?.[0]?.value, '绍兴贝斯美');
  assert.equal(previewInputs.length, 0);

  const fieldProvided = await service.chat({
    conversationKey: 'conv-update-name-then-fields',
    sceneKey: 'chat',
    query: '将行业更新为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(fieldProvided.executionState.status, 'waiting_confirmation');
  assert.equal(fieldProvided.message.extraInfo.agentTrace.continuationResolution?.action, 'resume_pending_interaction');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
});

test('Agent runtime keeps update preview blocked when named customer is not found', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  let previewCalled = false;
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '不存在客户'),
    shadowMetadataService: {
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
  });

  const response = await service.chat({
    conversationKey: 'conv-update-name-not-found',
    sceneKey: 'chat',
    query: '更新客户 不存在客户 将行业更新为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /没有找到这个客户/);
  assert.equal(response.message.content.includes('record.customer.preview_update'), false);
  assert.equal(previewCalled, false);
});

test('Agent runtime asks user to choose when update target name matches multiple customers', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const previewInputs: any[] = [];
  const { service } = createAgentTestService({
    repository,
    intentFrame: recordIntent('customer', 'write', '绍兴贝斯美化工股份有限公司'),
    shadowMetadataService: {
      executeSearch: async () => ({
        records: [
          {
            formInstId: 'customer-bsm-001',
            important: { 客户名称: '绍兴贝斯美化工股份有限公司' },
            fields: [{ codeId: '_S_NAME', title: '客户名称', type: 'textWidget', value: '绍兴贝斯美化工股份有限公司', rawValue: '绍兴贝斯美化工股份有限公司', parentCodeId: null }],
            fieldMap: {},
            rawRecord: { _S_NAME: '绍兴贝斯美化工股份有限公司' },
          },
          {
            formInstId: 'customer-bsm-002',
            important: { 客户名称: '绍兴贝斯美化工股份有限公司华东分公司' },
            fields: [{ codeId: '_S_NAME', title: '客户名称', type: 'textWidget', value: '绍兴贝斯美化工股份有限公司华东分公司', rawValue: '绍兴贝斯美化工股份有限公司华东分公司', parentCodeId: null }],
            fieldMap: {},
            rawRecord: { _S_NAME: '绍兴贝斯美化工股份有限公司华东分公司' },
          },
        ],
      }),
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
          requestBody: { formCodeId: 'customer-form', data: [{ widgetValue: { industry: input.params?.industry } }] },
        };
      },
      executeUpsert: async () => {
        throw new Error('not used');
      },
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-name-multiple',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美化工股份有限公司 将行业更新为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(waiting.executionState.status, 'waiting_selection');
  assert.equal(waiting.message.extraInfo.agentTrace.pendingInteraction?.kind, 'candidate_selection');
  assert.match(waiting.message.content, /找到多个可能的客户/);
  assert.equal(waiting.message.content.includes('customer-bsm-001'), false);
  assert.equal(waiting.message.content.includes('record.customer.preview_update'), false);
  assert.equal(previewInputs.length, 0);

  const selected = await service.chat({
    conversationKey: 'conv-update-name-multiple',
    sceneKey: 'chat',
    query: '选择第 2 条',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(selected.executionState.status, 'waiting_confirmation');
  assert.equal(selected.message.extraInfo.agentTrace.continuationResolution?.action, 'select_candidate');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-002');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
});

test('Agent runtime update scenario 01 asks for target when customer update has no name or field', async () => {
  const { service, searchInputs, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
  });

  const response = await service.chat({
    conversationKey: 'conv-update-s01-no-target',
    sceneKey: 'chat',
    query: '更新客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /需要先确定要更新的客户/);
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard, undefined);
  assert.equal(searchInputs.length, 0);
  assert.equal(previewInputs.length, 0);
  assertNoInternalUpdateText(response.message.content);
});

test('Agent runtime update scenario 02 locates named customer then shows update field picker', async () => {
  const { service, searchInputs, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    intentName: '客户',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  await service.chat({
    conversationKey: 'conv-update-s02-customer-name',
    sceneKey: 'chat',
    query: '更新客户',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const named = await service.chat({
    conversationKey: 'conv-update-s02-customer-name',
    sceneKey: 'chat',
    query: '绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(named.executionState.status, 'waiting_input');
  assert.equal(searchInputs.at(-1)?.input?.filters?.[0]?.value, '绍兴贝斯美');
  assert.equal(previewInputs.length, 0);
  assertUpdateFieldPicker(named, '绍兴贝斯美化工股份有限公司', ['customer_status', 'industry']);
  assert.ok(
    (named.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions.length ?? 0) > 6,
    'expected update field picker to include non-first-screen writable fields',
  );
});

test('Agent runtime update field picker fills current values from executeGet', async () => {
  const detailRecord = createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司', [
    { codeId: 'Ra_0', title: '客户状态', type: 'radioWidget', value: '潜在客户' },
    { codeId: 'Industry_0', title: '行业', value: '制造业' },
  ]);
  const { service } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
    getRecordsById: { 'customer-bsm-001': detailRecord },
  });

  const response = await service.chat({
    conversationKey: 'conv-update-current-values-get',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const questionCard = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard;
  const statusQuestion = questionCard?.questions.find((question) => question.paramKey === 'customer_status');

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(statusQuestion?.currentValue, 'potential');
  assert.equal(questionCard?.currentValues.customer_status?.value, '潜在客户');
  assert.equal(questionCard?.currentValues.industry?.value, '制造业');
});

test('Agent runtime update field picker falls back to search record when executeGet fails', async () => {
  const searchRecord = createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司', [
    { codeId: 'Ra_0', title: '客户状态', type: 'radioWidget', value: '成交' },
  ]);
  const { service } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [searchRecord],
    executeGetThrows: true,
  });

  const response = await service.chat({
    conversationKey: 'conv-update-current-values-search-fallback',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const questionCard = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard;
  const statusQuestion = questionCard?.questions.find((question) => question.paramKey === 'customer_status');

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(statusQuestion?.currentValue, 'won');
  assert.equal(questionCard?.currentValues.customer_status?.value, '成交');
});

test('Agent runtime update field picker includes metadata writable fields and searchable public options', async () => {
  const fields = [
    ...createCustomerUpdateFields(),
    createSearchField({
      fieldCode: 'Ta_remark',
      label: '备注',
      widgetType: 'textAreaWidget',
      writeParameterKey: 'Ta_remark',
    }),
    createSearchField({
      fieldCode: 'Pw_0',
      label: '省',
      widgetType: 'publicOptBoxWidget',
      searchParameterKey: 'province',
      writeParameterKey: 'province',
      options: [
        { title: '安徽', dicId: 'dic-province-ah' },
        { title: '浙江', dicId: 'dic-province-zj' },
      ],
    }),
  ];
  const { service } = createUpdateScenarioService({
    objectKey: 'customer',
    fields,
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  const response = await service.chat({
    conversationKey: 'conv-update-field-picker-metadata-fields',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const questions = response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions ?? [];
  const remarkQuestion = questions.find((question) => question.paramKey === 'Ta_remark');
  const provinceQuestion = questions.find((question) => question.paramKey === 'province');

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(remarkQuestion?.label, '备注');
  assert.equal(provinceQuestion?.lookup?.source, 'field_option');
  assert.equal(provinceQuestion?.options, undefined);
});

test('Agent runtime update field picker masks reference and person current identifiers', async () => {
  const internalPersonId = 'abcdefabcdefabcdefabcdefabcdefab';
  const detailRecord = createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司', [
    { codeId: 'Ps_owner', title: '负责人', type: 'personSelectWidget', value: internalPersonId },
  ]);
  const { service } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
    getRecordsById: { 'customer-bsm-001': detailRecord },
  });

  const response = await service.chat({
    conversationKey: 'conv-update-current-values-mask-person',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const serializedCard = JSON.stringify(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard);

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.currentValues.owner_open_id?.value, '已绑定人员');
  assert.equal(serializedCard.includes(internalPersonId), false);
});

test('Agent runtime update scenario 03 submits customer status from update field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s03-customer-status',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assertUpdateFieldPicker(waiting, '绍兴贝斯美化工股份有限公司', ['customer_status']);

  const submitted = await service.chat({
    conversationKey: 'conv-update-s03-customer-status',
    sceneKey: 'chat',
    query: '客户状态=成交',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { customer_status: 'won' },
    },
  });

  assert.equal(submitted.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { customer_status: 'won' });
});

test('Agent runtime update scenario 04 submits customer industry from update field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s04-customer-industry',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const submitted = await service.chat({
    conversationKey: 'conv-update-s04-customer-industry',
    sceneKey: 'chat',
    query: '行业=电子',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { industry: '电子' },
    },
  });

  assert.equal(submitted.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
});

test('Agent runtime update scenario 05 submits multiple customer fields from update field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s05-customer-multi-fields',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const submitted = await service.chat({
    conversationKey: 'conv-update-s05-customer-multi-fields',
    sceneKey: 'chat',
    query: '客户状态=成交，行业=电子',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { customer_status: 'won', industry: '电子' },
    },
  });

  assert.equal(submitted.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.params?.customer_status, 'won');
  assert.equal(previewInputs.at(-1)?.params?.industry, '电子');
});

test('Agent runtime update scenario 06 accepts natural-language field after customer field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司')],
  });

  await service.chat({
    conversationKey: 'conv-update-s06-customer-natural-language',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const continued = await service.chat({
    conversationKey: 'conv-update-s06-customer-natural-language',
    sceneKey: 'chat',
    query: '将行业改为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(continued.executionState.status, 'waiting_confirmation');
  assert.equal(continued.message.extraInfo.agentTrace.continuationResolution?.action, 'resume_pending_interaction');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
});

test('Agent runtime update scenario 07 keeps recognized fields while selecting among duplicate customers', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [
      createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司'),
      createUpdateLiveRecord('customer', 'customer-bsm-002', '绍兴贝斯美化工股份有限公司华东分公司'),
    ],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s07-customer-multiple-with-field',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美 将行业改为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(waiting.executionState.status, 'waiting_selection');
  assert.equal(previewInputs.length, 0);

  const selected = await service.chat({
    conversationKey: 'conv-update-s07-customer-multiple-with-field',
    sceneKey: 'chat',
    query: '选择第 2 条',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(selected.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.formInstId, 'customer-bsm-002');
  assert.deepEqual(previewInputs.at(-1)?.params, { industry: '电子' });
});

test('Agent runtime update scenario 08 shows field picker after selecting duplicate customer without fields', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [
      createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司'),
      createUpdateLiveRecord('customer', 'customer-bsm-002', '绍兴贝斯美化工股份有限公司华东分公司'),
    ],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s08-customer-multiple-no-field',
    sceneKey: 'chat',
    query: '更新客户 绍兴贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(waiting.executionState.status, 'waiting_selection');

  const selected = await service.chat({
    conversationKey: 'conv-update-s08-customer-multiple-no-field',
    sceneKey: 'chat',
    query: '选择第 2 条',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(selected.executionState.status, 'waiting_input');
  assert.equal(previewInputs.length, 0);
  assertUpdateFieldPicker(selected, '绍兴贝斯美化工股份有限公司华东分公司', ['customer_status', 'industry']);
});

test('Agent runtime update scenario 09 blocks preview when named customer is not found', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'customer',
    fields: createCustomerUpdateFields(),
    searchRecords: [],
  });

  const response = await service.chat({
    conversationKey: 'conv-update-s09-customer-not-found',
    sceneKey: 'chat',
    query: '更新客户 不存在客户 将行业改为电子',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.match(response.message.content, /没有找到这个客户/);
  assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.questionCard, undefined);
  assert.equal(previewInputs.length, 0);
  assertNoInternalUpdateText(response.message.content);
});

test('Agent runtime update scenario 10 locates contact then shows contact field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'contact',
    fields: createContactUpdateFields(),
    searchRecords: [createUpdateLiveRecord('contact', 'contact-liling-001', '李玲玲')],
  });

  const response = await service.chat({
    conversationKey: 'conv-update-s10-contact-picker',
    sceneKey: 'chat',
    query: '更新联系人 李玲玲',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(previewInputs.length, 0);
  assertUpdateFieldPicker(response, '李玲玲', ['mobile_phone', 'enabled_state', 'linked_customer_form_inst_id']);
});

test('Agent runtime update scenario 11 submits contact mobile phone from field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'contact',
    fields: createContactUpdateFields(),
    searchRecords: [createUpdateLiveRecord('contact', 'contact-liling-001', '李玲玲')],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s11-contact-mobile',
    sceneKey: 'chat',
    query: '更新联系人 李玲玲',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const submitted = await service.chat({
    conversationKey: 'conv-update-s11-contact-mobile',
    sceneKey: 'chat',
    query: '手机号=13800138000',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { mobile_phone: '13800138000' },
    },
  });

  assert.equal(submitted.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.formInstId, 'contact-liling-001');
  assert.deepEqual(previewInputs.at(-1)?.params, { mobile_phone: '13800138000' });
});

test('Agent runtime update scenario 12 treats contact linked customer as reference, not province text', async () => {
  const { service, searchInputs, previewInputs } = createUpdateScenarioService({
    objectKey: 'contact',
    fields: createContactUpdateFields(),
    searchRecords: [createUpdateLiveRecord('contact', 'contact-liling-001', '李玲玲')],
    searchRecordsByObject: { customer: [] },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s12-contact-linked-customer',
    sceneKey: 'chat',
    query: '更新联系人 李玲玲',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const blocked = await service.chat({
    conversationKey: 'conv-update-s12-contact-linked-customer',
    sceneKey: 'chat',
    query: '关联客户=安徽',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { linked_customer_form_inst_id: '安徽' },
    },
  });
  const pendingParams = blocked.message.extraInfo.agentTrace.pendingInteraction?.partialInput?.params as Record<string, unknown> | undefined;
  const question = blocked.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];

  assert.equal(blocked.executionState.status, 'waiting_input');
  assert.equal(question?.paramKey, 'linked_customer_form_inst_id');
  assert.equal(question?.type, 'reference');
  assert.equal(question?.lookup?.targetObjectKey, 'customer');
  assert.equal(searchInputs.at(-1)?.objectKey, 'customer');
  assert.equal(previewInputs.length, 0);
  assert.equal(pendingParams?.province, undefined);
  assert.equal(pendingParams?.linked_customer_form_inst_id, '安徽');
});

test('Agent runtime update scenario 13 locates opportunity then shows opportunity field picker', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'opportunity',
    fields: createOpportunityWriteFields(),
    searchRecords: [createUpdateLiveRecord('opportunity', 'opportunity-digital-001', '数字化经营项目')],
  });

  const response = await service.chat({
    conversationKey: 'conv-update-s13-opportunity-picker',
    sceneKey: 'chat',
    query: '更新商机 数字化经营项目',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(previewInputs.length, 0);
  assertUpdateFieldPicker(response, '数字化经营项目', ['sales_stage', 'opportunity_budget', 'expected_close_date', 'owner_open_id']);
});

test('Agent runtime update scenario 14 asks employee clarification for ambiguous opportunity owner', async () => {
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
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'opportunity',
    fields: createOpportunityWriteFields(),
    searchRecords: [createUpdateLiveRecord('opportunity', 'opportunity-digital-001', '数字化经营项目')],
    orgEmployees: employees,
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s14-opportunity-owner',
    sceneKey: 'chat',
    query: '更新商机 数字化经营项目',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  const blocked = await service.chat({
    conversationKey: 'conv-update-s14-opportunity-owner',
    sceneKey: 'chat',
    query: '负责人=陈伟',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: { owner_open_id: '陈伟' },
    },
  });
  const question = blocked.message.extraInfo.agentTrace.pendingInteraction?.questionCard?.questions[0];

  assert.equal(blocked.executionState.status, 'waiting_input');
  assert.equal(previewInputs.length, 0);
  assert.equal(question?.paramKey, 'owner_open_id');
  assert.equal(question?.lookup?.source, 'employee');
  assert.equal(question?.options?.some((option) => option.label.includes('open-chen')), false);
  assert.equal(blocked.message.content.includes('open-chen'), false);
});

test('Agent runtime update scenario 15 locates followup then updates method and content', async () => {
  const { service, previewInputs } = createUpdateScenarioService({
    objectKey: 'followup',
    fields: createFollowupWriteFields(),
    searchRecords: [createUpdateLiveRecord('followup', 'followup-quote-001', '报价回访')],
  });

  const waiting = await service.chat({
    conversationKey: 'conv-update-s15-followup-picker',
    sceneKey: 'chat',
    query: '更新拜访记录 报价回访',
    tenantContext: { operatorOpenId: 'operator-001' },
  });
  assert.equal(waiting.executionState.status, 'waiting_input');
  assertUpdateFieldPicker(waiting, '报价回访', ['followup_record', 'followup_method']);

  const submitted = await service.chat({
    conversationKey: 'conv-update-s15-followup-picker',
    sceneKey: 'chat',
    query: '跟进方式=电话，跟进记录=客户让下周带方案',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: waiting.message.extraInfo.agentTrace.pendingInteraction!.interactionId,
      answers: {
        followup_method: 'phone',
        followup_record: '客户让下周带方案',
      },
    },
  });

  assert.equal(submitted.executionState.status, 'waiting_confirmation');
  assert.equal(previewInputs.at(-1)?.formInstId, 'followup-quote-001');
  assert.equal(previewInputs.at(-1)?.params?.followup_method, 'phone');
  assert.equal(previewInputs.at(-1)?.params?.followup_record, '客户让下周带方案');
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
    await seedRecordContext(repository, {
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
  await seedRecordContext(repository, {
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
  await seedRecordContext(repository, {
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
  await seedRecordContext(repository, {
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
      { objectKey: 'contact', formCodeId: 'contact-form' },
      { objectKey: 'followup', formCodeId: 'followup-form' },
    ],
    getObject: (objectKey: ShadowObjectKey) => ({
      fields: objectKey === 'followup'
        ? createFollowupWriteFields()
        : objectKey === 'contact'
          ? createContactUpdateFields()
          : createCustomerLookupFields(),
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

  const publicOptionResponse = await buildMetaQuestionOptionsResponse({
    config: createTestConfig(),
    shadowMetadataService: shadowMetadataService as any,
    orgSyncRepository: createEmployeeLookup([]),
    request: {
      toolCode: 'record.contact.preview_update',
      paramKey: 'province',
      keyword: '安',
      pageSize: 10,
    },
  });
  assert.deepEqual(publicOptionResponse.options.map((option) => option.label), ['安徽']);
  assert.equal(publicOptionResponse.options[0]?.source, 'field_option');
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
    query: '新增跟进记录 已电话沟通',
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
  assert.equal(previewInput.params.followup_record, '已电话沟通');
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

test('Agent run repository prefers persisted context subject over legacy intent fallback', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  await seedRecordContext(repository, {
    conversationKey: 'conv-persisted-context',
    objectKey: 'customer',
    formInstId: 'customer-live-001',
    name: '上海松井机械有限公司',
  });

  const context = await repository.findContextFrame('conv-persisted-context');

  assert.equal(context?.subject?.type, 'customer');
  assert.equal(context?.subject?.id, 'customer-live-001');
  assert.equal(context?.subject?.name, '上海松井机械有限公司');
});

test('Agent run repository skips opaque external id context and keeps recent record subject', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-skip-opaque-external-context';
  const formInstId = '69f16bc40f31d40001b288bd';
  await seedRecordContext(repository, {
    conversationKey,
    objectKey: 'opportunity',
    formInstId,
    name: '数字化经营项目',
  });
  await seedCompanyContext(repository, conversationKey, formInstId);

  const context = await repository.findContextFrame(conversationKey);

  assert.equal(context?.subject?.kind, 'record');
  assert.equal(context?.subject?.type, 'opportunity');
  assert.equal(context?.subject?.id, formInstId);
});

test('Agent run repository skips collection query intent targets as context candidates', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const conversationKey = 'conv-collection-intent-targets';
  await saveRunWithoutContext(repository, {
    conversationKey,
    runId: 'run-collection-contact-label',
    query: '查询联系人',
    intentFrame: pollutedRecordQueryIntent('contact', '联系人', 'contact'),
  });
  await saveRunWithoutContext(repository, {
    conversationKey,
    runId: 'run-collection-customer-stale-name',
    query: '查询客户',
    intentFrame: pollutedRecordQueryIntent('customer', '苏州恒达机电有限公司'),
  });

  const candidates = await repository.findContextCandidates(conversationKey);
  const context = await repository.findContextFrame(conversationKey);

  assert.equal(candidates.some((candidate) => candidate.sourceRunId === 'run-collection-contact-label'), false);
  assert.equal(candidates.some((candidate) => candidate.sourceRunId === 'run-collection-customer-stale-name'), false);
  assert.equal(context, null);
});

test('Agent runtime uses subject-bound relation filter for contextual contact search', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  await seedRecordContext(repository, {
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
  await seedRecordContext(repository, {
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
  const context = await repository.findContextFrame('conv-child-write-parent-context');
  assert.equal(context?.subject?.type, 'customer');
  assert.equal(context?.subject?.id, 'customer-live-001');
  assert.equal(context?.subject?.name, '上海松井机械有限公司');
});

test('Agent runtime summarizes customer journey from current context', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  await seedRecordContext(repository, {
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

test('Agent runtime blocks visit prep when selected customer has no company research markdown', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const calls: Array<{ tool: string; input?: unknown }> = [];
  const customer = createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司');
  const { service } = createAgentTestService({
    repository,
    intentFrame: companyIntent('贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        calls.push({ tool: `record.${objectKey}.search`, input: searchInput });
        return { records: [customer], totalElements: 1 };
      },
    },
    externalSkillService: {
      createSkillJob: async () => {
        calls.push({ tool: 'ext.yunzhijia_visit_prep' });
        throw new Error('should not invoke visit prep without customer company research');
      },
      getSkillJob: async () => {
        throw new Error('not used');
      },
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    },
    artifactService: {
      findCompanyResearchArtifactsForVisitPrep: async (input: any) => {
        calls.push({ tool: 'artifact.company_research.lookup', input });
        return [];
      },
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      createAnalysisMaterialArtifact: async () => {
        throw new Error('not used');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-visit-prep-missing-research',
    sceneKey: 'chat',
    query: '/拜访准备 贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'waiting_input');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'external.yunzhijia_visit_prep');
  assert.equal(calls.some((item) => item.tool === 'record.customer.search'), true);
  assert.equal(calls.some((item) => item.tool === 'ext.yunzhijia_visit_prep'), false);
  assert.equal(calls.some((item) => item.tool === 'artifact.company_research.lookup'), true);
  assert.match(response.message.content, /\/公司研究 绍兴贝斯美化工股份有限公司/);
});

test('Agent runtime invokes visit prep with selected customer research and does not save analysis material', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const calls: Array<{ tool: string; input?: any }> = [];
  const companyName = '绍兴贝斯美化工股份有限公司';
  const visitPrepMarkdown = `# ${companyName} 拜访讲解准备\n\n## 一、客户画像速览\n贝斯美关注统一门户和流程审批。\n\n## 二、需求理解与方案匹配\n统一门户与统一流程管理匹配客户关注点。`;
  const customer = createUpdateLiveRecord('customer', 'customer-bsm-001', companyName);
  const { service } = createAgentTestService({
    repository,
    config: createTestConfig({ envFilePath: '/tmp/yzj-ai-crm-admin-api-test/.env' }),
    companyResearchMaxWaitMs: 0,
    intentFrame: companyIntent('贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        calls.push({ tool: `record.${objectKey}.search`, input: searchInput });
        return { records: [customer], totalElements: 1 };
      },
    },
    externalSkillService: {
      getSkillAssetMaterialization: () => ({
        enabled: false,
        label: '本轮对话结果',
        description: '客户拜访准备仅返回本轮对话 Markdown，不沉淀为资料资产。',
      }),
      createSkillJob: async (toolCode: string, payload: any) => {
        calls.push({ tool: toolCode, input: payload });
        return { jobId: 'job-visit-prep-001', status: 'running', artifacts: [] };
      },
      getSkillJob: async () => ({
        jobId: 'job-visit-prep-001',
        skillCode: 'ext.yunzhijia_visit_prep',
        runtimeSkillName: 'yunzhijia-visit-prep',
        model: null,
        status: 'succeeded',
        finalText: '拜访准备摘要',
        events: [],
        artifacts: [{
          artifactId: 'visit-prep-md-001',
          jobId: 'job-visit-prep-001',
          fileName: 'yunzhijia-visit-prep-job-visit-prep-001.md',
          mimeType: 'text/markdown',
          byteSize: Buffer.byteLength(visitPrepMarkdown),
          createdAt: new Date().toISOString(),
          downloadPath: '/api/external-skills/jobs/job-visit-prep-001/artifacts/visit-prep-md-001',
        }],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => ({
        artifact: {
          artifactId: 'visit-prep-md-001',
          jobId: 'job-visit-prep-001',
          fileName: 'yunzhijia-visit-prep-job-visit-prep-001.md',
          mimeType: 'text/markdown',
          byteSize: Buffer.byteLength(visitPrepMarkdown),
          createdAt: new Date().toISOString(),
          downloadPath: '/api/external-skills/jobs/job-visit-prep-001/artifacts/visit-prep-md-001',
        },
        content: Buffer.from(visitPrepMarkdown),
      }),
    },
    artifactService: {
      findCompanyResearchArtifactsForVisitPrep: async (input: any) => {
        calls.push({ tool: 'artifact.company_research.lookup', input });
        return [createVisitPrepCompanyResearchDetail({
          companyName,
          customerId: 'customer-bsm-001',
          customerName: companyName,
        })];
      },
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      createAnalysisMaterialArtifact: async (input: any) => {
        calls.push({ tool: 'artifact.analysis_material', input });
        throw new Error('visit prep should not create analysis material when materialization is disabled');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-visit-prep-success',
    sceneKey: 'chat',
    query: '/拜访准备 贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  const skillCall = calls.find((item) => item.tool === 'ext.yunzhijia_visit_prep');
  const artifactCall = calls.find((item) => item.tool === 'artifact.analysis_material');
  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'external.yunzhijia_visit_prep');
  assert.ok(skillCall);
  assert.match(skillCall.input.requestText, /客户初步需求：未提供/);
  assert.equal(skillCall.input.attachments.length, 1);
  assert.match(skillCall.input.attachments[0], /company-research\.md$/);
  assert.doesNotThrow(() => readFileSync(skillCall.input.attachments[0], 'utf8'));
  assert.equal(artifactCall, undefined);
  assert.deepEqual(response.message.extraInfo.evidence ?? [], []);
  assert.equal(response.message.attachments?.[0]?.name, 'yunzhijia-visit-prep-job-visit-prep-001.md');
  assert.equal(response.message.attachments?.[0]?.type, 'text/markdown');
  assert.doesNotMatch(response.message.content, /客户拜访准备已生成/);
  assert.doesNotMatch(response.message.content, /资料沉淀：本轮对话结果/);
  assert.match(response.message.content, /客户画像速览/);
  assert.equal(response.message.content, visitPrepMarkdown);
});

test('Agent runtime blocks visit prep when skill job fails without degraded material', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const calls: Array<{ tool: string; input?: any }> = [];
  const companyName = '绍兴贝斯美化工股份有限公司';
  const customer = createUpdateLiveRecord('customer', 'customer-bsm-001', companyName);
  const { service } = createAgentTestService({
    repository,
    config: createTestConfig({ envFilePath: '/tmp/yzj-ai-crm-admin-api-test/.env' }),
    companyResearchMaxWaitMs: 0,
    intentFrame: companyIntent('贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        calls.push({ tool: `record.${objectKey}.search`, input: searchInput });
        return { records: [customer], totalElements: 1 };
      },
    },
    externalSkillService: {
      getSkillAssetMaterialization: () => ({
        enabled: false,
        label: '本轮对话结果',
        description: '客户拜访准备仅返回本轮对话 Markdown，不沉淀为资料资产。',
      }),
      createSkillJob: async (toolCode: string, payload: any) => {
        calls.push({ tool: toolCode, input: payload });
        return { jobId: 'job-visit-prep-failed', status: 'running', artifacts: [] };
      },
      getSkillJob: async () => ({
        jobId: 'job-visit-prep-failed',
        skillCode: 'ext.yunzhijia_visit_prep',
        runtimeSkillName: 'yunzhijia-visit-prep',
        model: null,
        status: 'failed',
        finalText: null,
        events: [],
        artifacts: [],
        error: { message: '模型服务超时' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    },
    artifactService: {
      findCompanyResearchArtifactsForVisitPrep: async (input: any) => {
        calls.push({ tool: 'artifact.company_research.lookup', input });
        return [createVisitPrepCompanyResearchDetail({
          companyName,
          customerId: 'customer-bsm-001',
          customerName: companyName,
        })];
      },
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      createAnalysisMaterialArtifact: async () => {
        throw new Error('visit prep failure should not create analysis material');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
  });

  const response = await service.chat({
    conversationKey: 'conv-visit-prep-failed',
    sceneKey: 'chat',
    query: '/拜访准备 贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  assert.equal(response.executionState.status, 'tool_unavailable');
  assert.match(response.message.content, /客户拜访准备执行失败/);
  assert.match(response.message.content, /模型服务超时/);
  assert.doesNotMatch(response.message.content, /客户拜访准备已生成/);
  assert.equal(response.message.extraInfo.evidence?.length ?? 0, 0);
  assert.equal(response.message.attachments?.length ?? 0, 0);
});

test('Agent runtime shows single-select customer card when visit prep matches multiple customers', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const calls: Array<{ tool: string; input?: any }> = [];
  const customerA = createUpdateLiveRecord('customer', 'customer-bsm-001', '绍兴贝斯美化工股份有限公司');
  const customerB = createUpdateLiveRecord('customer', 'customer-bsm-002', '浙江贝斯美材料有限公司');
  const { service } = createAgentTestService({
    repository,
    config: createTestConfig({ envFilePath: '/tmp/yzj-ai-crm-admin-api-test/.env' }),
    intentFrame: companyIntent('贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        calls.push({ tool: `record.${objectKey}.search`, input: searchInput });
        return { records: [customerA, customerB], totalElements: 2 };
      },
    },
    externalSkillService: {
      getSkillAssetMaterialization: () => ({ enabled: false, label: '本轮对话结果' }),
      createSkillJob: async (toolCode: string, payload: any) => {
        calls.push({ tool: toolCode, input: payload });
        return { jobId: 'job-visit-prep-multi-customer', status: 'running', artifacts: [] };
      },
      getSkillJob: async () => ({
        jobId: 'job-visit-prep-multi-customer',
        skillCode: 'ext.yunzhijia_visit_prep',
        runtimeSkillName: 'yunzhijia-visit-prep',
        model: null,
        status: 'succeeded',
        finalText: '# 浙江贝斯美材料有限公司 拜访准备\n\n## 客户画像速览\n已生成。',
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
      findCompanyResearchArtifactsForVisitPrep: async (input: any) => {
        calls.push({ tool: 'artifact.company_research.lookup', input });
        return [createVisitPrepCompanyResearchDetail({
          companyName: '浙江贝斯美材料有限公司',
          customerId: input.customerId,
          customerName: input.customerName,
        })];
      },
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      createAnalysisMaterialArtifact: async () => {
        throw new Error('not used');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-visit-prep-multi-customer',
    sceneKey: 'chat',
    query: '/拜访准备 贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  const question = pending?.questionCard?.questions[0];
  assert.equal(waiting.executionState.status, 'waiting_input');
  assert.equal(question?.type, 'single_select');
  assert.equal(question?.paramKey, 'customerChoice');
  assert.deepEqual(question?.options?.map((item) => item.label), [
    '绍兴贝斯美化工股份有限公司',
    '浙江贝斯美材料有限公司',
  ]);

  const continued = await service.chat({
    conversationKey: 'conv-visit-prep-multi-customer',
    sceneKey: 'chat',
    query: '选择浙江贝斯美材料有限公司',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        customerChoice: 'customer:customer-bsm-002',
      },
    },
  });

  const researchCall = calls.find((item) => item.tool === 'artifact.company_research.lookup');
  assert.equal(continued.executionState.status, 'completed');
  assert.equal(researchCall?.input.customerId, 'customer-bsm-002');
  assert.equal(calls.some((item) => item.tool === 'ext.yunzhijia_visit_prep'), true);
});

test('Agent runtime shows single-select research card when selected customer has multiple company research materials', async () => {
  const repository = new AgentRunRepository(createInMemoryDatabase());
  const calls: Array<{ tool: string; input?: any }> = [];
  const companyName = '绍兴贝斯美化工股份有限公司';
  const customer = createUpdateLiveRecord('customer', 'customer-bsm-001', companyName);
  const researchA = createVisitPrepCompanyResearchDetail({
    companyName,
    artifactId: 'artifact-company-research-old',
    version: 1,
    customerId: 'customer-bsm-001',
    customerName: companyName,
    markdown: `# ${companyName} 公司研究旧版\n\n旧版材料。`,
  });
  const researchB = createVisitPrepCompanyResearchDetail({
    companyName,
    artifactId: 'artifact-company-research-new',
    version: 2,
    customerId: 'customer-bsm-001',
    customerName: companyName,
    markdown: `# ${companyName} 公司研究新版\n\n新版材料。`,
  });
  const { service } = createAgentTestService({
    repository,
    config: createTestConfig({ envFilePath: '/tmp/yzj-ai-crm-admin-api-test/.env' }),
    intentFrame: companyIntent('贝斯美'),
    shadowMetadataService: {
      executeSearch: async (objectKey: ShadowObjectKey, searchInput: any) => {
        calls.push({ tool: `record.${objectKey}.search`, input: searchInput });
        return { records: [customer], totalElements: 1 };
      },
    },
    externalSkillService: {
      getSkillAssetMaterialization: () => ({ enabled: false, label: '本轮对话结果' }),
      createSkillJob: async (toolCode: string, payload: any) => {
        calls.push({ tool: toolCode, input: payload });
        return { jobId: 'job-visit-prep-research-choice', status: 'running', artifacts: [] };
      },
      getSkillJob: async () => ({
        jobId: 'job-visit-prep-research-choice',
        skillCode: 'ext.yunzhijia_visit_prep',
        runtimeSkillName: 'yunzhijia-visit-prep',
        model: null,
        status: 'succeeded',
        finalText: '# 绍兴贝斯美化工股份有限公司 拜访准备\n\n## 客户画像速览\n已基于新版材料生成。',
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
      findCompanyResearchArtifactsForVisitPrep: async (input: any) => {
        calls.push({ tool: 'artifact.company_research.lookup', input });
        return [researchA, researchB];
      },
      getArtifact: async (artifactId: string) => {
        calls.push({ tool: 'artifact.get', input: { artifactId } });
        return artifactId === researchB.artifact.artifactId ? researchB : researchA;
      },
      createCompanyResearchArtifact: async () => {
        throw new Error('not used');
      },
      createAnalysisMaterialArtifact: async () => {
        throw new Error('not used');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    },
  });

  const waiting = await service.chat({
    conversationKey: 'conv-visit-prep-research-choice',
    sceneKey: 'chat',
    query: '/拜访准备 贝斯美',
    tenantContext: { operatorOpenId: 'operator-001' },
  });

  const pending = waiting.message.extraInfo.agentTrace.pendingInteraction;
  const question = pending?.questionCard?.questions[0];
  assert.equal(waiting.executionState.status, 'waiting_input');
  assert.equal(question?.type, 'single_select');
  assert.equal(question?.paramKey, 'companyResearchArtifactId');
  assert.equal(question?.options?.length, 2);

  const continued = await service.chat({
    conversationKey: 'conv-visit-prep-research-choice',
    sceneKey: 'chat',
    query: '使用新版材料',
    tenantContext: { operatorOpenId: 'operator-001' },
    resume: {
      runId: waiting.executionState.runId,
      action: 'provide_input',
      interactionId: pending!.interactionId,
      answers: {
        companyResearchArtifactId: 'research:artifact-company-research-new',
      },
    },
  });

  assert.equal(continued.executionState.status, 'completed');
  assert.equal(calls.some((item) => item.tool === 'artifact.get' && item.input.artifactId === 'artifact-company-research-new'), true);
  assert.equal(calls.some((item) => item.tool === 'ext.yunzhijia_visit_prep'), true);
});
