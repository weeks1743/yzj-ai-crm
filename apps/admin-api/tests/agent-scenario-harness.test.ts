import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { MainAgentRuntime } from '../src/agent-runtime.js';
import { AgentService } from '../src/agent-service.js';
import { createCrmAgentRuntimeParts } from '../src/crm-agent-pack.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type {
  AgentChatRequest,
  AgentChatResponse,
  AgentEvidenceCard,
  IntentFrame,
  ShadowObjectKey,
  ShadowPreviewResponse,
  ShadowPreviewUpsertInput,
  ShadowStandardizedField,
} from '../src/contracts.js';

const TEST_OPERATOR_OPEN_ID = '69e75eb5e4b0e65b61c014da';

interface HarnessMock {
  searchRecords?: unknown[];
  previewReady?: boolean;
  previewEmptyPayload?: boolean;
  blockedReadonlyParams?: string[];
  validationErrors?: string[];
  companyResearchFailure?: boolean;
  artifactEvidence?: AgentEvidenceCard[];
  intentFrame?: IntentFrame;
}

interface HarnessTurn {
  query: string;
  mock?: HarnessMock;
  omitOperator?: boolean;
  resumeDecision?: 'approve' | 'reject';
  expect: {
    status?: AgentChatResponse['executionState']['status'];
    selectedTool?: string;
    contentIncludes?: string[];
    contentExcludes?: string[];
    pendingConfirmation?: boolean;
    pendingInteractionKind?: 'input_required' | 'candidate_selection' | 'confirmation';
    continuationAction?: string;
    policyCode?: string;
    noToolPrefix?: string;
    assert?: (response: AgentChatResponse, harness: AgentScenarioHarness) => void;
  };
}

interface AgentScenario {
  id: string;
  title: string;
  turns: HarnessTurn[];
  assertRegistry?: boolean;
  qualityGate?: boolean;
}

interface LoggedCall {
  tool: string;
  objectKey?: ShadowObjectKey;
  input?: unknown;
}

interface TraceQualityReport {
  scenarioId: string;
  turnIndex: number;
  query: string;
  bugProbability: number;
  riskFactors: string[];
  hardFailures: string[];
  recommendedFixArea: Array<'intent' | 'context' | 'tool input' | 'field extraction' | 'memory' | 'debug'>;
}

const CRM_OBJECT_KEYS: ShadowObjectKey[] = ['customer', 'contact', 'opportunity', 'followup'];
const recordObjectTitles: Record<ShadowObjectKey, string> = {
  customer: '客户',
  contact: '联系人',
  opportunity: '商机',
  followup: '商机跟进记录',
};

class AgentScenarioHarness {
  readonly repository = new AgentRunRepository(createInMemoryDatabase());
  readonly calls: LoggedCall[] = [];
  readonly qualityReports: TraceQualityReport[] = [];
  readonly service: AgentService;
  readonly registryCodes: string[];
  activeMock: HarnessMock = {};

