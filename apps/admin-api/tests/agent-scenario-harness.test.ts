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
}

interface LoggedCall {
  tool: string;
  objectKey?: ShadowObjectKey;
  input?: unknown;
}

class AgentScenarioHarness {
  readonly repository = new AgentRunRepository(createInMemoryDatabase());
  readonly calls: LoggedCall[] = [];
  readonly service: AgentService;
  readonly registryCodes: string[];
  activeMock: HarnessMock = {};

  constructor() {
    const config = createTestConfig();
    const runtimeParts = createCrmAgentRuntimeParts({
      config,
      repository: this.repository,
      intentFrameService: {
        createIntentFrame: async (request: AgentChatRequest, focusedName?: string | null) => inferIntentFrame(request.query, focusedName),
      } as any,
      shadowMetadataService: {
        executeSearch: async (objectKey: ShadowObjectKey, input: unknown) => {
          this.calls.push({ tool: `record.${objectKey}.search`, objectKey, input });
          return { records: this.activeMock.searchRecords ?? [] };
        },
        executeGet: async (objectKey: ShadowObjectKey, input: unknown) => {
          this.calls.push({ tool: `record.${objectKey}.get`, objectKey, input });
          return { record: null };
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
    assert.equal(response.executionState.status, turn.expect.status, `${label}: status`);
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

function inferIntentFrame(query: string, focusedName?: string | null): IntentFrame {
  const objectKey = inferObjectKey(query);
  const actionType: IntentFrame['actionType'] = /(录入|创建|新增|新建|补录|写入|修改|更新)/.test(query)
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
  if (/联系人/.test(query)) {
    return 'contact';
  }
  if (/商机|机会/.test(query)) {
    return 'opportunity';
  }
  if (/跟进/.test(query)) {
    return 'followup';
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
      ? '商机|机会'
      : objectKey === 'followup'
        ? '跟进记录|跟进'
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