  constructor() {
    const config = createTestConfig();
    const runtimeParts = createCrmAgentRuntimeParts({
      config,
      repository: this.repository,
      intentFrameService: {
        createIntentFrame: async (request: AgentChatRequest, focusedName?: string | null) => (
          this.activeMock.intentFrame ?? inferIntentFrame(request.query, focusedName)
        ),
      } as any,
      shadowMetadataService: {
        executeSearch: async (objectKey: ShadowObjectKey, input: unknown) => {
          this.calls.push({ tool: `record.${objectKey}.search`, objectKey, input });
          return { records: this.activeMock.searchRecords ?? [] };
        },
        executeGet: async (objectKey: ShadowObjectKey, input: unknown) => {
          this.calls.push({ tool: `record.${objectKey}.get`, objectKey, input });
          const formInstId = typeof (input as { formInstId?: unknown })?.formInstId === 'string'
            ? (input as { formInstId: string }).formInstId
            : `${objectKey}-form-inst-001`;
          return { record: recordFixture(objectKey, formInstId, `${recordObjectTitles[objectKey]}样例`) };
        },
        previewUpsert: async (objectKey: ShadowObjectKey, input: ShadowPreviewUpsertInput) => {
          const mode = input.mode === 'update' ? 'update' : 'create';
          this.calls.push({ tool: `record.${objectKey}.preview_${mode}`, objectKey, input });
          return buildPreviewResponse(objectKey, input, this.activeMock);
        },
        executeUpsert: async (objectKey: ShadowObjectKey, input: ShadowPreviewUpsertInput) => {
          const mode = input.mode === 'update' ? 'update' : 'create';
          this.calls.push({ tool: `record.${objectKey}.commit_${mode}`, objectKey, input });
          return {
            objectKey,
            operation: 'upsert',
            mode: 'live',
            writeMode: mode,
            requestBody: { formCodeId: `${objectKey}-form`, data: [{ widgetValue: input.params ?? {} }] },
            formInstIds: [`${objectKey}-form-inst-001`],
          };
        },
        getObject: (objectKey: ShadowObjectKey) => ({
          objectKey,
          formCodeId: `${objectKey}-form`,
          title: recordObjectTitles[objectKey],
          fields: harnessRecordFields[objectKey],
        }),
        listObjects: () => CRM_OBJECT_KEYS.map((objectKey) => ({
          objectKey,
          formCodeId: `${objectKey}-form`,
          title: recordObjectTitles[objectKey],
        })),
      } as any,
      externalSkillService: {
        createSkillJob: async () => {
          this.calls.push({ tool: 'external.company_research' });
          if (this.activeMock.companyResearchFailure) {
            throw new Error('mock company research failed');
          }
          return { jobId: 'job-company-research-001', status: 'running', artifacts: [] };
        },
        getSkillJob: async () => ({
          jobId: 'job-company-research-001',
          skillName: 'ext.company_research_pm',
          status: 'succeeded',
          artifacts: [{ artifactId: 'skill-artifact-001', name: 'research.md', mimeType: 'text/markdown', size: 128 }],
          finalText: '# 公司研究\n\n销售切入点：关注预算、组织变化和数字化项目。',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getSkillJobArtifact: async () => ({
          content: Buffer.from('# 公司研究\n\n销售切入点：关注预算、组织变化和数字化项目。'),
          mimeType: 'text/markdown',
        }),
      } as any,
      artifactService: {
        createCompanyResearchArtifact: async (input: any) => {
          this.calls.push({ tool: 'artifact.company_research', input });
          return {
            artifact: {
              artifactId: 'artifact-company-001',
              versionId: 'artifact-version-001',
              title: input.title,
              version: 1,
              sourceToolCode: input.sourceToolCode,
              vectorStatus: 'indexed',
              chunkCount: 3,
            },
          };
        },
        search: async (input: any) => {
          this.calls.push({ tool: 'artifact.search', input });
          const evidence = this.activeMock.artifactEvidence ?? [{
            artifactId: 'artifact-company-001',
            versionId: 'artifact-version-001',
            title: '苏州金蝶软件有限公司 公司研究',
            version: 1,
            sourceToolCode: 'ext.company_research_pm',
            anchorIds: ['苏州金蝶软件有限公司'],
            snippet: '近期值得关注：预算周期、业务系统升级和关键人变化。',
            score: 0.91,
          }];
          return {
            query: input.query,
            vectorStatus: 'searched',
            qdrantFilter: { anchors: input.anchors ?? [] },
            evidence,
          };
        },
      } as any,
      companyResearchMaxWaitMs: 10,
    });

    this.registryCodes = runtimeParts.registry.list().map((tool) => tool.code).sort();
    this.service = new AgentService({
      config,
      repository: this.repository,
      runtime: new MainAgentRuntime({
        config,
        registry: runtimeParts.registry,
        intentResolver: runtimeParts.intentResolver,
        planner: runtimeParts.planner,
      }),
    });
  }
}

async function runAgentScenarios(scenarios: AgentScenario[]): Promise<void> {
  for (const scenario of scenarios) {
    const harness = new AgentScenarioHarness();
    if (scenario.assertRegistry) {
      assert.equal(harness.registryCodes.some((code) => code.startsWith('scene.')), false, `${scenario.id}: registry should not include scene.*`);
      assert.equal(harness.registryCodes.some((code) => code.includes('.delete')), false, `${scenario.id}: registry should not include delete tools`);
    }

    let previous: AgentChatResponse | null = null;
    for (const [turnIndex, turn] of scenario.turns.entries()) {
      harness.activeMock = turn.mock ?? {};
      const resume = turn.resumeDecision
        ? {
            runId: previous?.executionState.runId ?? '',
            action: 'confirm_writeback' as const,
            decision: turn.resumeDecision,
            confirmationId: previous?.message.extraInfo.agentTrace.pendingConfirmation?.confirmationId,
          }
        : undefined;
      const beforeCallCount = harness.calls.length;
      const response = await harness.service.chat({
        conversationKey: `harness-${scenario.id}`,
        sceneKey: 'chat',
        query: turn.query,
        tenantContext: turn.omitOperator ? undefined : { operatorOpenId: TEST_OPERATOR_OPEN_ID },
        resume,
      });
      assertTurnExpectation(scenario, turnIndex, turn, response, harness, beforeCallCount);
      if (scenario.qualityGate) {
        assertTraceQuality(scenario, turnIndex, turn, response, harness, beforeCallCount);
      }
      previous = response;
    }
  }
}

function assertTurnExpectation(
  scenario: AgentScenario,
  turnIndex: number,
  turn: HarnessTurn,
  response: AgentChatResponse,
  harness: AgentScenarioHarness,
  beforeCallCount: number,
): void {
  const label = `${scenario.id} turn ${turnIndex + 1}`;
  const trace = response.message.extraInfo.agentTrace;
  if (turn.expect.status) {
    assert.equal(response.executionState.status, turn.expect.status, `${label}: status\n${response.message.content}`);
  }
  if (turn.expect.selectedTool) {
    assert.equal(trace.selectedTool?.toolCode, turn.expect.selectedTool, `${label}: selected tool`);
  }
  for (const content of turn.expect.contentIncludes ?? []) {
    assert.match(response.message.content, new RegExp(escapeRegExp(content)), `${label}: content should include ${content}`);
  }
  for (const content of turn.expect.contentExcludes ?? []) {
    assert.doesNotMatch(response.message.content, new RegExp(escapeRegExp(content)), `${label}: content should not include ${content}`);
  }
  if (typeof turn.expect.pendingConfirmation === 'boolean') {
    assert.equal(Boolean(trace.pendingConfirmation), turn.expect.pendingConfirmation, `${label}: pending confirmation`);
  }
  if (turn.expect.pendingInteractionKind) {
    assert.equal(trace.pendingInteraction?.kind, turn.expect.pendingInteractionKind, `${label}: pending interaction kind`);
  }
  if (turn.expect.continuationAction) {
    assert.equal(trace.continuationResolution?.action, turn.expect.continuationAction, `${label}: continuation action`);
  }
  if (turn.expect.policyCode) {
    assert.equal(trace.policyDecisions?.some((item) => item.policyCode === turn.expect.policyCode), true, `${label}: policy ${turn.expect.policyCode}`);
  }
  if (turn.expect.noToolPrefix) {
    const calls = harness.calls.slice(beforeCallCount);
    assert.equal(calls.some((item) => item.tool.startsWith(turn.expect.noToolPrefix!)), false, `${label}: should not call ${turn.expect.noToolPrefix}`);
  }
  turn.expect.assert?.(response, harness);
}

function assertTraceQuality(
  scenario: AgentScenario,
  turnIndex: number,
  turn: HarnessTurn,
  response: AgentChatResponse,
  harness: AgentScenarioHarness,
  beforeCallCount: number,
): void {
  const report = inspectTraceQuality(scenario, turnIndex, turn, response, harness, beforeCallCount);
  harness.qualityReports.push(report);
  assert.deepEqual(report.hardFailures, [], `${scenario.id} turn ${turnIndex + 1}: QA hard failures\n${JSON.stringify(report, null, 2)}`);
  assert.ok(report.bugProbability < 0.15, `${scenario.id} turn ${turnIndex + 1}: QA risk too high\n${JSON.stringify(report, null, 2)}`);
}

function inspectTraceQuality(
  scenario: AgentScenario,
  turnIndex: number,
  turn: HarnessTurn,
  response: AgentChatResponse,
  harness: AgentScenarioHarness,
  beforeCallCount: number,
): TraceQualityReport {
  const trace = response.message.extraInfo.agentTrace;
  const selectedToolCode = trace.selectedTool?.toolCode ?? '';
  const selectedInput = (trace.selectedTool?.input ?? {}) as Record<string, any>;
  const selectedParams = readEffectiveSelectedParams(trace);
  const hardFailures: string[] = [];
  const riskFactors: string[] = [];
  const recommendedFixArea = new Set<TraceQualityReport['recommendedFixArea'][number]>();
  const addHard = (area: TraceQualityReport['recommendedFixArea'][number], reason: string): void => {
    hardFailures.push(reason);
    recommendedFixArea.add(area);
  };
  const addRisk = (area: TraceQualityReport['recommendedFixArea'][number], reason: string): void => {
    riskFactors.push(reason);
    recommendedFixArea.add(area);
  };

  if (selectedToolCode.includes('.preview_') && hasUserFieldValueSignal(turn.query) && Object.keys(selectedParams).length === 0) {
    addHard('field extraction', '写入意图包含字段和值，但 preview params 为空。');
  }

  if (trace.policyDecisions?.some((policy) => policy.policyCode === 'record.preview_empty_payload_guard') && hasUserFieldValueSignal(turn.query)) {
    addHard('field extraction', '用户原文有可写字段值，却触发空 payload 守卫。');
  }

  const confirmationInput = trace.pendingConfirmation?.requestInput as Record<string, any> | undefined;
  if (trace.pendingConfirmation && selectedToolCode.includes('.preview_') && Object.keys(readParamsFromInput(confirmationInput ?? {})).length === 0) {
    addHard('tool input', 'readyToSend 写入确认缺少实际业务 params。');
  }

  const objectKey = parseToolObjectKey(selectedToolCode);
  if (objectKey && selectedToolCode.endsWith('.search') && isHarnessBareCollectionQuery(turn.query, objectKey)) {
    if (trace.resolvedContext?.usedContext) {
      addHard('context', '裸集合查询错误使用历史上下文。');
    }
    if (trace.resolvedContext?.usageMode && trace.resolvedContext.usageMode !== 'skipped_collection_query') {
      addRisk('debug', '裸集合查询未标记 skipped_collection_query，调试区难以看出跳过原因。');
    }
    if (harness.repository.getRunDetail(response.executionState.runId)?.contextSubject) {
      addHard('memory', '裸集合查询把当前 run 沉淀成了新的上下文主体。');
    }
  }

  const currentCalls = harness.calls.slice(beforeCallCount);
  for (const call of currentCalls.filter((item) => item.tool.endsWith('.search'))) {
    const callObjectKey = call.objectKey;
    if (!callObjectKey || !isHarnessBareCollectionQuery(turn.query, callObjectKey)) {
      continue;
    }
    const intentTarget = readFirstIntentTargetName(trace.intentFrame);
    if (intentTarget && !isGroundedHarnessTarget(turn.query, callObjectKey, intentTarget)) {
      if (searchCallContainsValue(call, intentTarget)) {
        addHard('tool input', `未落在用户原文中的 LLM target 进入搜索过滤：${intentTarget}`);
      } else if (!selectedInput.agentControl?.targetSanitization) {
        addRisk('debug', `未落地 LLM target 未进入过滤，但调试 trace 缺少 targetSanitization：${intentTarget}`);
      }
    }
  }

  if (selectedToolCode.includes('.preview_') && response.executionState.status === 'waiting_confirmation') {
    for (const [paramKey, value] of Object.entries(selectedParams)) {
      if (!paramKey.endsWith('_form_inst_id')) {
        continue;
      }
      const text = stringifyQaValue(value);
      if (/[\u4e00-\u9fa5]/.test(text) && !/form-inst|customer-|contact-|opportunity-|followup-/.test(text)) {
        addHard('tool input', `关系字段 ${paramKey} 被普通文本值直接写入：${text}`);
      }
    }
  }

  const bugProbability = hardFailures.length
    ? 0.95
    : Math.min(0.14, riskFactors.length * 0.05);
  return {
    scenarioId: scenario.id,
    turnIndex,
    query: turn.query,
    bugProbability,
    riskFactors,
    hardFailures,
    recommendedFixArea: Array.from(recommendedFixArea),
  };
}

function readParamsFromInput(input: Record<string, any>): Record<string, unknown> {
  const params = input.params;
  return params && typeof params === 'object' && !Array.isArray(params) ? params : {};
}

function readEffectiveSelectedParams(trace: AgentChatResponse['message']['extraInfo']['agentTrace']): Record<string, unknown> {
  const selectedInput = (trace.selectedTool?.input ?? {}) as Record<string, any>;
  const selectedParams = readParamsFromInput(selectedInput);
  if (Object.keys(selectedParams).length) {
    return selectedParams;
  }
  const mergedInput = (trace.continuationResolution?.mergedInput ?? {}) as Record<string, any>;
  const mergedParams = readParamsFromInput(mergedInput);
  if (Object.keys(mergedParams).length) {
    return mergedParams;
  }
  const confirmationInput = (trace.pendingConfirmation?.requestInput ?? {}) as Record<string, any>;
  return readParamsFromInput(confirmationInput);
}

function hasUserFieldValueSignal(query: string): boolean {
  return /(?:更新|修改|变更|调整|设置|改|补|填|写|关联|绑定|选择).{0,24}(?:为|是|=|：|:|，|,).{1,}/.test(query)
    || /(?:备注|地址|职务|手机|电话|邮箱|Email|微信|客户状态|客户类型|销售阶段|预算|预计成交|跟进方式|跟进记录).{0,12}(?:为|是|=|：|:|，|,).{1,}/i.test(query);
}

function parseToolObjectKey(toolCode: string): ShadowObjectKey | null {
  const matched = toolCode.match(/^record\.(customer|contact|opportunity|followup)\./);
  return matched ? matched[1] as ShadowObjectKey : null;
}

function isHarnessBareCollectionQuery(query: string, objectKey: ShadowObjectKey): boolean {
  const trimmed = query.trim();
  if (!/^(?:查询|查一下|查看|搜索|找一下|打开|看看|看下|先查|帮我查|帮我搜|查)/.test(trimmed)) {
    return false;
  }
  if (/(这个|该|当前|刚才|上一|上个|前面|上面|的联系人|的商机|的跟进|的拜访)/.test(trimmed)) {
    return false;
  }
  const labels = objectKey === 'customer'
    ? '(?:客户|公司)'
    : objectKey === 'contact'
      ? '联系人'
      : objectKey === 'opportunity'
        ? '(?:商机|机会|项目|单子)'
        : '(?:跟进记录|拜访记录|回访记录|跟进|拜访|回访)';
  return new RegExp(`^(?:查询|查一下|查看|搜索|找一下|打开|看看|看下|先查|帮我查|帮我搜|查)\\s*${labels}\\s*$`).test(trimmed);
}

function readFirstIntentTargetName(intentFrame: IntentFrame): string {
  const target = intentFrame.targets?.[0];
  const name = typeof target?.name === 'string' ? target.name.trim() : '';
  const id = typeof target?.id === 'string' ? target.id.trim() : '';
  return name || id;
}

function isGroundedHarnessTarget(query: string, objectKey: ShadowObjectKey, target: string): boolean {
  if (!target.trim()) {
    return false;
  }
  if (query.includes(target)) {
    return true;
  }
  const labels = objectKey === 'customer'
    ? ['customer', '客户', '公司', '客户名称']
    : objectKey === 'contact'
      ? ['contact', '联系人', '联系人姓名']
      : objectKey === 'opportunity'
        ? ['opportunity', '商机', '机会', '项目', '单子', '商机名称']
        : ['followup', '跟进记录', '拜访记录', '回访记录', '跟进', '拜访', '回访'];
  return labels.includes(target);
}

function searchCallContainsValue(call: LoggedCall, value: string): boolean {
  const filters = Array.isArray((call.input as { filters?: unknown[] } | undefined)?.filters)
    ? (call.input as { filters: Array<{ value?: unknown }> }).filters
    : [];
  return filters.some((filter) => stringifyQaValue(filter.value).includes(value));
}

function stringifyQaValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

const fullCustomerInput = [
  '联系人姓名：李伟',
  '联系人手机：13612952100',
  '启用状态：启用',
  '客户类型：直客',
  '客户状态：意向',
  '客户是否分配：是',
].join(' ');

const fullOpportunityInput = [
  '客户编号：customer-form-inst-001',
  '销售阶段：初步沟通',
  '预计成交时间：2026-06-30',
  '商机预算（元）：200000',
].join(' ');

const fullFollowupInput = [
  '跟进方式：电话',
  '客户编号：customer-form-inst-001',
  `跟进负责人：${TEST_OPERATOR_OPEN_ID}`,
].join(' ');

function createHarnessField(input: Partial<ShadowStandardizedField> & {
  fieldCode: string;
  label: string;
  widgetType: string;
}): ShadowStandardizedField {
  return {
    fieldCode: input.fieldCode,
    label: input.label,
    widgetType: input.widgetType,
    required: input.required ?? false,
    readOnly: input.readOnly ?? false,
    edit: input.edit ?? true,
    view: input.view ?? true,
    writePolicy: input.writePolicy ?? 'promptable',
    isSystemField: input.isSystemField ?? false,
    provenance: input.provenance ?? { sources: ['public_view_form_def'], truthSource: 'public_view_form_def' },
    multi: input.multi ?? false,
    options: input.options ?? [],
    ...(input.writeParameterKey ? { writeParameterKey: input.writeParameterKey } : {}),
    ...(input.searchParameterKey ? { searchParameterKey: input.searchParameterKey } : {}),
    ...(input.semanticSlot ? { semanticSlot: input.semanticSlot } : {}),
    ...(input.relationBinding ? { relationBinding: input.relationBinding } : {}),
  };
}

const harnessRecordFields: Record<ShadowObjectKey, ShadowStandardizedField[]> = {
  customer: [
    createHarnessField({ fieldCode: '_S_NAME', label: '客户名称', widgetType: 'textWidget', writeParameterKey: 'customer_name', searchParameterKey: 'customer_name', semanticSlot: 'customer_name' }),
    createHarnessField({ fieldCode: 'Te_5', label: '联系人姓名', widgetType: 'textWidget', writeParameterKey: 'contact_name' }),
    createHarnessField({ fieldCode: 'Nu_1', label: '联系人手机', widgetType: 'numberWidget', writeParameterKey: 'contact_phone' }),
    createHarnessField({ fieldCode: '_S_DISABLE', label: '启用状态', widgetType: 'switchWidget', writeParameterKey: 'enabled_state', options: [{ title: '启用', key: '1', value: '启用' }, { title: '停用', key: '0', value: '停用' }] }),
    createHarnessField({ fieldCode: 'Ra_3', label: '客户类型', widgetType: 'radioWidget', writeParameterKey: 'customer_type', options: [{ title: '直客', key: 'direct', value: '直客' }, { title: '普通客户', key: 'normal', value: '普通客户' }, { title: 'VIP客户', key: 'vip', value: 'VIP客户' }] }),
    createHarnessField({ fieldCode: 'Ra_0', label: '客户状态', widgetType: 'radioWidget', writeParameterKey: 'customer_status', options: [{ title: '意向', key: 'intent', value: '意向' }, { title: '销售线索阶段', key: 'lead', value: '销售线索阶段' }, { title: '成交', key: 'won', value: '成交' }] }),
    createHarnessField({ fieldCode: 'Ra_1', label: '客户是否分配', widgetType: 'radioWidget', writeParameterKey: 'Ra_1', options: [{ title: '是', key: 'yes', value: '是' }, { title: '已分配', key: 'assigned', value: '已分配' }] }),
    createHarnessField({ fieldCode: 'Pw_0', label: '省', widgetType: 'publicOptBoxWidget', writeParameterKey: 'province', searchParameterKey: 'province', semanticSlot: 'province', options: [{ title: '安徽', dicId: 'ah' }, { title: '江苏', dicId: 'js' }, { title: '浙江', dicId: 'zj' }] }),
    createHarnessField({ fieldCode: 'Ps_0', label: '负责人', widgetType: 'personSelectWidget', writeParameterKey: 'owner_open_id' }),
  ],
  contact: [
    createHarnessField({ fieldCode: '_S_NAME', label: '联系人姓名', widgetType: 'textWidget', writeParameterKey: 'contact_name' }),
    createHarnessField({ fieldCode: 'Nu_0', label: '手机', widgetType: 'numberWidget', writeParameterKey: 'mobile_phone' }),
    createHarnessField({ fieldCode: 'Te_1', label: '职务', widgetType: 'textWidget', writeParameterKey: 'Te_1' }),
    createHarnessField({ fieldCode: 'Ta_0', label: '地址', widgetType: 'textAreaWidget', writeParameterKey: 'Ta_0' }),
    createHarnessField({ fieldCode: 'Ta_1', label: '备注', widgetType: 'textAreaWidget', writeParameterKey: 'Ta_1' }),
    createHarnessField({ fieldCode: 'Te_3', label: 'Email', widgetType: 'textWidget', writeParameterKey: 'Te_3' }),
    createHarnessField({ fieldCode: 'Te_4', label: '微信号', widgetType: 'textWidget', writeParameterKey: 'Te_4' }),
    createHarnessField({ fieldCode: '_S_DISABLE', label: '启用状态', widgetType: 'switchWidget', writeParameterKey: 'enabled_state', options: [{ title: '启用', key: '1', value: '启用' }] }),
    createHarnessField({
      fieldCode: 'Bd_0',
      label: '选择客户',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_customer_form_inst_id',
      semanticSlot: 'linked_customer_form_inst_id',
      relationBinding: { kind: 'basic_data', formCodeId: 'customer-form', modelName: '客户', displayCol: '_S_NAME' },
    }),
    createHarnessField({ fieldCode: 'Pw_0', label: '省', widgetType: 'publicOptBoxWidget', writeParameterKey: 'province', semanticSlot: 'province', options: [{ title: '安徽', dicId: 'ah' }, { title: '江苏', dicId: 'js' }] }),
    createHarnessField({ fieldCode: 'Pw_1', label: '市', widgetType: 'publicOptBoxWidget', writeParameterKey: 'city', semanticSlot: 'city', options: [{ title: '苏州', dicId: 'sz' }] }),
    createHarnessField({ fieldCode: 'Nu_1', label: '办公电话', widgetType: 'numberWidget', writeParameterKey: 'office_phone' }),
    createHarnessField({ fieldCode: 'De_0', label: '说明文字', widgetType: 'textWidget', writeParameterKey: 'De_0', writePolicy: 'read_only', readOnly: true, edit: false }),
  ],
  opportunity: [
    createHarnessField({ fieldCode: 'Te_0', label: '商机名称', widgetType: 'textWidget', writeParameterKey: 'opportunity_name' }),
    createHarnessField({
      fieldCode: 'Bd_0',
      label: '关联客户',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_customer_form_inst_id',
      relationBinding: { kind: 'basic_data', formCodeId: 'customer-form', modelName: '客户', displayCol: '_S_NAME' },
    }),
    createHarnessField({
      fieldCode: 'Bd_1',
      label: '关联联系人',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_contact_form_inst_id',
      relationBinding: { kind: 'basic_data', formCodeId: 'contact-form', modelName: '联系人', displayCol: '_S_NAME' },
    }),
    createHarnessField({ fieldCode: 'Ra_0', label: '销售阶段', widgetType: 'radioWidget', writeParameterKey: 'sales_stage', options: [{ title: '初步沟通', key: 'initial', value: '初步沟通' }, { title: '方案报价', key: 'quote', value: '方案报价' }, { title: '商务谈判', key: 'business', value: '商务谈判' }] }),
    createHarnessField({ fieldCode: 'Da_0', label: '预计成交时间', widgetType: 'dateWidget', writeParameterKey: 'expected_close_date' }),
    createHarnessField({ fieldCode: 'Mo_0', label: '商机预算（元）', widgetType: 'moneyWidget', writeParameterKey: 'opportunity_budget' }),
    createHarnessField({ fieldCode: 'Ps_0', label: '负责人', widgetType: 'personSelectWidget', writeParameterKey: 'owner_open_id' }),
  ],
  followup: [
    createHarnessField({ fieldCode: 'Ta_0', label: '跟进记录', widgetType: 'textAreaWidget', writeParameterKey: 'followup_record' }),
    createHarnessField({ fieldCode: 'Ra_1', label: '跟进方式', widgetType: 'radioWidget', writeParameterKey: 'followup_method', options: [{ title: '电话', key: 'phone', value: '电话' }, { title: '拜访', key: 'visit', value: '拜访' }, { title: '微信', key: 'wechat', value: '微信' }] }),
    createHarnessField({
      fieldCode: 'Bd_0',
      label: '关联客户',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_customer_form_inst_id',
      relationBinding: { kind: 'basic_data', formCodeId: 'customer-form', modelName: '客户', displayCol: '_S_NAME' },
    }),
    createHarnessField({
      fieldCode: 'Bd_3',
      label: '关联商机',
      widgetType: 'basicDataWidget',
      writeParameterKey: 'linked_opportunity_form_inst_id',
      relationBinding: { kind: 'basic_data', formCodeId: 'opportunity-form', modelName: '商机', displayCol: '_S_NAME' },
    }),
    createHarnessField({ fieldCode: 'Ps_0', label: '跟进负责人', widgetType: 'personSelectWidget', writeParameterKey: 'owner_open_id' }),
  ],
};

const scenarios: AgentScenario[] = [
  {
    id: '01-company-to-customer-waiting-input',
    title: '公司研究成功后录入这个客户，缺必填进入 waiting_input',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      {
        query: '录入这个客户',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          pendingConfirmation: false,
          pendingInteractionKind: 'input_required',
          contentIncludes: ['写入前还需要补充信息'],
        },
      },
    ],
  },
  {
    id: '02-supplement-keeps-customer-preview',
    title: '缺字段后补联系人和手机号，继续 customer preview',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '联系人：李伟 联系方式：13612952100',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          noToolPrefix: 'record.contact.search',
          assert: (response) => {
            const params = response.message.extraInfo.agentTrace.continuationResolution?.mergedInput?.params as Record<string, unknown>;
            assert.equal(params.contact_name, '李伟');
            assert.equal(params.contact_phone, '13612952100');
          },
        },
      },
    ],
  },
  {
    id: '03-partial-supplement-still-waiting',
    title: '只补一部分字段后仍缺客户状态',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '联系人姓名：李伟 联系人手机：13612952100',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          contentIncludes: ['客户状态'],
        },
      },
    ],
  },
  {
    id: '04-full-supplement-confirmation',
    title: '补齐全部必填后进入 confirmation',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: fullCustomerInput,
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          pendingConfirmation: true,
          pendingInteractionKind: 'confirmation',
          contentIncludes: ['请确认是否写入这条记录', '客户名称：苏州金蝶软件有限公司'],
        },
      },
    ],
  },
  {
    id: '05-approve-commits-writeback',
    title: 'approve 后执行 commit create',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', pendingConfirmation: true },
      },
      {
        query: '确认写回',
        resumeDecision: 'approve',
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.commit_create',
          continuationAction: 'confirm_writeback',
          contentIncludes: ['写回已完成'],
        },
      },
    ],
  },
  {
    id: '06-reject-cancels-writeback',
    title: 'reject 后取消，不执行写回',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', pendingConfirmation: true },
      },
      {
        query: '取消写回',
        resumeDecision: 'reject',
        expect: {
          status: 'cancelled',
          selectedTool: 'record.customer.commit_create',
          continuationAction: 'reject_writeback',
          contentIncludes: ['已取消写回确认'],
          assert: (_response, harness) => {
            assert.equal(harness.calls.some((item) => item.tool === 'record.customer.commit_create'), false);
          },
        },
      },
    ],
  },
  {
    id: '07-explicit-switch-from-waiting-input',
    title: 'waiting_input 中明确先查联系人，放弃 continuation',
    turns: [
      { query: '录入客户 苏州金蝶软件有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '先查联系人李伟',
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          continuationAction: 'start_new_task',
        },
      },
    ],
  },
  {
    id: '08-unknown-status-no-default',
    title: '用户说客户状态不清楚时不自动代填',
    turns: [
      { query: '录入客户 苏州金蝶软件有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '客户状态我不清楚',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          contentIncludes: ['客户状态'],
          assert: (response) => {
            const params = response.message.extraInfo.agentTrace.continuationResolution?.mergedInput?.params as Record<string, unknown>;
            assert.equal(Object.prototype.hasOwnProperty.call(params, 'customer_status'), false);
          },
        },
      },
    ],
  },
  {
    id: '09-duplicate-enters-selection',
    title: 'customer create 查重命中候选进入 waiting_selection',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { searchRecords: [{ formInstId: 'customer-existing-001', title: '苏州金蝶软件有限公司' }] },
        expect: {
          status: 'waiting_selection',
          selectedTool: 'record.customer.preview_create',
          pendingInteractionKind: 'candidate_selection',
          pendingConfirmation: false,
          contentIncludes: ['发现疑似重复记录'],
          noToolPrefix: 'record.customer.preview_create',
        },
      },
    ],
  },
  {
    id: '10-selection-update-existing',
    title: 'waiting_selection 后选择更新已有记录',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { searchRecords: [{ formInstId: 'customer-existing-001', title: '苏州金蝶软件有限公司' }] },
        expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' },
      },
      {
        query: '更新已有 formInstId:customer-existing-001',
        mock: { previewReady: true },
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_update',
          continuationAction: 'select_candidate',
          pendingConfirmation: true,
        },
      },
    ],
  },
  {
    id: '11-selection-create-new',
    title: 'waiting_selection 后明确仍要新建',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { searchRecords: [{ formInstId: 'customer-existing-001', title: '苏州金蝶软件有限公司' }] },
        expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' },
      },
      {
        query: '仍要新建一条',
        mock: { previewReady: true },
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'select_candidate',
          pendingConfirmation: true,
        },
      },
    ],
  },
  {
    id: '12-missing-operator-open-id',
    title: '缺 operatorOpenId 时等待输入，不调用真实记录工具',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        omitOperator: true,
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          pendingInteractionKind: 'input_required',
          contentIncludes: ['operatorOpenId'],
          assert: (_response, harness) => {
            assert.equal(harness.calls.some((item) => item.tool.startsWith('record.')), false);
          },
        },
      },
    ],
  },
  {
    id: '13-readonly-blocker',
    title: 'preview 返回 readonly 阻断时展示 blockedRows',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { blockedReadonlyParams: ['_S_TITLE'] },
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          pendingConfirmation: false,
          contentIncludes: ['写入参数被工具契约阻断', '标题'],
          assert: (response) => {
            assert.equal(response.message.extraInfo.agentTrace.pendingInteraction?.blockedRows?.[0]?.label, '标题');
          },
        },
      },
    ],
  },
  {
    id: '14-empty-payload-guard',
    title: 'preview ready 但 payload 为空时触发 empty payload guard',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { previewEmptyPayload: true },
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          policyCode: 'record.preview_empty_payload_guard',
          contentIncludes: ['写入预览被守卫阻断'],
        },
      },
    ],
  },
  {
    id: '15-company-research-failure-no-artifact',
    title: '公司研究失败时不生成降级 Artifact',
    turns: [
      {
        query: '研究这家公司 苏州金蝶软件有限公司',
        mock: { companyResearchFailure: true },
        expect: {
          status: 'tool_unavailable',
          selectedTool: 'external.company_research',
          policyCode: 'external.company_research.no_degraded_artifact',
          contentIncludes: ['未生成降级 Artifact'],
          assert: (_response, harness) => {
            assert.equal(harness.calls.some((item) => item.tool === 'artifact.company_research'), false);
          },
        },
      },
    ],
  },
  {
    id: '16-artifact-followup-after-research',
    title: '公司研究后追问值得关注，走 artifact.search',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      {
        query: '这个客户最近有什么值得关注',
        expect: {
          status: 'completed',
          selectedTool: 'artifact.search',
          contentIncludes: ['基于已有 Artifact 的回答'],
        },
      },
    ],
  },
  {
    id: '17-artifact-question-no-record-preview',
    title: '有 Artifact 但无 record 写入意图时，不触发 record preview',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      {
        query: '这个客户有什么风险',
        expect: {
          status: 'completed',
          selectedTool: 'artifact.search',
          noToolPrefix: 'record.',
        },
      },
    ],
  },
  {
    id: '18-new-contact-preview',
    title: '新增联系人时走 record.contact.preview_create',
    turns: [
      {
        query: '新增联系人李伟 手机：13612952100',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.contact.preview_create',
        },
      },
    ],
  },
  {
    id: '19-new-opportunity-missing-fields',
    title: '新增商机缺客户编号、阶段、预算时进入 waiting_input',
    turns: [
      {
        query: '新增商机 苏州 ERP 项目',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.opportunity.preview_create',
          contentIncludes: ['客户编号', '销售阶段', '商机预算'],
        },
      },
    ],
  },
  {
    id: '20-registry-no-scene-no-delete',
    title: 'Tool Registry 不包含 scene.* 和 delete',
    turns: [],
    assertRegistry: true,
  },
];

test('Agent scenario harness runs 20 deterministic multi-turn scenarios', async () => {
  await runAgentScenarios(scenarios);
});

const complexScenarios: AgentScenario[] = [
  {
    id: '21-latest-company-context-wins',
    title: '连续研究两家公司后，短指代应承接最近公司',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '研究这家公司 上海金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      {
        query: '这个客户最近有什么值得关注',
        expect: {
          status: 'completed',
          selectedTool: 'artifact.search',
          assert: (_response, harness) => {
            const call = harness.calls.findLast((item) => item.tool === 'artifact.search');
            const input = call?.input as { anchors?: Array<{ id?: string }> };
            assert.equal(input.anchors?.[0]?.id, '上海金蝶软件有限公司');
          },
        },
      },
    ],
  },
  {
    id: '22-customer-three-turn-field-completion',
    title: '客户录入跨三轮补字段后进入确认',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '联系人姓名：李伟 联系人手机：13612952100',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          contentIncludes: ['客户类型', '客户状态'],
        },
      },
      {
        query: '启用状态：启用 客户类型：直客 客户状态：意向 客户是否分配：是',
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          pendingConfirmation: true,
        },
      },
    ],
  },
  {
    id: '23-waiting-input-switch-to-new-research',
    title: '补字段等待态中明确先研究另一家公司，应放弃 continuation',
    turns: [
      { query: '录入客户 苏州金蝶软件有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '先研究这家公司 用友网络科技股份有限公司',
        expect: {
          status: 'completed',
          selectedTool: 'external.company_research',
          continuationAction: 'start_new_task',
          noToolPrefix: 'record.customer.preview',
        },
      },
    ],
  },
  {
    id: '24-confirmation-switch-to-contact-search',
    title: '写回确认态中明确先查联系人，应切换任务',
    turns: [
      { query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      {
        query: '先查联系人李伟',
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          continuationAction: 'start_new_task',
        },
      },
    ],
  },
  {
    id: '25-missing-operator-then-resume-with-tenant',
    title: '缺 operatorOpenId 后下一轮带身份恢复原预览',
    turns: [
      { query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`, omitOperator: true, expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '继续',
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_create',
          continuationAction: 'resume_pending_interaction',
          pendingConfirmation: true,
        },
      },
    ],
  },
  {
    id: '26-duplicate-update-then-approve',
    title: '查重候选选择更新已有记录后确认写回',
    turns: [
      { query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`, mock: { searchRecords: [{ formInstId: 'customer-existing-001', title: '苏州金蝶软件有限公司' }] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '更新已有 formInstId:customer-existing-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', continuationAction: 'select_candidate' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update', continuationAction: 'confirm_writeback' } },
    ],
  },
  {
    id: '27-duplicate-create-new-then-reject',
    title: '查重候选后仍要新建，再拒绝写回',
    turns: [
      { query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`, mock: { searchRecords: [{ formInstId: 'customer-existing-001', title: '苏州金蝶软件有限公司' }] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '仍要新建一条', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'select_candidate' } },
      { query: '取消写回', resumeDecision: 'reject', expect: { status: 'cancelled', selectedTool: 'record.customer.commit_create', continuationAction: 'reject_writeback' } },
    ],
  },
  {
    id: '28-readonly-waiting-then-switch-search',
    title: 'readonly 阻断后先查客户，应重新规划为查询',
    turns: [
      { query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`, mock: { blockedReadonlyParams: ['_S_TITLE'] }, expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '先查客户 苏州金蝶软件有限公司',
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          continuationAction: 'start_new_task',
        },
      },
    ],
  },
  {
    id: '29-validation-error-blocks-confirmation',
    title: 'preview 校验错误不能进入 confirmation',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        mock: { validationErrors: ['客户手机号格式不符合工具校验'] },
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          pendingConfirmation: false,
          contentIncludes: ['校验错误', '客户手机号格式不符合工具校验'],
        },
      },
    ],
  },
  {
    id: '30-artifact-followup-no-evidence',
    title: 'Artifact 追问无证据时不触发记录写入',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      {
        query: '这个客户最近有什么值得关注',
        mock: { artifactEvidence: [] },
        expect: {
          status: 'completed',
          selectedTool: 'artifact.search',
          contentIncludes: ['当前没有检索到可引用 Artifact'],
          noToolPrefix: 'record.',
        },
      },
    ],
  },
  {
    id: '31-contact-create-then-approve',
    title: '联系人跨轮补启用状态后确认写回',
    turns: [
      { query: '新增联系人李伟 手机：13612952100', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_create' } },
      { query: '启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create', continuationAction: 'confirm_writeback' } },
    ],
  },
  {
    id: '32-opportunity-full-create-approve',
    title: '商机一次性补齐字段后确认写回',
    turns: [
      { query: `新增商机 苏州 ERP 项目 ${fullOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create', continuationAction: 'confirm_writeback' } },
    ],
  },
  {
    id: '33-opportunity-two-turn-completion',
    title: '商机跨轮补齐客户编号、阶段和预算',
    turns: [
      { query: '新增商机 苏州 ERP 项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: fullOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
    ],
  },
  {
    id: '34-followup-two-turn-completion',
    title: '跟进记录跨轮补齐跟进方式、客户和负责人',
    turns: [
      { query: '新增跟进记录 和李伟沟通 ERP 需求', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: fullFollowupInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create', continuationAction: 'resume_pending_interaction' } },
    ],
  },
  {
    id: '35-customer-update-preview',
    title: '客户更新走 preview_update，不直接写回',
    turns: [
      {
        query: '更新客户 formInstId:customer-form-inst-001 客户状态：成交',
        mock: { previewReady: true },
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_update',
          pendingConfirmation: true,
        },
      },
    ],
  },
  {
    id: '36-customer-detail-get',
    title: '打开客户详情走 record.get',
    turns: [
      { query: '打开客户详情 formInstId:customer-form-inst-001', expect: { status: 'completed', selectedTool: 'record.customer.get' } },
    ],
  },
  {
    id: '37-opportunity-search',
    title: '查询商机走 record.opportunity.search',
    turns: [
      { query: '查询商机 苏州 ERP 项目', expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
    ],
  },
  {
    id: '38-failed-research-still-provides-context',
    title: '公司研究失败后仍可用意图主体承接录入客户',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', mock: { companyResearchFailure: true }, expect: { status: 'tool_unavailable', selectedTool: 'external.company_research' } },
      {
        query: '录入这个客户',
        expect: {
          status: 'waiting_input',
          selectedTool: 'record.customer.preview_create',
          assert: (response) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, true);
          },
        },
      },
    ],
  },
  {
    id: '39-waiting-input-switch-to-artifact-risk',
    title: '客户补字段等待态中追问风险，应切换到 Artifact 检索',
    turns: [
      { query: '研究这家公司 苏州金蝶软件有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      {
        query: '这个客户有什么风险',
        expect: {
          status: 'completed',
          selectedTool: 'artifact.search',
          continuationAction: 'start_new_task',
          noToolPrefix: 'record.customer.preview',
        },
      },
    ],
  },
  {
    id: '40-toolrefs-remain-business-agnostic',
    title: '复杂执行后的 TaskPlan toolRefs 不出现 scene/delete',
    turns: [
      {
        query: `新增客户 苏州金蝶软件有限公司 ${fullCustomerInput}`,
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.customer.preview_create',
          assert: (response) => {
            const refs = response.taskPlan.steps.flatMap((step) => step.toolRefs);
            assert.equal(refs.some((ref) => ref.startsWith('scene.')), false);
            assert.equal(refs.some((ref) => ref.includes('.delete')), false);
            assert.equal(refs.every((ref) => /^(record|external|meta|artifact)\./.test(ref)), true);
          },
        },
      },
    ],
  },
];

test('Agent scenario harness runs 20 complex sales scenarios', async () => {
  await runAgentScenarios(complexScenarios);
});

function recordFixture(objectKey: ShadowObjectKey, formInstId: string, title: string) {
  const titleLabel = objectKey === 'customer'
    ? '客户名称'
    : objectKey === 'contact'
      ? '联系人姓名'
      : objectKey === 'opportunity'
        ? '商机名称'
        : '跟进记录';
  return {
    formInstId,
    fields: [
      { title: titleLabel, value: title, rawValue: title },
      { title: '标题', value: title, rawValue: title },
    ],
    rawRecord: {
      _S_TITLE: title,
      _S_NAME: title,
    },
  };
}

const suzhouCustomerInput = [
  '联系人姓名：周敏',
  '联系人手机：13612952001',
  '启用状态：启用',
  '客户类型：直客',
  '客户状态：意向',
  '客户是否分配：是',
].join(' ');
const suzhouOpportunityInput = [
  '客户编号：customer-form-inst-001',
  '销售阶段：初步沟通',
  '预计成交时间：2026-06-30',
  '商机预算（元）：260000',
].join(' ');
const suzhouFollowupInput = [
  '跟进方式：电话',
  '客户编号：customer-form-inst-001',
  `跟进负责人：${TEST_OPERATOR_OPEN_ID}`,
].join(' ');

const suzhouSalesHabitScenarios: AgentScenario[] = [
  {
    id: '41-suzhou-1t-search-customer',
    title: '1轮：查客户',
    turns: [{ query: '查客户 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'record.customer.search' } }],
  },
  {
    id: '42-suzhou-1t-fast-contact',
    title: '1轮：快速新增联系人',
    turns: [{ query: '新增联系人 陈燕 手机：13612952011 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } }],
  },
  {
    id: '43-suzhou-1t-followup',
    title: '1轮：一次性补拜访记录',
    turns: [{ query: `新增拜访记录 今天电话沟通ERP升级，客户让下周带方案 跟进方式：电话 客户编号：customer-form-inst-001 跟进负责人：${TEST_OPERATOR_OPEN_ID}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } }],
  },
  {
    id: '44-suzhou-2t-customer-fill',
    title: '2轮：客户先记后补',
    turns: [
      { query: '新增客户 苏州恒达机电有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      { query: suzhouCustomerInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'resume_pending_interaction' } },
    ],
  },
  {
    id: '45-suzhou-2t-opportunity-fill',
    title: '2轮：商机先记后补',
    turns: [
      { query: '新增商机 苏州ERP升级项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: suzhouOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
    ],
  },
  {
    id: '46-suzhou-2t-research-followup',
    title: '2轮：研究后追问',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '这个客户最近有什么值得关注', expect: { status: 'completed', selectedTool: 'artifact.search' } },
    ],
  },
  {
    id: '47-suzhou-3t-contact-approve',
    title: '3轮：联系人补字段并确认',
    turns: [
      { query: '新增联系人 王丽 手机：13612952012', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_create' } },
      { query: '启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create', continuationAction: 'confirm_writeback' } },
    ],
  },
  {
    id: '48-suzhou-3t-duplicate-update',
    title: '3轮：查重后更新已有',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '更新已有 formInstId:customer-existing-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', continuationAction: 'select_candidate' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update', continuationAction: 'confirm_writeback' } },
    ],
  },
  {
    id: '49-suzhou-3t-search-update-current',
    title: '3轮：查客户后更新该客户',
    turns: [
      { query: '查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '把这个客户状态改成意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', assert: (_response, harness) => {
        const call = harness.calls.findLast((item) => item.tool === 'record.customer.preview_update');
        assert.equal((call?.input as ShadowPreviewUpsertInput | undefined)?.formInstId, 'customer-c1-001');
      } } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
    ],
  },
  {
    id: '50-suzhou-4t-research-create-customer',
    title: '4轮：研究后录入客户',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '录入这个客户', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      { query: suzhouCustomerInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
    ],
  },
  {
    id: '51-suzhou-4t-opportunity-two-supplements',
    title: '4轮：商机分两次补字段',
    turns: [
      { query: '新增项目 苏州恒达ERP升级', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: '客户编号：customer-form-inst-001 销售阶段：初步沟通', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '预计成交时间：2026-06-30 商机预算（元）：260000', expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
    ],
  },
  {
    id: '52-suzhou-4t-followup-two-supplements',
    title: '4轮：拜访记录分两次补字段',
    turns: [
      { query: '新增拜访记录 今天和老板聊了ERP升级', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: '客户编号：customer-form-inst-001 跟进方式：拜访', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: `跟进负责人：${TEST_OPERATOR_OPEN_ID}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
    ],
  },
  {
    id: '53-suzhou-5t-a-b-context-switch',
    title: '5轮：A/B 客户记忆切换',
    turns: [
      { query: '查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-a-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户状态改为意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '查客户 苏州明纬自动化有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-b-001', '苏州明纬自动化有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '把这个客户状态改成成交', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', assert: (_response, harness) => {
        const call = harness.calls.findLast((item) => item.tool === 'record.customer.preview_update');
        assert.equal((call?.input as ShadowPreviewUpsertInput | undefined)?.formInstId, 'customer-b-001');
      } } },
    ],
  },
  {
    id: '54-suzhou-5t-duplicate-create-new-contact',
    title: '5轮：查重仍新建后补联系人',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '仍要新建一条', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'select_candidate' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '查询这个客户的联系人', expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '新增联系人 赵强 手机：13612952013 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
    ],
  },
  {
    id: '55-suzhou-5t-research-to-opportunity',
    title: '5轮：研究转商机',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '这个客户有什么风险', expect: { status: 'completed', selectedTool: 'artifact.search' } },
      { query: '新增这个客户的商机 苏州恒达ERP升级', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: suzhouOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
    ],
  },
  {
    id: '56-suzhou-6t-customer-contact-loop',
    title: '6轮：客户到联系人闭环',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增联系人 王工 手机：13612952014', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_create' } },
      { query: '启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: '查询联系人 王工', expect: { status: 'completed', selectedTool: 'record.contact.search' } },
    ],
  },
  {
    id: '57-suzhou-6t-customer-opportunity-loop',
    title: '6轮：客户到商机闭环',
    turns: [
      { query: '查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '新增这个客户的商机 苏州MES升级项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: suzhouOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: '查询商机 苏州MES升级项目', mock: { searchRecords: [recordFixture('opportunity', 'opportunity-c1-001', '苏州MES升级项目')] }, expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
      { query: '销售阶段改为方案报价', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_update' } },
    ],
  },
  {
    id: '58-suzhou-6t-followup-interrupted-search',
    title: '6轮：拜访中途查客户',
    turns: [
      { query: '新增拜访记录 今天上午回访，客户要报价', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: '先查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search', continuationAction: 'start_new_task' } },
      { query: `新增拜访记录 今天上午回访，客户要报价 ${suzhouFollowupInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
      { query: '查询这个客户的跟进记录', expect: { status: 'completed', selectedTool: 'record.followup.search' } },
      { query: '基于这个客户旅程，给出下一步推进建议', expect: { status: 'completed', selectedTool: 'meta.context_summary' } },
    ],
  },
  {
    id: '59-suzhou-7t-new-customer-chain',
    title: '7轮：新客完整销售链',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增联系人 刘总 手机：13612952015 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: `新增商机 苏州恒达ERP升级 ${suzhouOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: `新增拜访记录 初次拜访确认预算窗口 ${suzhouFollowupInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
    ],
  },
  {
    id: '60-suzhou-7t-duplicate-then-contact-update',
    title: '7轮：重复客户后补联系人',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '更新已有 formInstId:customer-existing-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '新增联系人 赵强 手机：13612952016 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: '查询联系人 赵强', mock: { searchRecords: [recordFixture('contact', 'contact-zq-001', '赵强')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新联系人 formInstId:contact-zq-001 办公电话：051266688888', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update' } },
    ],
  },
  {
    id: '61-suzhou-7t-research-next-step',
    title: '7轮：研究到下一步建议',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '这个客户有什么风险', expect: { status: 'completed', selectedTool: 'artifact.search' } },
      { query: `新增商机 苏州恒达ERP升级 ${suzhouOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: `新增拜访记录 已沟通风险和预算 ${suzhouFollowupInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
      { query: '基于这个客户旅程，给出下一步推进建议', expect: { status: 'completed', selectedTool: 'meta.context_summary' } },
    ],
  },
  {
    id: '62-suzhou-8t-multi-customer-context',
    title: '8轮：多客户上下文回切',
    turns: [
      { query: '查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-a-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户状态改为意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '查客户 苏州明纬自动化有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-b-001', '苏州明纬自动化有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户状态改为成交', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '查客户 苏州恒达机电有限公司的联系人', mock: { searchRecords: [recordFixture('contact', 'contact-a-001', '周敏')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '查客户 苏州明纬自动化有限公司的商机', mock: { searchRecords: [recordFixture('opportunity', 'opportunity-b-001', '明纬WMS项目')] }, expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
    ],
  },
  {
    id: '63-suzhou-8t-mobile-fragmented-input',
    title: '8轮：移动端碎片录入',
    turns: [
      { query: '新增客户 苏州路上先记一下智能装备有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      { query: '联系人姓名：陆敏', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '联系人手机：13612952017', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '启用状态：启用 客户类型：直客 客户状态：意向 客户是否分配：是', expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增商机 苏州智能装备ERP升级', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: suzhouOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
    ],
  },
  {
    id: '64-suzhou-8t-duplicate-new-full-chain',
    title: '8轮：查重后新建全链路',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '仍要新建一条', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增联系人 钱经理 手机：13612952018 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: '新增拜访记录 下午回访确认报价口径', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: suzhouFollowupInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
    ],
  },
  {
    id: '65-suzhou-9t-morning-push',
    title: '9轮：早会客户推进',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: '查客户 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增联系人 周总 手机：13612952019 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: `新增商机 苏州恒达ERP升级 ${suzhouOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: '列出这个客户的客户旅程', expect: { status: 'completed', selectedTool: 'meta.context_summary' } },
    ],
  },
  {
    id: '66-suzhou-9t-opportunity-insert-customer-update',
    title: '9轮：商机录入中插入客户更新',
    turns: [
      { query: '新增商机 苏州恒达WMS项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: '先查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search', continuationAction: 'start_new_task' } },
      { query: '客户状态改为意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: `新增商机 苏州恒达WMS项目 ${suzhouOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: '新增拜访记录 和客户确认WMS预算', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: suzhouFollowupInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
      { query: '查询这个客户的跟进记录', expect: { status: 'completed', selectedTool: 'record.followup.search' } },
    ],
  },
  {
    id: '67-suzhou-9t-contact-link-customer',
    title: '9轮：联系人关联客户',
    turns: [
      { query: '新增联系人 李玲玲 手机：13612952020', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_create' } },
      { query: '启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: '查联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '将这个联系人的客户信息更新为苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', assert: (response) => {
        const params = response.message.extraInfo.agentTrace.selectedTool?.input?.params as Record<string, unknown>;
        assert.equal(params.linked_customer_form_inst_id, '苏州恒达机电有限公司');
        assert.equal(params.province, undefined);
      } } },
      { query: '关联客户：customer-c1-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
      { query: '查联系人 李玲玲', expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '查询苏州恒达机电有限公司客户', expect: { status: 'completed', selectedTool: 'record.customer.search' } },
    ],
  },
  {
    id: '68-suzhou-10t-day-work-loop',
    title: '10轮：一天工作闭环',
    turns: [
      { query: '研究这家公司 苏州恒达机电有限公司', expect: { status: 'completed', selectedTool: 'external.company_research' } },
      { query: `新增客户 苏州恒达机电有限公司 ${suzhouCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增联系人 刘总 手机：13612952021 启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
      { query: `新增商机 苏州恒达数字化经营项目 ${suzhouOpportunityInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: `新增拜访记录 完成首次拜访并约下周演示 ${suzhouFollowupInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
      { query: '查这个客户的客户旅程', expect: { status: 'completed', selectedTool: 'meta.context_summary' } },
    ],
  },
  {
    id: '69-suzhou-10t-multi-switch-isolation',
    title: '10轮：录入中多次切任务',
    turns: [
      { query: '新增客户 苏州待补信息科技有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      { query: '查客户 苏州明纬自动化有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-b-001', '苏州明纬自动化有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search', continuationAction: 'start_new_task' } },
      { query: '客户状态改为意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: `新增客户 苏州待补信息科技有限公司 ${suzhouCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
      { query: '新增商机 苏州待补ERP项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: suzhouOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
      { query: '查询商机 苏州待补ERP项目', expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
    ],
  },
  {
    id: '70-suzhou-10t-anhui-link-regression',
    title: '10轮：安徽关联回归',
    turns: [
      { query: '查联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '关联安徽的客户', mock: { searchRecords: [] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required', assert: (response) => {
        const params = response.message.extraInfo.agentTrace.selectedTool?.input?.params as Record<string, unknown>;
        assert.equal(params.linked_customer_form_inst_id, '安徽');
        assert.equal(params.province, undefined);
      } } },
      { query: '将这个联系人的客户信息更新为安徽艳阳电气', mock: { searchRecords: [recordFixture('customer', 'customer-ah-001', '安徽艳阳电气')] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required', assert: (response) => {
        const params = response.message.extraInfo.agentTrace.selectedTool?.input?.params as Record<string, unknown>;
        assert.equal(params.linked_customer_form_inst_id, '安徽艳阳电气');
        assert.equal(params.province, undefined);
      } } },
      { query: '关联客户：customer-ah-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
      { query: '更新关联客户', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required', contentExcludes: ['写入预览被守卫阻断'] } },
      { query: '查询安徽的客户', expect: { status: 'completed', selectedTool: 'record.customer.search', continuationAction: 'start_new_task' } },
      { query: '查客户 安徽艳阳电气', mock: { searchRecords: [recordFixture('customer', 'customer-ah-001', '安徽艳阳电气')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '更新客户 formInstId:customer-ah-001 客户状态：意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
    ],
  },
];

test('Agent scenario harness runs 30 Suzhou sales habit scenarios', async () => {
  await runAgentScenarios(suzhouSalesHabitScenarios);
});

const collectionContextIsolationScenarios: AgentScenario[] = [
  {
    id: '71b-collection-customer-ignores-ungrounded-llm-target',
    title: '集合查询：LLM target 被旧联系人 ID 污染时不进入客户搜索',
    turns: [
      { query: '查询联系人 陈晨', mock: { searchRecords: [recordFixture('contact', '69f16bbd21bf2b00014fbc6f', '陈晨')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      {
        query: '查询客户',
        mock: { intentFrame: pollutedCollectionIntent('customer', '69f16bbd21bf2b00014fbc6f') },
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          assert: (response, harness) => {
            const input = response.message.extraInfo.agentTrace.selectedTool?.input as { filters?: unknown[]; agentControl?: { targetSanitization?: { reasonCode?: string } } } | undefined;
            assert.deepEqual(input?.filters, []);
            assert.equal(input?.agentControl?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usageMode, 'skipped_collection_query');
            assertNoSearchFilterValue(harness, 'record.customer.search', '69f16bbd21bf2b00014fbc6f');
            const candidates = harness.repository.findContextCandidates(`harness-71b-collection-customer-ignores-ungrounded-llm-target`);
            assert.equal(candidates.some((candidate) => candidate.sourceRunId === response.executionState.runId), false);
          },
        },
      },
    ],
  },
  {
    id: '71-collection-contact-does-not-bind-current-contact',
    title: '集合查询：当前联系人后查询联系人列表不带旧联系人过滤',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      {
        query: '查询联系人',
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usageMode, 'skipped_collection_query');
            assertNoSearchFilterValue(harness, 'record.contact.search', 'contact-lilingling-001');
            assertNoSearchFilterValue(harness, 'record.contact.search', '李玲玲');
          },
        },
      },
    ],
  },
  {
    id: '72-collection-customer-does-not-bind-current-customer',
    title: '集合查询：当前客户后查询客户列表不带旧客户过滤',
    turns: [
      { query: '查询客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      {
        query: '查询客户',
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assertNoSearchFilterValue(harness, 'record.customer.search', 'customer-c1-001');
            assertNoSearchFilterValue(harness, 'record.customer.search', '苏州恒达机电有限公司');
          },
        },
      },
      {
        query: '查询所有客户',
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usageMode, 'skipped_collection_query');
            assertNoSearchFilterValue(harness, 'record.customer.search', 'customer-c1-001');
            assertNoSearchFilterValue(harness, 'record.customer.search', '苏州恒达机电有限公司');
          },
        },
      },
    ],
  },
  {
    id: '73-collection-opportunity-does-not-bind-current-opportunity',
    title: '集合查询：当前商机后查询商机列表不带旧商机过滤',
    turns: [
      { query: '查询商机 苏州MES升级项目', mock: { searchRecords: [recordFixture('opportunity', 'opportunity-c1-001', '苏州MES升级项目')] }, expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
      {
        query: '查询商机',
        expect: {
          status: 'completed',
          selectedTool: 'record.opportunity.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assertNoSearchFilterValue(harness, 'record.opportunity.search', 'opportunity-c1-001');
            assertNoSearchFilterValue(harness, 'record.opportunity.search', '苏州MES升级项目');
          },
        },
      },
    ],
  },
  {
    id: '74-collection-followup-does-not-bind-current-followup',
    title: '集合查询：当前拜访记录后查询拜访记录列表不带旧记录过滤',
    turns: [
      { query: '查询拜访记录 上次回访报价', mock: { searchRecords: [recordFixture('followup', 'followup-c1-001', '上次回访报价')] }, expect: { status: 'completed', selectedTool: 'record.followup.search' } },
      {
        query: '查询拜访记录',
        expect: {
          status: 'completed',
          selectedTool: 'record.followup.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assertNoSearchFilterValue(harness, 'record.followup.search', 'followup-c1-001');
            assertNoSearchFilterValue(harness, 'record.followup.search', '上次回访报价');
          },
        },
      },
    ],
  },
  {
    id: '75-subject-scoped-contact-search-keeps-relation-binding',
    title: '关系查询：查询这个客户的联系人继续绑定当前客户',
    turns: [
      { query: '查询客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-c1-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      {
        query: '查询这个客户的联系人',
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, true);
            assertSearchFilterValue(harness, 'record.contact.search', 'linked_customer_form_inst_id', 'customer-c1-001');
            const sources = response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { searchExtraction?: { filterSources?: Array<{ source?: string }> } } | undefined;
            assert.equal(sources?.searchExtraction?.filterSources?.some((item) => item.source === 'relation_context'), true);
          },
        },
      },
    ],
  },
  {
    id: '76-current-contact-update-still-binds-current-contact',
    title: '指代更新：更新这个联系人仍使用当前联系人',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      {
        query: '更新这个联系人手机号为13612952099',
        mock: { previewReady: true },
        expect: {
          status: 'waiting_confirmation',
          selectedTool: 'record.contact.preview_update',
          assert: (_response, harness) => {
            const call = harness.calls.findLast((item) => item.tool === 'record.contact.preview_update');
            assert.equal((call?.input as ShadowPreviewUpsertInput | undefined)?.formInstId, 'contact-lilingling-001');
          },
        },
      },
    ],
  },
  {
    id: '77-customer-name-search-after-contact-context-is-not-polluted',
    title: '名称查询：联系人上下文后查询安徽客户不被旧联系人污染',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      {
        query: '查询安徽的客户',
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          assert: (response, harness) => {
            assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
            assertNoSearchFilterValue(harness, 'record.customer.search', 'contact-lilingling-001');
            assertSearchFilterContainsValue(harness, 'record.customer.search', '安徽');
          },
        },
      },
    ],
  },
  {
    id: '78-collection-all-objects-ignore-polluted-llm-target',
    title: '集合查询：四类对象均忽略未落地 LLM target',
    turns: [
      {
        query: '查询联系人',
        mock: { intentFrame: pollutedCollectionIntent('contact', 'stale-contact-id-001') },
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assertNoSearchFilterValue(harness, 'record.contact.search', 'stale-contact-id-001');
          },
        },
      },
      {
        query: '查询商机',
        mock: { intentFrame: pollutedCollectionIntent('opportunity', 'stale-opportunity-id-001') },
        expect: {
          status: 'completed',
          selectedTool: 'record.opportunity.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assertNoSearchFilterValue(harness, 'record.opportunity.search', 'stale-opportunity-id-001');
          },
        },
      },
      {
        query: '查询拜访记录',
        mock: { intentFrame: pollutedCollectionIntent('followup', 'stale-followup-id-001') },
        expect: {
          status: 'completed',
          selectedTool: 'record.followup.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assertNoSearchFilterValue(harness, 'record.followup.search', 'stale-followup-id-001');
          },
        },
      },
    ],
  },
  {
    id: '79-collection-all-objects-ignore-polluted-llm-record-name',
    title: '集合查询：四类对象均忽略未落在用户原文中的旧记录名 target',
    turns: [
      {
        query: '查询客户',
        mock: { intentFrame: pollutedCollectionIntent('customer', '苏州恒达机电有限公司') },
        expect: {
          status: 'completed',
          selectedTool: 'record.customer.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { targetSanitization?: { reasonCode?: string } } | undefined)?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assertNoSearchFilterValue(harness, 'record.customer.search', '苏州恒达机电有限公司');
          },
        },
      },
      {
        query: '查询联系人',
        mock: { intentFrame: pollutedCollectionIntent('contact', '李玲玲') },
        expect: {
          status: 'completed',
          selectedTool: 'record.contact.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { targetSanitization?: { reasonCode?: string } } | undefined)?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assertNoSearchFilterValue(harness, 'record.contact.search', '李玲玲');
          },
        },
      },
      {
        query: '查询商机',
        mock: { intentFrame: pollutedCollectionIntent('opportunity', '苏州ERP升级项目') },
        expect: {
          status: 'completed',
          selectedTool: 'record.opportunity.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { targetSanitization?: { reasonCode?: string } } | undefined)?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assertNoSearchFilterValue(harness, 'record.opportunity.search', '苏州ERP升级项目');
          },
        },
      },
      {
        query: '查询拜访记录',
        mock: { intentFrame: pollutedCollectionIntent('followup', '报价后回访记录') },
        expect: {
          status: 'completed',
          selectedTool: 'record.followup.search',
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { targetSanitization?: { reasonCode?: string } } | undefined)?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assertNoSearchFilterValue(harness, 'record.followup.search', '报价后回访记录');
          },
        },
      },
    ],
  },
];

test('Agent scenario harness keeps collection queries isolated from current record context', async () => {
  await runAgentScenarios(collectionContextIsolationScenarios);
});

const qaTraceReplayScenarios: AgentScenario[] = [
  {
    id: '81-qa-trace-f66b5851-contact-remark-comma',
    title: 'Trace 回放：联系人备注用逗号口语更新',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新备注，喜欢喝茶', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', assert: assertLatestPreviewParam('record.contact.preview_update', 'Ta_1', '喜欢喝茶') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
    ],
  },
  {
    id: '82-qa-trace-f66b5851-contact-remark-colon',
    title: 'Trace 回放：联系人备注冒号更新',
    turns: [
      { query: '查询联系人 陈燕', mock: { searchRecords: [recordFixture('contact', 'contact-chenyan-001', '陈燕')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '备注：喜欢喝茶', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', assert: assertLatestPreviewParam('record.contact.preview_update', 'Ta_1', '喜欢喝茶') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
    ],
  },
  {
    id: '83-qa-trace-279a3af1-customer-collection-polluted-id',
    title: 'Trace 回放：查询客户时 LLM target 被旧 ID 污染',
    turns: [
      { query: '查询联系人 陈晨', mock: { searchRecords: [recordFixture('contact', '69f16bbd21bf2b00014fbc6f', '陈晨')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '查询客户', mock: { intentFrame: pollutedCollectionIntent('customer', '69f16bbd21bf2b00014fbc6f') }, expect: { status: 'completed', selectedTool: 'record.customer.search', assert: assertCollectionQueryClean('record.customer.search', '69f16bbd21bf2b00014fbc6f') } },
      { query: '查询客户 安徽艳阳电气', mock: { intentFrame: pollutedCollectionIntent('customer', '69f16bbd21bf2b00014fbc6f') }, expect: { status: 'completed', selectedTool: 'record.customer.search', assert: (_response, harness) => assertSearchFilterContainsValue(harness, 'record.customer.search', '安徽艳阳电气') } },
    ],
  },
  {
    id: '84-qa-trace-2ed9c7bf-contact-collection-after-contact',
    title: 'Trace 回放：查询联系人列表不承接当前联系人',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '查询联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: assertCollectionQueryClean('record.contact.search', '李玲玲') } },
      { query: '查询联系人 陈燕', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: (_response, harness) => assertSearchFilterContainsValue(harness, 'record.contact.search', '陈燕') } },
      { query: '查询联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: assertCollectionQueryClean('record.contact.search', '陈燕') } },
    ],
  },
  {
    id: '85-qa-trace-anhui-relation-not-province',
    title: 'Trace 回放：联系人关联客户不写成省份',
    turns: [
      { query: '查联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '关联安徽的客户', mock: { searchRecords: [] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required' } },
      { query: '将这个联系人的客户信息更新为安徽艳阳电气', mock: { searchRecords: [recordFixture('customer', 'customer-ah-001', '安徽艳阳电气')] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required', assert: assertNoPreviewParam('record.contact.preview_update', 'province') } },
      { query: '查询安徽的客户', expect: { status: 'completed', selectedTool: 'record.customer.search', assert: (_response, harness) => assertSearchFilterContainsValue(harness, 'record.customer.search', '安徽') } },
    ],
  },
  {
    id: '86-qa-trace-remark-update-then-contact-list',
    title: 'Trace 回放：更新联系人备注后再查联系人列表',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-lilingling-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新备注，喜欢喝茶', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
      { query: '查询联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: assertCollectionQueryClean('record.contact.search', 'contact-lilingling-001') } },
    ],
  },
  {
    id: '87-qa-trace-customer-update-then-customer-list',
    title: 'Trace 回放：更新客户后再查客户列表',
    turns: [
      { query: '查询客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-a-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户状态改为成交', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', assert: assertLatestPreviewParam('record.customer.preview_update', 'customer_status', 'won') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '查询客户', expect: { status: 'completed', selectedTool: 'record.customer.search', assert: assertCollectionQueryClean('record.customer.search', '苏州恒达机电有限公司') } },
    ],
  },
  {
    id: '88-qa-trace-followup-update-no-empty-payload',
    title: 'Trace 回放：跟进记录备注式更新不触发空 payload',
    turns: [
      { query: '查询拜访记录 上次回访报价', mock: { searchRecords: [recordFixture('followup', 'followup-a-001', '上次回访报价')] }, expect: { status: 'completed', selectedTool: 'record.followup.search' } },
      { query: '跟进记录：客户让下周带方案', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_update', assert: assertLatestPreviewParam('record.followup.preview_update', 'followup_record', '客户让下周带方案') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_update' } },
    ],
  },
];

const qaMetadataFieldScenarios: AgentScenario[] = [
  qaUpdateParamScenario('89-qa-meta-contact-remark-comma', '元数据字段：联系人备注逗号更新', 'contact', '查询联系人 李玲玲', recordFixture('contact', 'contact-meta-001', '李玲玲'), '更新备注，喜欢喝茶', 'record.contact.preview_update', 'Ta_1', '喜欢喝茶'),
  qaUpdateParamScenario('90-qa-meta-contact-remark-colon', '元数据字段：联系人备注冒号更新', 'contact', '查询联系人 陈燕', recordFixture('contact', 'contact-meta-002', '陈燕'), '备注：喜欢喝茶', 'record.contact.preview_update', 'Ta_1', '喜欢喝茶'),
  qaUpdateParamScenario('91-qa-meta-contact-address', '元数据字段：联系人地址更新', 'contact', '查询联系人 王工', recordFixture('contact', 'contact-meta-003', '王工'), '地址：苏州工业园区星湖街', 'record.contact.preview_update', 'Ta_0', '苏州工业园区星湖街'),
  qaUpdateParamScenario('92-qa-meta-contact-title', '元数据字段：联系人职务更新', 'contact', '查询联系人 周敏', recordFixture('contact', 'contact-meta-004', '周敏'), '职务改为信息化负责人', 'record.contact.preview_update', 'Te_1', '信息化负责人'),
  qaUpdateParamScenario('93-qa-meta-contact-email', '元数据字段：联系人 Email 更新', 'contact', '查询联系人 赵强', recordFixture('contact', 'contact-meta-005', '赵强'), 'Email：zhaoqiang@example.com', 'record.contact.preview_update', 'Te_3', 'zhaoqiang@example.com'),
  qaUpdateParamScenario('94-qa-meta-contact-wechat', '元数据字段：联系人微信号更新', 'contact', '查询联系人 陆晨', recordFixture('contact', 'contact-meta-006', '陆晨'), '微信号：wx-luchen', 'record.contact.preview_update', 'Te_4', 'wx-luchen'),
  qaUpdateParamScenario('95-qa-meta-contact-mobile', '元数据字段：联系人手机更新', 'contact', '查询联系人 沈洁', recordFixture('contact', 'contact-meta-007', '沈洁'), '手机号改为13612952088', 'record.contact.preview_update', 'mobile_phone', 13612952088),
  qaUpdateParamScenario('96-qa-meta-contact-enabled', '元数据字段：联系人启用状态更新', 'contact', '查询联系人 吴昊', recordFixture('contact', 'contact-meta-008', '吴昊'), '启用状态：启用', 'record.contact.preview_update', 'enabled_state', '1'),
  qaUpdateParamScenario('97-qa-meta-customer-status', '元数据字段：客户状态更新', 'customer', '查询客户 苏州恒达机电有限公司', recordFixture('customer', 'customer-meta-001', '苏州恒达机电有限公司'), '客户状态改为成交', 'record.customer.preview_update', 'customer_status', 'won'),
  qaUpdateParamScenario('98-qa-meta-customer-type', '元数据字段：客户类型更新', 'customer', '查询客户 苏州明纬自动化有限公司', recordFixture('customer', 'customer-meta-002', '苏州明纬自动化有限公司'), '客户类型改为普通客户', 'record.customer.preview_update', 'customer_type', 'normal'),
  qaUpdateParamScenario('99-qa-meta-customer-province', '元数据字段：客户省份更新', 'customer', '查询客户 苏州协同机械有限公司', recordFixture('customer', 'customer-meta-003', '苏州协同机械有限公司'), '省：安徽', 'record.customer.preview_update', 'province', '安徽'),
  qaUpdateParamScenario('100-qa-meta-opportunity-budget', '元数据字段：商机预算更新', 'opportunity', '查询商机 苏州ERP升级项目', recordFixture('opportunity', 'opportunity-meta-001', '苏州ERP升级项目'), '商机预算（元）：28万', 'record.opportunity.preview_update', 'opportunity_budget', 280000),
  qaUpdateParamScenario('101-qa-meta-opportunity-stage', '元数据字段：商机阶段更新', 'opportunity', '查询商机 昆山WMS项目', recordFixture('opportunity', 'opportunity-meta-002', '昆山WMS项目'), '销售阶段改为方案报价', 'record.opportunity.preview_update', 'sales_stage', 'quote'),
  qaUpdateParamScenario('102-qa-meta-opportunity-date', '元数据字段：商机预计成交时间更新', 'opportunity', '查询商机 太仓MES项目', recordFixture('opportunity', 'opportunity-meta-003', '太仓MES项目'), '预计成交时间：2026-07-31', 'record.opportunity.preview_update', 'expected_close_date', '2026-07-31'),
  qaUpdateParamScenario('103-qa-meta-followup-method', '元数据字段：跟进方式更新', 'followup', '查询拜访记录 昨天拜访', recordFixture('followup', 'followup-meta-001', '昨天拜访'), '跟进方式改为微信', 'record.followup.preview_update', 'followup_method', 'wechat'),
  qaUpdateParamScenario('104-qa-meta-followup-record', '元数据字段：跟进记录更新', 'followup', '查询拜访记录 报价回访', recordFixture('followup', 'followup-meta-002', '报价回访'), '跟进记录：客户让下周带方案', 'record.followup.preview_update', 'followup_record', '客户让下周带方案'),
];

const qaContextMemoryScenarios: AgentScenario[] = [
  {
    id: '105-qa-memory-customer-a-b-switch',
    title: '记忆隔离：A 客户确认后切 B 客户再更新',
    turns: [
      { query: '查客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-a-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户状态改为意向', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
      { query: '查客户 苏州明纬自动化有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-b-001', '苏州明纬自动化有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '把这个客户状态改成成交', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', assert: assertLatestPreviewFormInstId('record.customer.preview_update', 'customer-b-001') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
    ],
  },
  {
    id: '106-qa-memory-contact-update-current-after-list',
    title: '记忆隔离：联系人详情后更新当前联系人',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-a-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '查询联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: assertCollectionQueryClean('record.contact.search', '李玲玲') } },
      { query: '查询联系人 陈燕', mock: { searchRecords: [recordFixture('contact', 'contact-b-001', '陈燕')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新备注，下午三点后联系', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', assert: assertLatestPreviewFormInstId('record.contact.preview_update', 'contact-b-001') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
    ],
  },
  {
    id: '107-qa-memory-customer-relation-search-keeps-parent',
    title: '记忆隔离：关系查询继续绑定当前客户',
    turns: [
      { query: '查询客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-rel-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '查询这个客户的联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: (_response, harness) => assertSearchFilterValue(harness, 'record.contact.search', 'linked_customer_form_inst_id', 'customer-rel-001') } },
      { query: '查询联系人', expect: { status: 'completed', selectedTool: 'record.contact.search', assert: assertCollectionQueryClean('record.contact.search', 'customer-rel-001') } },
    ],
  },
  {
    id: '108-qa-memory-opportunity-list-after-opportunity',
    title: '记忆隔离：当前商机后查商机列表',
    turns: [
      { query: '查询商机 苏州ERP升级项目', mock: { searchRecords: [recordFixture('opportunity', 'opportunity-a-001', '苏州ERP升级项目')] }, expect: { status: 'completed', selectedTool: 'record.opportunity.search' } },
      { query: '销售阶段改为方案报价', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_update' } },
      { query: '查询商机', expect: { status: 'completed', selectedTool: 'record.opportunity.search', assert: assertCollectionQueryClean('record.opportunity.search', '苏州ERP升级项目') } },
    ],
  },
  {
    id: '109-qa-memory-followup-list-after-followup',
    title: '记忆隔离：当前拜访记录后查拜访记录列表',
    turns: [
      { query: '查询拜访记录 报价后回访', mock: { searchRecords: [recordFixture('followup', 'followup-a-001', '报价后回访')] }, expect: { status: 'completed', selectedTool: 'record.followup.search' } },
      { query: '跟进方式改为微信', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_update' } },
      { query: '查询拜访记录', expect: { status: 'completed', selectedTool: 'record.followup.search', assert: assertCollectionQueryClean('record.followup.search', '报价后回访') } },
    ],
  },
  {
    id: '110-qa-memory-contact-context-customer-explicit-search',
    title: '记忆隔离：联系人上下文后显式查安徽客户',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-a-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新备注，喜欢喝茶', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
      { query: '查询安徽的客户', expect: { status: 'completed', selectedTool: 'record.customer.search', assert: (_response, harness) => assertSearchFilterContainsValue(harness, 'record.customer.search', '安徽') } },
    ],
  },
  {
    id: '111-qa-memory-pending-customer-interrupted-by-search',
    title: '记忆隔离：客户录入中插入查询后仍可补录',
    turns: [
      { query: '新增客户 苏州恒达机电有限公司', expect: { status: 'waiting_input', selectedTool: 'record.customer.preview_create' } },
      { query: '先查客户 苏州明纬自动化有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-b-001', '苏州明纬自动化有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search', continuationAction: 'start_new_task' } },
      { query: `新增客户 苏州恒达机电有限公司 ${fullCustomerInput}`, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
    ],
  },
  {
    id: '112-qa-memory-query-after-update-binds-latest-result',
    title: '记忆隔离：查询后更新查询对象而不是旧对象',
    turns: [
      { query: '查询客户 苏州恒达机电有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-old-001', '苏州恒达机电有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '查询客户 苏州协同机械有限公司', mock: { searchRecords: [recordFixture('customer', 'customer-new-001', '苏州协同机械有限公司')] }, expect: { status: 'completed', selectedTool: 'record.customer.search' } },
      { query: '客户类型改为VIP客户', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', assert: assertLatestPreviewFormInstId('record.customer.preview_update', 'customer-new-001') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
    ],
  },
];

const qaTargetPollutionScenarios: AgentScenario[] = [
  qaPollutedCollectionScenario('113-qa-pollution-customer-old-id', 'LLM target 污染：客户旧 ID', 'customer', '查询客户', 'stale-customer-id-001', '苏州恒达机电有限公司'),
  qaPollutedCollectionScenario('114-qa-pollution-contact-old-id', 'LLM target 污染：联系人旧 ID', 'contact', '查询联系人', 'stale-contact-id-001', '李玲玲'),
  qaPollutedCollectionScenario('115-qa-pollution-opportunity-old-id', 'LLM target 污染：商机旧 ID', 'opportunity', '查询商机', 'stale-opportunity-id-001', '苏州ERP升级项目'),
  qaPollutedCollectionScenario('116-qa-pollution-followup-old-id', 'LLM target 污染：拜访记录旧 ID', 'followup', '查询拜访记录', 'stale-followup-id-001', '报价后回访'),
  qaPollutedCollectionScenario('117-qa-pollution-customer-old-name', 'LLM target 污染：客户旧名称', 'customer', '查询客户', '苏州恒达机电有限公司', '苏州恒达机电有限公司'),
  qaPollutedCollectionScenario('118-qa-pollution-contact-old-name', 'LLM target 污染：联系人旧名称', 'contact', '查询联系人', '李玲玲', '李玲玲'),
  qaPollutedCollectionScenario('119-qa-pollution-customer-object-label', 'LLM target 污染：对象标签串入客户 target', 'customer', '查询客户', '联系人', '苏州恒达机电有限公司'),
  qaPollutedCollectionScenario('120-qa-pollution-contact-other-object-id', 'LLM target 污染：其他对象 ID 串入联系人 target', 'contact', '查询联系人', 'customer-old-001', '陈燕'),
];

const qaRecoveryScenarios: AgentScenario[] = [
  {
    id: '121-qa-recovery-contact-fill-confirm',
    title: '恢复补槽：联系人缺启用状态后补齐确认',
    turns: [
      { query: '新增联系人 陈燕 手机：13612952011', expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_create' } },
      { query: '启用状态：启用', expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_create' } },
    ],
  },
  {
    id: '122-qa-recovery-opportunity-fill-confirm',
    title: '恢复补槽：商机缺字段后补齐确认',
    turns: [
      { query: '新增商机 苏州ERP升级项目', expect: { status: 'waiting_input', selectedTool: 'record.opportunity.preview_create' } },
      { query: fullOpportunityInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.opportunity.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.opportunity.commit_create' } },
    ],
  },
  {
    id: '123-qa-recovery-followup-fill-confirm',
    title: '恢复补槽：拜访记录缺字段后补齐确认',
    turns: [
      { query: '新增拜访记录 今天电话沟通ERP升级', expect: { status: 'waiting_input', selectedTool: 'record.followup.preview_create' } },
      { query: fullFollowupInput, expect: { status: 'waiting_confirmation', selectedTool: 'record.followup.preview_create', continuationAction: 'resume_pending_interaction' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.followup.commit_create' } },
    ],
  },
  {
    id: '124-qa-recovery-duplicate-update-existing',
    title: '恢复补槽：客户查重后选择更新已有',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${fullCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '更新已有 formInstId:customer-existing-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_update', continuationAction: 'select_candidate' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_update' } },
    ],
  },
  {
    id: '125-qa-recovery-duplicate-create-new',
    title: '恢复补槽：客户查重后仍新建',
    turns: [
      { query: `新增客户 苏州恒达机电有限公司 ${fullCustomerInput}`, mock: { searchRecords: [recordFixture('customer', 'customer-existing-001', '苏州恒达机电有限公司')] }, expect: { status: 'waiting_selection', selectedTool: 'record.customer.preview_create' } },
      { query: '仍要新建一条', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.customer.preview_create', continuationAction: 'select_candidate' } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.customer.commit_create' } },
    ],
  },
  {
    id: '126-qa-recovery-reject-writeback',
    title: '恢复补槽：写回预览后取消',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-cancel-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新备注，暂时不要联系', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update' } },
      { query: '取消写回', resumeDecision: 'reject', expect: { status: 'cancelled', selectedTool: 'record.contact.commit_update' } },
    ],
  },
  {
    id: '127-qa-recovery-empty-payload-guard-visible',
    title: '恢复补槽：空 payload 守卫可见但不吞掉上下文',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-empty-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '更新这个联系人', mock: { previewEmptyPayload: true }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', policyCode: 'record.preview_empty_payload_guard' } },
      { query: '备注：喜欢喝茶', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', continuationAction: 'resume_pending_interaction', assert: assertLatestPreviewParam('record.contact.preview_update', 'Ta_1', '喜欢喝茶') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
    ],
  },
  {
    id: '128-qa-recovery-relation-candidate-then-id-confirm',
    title: '恢复补槽：关系字段候选后用 ID 补齐确认',
    turns: [
      { query: '查询联系人 李玲玲', mock: { searchRecords: [recordFixture('contact', 'contact-relation-001', '李玲玲')] }, expect: { status: 'completed', selectedTool: 'record.contact.search' } },
      { query: '将这个联系人的客户信息更新为安徽艳阳电气', mock: { searchRecords: [recordFixture('customer', 'customer-ah-001', '安徽艳阳电气')] }, expect: { status: 'waiting_input', selectedTool: 'record.contact.preview_update', pendingInteractionKind: 'input_required', assert: assertNoPreviewParam('record.contact.preview_update', 'province') } },
      { query: '客户编号：customer-ah-001', mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: 'record.contact.preview_update', continuationAction: 'resume_pending_interaction', assert: assertLatestPreviewParam('record.contact.preview_update', 'linked_customer_form_inst_id', 'customer-ah-001') } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: 'record.contact.commit_update' } },
    ],
  },
];

const qaAgentQualityScenarios: AgentScenario[] = [
  ...qaTraceReplayScenarios,
  ...qaMetadataFieldScenarios,
  ...qaContextMemoryScenarios,
  ...qaTargetPollutionScenarios,
  ...qaRecoveryScenarios,
].map((scenario) => ({ ...scenario, qualityGate: true }));

test('Agent scenario harness runs 48 QA-agent quality scenarios with deterministic trace scoring', async () => {
  assert.equal(qaAgentQualityScenarios.length, 48);
  assert.ok(qaAgentQualityScenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0) >= 176);
  await runAgentScenarios(qaAgentQualityScenarios);
});

function pollutedCollectionIntent(objectKey: ShadowObjectKey, pollutedTarget: string): IntentFrame {
  return {
    actionType: 'query',
    goal: `查询${recordObjectTitles[objectKey]}`,
    targetType: objectKey,
    targets: [{ type: 'company', id: pollutedTarget, name: pollutedTarget }],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.95,
    source: 'llm',
  };
}

function inferIntentFrame(query: string, focusedName?: string | null): IntentFrame {
  const objectKey = inferObjectKey(query);
  const actionType: IntentFrame['actionType'] = /(录入|创建|新增|新建|补录|写入|修改|更新|关联|绑定|选择)/.test(query)
    ? 'write'
    : /(研究|分析|最近|关注|风险|有什么)/.test(query)
      ? 'analyze'
      : 'query';

  if (/研究|分析/.test(query) && !objectKey) {
    const name = extractCompanyName(query) || focusedName || '苏州金蝶软件有限公司';
    return {
      actionType: 'analyze',
      goal: '研究目标公司并沉淀 Artifact',
      targetType: 'company',
      targets: [{ type: 'company', id: name, name }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.9,
      source: 'fallback',
    };
  }

  if (/(最近|值得关注|风险|有什么)/.test(query) && !/(录入|创建|新增|新建|写入)/.test(query)) {
    const name = extractCompanyName(query) || focusedName || '苏州金蝶软件有限公司';
    return {
      actionType,
      goal: '检索已有 Artifact 证据',
      targetType: 'artifact',
      targets: [{ type: 'artifact', id: name, name }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.82,
      source: 'fallback',
    };
  }

  if (objectKey) {
    const name = extractRecordName(query, objectKey);
    return {
      actionType,
      goal: `${actionType} ${objectKey}`,
      targetType: objectKey,
      targets: [{ type: objectKey, id: name || objectKey, name: name || objectKey }],
      inputMaterials: [],
      constraints: [],
      missingSlots: [],
      confidence: 0.86,
      source: 'fallback',
    };
  }

  return {
    actionType,
    goal: '澄清任务',
    targetType: 'unknown',
    targets: [],
    inputMaterials: [],
    constraints: [],
    missingSlots: ['目标对象或任务类型'],
    confidence: 0.5,
    source: 'fallback',
  };
}

function inferObjectKey(query: string): ShadowObjectKey | null {
  if (/(新增|新建|录入|创建|写入)\s*(客户|公司)|这个客户/.test(query) && !/(研究|分析)/.test(query)) {
    return 'customer';
  }
  if (/拜访记录|回访记录|跟进记录|跟进|回访/.test(query)) {
    return 'followup';
  }
  if (/联系人/.test(query)) {
    return 'contact';
  }
  if (/商机|机会|项目|单子/.test(query)) {
    return 'opportunity';
  }
  if (/客户|公司/.test(query) && !/(研究|分析)/.test(query)) {
    return 'customer';
  }
  return null;
}

function extractCompanyName(query: string): string {
  return query
    .replace(/研究这家公司/g, '')
    .replace(/研究/g, '')
    .replace(/分析/g, '')
    .trim();
}

function extractRecordName(query: string, objectKey: ShadowObjectKey): string {
  if (/这个客户/.test(query)) {
    return '这个客户';
  }
  const labels = objectKey === 'contact'
    ? '联系人'
    : objectKey === 'opportunity'
      ? '商机|机会|项目|单子'
      : objectKey === 'followup'
        ? '跟进记录|拜访记录|回访记录|跟进|回访|拜访'
        : '客户|公司';
  const matched = query.match(new RegExp(`(?:新增|新建|录入|创建|查询|查一下|先查)?(?:${labels})?\\s*([^，。\\n]+)`));
  return (matched?.[1] ?? '').trim().split(/\s+/)[0] ?? '';
}

function buildPreviewResponse(
  objectKey: ShadowObjectKey,
  input: ShadowPreviewUpsertInput,
  mock: HarnessMock,
): ShadowPreviewResponse {
  const params = input.params && typeof input.params === 'object' ? input.params : {};
  const blockedReadonlyParams = mock.blockedReadonlyParams ?? [];
  const validationErrors = mock.validationErrors ?? [];
  const missingRequiredParams = mock.previewReady
    ? []
    : requiredFields[objectKey].filter((field) => !hasMeaningfulValue((params as Record<string, unknown>)[field]));
  const readyToSend = mock.previewEmptyPayload
    || (missingRequiredParams.length === 0 && blockedReadonlyParams.length === 0 && validationErrors.length === 0);
  const widgetValue = mock.previewEmptyPayload
    ? {}
    : {
        ...(params as Record<string, unknown>),
        _S_TITLE: String(Object.values(params as Record<string, unknown>)[0] ?? `${objectKey} 记录`),
      };

  return {
    objectKey,
    operation: 'upsert',
    unresolvedDictionaries: [],
    resolvedDictionaryMappings: [],
    missingRequiredParams,
    blockedReadonlyParams,
    missingRuntimeInputs: [],
    validationErrors,
    readyToSend,
    requestBody: { formCodeId: `${objectKey}-form`, data: [{ widgetValue }] },
  };
}

const requiredFields: Record<ShadowObjectKey, string[]> = {
  customer: ['contact_name', 'enabled_state', 'customer_type', 'customer_status', 'Ra_1', 'customer_name', 'contact_phone'],
  contact: ['contact_name', 'enabled_state', 'mobile_phone'],
  opportunity: ['linked_customer_form_inst_id', 'opportunity_name', 'sales_stage', 'expected_close_date', 'opportunity_budget'],
  followup: ['followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'followup_record'],
};

function hasMeaningfulValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function assertNoSearchFilterValue(harness: AgentScenarioHarness, tool: string, value: string): void {
  const call = harness.calls.findLast((item) => item.tool === tool);
  const filters = Array.isArray((call?.input as { filters?: unknown[] } | undefined)?.filters)
    ? (call?.input as { filters: Array<{ value?: unknown }> }).filters
    : [];
  assert.equal(filters.some((filter) => String(filter.value ?? '') === value), false, `${tool} should not filter by ${value}`);
}

function assertSearchFilterValue(harness: AgentScenarioHarness, tool: string, field: string, value: string): void {
  const call = harness.calls.findLast((item) => item.tool === tool);
  const filters = Array.isArray((call?.input as { filters?: unknown[] } | undefined)?.filters)
    ? (call?.input as { filters: Array<{ field?: unknown; value?: unknown }> }).filters
    : [];
  assert.equal(
    filters.some((filter) => filter.field === field && String(filter.value ?? '') === value),
    true,
    `${tool} should filter ${field} by ${value}`,
  );
}

function assertSearchFilterContainsValue(harness: AgentScenarioHarness, tool: string, value: string): void {
  const call = harness.calls.findLast((item) => item.tool === tool);
  const filters = Array.isArray((call?.input as { filters?: unknown[] } | undefined)?.filters)
    ? (call?.input as { filters: Array<{ value?: unknown }> }).filters
    : [];
  assert.equal(
    filters.some((filter) => {
      const filterValue = String(filter.value ?? '');
      return filterValue.includes(value) || value.includes(filterValue);
    }),
    true,
    `${tool} should include filter value ${value}; filters=${JSON.stringify(filters)}`,
  );
}

function assertLatestPreviewParam(tool: string, paramKey: string, expected: unknown): HarnessTurn['expect']['assert'] {
  return (_response, harness) => {
    const call = harness.calls.findLast((item) => item.tool === tool);
    const params = (call?.input as ShadowPreviewUpsertInput | undefined)?.params ?? {};
    assert.deepEqual(params[paramKey], expected, `${tool} should set ${paramKey}`);
  };
}

function assertNoPreviewParam(tool: string, paramKey: string): HarnessTurn['expect']['assert'] {
  return (_response, harness) => {
    const call = harness.calls.findLast((item) => item.tool === tool);
    const params = (call?.input as ShadowPreviewUpsertInput | undefined)?.params ?? {};
    assert.equal(Object.prototype.hasOwnProperty.call(params, paramKey), false, `${tool} should not set ${paramKey}`);
  };
}

function assertLatestPreviewFormInstId(tool: string, expected: string): HarnessTurn['expect']['assert'] {
  return (_response, harness) => {
    const call = harness.calls.findLast((item) => item.tool === tool);
    assert.equal((call?.input as ShadowPreviewUpsertInput | undefined)?.formInstId, expected, `${tool} should update ${expected}`);
  };
}

function assertCollectionQueryClean(tool: string, staleValue: string): HarnessTurn['expect']['assert'] {
  return (response, harness) => {
    assert.equal(response.message.extraInfo.agentTrace.resolvedContext?.usedContext, false);
    assertNoSearchFilterValue(harness, tool, staleValue);
  };
}

function qaUpdateParamScenario(
  id: string,
  title: string,
  objectKey: ShadowObjectKey,
  searchQuery: string,
  record: ReturnType<typeof recordFixture>,
  updateQuery: string,
  previewTool: string,
  paramKey: string,
  expected: unknown,
): AgentScenario {
  return {
    id,
    title,
    turns: [
      { query: searchQuery, mock: { searchRecords: [record] }, expect: { status: 'completed', selectedTool: `record.${objectKey}.search` } },
      { query: updateQuery, mock: { previewReady: true }, expect: { status: 'waiting_confirmation', selectedTool: previewTool, assert: assertLatestPreviewParam(previewTool, paramKey, expected) } },
      { query: '确认写回', resumeDecision: 'approve', expect: { status: 'completed', selectedTool: `record.${objectKey}.commit_update` } },
    ],
  };
}

function qaPollutedCollectionScenario(
  id: string,
  title: string,
  objectKey: ShadowObjectKey,
  query: string,
  pollutedTarget: string,
  previousName: string,
): AgentScenario {
  const explicitQuery = `${query} ${previousName}`;
  return {
    id,
    title,
    turns: [
      { query: explicitQuery, mock: { searchRecords: [recordFixture(objectKey, `${objectKey}-previous-001`, previousName)] }, expect: { status: 'completed', selectedTool: `record.${objectKey}.search` } },
      {
        query,
        mock: { intentFrame: pollutedCollectionIntent(objectKey, pollutedTarget) },
        expect: {
          status: 'completed',
          selectedTool: `record.${objectKey}.search`,
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assert.equal((response.message.extraInfo.agentTrace.selectedTool?.input?.agentControl as { targetSanitization?: { reasonCode?: string } } | undefined)?.targetSanitization?.reasonCode, 'ignored_ungrounded_target');
            assertNoSearchFilterValue(harness, `record.${objectKey}.search`, pollutedTarget);
          },
        },
      },
      {
        query: explicitQuery,
        mock: { intentFrame: pollutedCollectionIntent(objectKey, pollutedTarget) },
        expect: {
          status: 'completed',
          selectedTool: `record.${objectKey}.search`,
          assert: (_response, harness) => assertSearchFilterContainsValue(harness, `record.${objectKey}.search`, previousName),
        },
      },
      {
        query,
        mock: { intentFrame: pollutedCollectionIntent(objectKey, pollutedTarget) },
        expect: {
          status: 'completed',
          selectedTool: `record.${objectKey}.search`,
          assert: (response, harness) => {
            assert.deepEqual(response.message.extraInfo.agentTrace.selectedTool?.input?.filters, []);
            assertNoSearchFilterValue(harness, `record.${objectKey}.search`, pollutedTarget);
          },
        },
      },
      {
        query: explicitQuery,
        expect: {
          status: 'completed',
          selectedTool: `record.${objectKey}.search`,
          assert: (_response, harness) => assertSearchFilterContainsValue(harness, `record.${objectKey}.search`, previousName),
        },
      },
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
