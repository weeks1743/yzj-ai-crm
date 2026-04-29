import { randomUUID } from 'node:crypto';
import type {
  AgentEvidenceCard,
  AppConfig,
  ArtifactAnchor,
  ExternalSkillJobResponse,
  IntentFrame,
  ShadowObjectKey,
  ShadowPreviewResponse,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
  ShadowStandardizedField,
  TaskPlan,
} from './contracts.js';
import {
  type AgentIntentResolver,
  type AgentPlanner,
  type AgentPlannerInput,
  type AgentPlannerResult,
  type AgentToolDefinition,
  type AgentToolExecuteContext,
  type AgentToolExecuteInput,
  type AgentToolExecutionResult,
  type AgentToolSelection,
  type ConfirmationRequest,
  type ContextFrame,
  type FieldOptionHint,
  type MetaQuestion,
  type PendingInteraction,
  type RecordWritePreviewRow,
  type RecordWritePreviewView,
  type RecordToolCapability,
  type ToolArbitrationTrace,
  createPolicyDecision,
  createToolCall,
  finishToolCall,
} from './agent-core.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import {
  arbitrateToolSemantic,
  buildProbeTrace,
  readToolArbitrationProbeControl,
  type ToolArbitrationRule,
} from './agent-tool-semantic-arbitrator.js';
import { cleanupCompanyName, extractCompanyName, inferFallbackIntent } from './agent-utils.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import type { IntentFrameService } from './intent-frame-service.js';
import type { ShadowMetadataService } from './shadow-metadata-service.js';
import { AgentToolRegistry } from './tool-registry.js';
import { getErrorMessage } from './errors.js';

const CRM_RECORD_OBJECTS: ShadowObjectKey[] = ['customer', 'contact', 'opportunity', 'followup'];
const COMPANY_RESEARCH_TOOL = 'external.company_research';
const COMPANY_RESEARCH_RUNTIME_TOOL = 'ext.company_research_pm';
const CONTEXT_SUMMARY_TOOL = 'meta.context_summary';
const COMPANY_RESEARCH_POLL_INTERVAL_MS = 1000;
const COMPANY_RESEARCH_MAX_WAIT_MS = 420_000;
const DUPLICATE_CHECK_MAX_ATTEMPTS = 2;
const DUPLICATE_CHECK_RETRY_DELAY_MS = 300;

const CRM_RECORD_CAPABILITIES: Record<ShadowObjectKey, RecordToolCapability> = {
  customer: {
    subjectBinding: {
      acceptedSubjectTypes: ['company', 'customer', 'artifact_anchor'],
      identityFromSubject: true,
    },
    identityFields: ['customer_name'],
    fieldLabels: {
      customer_name: '客户名称',
      _S_NAME: '客户名称',
      _S_TITLE: '标题',
      contact_name: '联系人姓名',
      Te_5: '联系人姓名',
      contact_phone: '联系人手机',
      Nu_1: '联系人手机',
      enabled_state: '启用状态',
      _S_DISABLE: '启用状态',
      customer_type: '客户类型',
      Ra_3: '客户类型',
      customer_status: '客户状态',
      Ra_0: '客户状态',
      Ra_1: '客户是否分配',
      province: '省',
      city: '市',
      district: '区',
      industry: '行业',
      company_phone: '公司电话',
      office_phone: '办公电话',
      owner_open_id: '负责人',
      service_rep_open_id: '售后服务代表',
    },
    fieldDisplayOrder: [
      'customer_name',
      'contact_name',
      'contact_phone',
      'customer_status',
      'customer_type',
      'enabled_state',
      'Ra_1',
      'province',
      'city',
      'district',
      'industry',
    ],
    requiredFieldRefs: [
      'contact_name',
      'enabled_state',
      'customer_type',
      'customer_status',
      'Ra_1',
      'customer_name',
      'contact_phone',
    ],
    derivedFieldRefs: ['_S_TITLE'],
    recommendedFieldRefs: ['province', 'city', 'district', 'industry', 'owner_open_id', 'service_rep_open_id'],
    debugVisibility: 'content',
    duplicateCheckPolicy: { enabled: true, maxCandidates: 5 },
    previewInputPolicy: {
      subjectNameParam: 'customer_name',
      writableParams: [
        'customer_name',
        'contact_name',
        'contact_phone',
        'customer_status',
        'customer_type',
        'enabled_state',
        'Ra_1',
        'province',
        'city',
        'district',
        'industry',
        'owner_open_id',
        'service_rep_open_id',
      ],
    },
  },
  contact: {
    subjectBinding: {
      acceptedSubjectTypes: ['customer'],
      searchFilterField: 'linked_customer_form_inst_id',
      searchValueSource: 'subject_id',
    },
    identityFields: ['contact_name'],
    fieldLabels: {
      contact_name: '联系人姓名',
      _S_NAME: '联系人姓名',
      mobile_phone: '手机',
      Nu_0: '手机',
      enabled_state: '启用状态',
      _S_DISABLE: '启用状态',
      linked_customer_form_inst_id: '关联客户',
      province: '省',
      city: '市',
      district: '区',
      office_phone: '办公电话',
      _S_TITLE: '标题',
    },
    fieldDisplayOrder: ['contact_name', 'mobile_phone', 'enabled_state', 'linked_customer_form_inst_id', 'province', 'city', 'district'],
    requiredFieldRefs: ['contact_name', 'enabled_state', 'mobile_phone'],
    derivedFieldRefs: ['_S_TITLE'],
    recommendedFieldRefs: ['linked_customer_form_inst_id', 'province', 'city', 'district', 'office_phone'],
    debugVisibility: 'content',
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: 'contact_name',
      writableParams: ['contact_name', 'mobile_phone', 'enabled_state', 'linked_customer_form_inst_id', 'province', 'city', 'district', 'office_phone'],
    },
  },
  opportunity: {
    subjectBinding: {
      acceptedSubjectTypes: ['customer'],
      searchFilterField: 'linked_customer_form_inst_id',
      searchValueSource: 'subject_id',
    },
    identityFields: ['opportunity_name'],
    fieldLabels: {
      opportunity_name: '机会名称',
      _S_TITLE: '标题',
      linked_customer_form_inst_id: '客户编号',
      linked_contact_form_inst_id: '联系人',
      sales_stage: '销售阶段',
      expected_close_date: '预计成交时间',
      opportunity_budget: '商机预算（元）',
      owner_open_id: '负责人',
    },
    fieldDisplayOrder: [
      'opportunity_name',
      'linked_customer_form_inst_id',
      'sales_stage',
      'expected_close_date',
      'opportunity_budget',
      'linked_contact_form_inst_id',
      'owner_open_id',
    ],
    requiredFieldRefs: ['linked_customer_form_inst_id', 'opportunity_name', 'sales_stage', 'expected_close_date', 'opportunity_budget'],
    derivedFieldRefs: ['_S_TITLE'],
    recommendedFieldRefs: ['linked_contact_form_inst_id', 'owner_open_id'],
    debugVisibility: 'content',
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: 'opportunity_name',
      writableParams: [
        'opportunity_name',
        'linked_customer_form_inst_id',
        'sales_stage',
        'expected_close_date',
        'opportunity_budget',
        'linked_contact_form_inst_id',
        'owner_open_id',
      ],
    },
  },
  followup: {
    subjectBinding: {
      acceptedSubjectTypes: ['customer'],
      searchFilterField: 'linked_customer_form_inst_id',
      searchValueSource: 'subject_id',
    },
    identityFields: ['followup_record'],
    fieldLabels: {
      followup_record: '跟进记录',
      Ta_0: '跟进记录',
      followup_method: '跟进方式',
      Ra_1: '跟进方式',
      linked_customer_form_inst_id: '客户编号',
      owner_open_id: '跟进负责人',
      linked_opportunity_form_inst_id: '商机',
      _S_TITLE: '标题',
    },
    fieldDisplayOrder: ['followup_record', 'followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'linked_opportunity_form_inst_id'],
    requiredFieldRefs: ['followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'followup_record'],
    derivedFieldRefs: ['_S_TITLE'],
    recommendedFieldRefs: ['linked_opportunity_form_inst_id'],
    debugVisibility: 'content',
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: 'followup_record',
      writableParams: ['followup_record', 'followup_method', 'linked_customer_form_inst_id', 'owner_open_id', 'linked_opportunity_form_inst_id'],
    },
  },
};

interface SkillJobWaitResult {
  status: 'succeeded' | 'still_running';
  job: ExternalSkillJobResponse;
}

export interface CrmAgentPackOptions {
  config: AppConfig;
  repository: AgentRunRepository;
  intentFrameService: IntentFrameService;
  shadowMetadataService: ShadowMetadataService;
  externalSkillService: ExternalSkillService;
  artifactService: ArtifactService;
  companyResearchMaxWaitMs?: number;
}

const CRM_TOOL_ARBITRATION_RULES: ToolArbitrationRule[] = [
  {
    ruleCode: 'crm.subject_profile_lookup',
    conflictGroup: 'subject_profile_lookup',
    priority: 100,
    readOnlyProbeToolCode: 'record.customer.search',
    match: ({ query, intentFrame }) => {
      const target = intentFrame.target;
      if (target.kind === 'record' && target.objectType !== 'customer') {
        return null;
      }

      if (isExplicitCompanyResearchQuery(query)) {
        const companyName = cleanupCompanyName(target.name || extractCompanyName(query));
        return companyName
          ? {
              mode: 'direct',
              intentCode: 'external_research',
              subjectType: 'company',
              subjectName: companyName,
              directToolCode: COMPANY_RESEARCH_TOOL,
              reason: '用户明确要求外部研究，直接选择公司研究工具。',
              confidence: 0.86,
            }
          : null;
      }

      const recordLookupName = target.kind === 'record'
        ? ''
        : resolveExplicitCustomerRecordInfoName(query, target);
      if (recordLookupName) {
        return {
          mode: 'direct',
          intentCode: 'internal_record_lookup',
          subjectType: 'company',
          subjectName: recordLookupName,
          directToolCode: 'record.customer.search',
          reason: '用户明确要求查看系统中的客户资料，直接选择只读记录查询。',
          confidence: 0.84,
        };
      }

      const ambiguousName = target.kind === 'record' && target.objectType !== 'customer'
        ? ''
        : resolveAmbiguousCompanyInfoName(query, target);
      if (!ambiguousName) {
        return null;
      }
      return {
        mode: 'ambiguous',
        intentCode: 'provide_info',
        subjectType: 'company',
        subjectName: ambiguousName,
        reason: '用户表达在内部记录资料、已有 Artifact 和外部研究之间存在语义冲突，先选择只读探测工具。',
        confidence: 0.82,
      };
    },
    buildToolInput: ({ tool, match, query }) => buildCrmArbitrationToolInput(tool.code, match.subjectName ?? '', query),
  },
];

export class CrmIntentResolver implements AgentIntentResolver {
  constructor(
    private readonly options: {
      intentFrameService: IntentFrameService;
    },
  ) {}

  async resolve(input: AgentToolExecuteInput['request'], contextFrame?: ContextFrame | null) {
    const focusedName = contextFrame?.subject?.name ?? null;
    const legacyIntentFrame = await this.options.intentFrameService.createIntentFrame(input, focusedName);
    return toGenericIntentFrame(legacyIntentFrame, input, focusedName);
  }
}

export class CrmAgentPlanner implements AgentPlanner {
  constructor(
    private readonly options: {
      arbitrationRules: ToolArbitrationRule[];
    },
  ) {}

  async plan(input: AgentPlannerInput): Promise<AgentPlannerResult> {
    const toolSelection = selectTool(input, this.options.arbitrationRules);
    const selectedTool = toolSelection.selectedTool;
    const taskPlan = buildToolTaskPlan(input.intentFrame.legacyIntentFrame, selectedTool);
    return {
      taskPlan,
      selectedTool,
      toolArbitration: toolSelection.toolArbitration ?? null,
      policyDecisions: [
        createPolicyDecision({
          policyCode: toolSelection.toolArbitration ? 'agent_core.tool_semantic_arbitration' : 'runtime.no_scene_tools',
          action: 'audit',
          toolCode: selectedTool?.toolCode,
          reason: toolSelection.toolArbitration
            ? `已通过通用工具语义仲裁选择工具：${toolSelection.toolArbitration.reason}`
            : '运行时只允许 record/external/meta/artifact 工具，不选择 scene.*。',
        }),
      ],
    };
  }
}

export function createCrmAgentRuntimeParts(options: CrmAgentPackOptions): {
  registry: AgentToolRegistry;
  intentResolver: CrmIntentResolver;
  planner: CrmAgentPlanner;
} {
  const registry = new AgentToolRegistry();

  for (const objectKey of CRM_RECORD_OBJECTS) {
    registerRecordTools(registry, objectKey, options);
  }
  registerCompanyResearchTool(registry, options);
  registerArtifactSearchTool(registry, options);
  registerMetaTools(registry, options);

  return {
    registry,
    intentResolver: new CrmIntentResolver({
      intentFrameService: options.intentFrameService,
    }),
    planner: new CrmAgentPlanner({
      arbitrationRules: CRM_TOOL_ARBITRATION_RULES,
    }),
  };
}

function toGenericIntentFrame(legacyIntentFrame: IntentFrame, request: AgentToolExecuteInput['request'], focusedName?: string | null) {
  const recordObject = resolveRecordObject(request.query, legacyIntentFrame);
  const target = (() => {
    if (recordObject) {
      return {
        kind: 'record' as const,
        objectType: recordObject,
        id: legacyIntentFrame.targets[0]?.id,
        name: legacyIntentFrame.targets[0]?.name || extractRecordName(request.query, recordObject),
      };
    }
    if (legacyIntentFrame.targetType === 'artifact') {
      return {
        kind: 'artifact' as const,
        id: legacyIntentFrame.targets[0]?.id,
        name: legacyIntentFrame.targets[0]?.name || focusedName || undefined,
      };
    }
    if (legacyIntentFrame.targetType === 'company') {
      return {
        kind: 'external_subject' as const,
        objectType: 'company',
        id: legacyIntentFrame.targets[0]?.id,
        name: legacyIntentFrame.targets[0]?.name || extractCompanyName(request.query) || focusedName || undefined,
      };
    }
    return {
      kind: 'unknown' as const,
      name: legacyIntentFrame.targets[0]?.name || focusedName || undefined,
    };
  })();

  return {
    actionType: legacyIntentFrame.actionType,
    goal: legacyIntentFrame.goal,
    target,
    inputMaterials: legacyIntentFrame.inputMaterials,
    constraints: legacyIntentFrame.constraints,
    missingSlots: legacyIntentFrame.missingSlots,
    confidence: legacyIntentFrame.confidence,
    source: legacyIntentFrame.source,
    fallbackReason: legacyIntentFrame.fallbackReason,
    legacyIntentFrame,
  };
}

function resolveRecordObject(query: string, intentFrame: IntentFrame): ShadowObjectKey | null {
  if (intentFrame.targetType === 'company' && (intentFrame.actionType === 'analyze' || /(公司研究|研究|分析)/.test(query))) {
    return null;
  }
  const explicitObject = inferExplicitRecordObject(query);
  if (explicitObject === '客户' || explicitObject === '公司') {
    return 'customer';
  }
  if (explicitObject === '联系人') {
    return 'contact';
  }
  if (explicitObject === '商机' || explicitObject === '机会') {
    return 'opportunity';
  }
  if (explicitObject === '跟进记录' || explicitObject === '跟进') {
    return 'followup';
  }
  if (intentFrame.targetType === 'customer'
    || intentFrame.targetType === 'contact'
    || intentFrame.targetType === 'opportunity'
    || intentFrame.targetType === 'followup') {
    return intentFrame.targetType;
  }

  const text = `${query}\n${intentFrame.goal}\n${intentFrame.targetType}`.toLowerCase();
  if (/联系人|contact/.test(text)) {
    return 'contact';
  }
  if (/跟进|拜访记录|followup/.test(text)) {
    return 'followup';
  }
  if (/商机|机会|opportunity/.test(text)) {
    return 'opportunity';
  }
  if (/客户|customer/.test(text) && !/(公司研究|研究|分析)/.test(query)) {
    return 'customer';
  }
  return null;
}

function inferExplicitRecordObject(query: string): string | null {
  if (/((这个|该|当前)?(客户|公司))的联系人/.test(query)) {
    return '联系人';
  }
  if (/((这个|该|当前)?(客户|公司))的(商机|机会)/.test(query)) {
    return '商机';
  }
  if (/((这个|该|当前)?(客户|公司))的(跟进记录|跟进)/.test(query)) {
    return '跟进记录';
  }

  return query.match(/(?:录入|创建|新增|新建|补录|写入|查询|查一下|搜索|找一下|更新|修改|打开)\s*(?:一个|这?个)?\s*(客户|公司|联系人|商机|机会|跟进记录|跟进)/)?.[1] ?? null;
}

interface CrmToolSelectionResult {
  selectedTool: AgentToolSelection | null;
  toolArbitration?: ToolArbitrationTrace | null;
}

function selectTool(input: AgentPlannerInput, arbitrationRules: ToolArbitrationRule[]): CrmToolSelectionResult {
  const query = input.request.query.trim();
  const target = input.intentFrame.target;

  if (hasAudioInput(input.request)) {
    return wrapSelectedTool({
      toolCode: 'meta.clarify_card',
      reason: '当前 MVP 不做录音转写，需要用户补充文字纪要。',
      input: {
        missingSlots: ['文字纪要'],
      },
      confidence: 0.82,
    });
  }

  if (target.kind === 'artifact' || isArtifactFollowupQuestion(query)) {
    return wrapSelectedTool({
      toolCode: 'artifact.search',
      reason: '用户正在追问已有研究或资产证据。',
      input: {
        query,
        anchorName: resolveArtifactAnchorName(input),
      },
      confidence: 0.78,
    });
  }

  const arbitration = arbitrateToolSemantic({
    query,
    intentFrame: input.intentFrame,
    availableTools: input.availableTools,
    rules: arbitrationRules,
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  });
  if (arbitration) {
    return {
      selectedTool: injectOperatorOpenId(arbitration.selectedTool, input.request.tenantContext?.operatorOpenId),
      toolArbitration: arbitration.trace,
    };
  }

  if (target.kind === 'external_subject' && target.objectType === 'company') {
    return wrapSelectedTool({
      toolCode: COMPANY_RESEARCH_TOOL,
      reason: '用户请求公司研究，选择外部研究工具。',
      input: {
        companyName: target.name || extractCompanyName(query),
      },
      confidence: 0.86,
    });
  }

  if (isContextSummaryQuery(query) && hasContextSummarySubject(input)) {
    const summaryType = inferContextSummaryType(query);
    return wrapSelectedTool({
      toolCode: CONTEXT_SUMMARY_TOOL,
      reason: summaryType === 'journey'
        ? '用户要求基于当前主体汇总连续业务旅程，选择通用上下文摘要工具。'
        : '用户要求基于当前主体给出推进建议，选择通用上下文摘要工具。',
      input: {
        query,
        summaryType,
      },
      confidence: 0.81,
    });
  }

  if (target.kind === 'record' && target.objectType) {
    const objectKey = target.objectType;
    const operation = resolveRecordOperation(query, input.intentFrame.legacyIntentFrame);
    const toolCode = `record.${objectKey}.${operation}`;
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return wrapSelectedTool({
      toolCode,
      reason: `用户意图落在记录对象 ${objectKey} 的 ${operation} 能力。`,
      input: buildRecordToolInput({
        query,
        objectKey,
        operation,
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        targetName: target.name,
        tool,
        contextFrame: input.contextFrame ?? null,
        resolvedContext: input.resolvedContext ?? null,
      }),
      confidence: 0.76,
    });
  }

  return wrapSelectedTool({
    toolCode: 'meta.clarify_card',
    reason: '目标对象或任务动作不完整。',
    input: {
      missingSlots: input.intentFrame.missingSlots.length
        ? input.intentFrame.missingSlots
        : ['目标对象或任务类型'],
    },
    confidence: 0.6,
  });
}

function wrapSelectedTool(selectedTool: AgentToolSelection): CrmToolSelectionResult {
  return { selectedTool, toolArbitration: null };
}

function injectOperatorOpenId(selectedTool: AgentToolSelection, operatorOpenId?: string): AgentToolSelection {
  if (!operatorOpenId || !selectedTool.toolCode.startsWith('record.')) {
    return selectedTool;
  }
  return {
    ...selectedTool,
    input: {
      ...selectedTool.input,
      operatorOpenId,
    },
  };
}

function buildCrmArbitrationToolInput(toolCode: string, subjectName: string, query: string): Record<string, unknown> {
  const companyName = cleanupCompanyName(subjectName || extractCompanyName(query));
  if (toolCode === 'record.customer.search') {
    const identityField = CRM_RECORD_CAPABILITIES.customer.identityFields?.[0] ?? 'customer_name';
    return {
      filters: [
        {
          field: identityField,
          value: companyName,
          operator: 'like',
        },
      ],
      pageNumber: 1,
      pageSize: 5,
    };
  }
  if (toolCode === COMPANY_RESEARCH_TOOL) {
    return {
      companyName,
    };
  }
  return {
    query,
    subjectName: companyName,
  };
}

function resolveAmbiguousCompanyInfoName(
  query: string,
  target: AgentPlannerInput['intentFrame']['target'],
): string {
  if (isExplicitCompanyResearchQuery(query)) {
    return '';
  }
  if (!isAmbiguousCompanyInfoQuery(query)) {
    return '';
  }
  return cleanupCompanyName(target.name || extractCompanyName(query));
}

function resolveExplicitCustomerRecordInfoName(
  query: string,
  target: AgentPlannerInput['intentFrame']['target'],
): string {
  if (isExplicitCompanyResearchQuery(query)) {
    return '';
  }
  if (!/^(?:查询|查一下|查看|打开)\s*/.test(query.trim())) {
    return '';
  }
  if (!/(客户|公司|信息|资料|详情)/.test(query)) {
    return '';
  }
  return cleanupCompanyName(target.name || extractCompanyName(query));
}

function isExplicitCompanyResearchQuery(query: string): boolean {
  return /\/客户分析|公司研究|客户分析|研究|分析一下|分析\s*(?:这家|这个)?(?:公司|客户)/.test(query);
}

function isAmbiguousCompanyInfoQuery(query: string): boolean {
  if (/^(?:查询|查一下|查看|打开)\s*/.test(query.trim())) {
    return false;
  }
  return /(?:给出|提供|展示|显示|看一下)\s*.+(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情)/.test(query)
    || /(?:给出|提供|展示|显示)\s*.+(?:公司|客户)/.test(query);
}

function resolveRecordOperation(query: string, intentFrame: IntentFrame) {
  if (/修改|更新|改成|变更/.test(query)) {
    return 'preview_update';
  }
  if (/录入|创建|新增|新建|补录|写入/.test(query) || intentFrame.actionType === 'write') {
    return 'preview_create';
  }
  if (/详情|详细|具体|打开/.test(query)) {
    return 'get';
  }
  return 'search';
}

function buildRecordToolInput(input: {
  query: string;
  objectKey: string;
  operation: string;
  operatorOpenId?: string;
  targetName?: string;
  tool?: AgentToolDefinition;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'];
}): Record<string, unknown> {
  const name = input.targetName || extractRecordName(input.query, input.objectKey);
  const capability = input.tool?.recordCapability ?? CRM_RECORD_CAPABILITIES[input.objectKey as ShadowObjectKey];
  const identityField = capability.identityFields?.[0] ?? inferRecordNameParam(input.objectKey);
  const contextRecordId = resolveContextRecordFormInstId({
    objectKey: input.objectKey,
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  });
  const boundSearchInput = buildSubjectBoundSearchInput({
    query: input.query,
    objectKey: input.objectKey,
    capability,
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  });
  if (input.operation === 'search') {
    return {
      filters: boundSearchInput?.filters ?? (name
        ? [
            {
              field: identityField,
              value: name,
              operator: 'like',
            },
          ]
        : []),
      operatorOpenId: input.operatorOpenId,
      pageNumber: 1,
      pageSize: 5,
    };
  }
  if (input.operation === 'get') {
    return {
      formInstId: extractFormInstId(input.query) ?? contextRecordId,
      operatorOpenId: input.operatorOpenId,
    };
  }
  if (input.operation === 'preview_update') {
    return {
      mode: 'update',
      formInstId: extractFormInstId(input.query) ?? contextRecordId,
      params: buildRecordParams(input.objectKey, input.query, name, capability, {
        includeSubjectName: false,
      }),
      operatorOpenId: input.operatorOpenId,
    };
  }
  const duplicateCheck = capability.duplicateCheckPolicy?.enabled && name
    ? {
        enabled: true,
        searchToolCode: capability.duplicateCheckPolicy.searchToolCode,
        filters: [
          {
            field: identityField,
            value: name,
            operator: 'like',
          },
        ],
        pageNumber: 1,
        pageSize: capability.duplicateCheckPolicy.maxCandidates ?? 5,
      }
    : undefined;
  return {
    mode: 'create',
    params: buildRecordParams(input.objectKey, input.query, name, capability, {
      includeSubjectName: true,
    }),
    operatorOpenId: input.operatorOpenId,
    ...(duplicateCheck ? { agentControl: { duplicateCheck, subjectName: name } } : {}),
  };
}

function resolveContextRecordFormInstId(input: {
  objectKey: string;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'] | null;
}): string | undefined {
  const subjects = [
    input.resolvedContext?.subject,
    input.contextFrame?.subject,
  ];
  for (const subject of subjects) {
    if (
      subject?.kind === 'record' &&
      subject.type === input.objectKey &&
      typeof subject.id === 'string' &&
      subject.id.trim()
    ) {
      return subject.id.trim();
    }
  }
  return undefined;
}

function buildSubjectBoundSearchInput(input: {
  query: string;
  objectKey: string;
  capability: RecordToolCapability;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'];
}): { filters: Array<{ field: string; value: string; operator: string }> } | null {
  const subject = input.contextFrame?.subject ?? input.resolvedContext?.subject;
  const binding = input.capability.subjectBinding;
  if (!subject?.type || !subject.id || !binding?.searchFilterField) {
    return null;
  }
  if (!binding.acceptedSubjectTypes?.includes(subject.type)) {
    return null;
  }
  if (!shouldUseSubjectBindingSearch(input.query, input.objectKey, input.resolvedContext ?? null)) {
    return null;
  }

  return {
    filters: [
      {
        field: binding.searchFilterField,
        value: binding.searchValueSource === 'subject_name' ? subject.name ?? '' : subject.id,
        operator: 'eq',
      },
    ],
  };
}

function shouldUseSubjectBindingSearch(
  query: string,
  objectKey: string,
  resolvedContext?: AgentPlannerInput['resolvedContext'] | null,
): boolean {
  if (resolvedContext?.usedContext) {
    return true;
  }

  if (objectKey === 'contact') {
    return /(客户.*联系人|公司.*联系人|联系人.*客户)/.test(query);
  }
  if (objectKey === 'opportunity') {
    return /(客户.*商机|公司.*商机|商机.*客户)/.test(query);
  }
  if (objectKey === 'followup') {
    return /(客户.*跟进|公司.*跟进|跟进.*客户)/.test(query);
  }
  return false;
}

function buildRecordParams(
  objectKey: string,
  query: string,
  name: string,
  capability: RecordToolCapability,
  options: {
    includeSubjectName: boolean;
  },
): Record<string, unknown> {
  const subjectNameParam = capability.previewInputPolicy?.subjectNameParam ?? inferRecordNameParam(objectKey);
  const normalizedName = trimValueBeforeKnownLabels(name, capability, subjectNameParam);
  const params: Record<string, unknown> = options.includeSubjectName && normalizedName ? { [subjectNameParam]: normalizedName } : {};

  for (const paramKey of capability.previewInputPolicy?.writableParams ?? []) {
    if (Object.prototype.hasOwnProperty.call(params, paramKey)) {
      continue;
    }
    const value = extractLabeledParamValue(query, paramKey, capability);
    if (value !== undefined) {
      params[paramKey] = value;
    }
  }

  return params;
}

function inferRecordNameParam(objectKey: string): string {
  if (objectKey === 'opportunity') {
    return 'opportunity_name';
  }
  if (objectKey === 'followup') {
    return 'followup_record';
  }
  if (objectKey === 'contact') {
    return 'contact_name';
  }
  if (objectKey === 'customer') {
    return 'customer_name';
  }
  return '_S_NAME';
}

function extractLabeledParamValue(query: string, paramKey: string, capability: RecordToolCapability): string | undefined {
  const labels = Array.from(
    new Set([
      capability.fieldLabels?.[paramKey],
      paramKey,
    ].filter((item): item is string => Boolean(item?.trim()))),
  );

  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const matched = query.match(new RegExp(`${escaped}\\s*(?:为|是|=|：|:)\\s*([^，。；;\\n]+)`));
    if (matched?.[1]?.trim()) {
      return trimValueBeforeKnownLabels(matched[1], capability, paramKey);
    }
  }

  const labelText = labels.join('|');
  if (/手机|电话|phone/i.test(labelText)) {
    return query.match(/1[3-9]\d{9}/)?.[0];
  }

  return undefined;
}

function trimValueBeforeKnownLabels(
  value: string,
  capability: RecordToolCapability,
  currentParamKey?: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  const labels = Object.entries(capability.fieldLabels ?? {})
    .filter(([paramKey]) => paramKey !== currentParamKey)
    .flatMap(([, label]) => [label, ...buildShortLabelVariants(label)])
    .filter((item): item is string => Boolean(item?.trim()))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!labels.length) {
    return normalized;
  }
  const labelPattern = labels.join('|');
  return normalized
    .replace(new RegExp(`\\s+(?:${labelPattern})\\s*(?:为|是|=|：|:).*$`), '')
    .trim();
}

function buildShortLabelVariants(label: string): string[] {
  return [
    label.replace(/姓名$/, ''),
    label.includes('姓名') ? '姓名' : '',
    label.includes('手机') ? '手机' : '',
    label.includes('手机') || label.includes('电话') ? '电话' : '',
    label.includes('手机') || label.includes('电话') ? '手机号' : '',
    label.replace(/（.*?）/g, ''),
  ].filter((item) => item && item !== label);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRecordName(query: string, objectKey: string): string {
  const withoutSlash = query.replace(/^\/\S+\s*/, '').trim();
  const labels = objectKey === 'contact'
    ? '联系人'
    : objectKey === 'opportunity'
      ? '商机'
      : objectKey === 'followup'
        ? '跟进记录|拜访记录'
        : '客户|公司';
  const pattern = new RegExp(`(?:录入|创建|新增|新建|补录|查询|查一下|找一下|搜索)?(?:一个|这?个)?(?:${labels})?[，,：:\\s]*([^，。！？\\n]+)`);
  const matched = withoutSlash.match(pattern)?.[1] ?? '';
  return cleanupCompanyName(matched) || cleanupCompanyName(withoutSlash);
}

function extractFormInstId(query: string): string | undefined {
  return query.match(/formInstId[:：=]?\s*([A-Za-z0-9_-]+)/)?.[1];
}

function isArtifactFollowupQuestion(query: string): boolean {
  const normalized = query.trim();
  const asksForExistingEvidence = ['最近', '关注', '值得关注', '有什么', '卡在哪里', '风险'].some((token) => normalized.includes(token));
  const startsNewResearch = /^(?:研究|分析一下|分析|公司分析|客户分析|\/客户分析)/.test(normalized);
  return asksForExistingEvidence && !startsNewResearch;
}

function resolveArtifactAnchorName(input: AgentPlannerInput): string | undefined {
  const resolvedName = input.resolvedContext?.usedContext ? input.resolvedContext.subject?.name : undefined;
  if (resolvedName) {
    return resolvedName;
  }
  const targetName = input.intentFrame.target.name;
  if (targetName && isLikelyEntityAnchorName(targetName)) {
    return targetName;
  }
  return input.contextFrame?.subject?.name || input.focusedName || targetName;
}

function isLikelyEntityAnchorName(value: string): boolean {
  const normalized = value.replace(/\s+/g, '').trim();
  return /[A-Za-z0-9][A-Za-z0-9_-]{2,}/.test(normalized)
    || /(公司|集团|有限|股份|银行|医院|学校|大学|研究院|事务所|协会|中心|工厂|厂)$/.test(normalized)
    || /(公司|集团|有限|股份)/.test(normalized);
}

function hasAudioInput(request: AgentToolExecuteInput['request']): boolean {
  return request.query.includes('录音')
    || (request.attachments ?? []).some((item) => item.type.includes('audio') || item.name.match(/\.(mp3|m4a|wav)$/i));
}

function buildToolTaskPlan(intentFrame: IntentFrame, selectedTool: AgentToolSelection | null): TaskPlan {
  const planId = `plan-${randomUUID().slice(0, 8)}`;
  if (!selectedTool) {
    return {
      planId,
      kind: 'tool_clarify',
      title: '通用澄清计划',
      status: 'waiting_input',
      steps: [
        step('clarify', '请用户补充目标对象或任务类型', 'meta', ['meta.clarify_card'], 'pending'),
      ],
      evidenceRequired: false,
    };
  }

  const toolType = selectedTool.toolCode.split('.')[0] || 'meta';
  const confirmationRequired = selectedTool.toolCode.includes('.preview_');
  return {
    planId,
    kind: confirmationRequired ? 'tool_confirmation' : 'tool_execution',
    title: `${toolType} 工具执行计划`,
    status: confirmationRequired ? 'waiting_confirmation' : 'running',
    steps: [
      step('build-intent', '生成 IntentFrame', 'meta', ['meta.plan_builder'], 'succeeded'),
      step('select-tool', '从 Tool Registry 选择工具', 'meta', [selectedTool.toolCode], 'succeeded'),
      step('execute-tool', '执行工具或生成预览', inferStepActionType(selectedTool.toolCode), [selectedTool.toolCode], 'pending', confirmationRequired),
      ...(confirmationRequired
        ? [step('confirm-writeback', '等待用户确认写回', 'confirm', ['meta.confirm_writeback'], 'pending', true)]
        : []),
    ],
    evidenceRequired: intentFrame.actionType === 'query' || intentFrame.actionType === 'analyze',
  };
}

function inferStepActionType(toolCode: string): TaskPlan['steps'][number]['actionType'] {
  if (toolCode.startsWith('record.') && toolCode.includes('.preview_')) {
    return 'write_preview';
  }
  if (toolCode.startsWith('record.') || toolCode.startsWith('artifact.')) {
    return 'query';
  }
  if (toolCode.startsWith('external.')) {
    return 'external';
  }
  return 'meta';
}

function step(
  key: string,
  title: string,
  actionType: TaskPlan['steps'][number]['actionType'],
  toolRefs: string[],
  status: TaskPlan['steps'][number]['status'],
  confirmationRequired = false,
) {
  return {
    key,
    title,
    actionType,
    toolRefs,
    required: true,
    skippable: false,
    confirmationRequired,
    status,
  };
}

function registerRecordTools(registry: AgentToolRegistry, objectKey: ShadowObjectKey, options: CrmAgentPackOptions): void {
  const base = `record.${objectKey}`;
  const capability = CRM_RECORD_CAPABILITIES[objectKey];
  const common = {
    type: 'record' as const,
    provider: 'lightcloud-shadow',
    owner: '对象治理组',
    enabled: true,
    outputSchema: { type: 'object' },
  };

  registry.register({
    ...common,
    code: `${base}.search`,
    description: '查询结构化记录对象列表',
    whenToUse: '用户要查询、搜索或确认某类记录对象时使用。',
    inputSchema: { type: 'object', properties: { filters: { type: 'array' } } },
    riskLevel: 'low',
    confirmationPolicy: 'read_only',
    displayCardType: 'record-search-results',
    recordCapability: capability,
    semanticProfile: objectKey === 'customer'
      ? {
          subjectTypes: ['company'],
          intentCodes: ['provide_info', 'internal_record_lookup'],
          conflictGroups: ['subject_profile_lookup'],
          priority: 90,
          risk: 'low_cost',
          clarifyLabel: '查看客户信息',
          aliases: ['查看客户信息', '客户资料', '客户信息', '系统记录'],
          readOnlyProbe: true,
        }
      : undefined,
    execute: (input, context) => executeRecordReadTool(options, registry, objectKey, 'search', input, context),
  });
  registry.register({
    ...common,
    code: `${base}.get`,
    description: '读取结构化记录对象详情',
    whenToUse: '用户指定 formInstId 或已选择候选记录后读取详情。',
    inputSchema: { type: 'object', properties: { formInstId: { type: 'string' } } },
    riskLevel: 'low',
    confirmationPolicy: 'read_only',
    displayCardType: 'record-detail',
    recordCapability: capability,
    semanticProfile: objectKey === 'customer'
      ? {
          subjectTypes: ['company'],
          intentCodes: ['provide_info', 'internal_record_lookup'],
          conflictGroups: ['subject_profile_lookup'],
          priority: 95,
          risk: 'low_cost',
          clarifyLabel: '查看客户信息',
          aliases: ['查看客户信息', '客户详情', '客户资料'],
        }
      : undefined,
    execute: (input, context) => executeRecordReadTool(options, registry, objectKey, 'get', input, context),
  });
  for (const mode of ['create', 'update'] as const) {
    registry.register({
      ...common,
      code: `${base}.preview_${mode}`,
      description: `生成结构化记录对象 ${mode} 写入预览`,
      whenToUse: '用户明确要求创建或更新记录对象时，先生成预览。',
      inputSchema: { type: 'object', properties: { params: { type: 'object' } } },
      riskLevel: 'high',
      confirmationPolicy: 'required_before_write',
      displayCardType: `record-${mode}-preview`,
      recordCapability: {
        ...capability,
        duplicateCheckPolicy: mode === 'create'
          ? {
              ...(capability.duplicateCheckPolicy ?? { enabled: false }),
              searchToolCode: `${base}.search`,
            }
          : { enabled: false },
      },
      execute: (input, context) => executeRecordPreviewTool(options, objectKey, mode, input, context),
    });
    registry.register({
      ...common,
      code: `${base}.commit_${mode}`,
      description: `确认后执行结构化记录对象 ${mode} 写回`,
      whenToUse: '只能在 meta.confirm_writeback 确认通过后使用。',
      inputSchema: { type: 'object', properties: { confirmationId: { type: 'string' } } },
      riskLevel: 'high',
      confirmationPolicy: 'required_before_write',
      displayCardType: `record-${mode}-result`,
      recordCapability: capability,
      execute: (input, context) => executeRecordCommitTool(options, objectKey, mode, input, context),
    });
  }
}

async function executeRecordReadTool(
  options: CrmAgentPackOptions,
  registry: AgentToolRegistry,
  objectKey: ShadowObjectKey,
  operation: 'search' | 'get',
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(input.selectedTool.input));
  if (!context.operatorOpenId) {
    finishToolCall(toolCall, 'skipped', '缺少 operatorOpenId，等待用户补充');
    return {
      status: 'waiting_input',
      content: '需要当前操作人的 `operatorOpenId` 后才能执行真实记录读取。',
      headline: '需要补充操作人身份',
      references: ['meta.clarify_card'],
      toolCalls: [toolCall],
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'record.operator_required',
          action: 'clarify',
          toolCode: input.selectedTool.toolCode,
          reason: '轻云真实查询需要 operatorOpenId。',
        }),
      ],
    };
  }

  try {
    const selectedInput = stripRecordAgentControl(input.selectedTool.input);
    const result = operation === 'search'
      ? await options.shadowMetadataService.executeSearch(objectKey, {
          ...selectedInput,
          operatorOpenId: context.operatorOpenId ?? undefined,
        })
      : await options.shadowMetadataService.executeGet(objectKey, {
          ...selectedInput,
          operatorOpenId: context.operatorOpenId ?? undefined,
        });
    finishToolCall(toolCall, 'succeeded', operation === 'search' ? `records=${(result as any).records?.length ?? 0}` : 'record loaded');
    const arbitrationProbe = readToolArbitrationProbeControl(input.selectedTool.input);
    if (operation === 'search' && arbitrationProbe?.enabled && objectKey === 'customer') {
      return buildCrmToolArbitrationProbeResult({
        runId: context.runId,
        toolCode: input.selectedTool.toolCode,
        control: arbitrationProbe,
        companyName: cleanupCompanyName(arbitrationProbe.subjectName || readFilterFallbackName(selectedInput) || ''),
        result: result as Awaited<ReturnType<ShadowMetadataService['executeSearch']>>,
        toolCall,
        context,
        registry,
      });
    }
    return {
      status: 'completed',
      content: `## 记录工具已执行\n- 工具：\`${input.selectedTool.toolCode}\`\n- 对象：\`${objectKey}\`\n\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 3000)}\n\`\`\``,
      headline: '记录对象读取完成',
      references: [input.selectedTool.toolCode],
      contextFrame: buildRecordContextFrame({
        objectKey,
        operation,
        result,
        capability: CRM_RECORD_CAPABILITIES[objectKey],
        fallbackName: readFilterFallbackName(input.selectedTool.input),
        preferFallback: isSubjectBoundSearch(input.selectedTool.input, CRM_RECORD_CAPABILITIES[objectKey]),
        fallback: context.contextFrame ?? null,
      }),
      toolCalls: [toolCall],
    };
  } catch (error) {
    finishToolCall(toolCall, 'failed', '记录读取失败', error);
    throw error;
  }
}

function buildCrmToolArbitrationProbeResult(input: {
  runId: string;
  toolCode: string;
  control: NonNullable<ReturnType<typeof readToolArbitrationProbeControl>>;
  companyName: string;
  result: Awaited<ReturnType<ShadowMetadataService['executeSearch']>>;
  toolCall: AgentToolExecutionResult['toolCalls'][number];
  context: AgentToolExecuteContext;
  registry: AgentToolRegistry;
}): AgentToolExecutionResult {
  const records = Array.isArray(input.result.records) ? input.result.records : [];
  const companyName = input.companyName || '目标公司';
  const choiceParamKey = 'next_action';
  const candidateToolCodes = input.control.candidateToolCodes ?? [];
  const choices: Record<string, {
    toolCode: string;
    input: Record<string, unknown>;
    reason: string;
    aliases: string[];
  }> = {};
  const options: FieldOptionHint[] = [];

  if (candidateToolCodes.includes('record.customer.get')) {
    for (const record of records.slice(0, 5)) {
      const formInstId = typeof record.formInstId === 'string' ? record.formInstId : '';
      if (!formInstId) {
        continue;
      }
      const displayName = readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.customer) ?? companyName;
      const choiceKey = `view_record:${formInstId}`;
      choices[choiceKey] = {
        toolCode: 'record.customer.get',
        input: {
          formInstId,
          operatorOpenId: input.context.operatorOpenId ?? undefined,
        },
        reason: '用户选择查看系统中已有客户记录。',
        aliases: ['查看客户信息', '客户信息', '查看记录', '查询信息', displayName],
      };
      options.push({
        label: records.length > 1 ? `查看客户信息：${displayName}` : '查看客户信息',
        value: choiceKey,
        key: choiceKey,
        source: 'field_option',
      });
    }
  }

  if (candidateToolCodes.includes(COMPANY_RESEARCH_TOOL)) {
    choices.company_research = {
      toolCode: COMPANY_RESEARCH_TOOL,
      input: {
        companyName,
      },
      reason: '用户选择进行外部公司研究。',
      aliases: ['公司研究', '进行公司研究', '外部公司研究', '重新研究', '重新进行公司研究'],
    };
    options.push({
      label: '进行公司研究',
      value: 'company_research',
      key: 'company_research',
      source: 'field_option',
    });
  }

  const questionCard: PendingInteraction['questionCard'] = {
    title: records.length ? '已找到客户，请选择下一步' : '未查到已有客户，请选择下一步',
    description: records.length
      ? `系统中已找到「${companyName}」相关客户。`
      : `系统中未查到「${companyName}」相关客户。`,
    toolCode: input.toolCode,
    submitLabel: '继续',
    currentValues: records.length
      ? {
          matched_customer: {
            label: '匹配客户',
            value: records.slice(0, 3)
              .map((record) => readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.customer) ?? record.formInstId)
              .filter(Boolean)
              .join('、'),
          },
        }
      : {
          target_company: {
            label: '目标公司',
            value: companyName,
          },
        },
    questions: [
      {
        questionId: `${input.toolCode}:ambiguity:${choiceParamKey}`,
        paramKey: choiceParamKey,
        label: '你想继续做什么',
        type: 'single_select',
        required: true,
        placeholder: '请选择下一步',
        options,
        reason: records.length
          ? '该表达既可能是查看系统客户信息，也可能是进行外部公司研究。'
          : '未查到已有客户，外部公司研究会生成新的研究 Artifact。',
      },
    ],
  };

  return {
    status: 'waiting_input',
    currentStepKey: 'execute-tool',
    content: [
      records.length ? '## 已找到已有客户' : '## 未查到已有客户',
      `- 查询对象：${companyName}`,
      `- 命中数量：${records.length}`,
      '',
      records.length
        ? '请选择是查看系统中的客户信息，还是进行外部公司研究。'
        : '没有自动触发公司研究。你可以选择进行公司研究，或重新输入更准确的客户名称。',
    ].join('\n'),
    headline: records.length ? '已找到客户，等待选择下一步' : '未查到客户，等待选择下一步',
    references: ['meta.clarify_card', input.toolCode],
    toolCalls: [input.toolCall],
    toolArbitration: buildProbeTrace({
      control: input.control,
      tools: input.registry.list(),
      selectedToolCode: input.toolCode,
      count: records.length,
      summary: `records=${records.length}`,
    }),
    pendingInteraction: buildPendingInteraction({
      runId: input.runId,
      kind: 'input_required',
      toolCode: input.toolCode,
      title: records.length ? '已找到客户，等待选择下一步' : '未查到客户，等待选择下一步',
      summary: '歧义意图已先执行只读客户查询，等待用户选择查看记录或进行公司研究。',
      partialInput: {
        agentControl: {
          choiceRouting: {
            answerParamKey: choiceParamKey,
            choices,
          },
        },
      },
      questionCard,
      context: input.context,
    }),
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'tool.semantic_arbitration_probe',
        action: 'clarify',
        toolCode: input.toolCode,
        reason: '用户表达在多个工具能力之间存在语义冲突，已先执行只读探测并等待用户选择。',
      }),
    ],
  };
}

function buildRecordContextFrame(input: {
  objectKey: ShadowObjectKey;
  operation: 'search' | 'get';
  result: any;
  capability: RecordToolCapability;
  fallbackName?: string;
  preferFallback?: boolean;
  fallback?: ContextFrame | null;
}): ContextFrame | null {
  if (input.operation === 'search') {
    if (input.preferFallback) {
      return input.fallback ?? null;
    }
    const records = Array.isArray(input.result?.records) ? input.result.records : [];
    if (records.length !== 1) {
      return input.fallback ?? null;
    }
    const record = records[0];
    return {
      subject: {
        kind: 'record',
        type: input.objectKey,
        id: typeof record.formInstId === 'string' ? record.formInstId : undefined,
        name: readLiveRecordDisplayName(record, input.capability) ?? input.fallbackName,
      },
      sourceRunId: undefined,
      evidenceRefs: [],
      confidence: 0.92,
      resolvedBy: 'record.search.unique',
    };
  }

  const record = input.result?.record;
  if (!record || typeof record !== 'object') {
    return input.fallback ?? null;
  }
  return {
    subject: {
      kind: 'record',
      type: input.objectKey,
      id: typeof record.formInstId === 'string' ? record.formInstId : undefined,
      name: readLiveRecordDisplayName(record, input.capability) ?? input.fallbackName,
    },
    sourceRunId: undefined,
    evidenceRefs: [],
    confidence: 0.96,
    resolvedBy: 'record.get',
  };
}

function isSubjectBoundSearch(
  selectedToolInput: Record<string, unknown>,
  capability: RecordToolCapability,
): boolean {
  const filters = Array.isArray(selectedToolInput.filters) ? selectedToolInput.filters : [];
  const relationField = capability.subjectBinding?.searchFilterField;
  if (!relationField) {
    return false;
  }
  return filters.some((item) => item && typeof item === 'object' && (item as { field?: unknown }).field === relationField);
}

function readLiveRecordDisplayName(record: {
  formInstId?: string;
  fields?: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
  rawRecord?: Record<string, unknown>;
}, capability: RecordToolCapability): string | undefined {
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const preferredTitles = new Set(
    (capability.identityFields ?? [])
      .flatMap((paramKey) => [capability.fieldLabels?.[paramKey], capability.fieldLabels?._S_NAME, capability.fieldLabels?._S_TITLE])
      .filter((item): item is string => Boolean(item?.trim())),
  );

  for (const field of fields) {
    if (!field?.title || !preferredTitles.has(field.title)) {
      continue;
    }
    const value = stringifyPreviewValue(field.value ?? field.rawValue);
    if (value) {
      return value;
    }
  }

  const rawTitle = record.rawRecord && typeof record.rawRecord._S_TITLE === 'string' ? record.rawRecord._S_TITLE : null;
  if (rawTitle?.trim()) {
    return rawTitle.trim();
  }

  return typeof record.formInstId === 'string' ? record.formInstId : undefined;
}

function readFilterFallbackName(selectedToolInput: Record<string, unknown>): string | undefined {
  const filters = Array.isArray(selectedToolInput.filters) ? selectedToolInput.filters : [];
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') {
      continue;
    }
    const value = (filter as { value?: unknown }).value;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

interface RecordAgentControl {
  duplicateCheck?: {
    enabled?: boolean;
    searchToolCode?: string;
    filters?: ShadowPreviewSearchInput['filters'];
    pageNumber?: number;
    pageSize?: number;
    lastResult?: {
      status: 'no_candidates';
      fingerprint: string;
      candidateCount: number;
      checkedAt: string;
      ttlMs: number;
    };
  };
  subjectName?: string;
  choiceRouting?: {
    answerParamKey?: string;
    choices?: Record<string, unknown>;
  };
}

function readRecordAgentControl(input: Record<string, unknown>): RecordAgentControl {
  const control = input.agentControl;
  return control && typeof control === 'object' ? control as RecordAgentControl : {};
}

function stripRecordAgentControl(input: Record<string, unknown>): Record<string, unknown> {
  const { agentControl: _agentControl, ...rest } = input;
  return rest;
}

function getFieldLabel(capability: RecordToolCapability, paramKey: string): string {
  if (isInternalRecordIdentityParam(paramKey)) {
    return '要修改的记录';
  }
  return capability.fieldLabels?.[paramKey] ?? paramKey;
}

function isInternalRecordIdentityParam(paramKey?: string): boolean {
  return paramKey === 'form_inst_id' || paramKey === 'formInstId';
}

function stringifyPreviewValue(value: unknown): string {
  if (value === null) {
    return '空';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyPreviewValue).filter(Boolean).join('、');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.title === 'string') {
      return record.title;
    }
    if (typeof record.name === 'string') {
      return record.name;
    }
    if (typeof record.open_id === 'string') {
      return record.open_id;
    }
    if (typeof record.formInstId === 'string') {
      return record.formInstId;
    }
    if (typeof record.id === 'string') {
      return record.id;
    }
    return JSON.stringify(value);
  }
  return '';
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function orderParamKeys(keys: string[], capability: RecordToolCapability): string[] {
  const order = capability.fieldDisplayOrder ?? [];
  return [...keys].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  });
}

function readRequestParams(requestInput: ShadowPreviewUpsertInput): Record<string, unknown> {
  return requestInput.params && typeof requestInput.params === 'object' ? requestInput.params : {};
}

function readLooseRecordParams(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRecordFormInstId(value: unknown): string {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const candidate = record.formInstId ?? record.form_inst_id;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : '';
}

function enrichRecordParamsFromQuery(input: {
  query: string;
  params: Record<string, unknown>;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
}): Record<string, unknown> {
  const params = { ...input.params };
  for (const paramKey of input.capability.previewInputPolicy?.writableParams ?? []) {
    if (hasMeaningfulValue(params[paramKey])) {
      continue;
    }
    const field = findFieldByParamKey(paramKey, input.fields);
    if (!field?.options?.length) {
      continue;
    }
    const option = resolveFieldOptionFromQuery(input.query, field);
    if (option) {
      params[paramKey] = normalizeOptionHintValue(field, option);
    }
  }
  return params;
}

function resolveFieldOptionFromQuery(
  query: string,
  field: ShadowStandardizedField,
): ShadowStandardizedField['options'][number] | undefined {
  const normalizedQuery = query.replace(/\s+/g, '').trim();
  if (!normalizedQuery) {
    return undefined;
  }
  const options = [...field.options].sort((left, right) => {
    const leftLength = String(left.title || left.value || left.key || left.dicId || '').length;
    const rightLength = String(right.title || right.value || right.key || right.dicId || '').length;
    return rightLength - leftLength;
  });
  return options.find((option) => {
    const candidates = [
      option.title,
      option.value,
      ...(option.aliases ?? []),
    ]
      .filter((item): item is string => Boolean(item?.trim()))
      .map((item) => item.replace(/\s+/g, '').trim())
      .filter((item) => item.length >= 2);
    return candidates.some((candidate) => normalizedQuery.includes(candidate));
  });
}

function readWidgetValue(requestBody: unknown): Record<string, unknown> {
  if (!requestBody || typeof requestBody !== 'object') {
    return {};
  }
  const data = (requestBody as { data?: unknown }).data;
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== 'object') {
    return {};
  }
  const widgetValue = (first as { widgetValue?: unknown }).widgetValue;
  return widgetValue && typeof widgetValue === 'object' && !Array.isArray(widgetValue)
    ? widgetValue as Record<string, unknown>
    : {};
}

function buildSummaryRows(input: {
  requestInput: ShadowPreviewUpsertInput;
  preview: ShadowPreviewResponse;
  capability: RecordToolCapability;
  fields?: ShadowStandardizedField[];
}): RecordWritePreviewRow[] {
  const params = readRequestParams(input.requestInput);
  const paramRows = orderParamKeys(Object.keys(params), input.capability)
    .filter((paramKey) => hasMeaningfulValue(params[paramKey]))
    .map((paramKey) => ({
      label: getFieldLabel(input.capability, paramKey),
      value: stringifyRecordParamValueForDisplay(paramKey, params[paramKey], input.fields),
      paramKey,
      source: 'input' as const,
    }));

  const existingParamKeys = new Set(paramRows.map((row) => row.paramKey));
  const widgetValue = readWidgetValue(input.preview.requestBody);
  const derivedRows = (input.capability.derivedFieldRefs ?? [])
    .filter((paramKey) => !existingParamKeys.has(paramKey) && hasMeaningfulValue(widgetValue[paramKey]))
    .map((paramKey) => ({
      label: getFieldLabel(input.capability, paramKey),
      value: stringifyPreviewValue(widgetValue[paramKey]),
      paramKey,
      source: 'derived' as const,
    }));

  return [...paramRows, ...derivedRows];
}

function buildRecommendedRows(input: {
  requestInput: ShadowPreviewUpsertInput;
  preview?: ShadowPreviewResponse;
  capability: RecordToolCapability;
}): RecordWritePreviewRow[] {
  const params = readRequestParams(input.requestInput);
  const widgetValue = input.preview ? readWidgetValue(input.preview.requestBody) : {};
  return (input.capability.recommendedFieldRefs ?? [])
    .filter((paramKey) => !hasMeaningfulValue(params[paramKey]) && !hasMeaningfulValue(widgetValue[paramKey]))
    .map((paramKey) => ({
      label: getFieldLabel(input.capability, paramKey),
      paramKey,
      reason: '后续补充后有助于完善记录画像',
      source: 'system' as const,
    }));
}

function buildRecordPreviewView(input: {
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  requestInput: ShadowPreviewUpsertInput;
  preview: ShadowPreviewResponse;
  capability: RecordToolCapability;
  fields?: ShadowStandardizedField[];
}): RecordWritePreviewView {
  return {
    title: input.mode === 'create' ? '待确认写入记录' : '待确认更新记录',
    summaryRows: buildSummaryRows(input),
    missingRequiredRows: input.preview.missingRequiredParams.map((paramKey) => ({
      label: getFieldLabel(input.capability, paramKey),
      paramKey,
      reason: '模板必填，必须由用户明确提供或由证据唯一确定',
      source: 'tool',
      options: buildFieldOptionHints(paramKey, input.fields),
    })),
    blockedRows: [
      ...input.preview.blockedReadonlyParams.map((paramKey) => ({
        label: getFieldLabel(input.capability, paramKey),
        paramKey,
        reason: '工具契约标记为只读或自动派生，不能由用户写入',
        source: 'tool' as const,
      })),
      ...input.preview.missingRuntimeInputs.map((paramKey) => ({
        label: getFieldLabel(input.capability, paramKey),
        paramKey,
        reason: '缺少运行时输入',
        source: 'tool' as const,
      })),
      ...input.preview.validationErrors.map((reason) => ({
        label: '校验错误',
        reason,
        source: 'tool' as const,
      })),
    ],
    recommendedRows: buildRecommendedRows(input),
  };
}

function buildMetaQuestionCard(input: {
  toolCode: string;
  title: string;
  summary: string;
  userPreview: RecordWritePreviewView;
  partialInput: Record<string, unknown>;
}) {
  const currentValues = Object.fromEntries(
    input.userPreview.summaryRows
      .filter((row) => row.paramKey)
      .map((row) => [
        row.paramKey!,
        {
          label: row.label,
          value: row.value,
        },
      ]),
  );
  const missingRows = input.userPreview.missingRequiredRows ?? [];
  const questions: MetaQuestion[] = missingRows
    .filter((row) => row.paramKey)
    .filter((row) => !isInternalRecordIdentityParam(row.paramKey))
    .map((row) => ({
      questionId: `${input.toolCode}:${row.paramKey}`,
      paramKey: row.paramKey!,
      label: row.label,
      type: inferQuestionType(row),
      required: true,
      placeholder: row.options?.length ? '请选择' : `请输入${row.label}`,
      options: row.options,
      reason: row.reason,
    }));

  return {
    title: '还需要补充以下信息',
    description: input.summary,
    toolCode: input.toolCode,
    submitLabel: '补充并继续预览',
    currentValues,
    questions,
  };
}

function inferQuestionType(row: RecordWritePreviewRow): MetaQuestion['type'] {
  if (row.options?.length) {
    return 'single_select';
  }
  const text = `${row.paramKey ?? ''} ${row.label}`;
  if (/手机|电话|phone|mobile/i.test(text)) {
    return 'phone';
  }
  if (/日期|时间|date/i.test(text)) {
    return 'date';
  }
  if (/编号|关联|客户|联系人|商机/.test(row.label) && /form_inst_id|linked_/i.test(row.paramKey ?? '')) {
    return 'reference';
  }
  return 'text';
}

function buildFieldOptionHints(paramKey: string, fields?: ShadowStandardizedField[]): FieldOptionHint[] | undefined {
  const field = findFieldByParamKey(paramKey, fields);
  if (!field) {
    return undefined;
  }
  if (field.options?.length) {
    return field.options.slice(0, 12).map((option) => ({
      label: option.title || option.value || option.key || option.dicId || '',
      value: normalizeOptionHintValue(field, option),
      key: option.key || option.dicId,
      source: option.dicId ? 'dictionary' as const : 'field_option' as const,
    })).filter((option) => option.label && option.value !== '');
  }
  if (field.widgetType === 'switchWidget') {
    return [
      { label: '启用', value: '1', key: '1', source: 'widget' },
      { label: '停用', value: '0', key: '0', source: 'widget' },
    ];
  }
  return undefined;
}

function normalizeOptionHintValue(
  field: ShadowStandardizedField,
  option: ShadowStandardizedField['options'][number],
): string | number | boolean {
  if ((field.widgetType === 'radioWidget' || field.widgetType === 'checkboxWidget' || field.widgetType === 'switchWidget') && option.key) {
    return option.key;
  }
  return option.value || option.title || option.key || option.dicId || '';
}

function stringifyRecordParamValueForDisplay(
  paramKey: string,
  value: unknown,
  fields?: ShadowStandardizedField[],
): string {
  const field = findFieldByParamKey(paramKey, fields);
  if (!field) {
    return stringifyPreviewValue(value);
  }
  return stringifyFieldValueForDisplay(field, value);
}

function stringifyFieldValueForDisplay(field: ShadowStandardizedField, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => stringifyFieldValueForDisplay(field, item)).filter(Boolean).join('、');
  }

  const option = findDisplayOption(field, value);
  if (option) {
    return option.title || option.value || option.key || option.dicId || stringifyPreviewValue(value);
  }

  if (field.widgetType === 'switchWidget') {
    const normalized = normalizeSwitchDisplayInput(value);
    if (normalized === true) {
      return '启用';
    }
    if (normalized === false) {
      return '停用';
    }
  }

  return stringifyPreviewValue(value);
}

function findDisplayOption(
  field: ShadowStandardizedField,
  value: unknown,
): ShadowStandardizedField['options'][number] | undefined {
  const comparable = normalizeDisplayComparable(value);
  const switchBoolean = field.widgetType === 'switchWidget' ? normalizeSwitchDisplayInput(value) : null;
  return field.options.find((option) => {
    const values = [option.key, option.title, option.value, option.dicId]
      .filter((item): item is string => typeof item === 'string');
    return values.some((item) => normalizeDisplayComparable(item) === comparable)
      || switchBoolean !== null && isSwitchDisplayOptionForBoolean(option, switchBoolean);
  });
}

function normalizeDisplayComparable(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function normalizeSwitchDisplayInput(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  const comparable = normalizeDisplayComparable(value);
  if (/^(1|true|yes|y|on|enable|enabled|open|开启|启用|打开|是)$/.test(comparable)) {
    return true;
  }
  if (/^(0|false|no|n|off|disable|disabled|close|关闭|停用|禁用|关|否)$/.test(comparable)) {
    return false;
  }
  return null;
}

function isSwitchDisplayOptionForBoolean(
  option: ShadowStandardizedField['options'][number],
  expected: boolean,
): boolean {
  return [option.key, option.title, option.value]
    .filter((item): item is string => typeof item === 'string')
    .some((item) => normalizeSwitchDisplayInput(item) === expected);
}

function findFieldByParamKey(paramKey: string, fields?: ShadowStandardizedField[]): ShadowStandardizedField | undefined {
  return fields?.find((field) => (
    field.writeParameterKey === paramKey
    || field.searchParameterKey === paramKey
    || field.fieldCode === paramKey
  ));
}

function readRecordFields(options: CrmAgentPackOptions, objectKey: ShadowObjectKey): ShadowStandardizedField[] {
  try {
    return options.shadowMetadataService.getObject(objectKey).fields ?? [];
  } catch {
    return [];
  }
}

function formatRows(rows: RecordWritePreviewRow[], emptyText: string): string {
  if (!rows.length) {
    return emptyText;
  }
  return rows
    .map((row) => {
      const value = row.value ? `：${row.value}` : '';
      const options = row.options?.length
        ? `（可选：${row.options.slice(0, 6).map((option) => option.label).join('、')}）`
        : '';
      const reason = row.reason ? `（${row.reason}）` : '';
      return `${row.label}${value}${options}${reason}`;
    })
    .join('、');
}

function buildPreviewWaitingInputContent(input: {
  toolCode: string;
  userPreview: RecordWritePreviewView;
  preview: ShadowPreviewResponse;
}): string {
  const missing = input.userPreview.missingRequiredRows ?? [];
  const blocked = input.userPreview.blockedRows ?? [];
  const lines = [
    blocked.length && !missing.length ? '## 写入参数被工具契约阻断' : '## 写入前还需要补充信息',
    `- 工具：\`${input.toolCode}\``,
    `- 缺少必填：${formatRows(missing, '无')}`,
    `- 阻断 / 校验：${formatRows(blocked, '无')}`,
  ];
  if (!missing.length && !blocked.length) {
    lines.push('- 阻断原因：记录工具返回 `readyToSend=false`，但未给出具体缺失项；请检查工具契约或字段映射。');
  }
  return lines.join('\n');
}

function buildPendingInteraction(input: {
  runId: string;
  kind: PendingInteraction['kind'];
  toolCode: string;
  title: string;
  summary: string;
  partialInput: Record<string, unknown>;
  userPreview?: RecordWritePreviewView;
  questionCard?: PendingInteraction['questionCard'];
  context?: AgentToolExecuteContext;
}): PendingInteraction {
  return {
    interactionId: randomUUID(),
    kind: input.kind,
    runId: input.runId,
    toolCode: input.toolCode,
    status: 'pending',
    title: input.title,
    summary: input.summary,
    partialInput: input.partialInput,
    missingRows: input.userPreview?.missingRequiredRows,
    blockedRows: input.userPreview?.blockedRows,
    recommendedRows: input.userPreview?.recommendedRows,
    questionCard: input.questionCard ?? (input.userPreview
      ? buildMetaQuestionCard({
          toolCode: input.toolCode,
          title: input.title,
          summary: input.summary,
          userPreview: input.userPreview,
          partialInput: input.partialInput,
        })
      : undefined),
    contextSubject: input.context?.resolvedContext?.subject ?? input.context?.contextFrame?.subject,
    createdAt: new Date().toISOString(),
  };
}

function buildPreviewConfirmationContent(input: {
  confirmationId: string;
  toolCode: string;
  userPreview: RecordWritePreviewView;
  debugPayload: unknown;
  capability: RecordToolCapability;
}): string {
  const lines = [
    '## 请确认是否写入这条记录',
    ...input.userPreview.summaryRows.map((row) => `- ${row.label}：${row.value ?? ''}`),
    '',
    `- 确认 ID：\`${input.confirmationId}\``,
    '- 确认后才会执行真实轻云写回。',
  ];

  const recommended = input.userPreview.recommendedRows ?? [];
  if (recommended.length) {
    lines.push('', `## 本次暂未写入，后续建议补充`, `- ${recommended.map((row) => row.label).join('、')}`);
  }

  if (input.capability.debugVisibility === 'content') {
    lines.push('', '## 调试信息', '```json', JSON.stringify(input.debugPayload, null, 2).slice(0, 3000), '```');
  }

  return lines.join('\n');
}

function hasIdentityInput(input: {
  mode: 'create' | 'update';
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
}): boolean {
  if (input.mode !== 'create') {
    return true;
  }
  const identityFields = input.capability.identityFields ?? [];
  if (!identityFields.length) {
    return true;
  }
  const params = readRequestParams(input.requestInput);
  return identityFields.some((paramKey) => hasMeaningfulValue(params[paramKey]));
}

function buildRecordPreviewGuardResult(input: {
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  toolCode: string;
  requestInput: ShadowPreviewUpsertInput;
  preview: ShadowPreviewResponse;
  capability: RecordToolCapability;
  fields?: ShadowStandardizedField[];
  toolCall: AgentToolExecutionResult['toolCalls'][number];
  toolCalls: AgentToolExecutionResult['toolCalls'];
}): AgentToolExecutionResult | null {
  const widgetValue = readWidgetValue(input.preview.requestBody);
  const widgetKeys = Object.keys(widgetValue);
  const derivedParams = new Set(input.capability.derivedFieldRefs ?? []);
  const hasOnlyDerivedWidgetValue = widgetKeys.length > 0 && widgetKeys.every((key) => derivedParams.has(key));

  if (widgetKeys.length > 0 && hasIdentityInput(input) && !hasOnlyDerivedWidgetValue) {
    return null;
  }

  const policyCode = widgetKeys.length === 0
    ? 'record.preview_empty_payload_guard'
    : 'record.preview_identity_guard';
  const reason = widgetKeys.length === 0
    ? '记录工具返回 readyToSend=true，但没有生成实际写入字段。'
    : '记录工具只生成了派生字段或缺少记录身份字段，阻止确认空壳记录。';
  finishToolCall(input.toolCall, 'skipped', reason);

  const userPreview = buildRecordPreviewView(input);
  return {
    status: 'waiting_input',
    currentStepKey: 'execute-tool',
    content: [
      '## 写入预览被守卫阻断',
      `- 工具：\`${input.toolCode}\``,
      `- 原因：${reason}`,
      `- 已识别字段：${formatRows(userPreview.summaryRows, '无')}`,
    ].join('\n'),
    headline: '写入预览缺少有效写入内容',
    references: ['meta.clarify_card', input.toolCode],
    toolCalls: input.toolCalls,
    policyDecisions: [
      createPolicyDecision({
        policyCode,
        action: 'clarify',
        toolCode: input.toolCode,
        reason,
      }),
    ],
  };
}

async function executeDuplicateCheckIfNeeded(input: {
  options: CrmAgentPackOptions;
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  context: AgentToolExecuteContext;
  agentControl: RecordAgentControl;
  partialInput: Record<string, unknown>;
}): Promise<{
  toolCalls: AgentToolExecutionResult['toolCalls'];
  result?: AgentToolExecutionResult;
  partialInput?: Record<string, unknown>;
}> {
  const duplicateCheck = input.agentControl.duplicateCheck;
  if (input.mode !== 'create' || !duplicateCheck?.enabled) {
    return { toolCalls: [] };
  }

  const searchToolCode = duplicateCheck.searchToolCode ?? `record.${input.objectKey}.search`;
  const searchInput = {
    filters: duplicateCheck.filters ?? [],
    pageNumber: duplicateCheck.pageNumber ?? 1,
    pageSize: duplicateCheck.pageSize ?? 5,
    operatorOpenId: input.context.operatorOpenId ?? undefined,
  };
  const searchCall = createToolCall(input.context.runId, searchToolCode, JSON.stringify(searchInput));
  const fingerprint = buildDuplicateCheckFingerprint(searchInput);
  if (canReuseDuplicateCheckResult(duplicateCheck, fingerprint)) {
    finishToolCall(searchCall, 'skipped', '复用当前等待态内已通过的写前查重结果');
    return {
      toolCalls: [searchCall],
      partialInput: input.partialInput,
    };
  }

  if (!input.context.operatorOpenId) {
    const previewToolCode = `record.${input.objectKey}.preview_${input.mode}`;
    finishToolCall(searchCall, 'skipped', '缺少 operatorOpenId，无法执行写前查重');
    return {
      toolCalls: [searchCall],
      result: {
        status: 'waiting_input',
        currentStepKey: 'execute-tool',
        content: '写入记录前需要当前操作人的 `operatorOpenId`，用于先查询是否已有重复记录。',
        headline: '需要补充操作人身份',
        references: ['meta.clarify_card', searchToolCode],
        toolCalls: [searchCall],
        pendingInteraction: buildPendingInteraction({
          runId: input.context.runId,
          kind: 'input_required',
          toolCode: previewToolCode,
          title: '需要补充操作人身份',
          summary: '创建记录前的查重查询需要 operatorOpenId。',
          partialInput: input.partialInput,
          context: input.context,
        }),
        policyDecisions: [
          createPolicyDecision({
            policyCode: 'record.duplicate_check.operator_required',
            action: 'clarify',
            toolCode: searchToolCode,
            reason: '创建记录前的查重查询需要 operatorOpenId。',
          }),
        ],
      },
    };
  }

  let search: Awaited<ReturnType<ShadowMetadataService['executeSearch']>>;
  try {
    search = await executeDuplicateSearchWithRetry({
      options: input.options,
      objectKey: input.objectKey,
      searchInput,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const diagnostic = buildUpstreamErrorDiagnostic(error);
    const outputSummary = diagnostic ? `${message}；${diagnostic}` : message;
    const previewToolCode = `record.${input.objectKey}.preview_${input.mode}`;
    finishToolCall(searchCall, 'failed', `写前查重失败：${outputSummary}`, error);
    return {
      toolCalls: [searchCall],
      result: {
        status: 'waiting_input',
        currentStepKey: 'execute-tool',
        content: [
          '## 写前查重暂时不可用',
          `- 工具：\`${searchToolCode}\``,
          `- 写入目标：${input.agentControl.subjectName || '当前上下文主体'}`,
          `- 失败原因：${message}`,
          ...(diagnostic ? [`- 诊断信息：${diagnostic}`] : []),
          '',
          '## 当前处理',
          '- 已阻止创建预览，避免绕过查重产生重复记录。',
          '- 已保留本次已填写字段，可以稍后直接说“重试”，或重新提交当前问题卡。',
          '- 未生成本地替代结果，未保存写回确认。',
        ].join('\n'),
        headline: '写前查重暂时不可用，已保留已填字段',
        references: ['meta.clarify_card', searchToolCode, previewToolCode],
        toolCalls: [searchCall],
        pendingInteraction: buildPendingInteraction({
          runId: input.context.runId,
          kind: 'input_required',
          toolCode: previewToolCode,
          title: '写前查重暂时不可用',
          summary: '创建记录前的查重查询失败，已阻止继续生成写入预览并保留已填字段。',
          partialInput: input.partialInput,
          context: input.context,
        }),
        policyDecisions: [
          createPolicyDecision({
            policyCode: 'record.duplicate_check_unavailable',
            action: 'block',
            toolCode: searchToolCode,
            reason: `创建记录前的查重查询失败，不能绕过查重继续写入预览：${outputSummary}`,
          }),
        ],
      },
    };
  }
  const records = Array.isArray(search.records) ? search.records : [];
  finishToolCall(searchCall, 'succeeded', `duplicateCandidates=${records.length}`);

  if (records.length === 0) {
    return {
      toolCalls: [searchCall],
      partialInput: markDuplicateCheckNoCandidates({
        partialInput: input.partialInput,
        fingerprint,
      }),
    };
  }

  return {
    toolCalls: [searchCall],
    result: {
      status: 'waiting_selection',
      currentStepKey: 'execute-tool',
      content: [
        '## 发现疑似重复记录',
        `- 对象：\`${input.objectKey}\``,
        `- 写入目标：${input.agentControl.subjectName || '当前上下文主体'}`,
        `- 候选数量：${records.length}`,
        '',
        '请先确认是更新已有记录，还是仍要新建一条记录。',
        '',
        '```json',
        JSON.stringify(records.slice(0, duplicateCheck.pageSize ?? 5), null, 2).slice(0, 3000),
        '```',
      ].join('\n'),
      headline: '发现疑似重复记录，等待选择',
      references: ['meta.candidate_selection', searchToolCode],
      toolCalls: [searchCall],
      pendingInteraction: buildPendingInteraction({
        runId: input.context.runId,
        kind: 'candidate_selection',
        toolCode: `record.${input.objectKey}.preview_create`,
        title: '发现疑似重复记录，等待选择',
        summary: '创建记录前查到候选记录，阻止直接新建重复记录。',
        partialInput: input.partialInput,
        context: input.context,
      }),
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'record.duplicate_check',
          action: 'clarify',
          toolCode: searchToolCode,
          reason: '创建记录前查到候选记录，阻止直接新建重复记录。',
        }),
      ],
    },
  };
}

function buildDuplicateCheckFingerprint(searchInput: {
  filters: ShadowPreviewSearchInput['filters'];
  pageNumber: number;
  pageSize: number;
  operatorOpenId?: string;
}): string {
  return JSON.stringify({
    filters: searchInput.filters ?? [],
    pageNumber: searchInput.pageNumber,
    pageSize: searchInput.pageSize,
    operatorOpenId: searchInput.operatorOpenId ?? '',
  });
}

function canReuseDuplicateCheckResult(
  duplicateCheck: NonNullable<RecordAgentControl['duplicateCheck']>,
  fingerprint: string,
): boolean {
  const lastResult = duplicateCheck.lastResult;
  if (!lastResult || lastResult.status !== 'no_candidates' || lastResult.fingerprint !== fingerprint) {
    return false;
  }
  const checkedAt = Date.parse(lastResult.checkedAt);
  if (!Number.isFinite(checkedAt)) {
    return false;
  }
  return Date.now() - checkedAt <= lastResult.ttlMs;
}

function markDuplicateCheckNoCandidates(input: {
  partialInput: Record<string, unknown>;
  fingerprint: string;
}): Record<string, unknown> {
  const agentControl = readRecordAgentControl(input.partialInput);
  return {
    ...input.partialInput,
    agentControl: {
      ...agentControl,
      duplicateCheck: {
        ...(agentControl.duplicateCheck ?? {}),
        lastResult: {
          status: 'no_candidates' as const,
          fingerprint: input.fingerprint,
          candidateCount: 0,
          checkedAt: new Date().toISOString(),
          ttlMs: 5 * 60 * 1000,
        },
      },
    },
  };
}

async function executeDuplicateSearchWithRetry(input: {
  options: CrmAgentPackOptions;
  objectKey: ShadowObjectKey;
  searchInput: ShadowPreviewSearchInput;
}): Promise<Awaited<ReturnType<ShadowMetadataService['executeSearch']>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DUPLICATE_CHECK_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await input.options.shadowMetadataService.executeSearch(input.objectKey, input.searchInput);
    } catch (error) {
      lastError = error;
      if (attempt >= DUPLICATE_CHECK_MAX_ATTEMPTS || !isRetryableToolError(error)) {
        break;
      }
      await sleep(DUPLICATE_CHECK_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function isRetryableToolError(error: unknown): boolean {
  if (isRateLimitToolError(error)) {
    return false;
  }
  const maybeAppError = error as { code?: unknown; statusCode?: unknown };
  if (typeof maybeAppError.statusCode === 'number') {
    return maybeAppError.statusCode >= 500;
  }
  if (maybeAppError.code === 'YZJ_API_ERROR' || maybeAppError.code === 'SERVICE_UNAVAILABLE') {
    return true;
  }
  const message = getErrorMessage(error);
  return /查询轻云|网络|超时|timeout|timed?out|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(message);
}

function isRateLimitToolError(error: unknown): boolean {
  const details = (error as { details?: unknown }).details as {
    payload?: {
      errorCode?: unknown;
      error?: unknown;
      message?: unknown;
      msg?: unknown;
      errorMsg?: unknown;
    };
  } | undefined;
  const errorCode = details?.payload?.errorCode;
  const message = [
    getErrorMessage(error),
    details?.payload?.error,
    details?.payload?.message,
    details?.payload?.msg,
    details?.payload?.errorMsg,
  ].filter((item): item is string => typeof item === 'string').join(' ');

  return errorCode === 10000429 || /请求过于频繁|too many|rate.?limit/i.test(message);
}

function buildUpstreamErrorDiagnostic(error: unknown): string {
  const maybeDetails = (error as { details?: unknown }).details;
  if (!maybeDetails || typeof maybeDetails !== 'object') {
    return '';
  }

  const details = maybeDetails as {
    status?: unknown;
    payload?: {
      errorCode?: unknown;
      code?: unknown;
      message?: unknown;
      msg?: unknown;
      errorMsg?: unknown;
      error?: unknown;
      success?: unknown;
    };
  };
  const items = [
    typeof details.status === 'number' ? `http=${details.status}` : '',
    typeof details.payload?.errorCode === 'string' || typeof details.payload?.errorCode === 'number'
      ? `errorCode=${details.payload.errorCode}`
      : '',
    typeof details.payload?.code === 'string' || typeof details.payload?.code === 'number'
      ? `code=${details.payload.code}`
      : '',
    typeof details.payload?.message === 'string'
      ? `message=${details.payload.message}`
      : typeof details.payload?.msg === 'string'
        ? `message=${details.payload.msg}`
        : typeof details.payload?.errorMsg === 'string'
          ? `message=${details.payload.errorMsg}`
          : typeof details.payload?.error === 'string'
            ? `message=${details.payload.error}`
          : '',
    typeof details.payload?.success === 'boolean' ? `success=${details.payload.success}` : '',
  ].filter(Boolean);

  return items.join(', ');
}

async function executeRecordPreviewTool(
  options: CrmAgentPackOptions,
  objectKey: ShadowObjectKey,
  mode: 'create' | 'update',
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const capability = CRM_RECORD_CAPABILITIES[objectKey];
  const fields = readRecordFields(options, objectKey);
  const agentControl = readRecordAgentControl(input.selectedTool.input);
  const selectedInput = stripRecordAgentControl(input.selectedTool.input);
  const selectedParams = readLooseRecordParams(selectedInput.params);
  const enrichedParams = enrichRecordParamsFromQuery({
    query: input.request.query,
    params: selectedParams,
    capability,
    fields,
  });
  const contextRecordId = mode === 'update'
    ? resolveContextRecordFormInstId({
        objectKey,
        contextFrame: context.contextFrame ?? null,
        resolvedContext: context.resolvedContext ?? null,
      })
    : undefined;
  const requestInput = {
    ...selectedInput,
    ...(Object.keys(enrichedParams).length ? { params: enrichedParams } : {}),
    ...(mode === 'update' && !readRecordFormInstId(selectedInput) && contextRecordId
      ? { formInstId: contextRecordId }
      : {}),
    mode,
    operatorOpenId: context.operatorOpenId ?? undefined,
  } as ShadowPreviewUpsertInput;
  const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(requestInput));
  if (mode === 'update' && !readRecordFormInstId(requestInput)) {
    finishToolCall(toolCall, 'skipped', '缺少可更新的记录上下文，等待用户选择记录');
    return {
      status: 'waiting_input',
      currentStepKey: 'execute-tool',
      content: [
        '## 需要先确定要修改的记录',
        `- 工具：\`${input.selectedTool.toolCode}\``,
        '- 当前对话里没有可直接绑定的记录。',
        '- 请先查询要修改的记录，或说明更完整的记录名称，系统会帮你选择候选记录。',
      ].join('\n'),
      headline: '需要先确定要修改的记录',
      references: ['meta.clarify_card', input.selectedTool.toolCode],
      toolCalls: [toolCall],
      pendingInteraction: buildPendingInteraction({
        runId: context.runId,
        kind: 'input_required',
        toolCode: input.selectedTool.toolCode,
        title: '需要先确定要修改的记录',
        summary: '更新记录前需要先绑定一条已存在记录。',
        partialInput: requestInput as unknown as Record<string, unknown>,
        context,
      }),
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'record.update_identity_required',
          action: 'clarify',
          toolCode: input.selectedTool.toolCode,
          reason: '更新记录需要先绑定一条已存在记录，不能要求普通用户输入内部 formInstId。',
        }),
      ],
    };
  }
  const guardToolCalls = await executeDuplicateCheckIfNeeded({
    options,
    objectKey,
    mode,
    context,
    agentControl,
    partialInput: input.selectedTool.input,
  });
  const effectiveSelectedInput = guardToolCalls.partialInput ?? input.selectedTool.input;
  if (guardToolCalls.result) {
    finishToolCall(toolCall, 'skipped', '写入预览前发现候选记录、缺少运行输入或查重不可用');
    return {
      ...guardToolCalls.result,
      toolCalls: [...guardToolCalls.toolCalls, toolCall],
    };
  }

  const preview = await options.shadowMetadataService.previewUpsert(objectKey, requestInput);
  const toolCalls = [...guardToolCalls.toolCalls, toolCall];
  const userPreview = buildRecordPreviewView({
    objectKey,
    mode,
    requestInput,
    preview,
    capability,
    fields,
  });
  if (!preview.readyToSend) {
    finishToolCall(toolCall, 'skipped', '写入预览参数不完整');
    return {
      status: 'waiting_input',
      content: buildPreviewWaitingInputContent({
        toolCode: input.selectedTool.toolCode,
        userPreview,
        preview,
      }),
      headline: preview.blockedReadonlyParams.length ? '写入参数被工具契约阻断' : '写入预览未就绪',
      references: ['meta.clarify_card', input.selectedTool.toolCode],
      toolCalls,
      pendingInteraction: buildPendingInteraction({
        runId: context.runId,
        kind: 'input_required',
        toolCode: input.selectedTool.toolCode,
        title: preview.blockedReadonlyParams.length ? '写入参数被工具契约阻断' : '写入预览未就绪',
        summary: '写入预览存在缺失字段、只读字段、运行输入或校验错误。',
        partialInput: effectiveSelectedInput,
        userPreview,
        context,
      }),
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'record.preview_validation',
          action: 'clarify',
          toolCode: input.selectedTool.toolCode,
          reason: '写入预览存在缺失字段、只读字段、运行输入或校验错误。',
        }),
      ],
    };
  }

  const guardResult = buildRecordPreviewGuardResult({
    objectKey,
    mode,
    toolCode: input.selectedTool.toolCode,
    requestInput,
    preview,
    capability,
    fields,
    toolCall,
    toolCalls,
  });
  if (guardResult) {
    return guardResult;
  }

  const confirmation: ConfirmationRequest = {
    confirmationId: randomUUID(),
    runId: context.runId,
    toolCode: input.selectedTool.toolCode,
    title: `${objectKey} ${mode} 写回确认`,
    summary: `确认后将通过轻云记录系统执行 ${objectKey} ${mode} 写回。`,
    preview,
    userPreview,
    debugPayload: preview,
    requestInput: requestInput as unknown as Record<string, unknown>,
    status: 'pending',
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  options.repository.saveConfirmation(confirmation);
  finishToolCall(toolCall, 'succeeded', `preview ready confirmation=${confirmation.confirmationId}`);

  return {
    status: 'waiting_confirmation',
    currentStepKey: 'confirm-writeback',
    content: buildPreviewConfirmationContent({
      confirmationId: confirmation.confirmationId,
      toolCode: input.selectedTool.toolCode,
      userPreview,
      debugPayload: preview,
      capability,
    }),
    headline: '等待写回确认',
    references: ['meta.confirm_writeback', input.selectedTool.toolCode],
    toolCalls,
    pendingConfirmation: confirmation,
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'record.write_requires_confirmation',
        action: 'require_confirmation',
        toolCode: input.selectedTool.toolCode,
        reason: '所有记录系统写操作必须先预览，再由用户确认。',
      }),
    ],
  };
}

async function executeRecordCommitTool(
  options: CrmAgentPackOptions,
  objectKey: ShadowObjectKey,
  mode: 'create' | 'update',
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const confirmationId = String(input.selectedTool.input.confirmationId ?? '');
  const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, confirmationId);
  const pending = options.repository.findPendingConfirmation(context.runId, confirmationId);
  if (!pending) {
    finishToolCall(toolCall, 'failed', '未找到待确认写回请求');
    return {
      status: 'failed',
      content: '未找到待确认写回请求，无法执行真实写回。',
      headline: '写回确认不存在',
      references: ['meta.confirm_writeback'],
      toolCalls: [toolCall],
    };
  }

  if (input.resumeDecision?.action !== 'confirm_writeback' || input.resumeDecision.decision !== 'approve') {
    const rejected = options.repository.resolveConfirmation({
      runId: context.runId,
      confirmationId,
      status: 'rejected',
    }) ?? pending;
    finishToolCall(toolCall, 'skipped', '用户拒绝写回');
    return {
      status: 'cancelled',
      content: `已取消写回确认：\`${confirmationId}\`。`,
      headline: '写回已取消',
      references: ['meta.confirm_writeback'],
      toolCalls: [toolCall],
      pendingConfirmation: rejected,
    };
  }

  const requestInput = pending.requestInput as unknown as ShadowPreviewUpsertInput;
  const result = await options.shadowMetadataService.executeUpsert(objectKey, requestInput);
  const commitPreview: ShadowPreviewResponse = {
    objectKey,
    operation: 'upsert',
    unresolvedDictionaries: [],
    resolvedDictionaryMappings: [],
    missingRequiredParams: [],
    blockedReadonlyParams: [],
    missingRuntimeInputs: [],
    validationErrors: [],
    readyToSend: true,
    requestBody: result.requestBody,
  };
  const userPreview = buildRecordPreviewView({
    objectKey,
    mode,
    requestInput,
    preview: commitPreview,
    capability: CRM_RECORD_CAPABILITIES[objectKey],
    fields: readRecordFields(options, objectKey),
  });
  const approved = options.repository.resolveConfirmation({
    runId: context.runId,
    confirmationId,
    status: 'approved',
  }) ?? pending;
  finishToolCall(toolCall, 'succeeded', `formInstIds=${result.formInstIds.join(',')}`);
  const recommendedRows = userPreview.recommendedRows ?? [];
  const committedContextFrame = buildCommittedRecordContextFrame({
    objectKey,
    formInstId: result.formInstIds[0],
    requestInput,
    capability: CRM_RECORD_CAPABILITIES[objectKey],
    runId: context.runId,
    contextFrame: context.contextFrame ?? null,
    resolvedContext: context.resolvedContext ?? null,
  });
  return {
    status: 'completed',
    content: [
      '## 写回已完成',
      `- 工具：\`${input.selectedTool.toolCode}\``,
      `- 确认 ID：\`${confirmationId}\``,
      `- 系统记录：已生成 ${result.formInstIds.length} 条记录`,
      '',
      '## 已写入字段',
      ...(userPreview.summaryRows.length
        ? userPreview.summaryRows.map((row) => `- ${row.label}：${row.value ?? ''}`)
        : ['- 暂无可展示字段摘要，请查看调试 trace。']),
      ...(recommendedRows.length
        ? [
            '',
            '## 建议继续补充',
            `- ${recommendedRows.map((row) => row.label).join('、')}`,
            `- 可以继续说：补充这条记录的${recommendedRows.slice(0, 3).map((row) => row.label).join('、')}。`,
          ]
        : []),
    ].join('\n'),
    headline: `${objectKey} ${mode} 写回完成`,
    references: [input.selectedTool.toolCode, 'meta.confirm_writeback'],
    toolCalls: [toolCall],
    contextFrame: committedContextFrame,
    pendingConfirmation: {
      ...approved,
      userPreview,
      debugPayload: result,
    },
  };
}

function buildCommittedRecordContextFrame(input: {
  objectKey: ShadowObjectKey;
  formInstId?: string;
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
  runId: string;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentToolExecuteInput['resolvedContext'];
}): ContextFrame | null {
  if (!input.formInstId) {
    return null;
  }
  const params = readRequestParams(input.requestInput);

  const binding = input.capability.subjectBinding;
  const boundSubjectType = binding?.acceptedSubjectTypes?.[0];
  const boundSubjectId = binding?.searchFilterField ? toContextScalar(params[binding.searchFilterField]) : '';
  if (input.objectKey !== 'customer' && boundSubjectType && boundSubjectId) {
    const previousSubject = findMatchingSubject({
      subjectType: boundSubjectType,
      subjectId: boundSubjectId,
      contextFrame: input.contextFrame ?? null,
      resolvedContext: input.resolvedContext ?? null,
    });
    return {
      subject: {
        kind: 'record',
        type: boundSubjectType,
        id: boundSubjectId,
        name: previousSubject?.name || boundSubjectId,
      },
      sourceRunId: input.runId,
      evidenceRefs: [],
      confidence: previousSubject ? 0.95 : 0.86,
      resolvedBy: 'record.commit.subject_binding',
    };
  }

  const identityField = input.capability.identityFields?.[0] ?? inferRecordNameParam(input.objectKey);
  const identityValue = params[identityField] ?? params[inferRecordNameParam(input.objectKey)];
  const name = identityValue === undefined || identityValue === null || String(identityValue).trim() === ''
    ? input.formInstId
    : String(identityValue).trim();
  return {
    subject: {
      kind: 'record',
      type: input.objectKey,
      id: input.formInstId,
      name,
    },
    sourceRunId: input.runId,
    evidenceRefs: [],
    confidence: 0.94,
    resolvedBy: 'record.commit',
  };
}

function findMatchingSubject(input: {
  subjectType: string;
  subjectId: string;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentToolExecuteInput['resolvedContext'];
}): ContextFrame['subject'] | null {
  const subjects = [
    input.resolvedContext?.subject,
    input.contextFrame?.subject,
  ].filter((item): item is NonNullable<ContextFrame['subject']> => Boolean(item?.type));
  return subjects.find((subject) => (
    subject.type === input.subjectType
    && (!subject.id || subject.id === input.subjectId)
    && Boolean(subject.name)
  )) ?? null;
}

function toContextScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return toContextScalar(value[0]);
  }
  if (value && typeof value === 'object') {
    const record = value as { formInstId?: unknown; id?: unknown; value?: unknown };
    return toContextScalar(record.formInstId ?? record.id ?? record.value);
  }
  return '';
}

function registerCompanyResearchTool(registry: AgentToolRegistry, options: CrmAgentPackOptions): void {
  registry.register({
    code: COMPANY_RESEARCH_TOOL,
    type: 'external',
    provider: 'skill-runtime',
    description: '对目标公司进行外部研究并沉淀 Artifact',
    whenToUse: '用户要求公司研究、客户分析或研究某家公司时使用。',
    inputSchema: { type: 'object', properties: { companyName: { type: 'string' } } },
    outputSchema: { type: 'object' },
    riskLevel: 'medium',
    confirmationPolicy: 'asset_only',
    displayCardType: 'company-research-artifact',
    owner: '研究能力组',
    enabled: true,
    semanticProfile: {
      subjectTypes: ['company'],
      intentCodes: ['provide_info', 'external_research'],
      conflictGroups: ['subject_profile_lookup'],
      priority: 60,
      risk: 'high_cost',
      clarifyLabel: '进行公司研究',
      aliases: ['公司研究', '进行公司研究', '外部公司研究', '重新研究', '重新进行公司研究', '客户分析'],
    },
    execute: (input, context) => executeCompanyResearch(options, input, context),
  });
}

async function executeCompanyResearch(
  options: CrmAgentPackOptions,
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const companyName = String(input.selectedTool.input.companyName || input.intentFrame.target.name || '').trim();
  if (!companyName) {
    throw new Error('缺少公司名称，无法执行公司研究');
  }

  const skillCall = createToolCall(context.runId, COMPANY_RESEARCH_RUNTIME_TOOL, companyName);
  let markdown: string;
  let skillReference = 'company-research';

  try {
    const job = await options.externalSkillService.createSkillJob(COMPANY_RESEARCH_RUNTIME_TOOL, {
      requestText: `研究这家公司：${companyName}。输出业务定位、成长驱动、核心风险、销售切入点和来源引用，使用结构化 Markdown。`,
      model: options.config.deepseek.defaultModel,
    });
    const waitResult = await waitForSkillJob(options, job.jobId);
    if (waitResult.status === 'still_running') {
      finishToolCall(skillCall, 'running', `job=${waitResult.job.jobId}, status=${waitResult.job.status}, 已超过同步等待窗口`);
      return buildCompanyResearchRunningResult(companyName, waitResult.job, options.companyResearchMaxWaitMs ?? COMPANY_RESEARCH_MAX_WAIT_MS, [skillCall]);
    }

    const finishedJob = waitResult.job;
    markdown = await resolveMarkdownFromJob(options, finishedJob);
    skillReference = finishedJob.jobId;
    finishToolCall(skillCall, 'succeeded', `job=${finishedJob.jobId}, artifacts=${finishedJob.artifacts.length}`);
  } catch (error) {
    finishToolCall(skillCall, 'failed', '公司研究 Skill 执行失败，未生成降级 Artifact', error);
    return buildCompanyResearchUnavailableResult(companyName, error, [skillCall]);
  }

  const artifactCall = createToolCall(context.runId, 'artifact.company_research', companyName);
  const artifact = await options.artifactService.createCompanyResearchArtifact({
    eid: context.eid,
    appId: context.appId,
    title: `${companyName} 公司研究`,
    markdown,
    sourceToolCode: COMPANY_RESEARCH_RUNTIME_TOOL,
    anchors: [buildCompanyAnchor(companyName)],
    createdBy: 'agent-runtime',
    summary: summarizeMarkdown(markdown),
    sourceRefs: extractSourceRefs(markdown),
  });
  finishToolCall(artifactCall, 'succeeded', `${artifact.artifact.vectorStatus}, chunks=${artifact.artifact.chunkCount}`);

  const evidence = [
    {
      artifactId: artifact.artifact.artifactId,
      versionId: artifact.artifact.versionId,
      title: artifact.artifact.title,
      version: artifact.artifact.version,
      sourceToolCode: artifact.artifact.sourceToolCode,
      anchorLabel: companyName,
      snippet: summarizeMarkdown(markdown),
      vectorStatus: artifact.artifact.vectorStatus,
    },
  ];

  return {
    status: 'completed',
    content: `## 公司研究已完成\n- 公司：**${companyName}**\n- Artifact：${artifact.artifact.title} v${artifact.artifact.version}\n- 向量状态：${artifact.artifact.vectorStatus}\n\n## 研究摘要\n${summarizeMarkdown(markdown)}\n\n## 下一步\n1. 可以继续问“这个客户最近有什么值得关注”。\n2. 如需写入客户或跟进记录，后续必须先生成 preview，再由你确认。`,
    headline: '已通过 Agent 调用公司研究 Skill，并沉淀 Artifact',
    references: [skillReference, artifact.artifact.title],
    evidence,
    attachments: [
      {
        name: `${companyName}-公司研究.md`,
        url: '#agent-company-research',
        type: 'markdown',
      },
    ],
    contextFrame: buildCompanyContextFrame(companyName, context.runId),
    toolCalls: [skillCall, artifactCall],
  };
}

function registerArtifactSearchTool(registry: AgentToolRegistry, options: CrmAgentPackOptions): void {
  registry.register({
    code: 'artifact.search',
    type: 'artifact',
    provider: 'ai-crm-native-data',
    description: '检索已有 Artifact 证据并返回 Evidence Card',
    whenToUse: '用户追问已有研究、资产或上下文证据时使用。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, anchorName: { type: 'string' } } },
    outputSchema: { type: 'object' },
    riskLevel: 'low',
    confirmationPolicy: 'read_only',
    displayCardType: 'artifact-evidence-list',
    owner: 'Agent 平台组',
    enabled: true,
    semanticProfile: {
      subjectTypes: ['company'],
      intentCodes: ['artifact_evidence_lookup'],
      conflictGroups: [],
      priority: 70,
      risk: 'low_cost',
      aliases: ['已有证据', '历史证据', '证据'],
    },
    execute: async (input, context) => {
      const query = String(input.selectedTool.input.query || input.request.query);
      const anchorName = String(input.selectedTool.input.anchorName || input.intentFrame.target.name || '').trim();
      const call = createToolCall(context.runId, 'artifact.search', query);
      const search = await options.artifactService.search({
        eid: context.eid,
        appId: context.appId,
        query,
        anchors: anchorName ? [buildCompanyAnchor(anchorName)] : undefined,
        limit: 5,
      });
      finishToolCall(call, 'succeeded', `${search.vectorStatus}, evidence=${search.evidence.length}`);
      const evidence: AgentEvidenceCard[] = search.evidence.map((item) => ({
        artifactId: item.artifactId,
        versionId: item.versionId,
        title: item.title,
        version: item.version,
        sourceToolCode: item.sourceToolCode,
        anchorLabel: item.anchorIds[0] ?? anchorName ?? 'Artifact',
        snippet: item.snippet,
        score: item.score,
        vectorStatus: search.vectorStatus,
      }));
      return {
        status: 'completed',
        content: evidence.length
          ? `## 基于已有 Artifact 的回答\n- 客户 / 公司：**${anchorName || '当前会话对象'}**\n- 可引用证据：${evidence.length} 条\n\n${evidence.slice(0, 2).map((item) => `- ${item.snippet}`).join('\n')}`
          : '当前没有检索到可引用 Artifact。你可以先说“研究这家公司 XX有限公司”，生成公司研究 Artifact 后再继续追问。',
        headline: evidence.length ? '已从 Artifact 检索到可引用证据' : '暂无可用 Artifact 证据',
        references: evidence.map((item) => item.title),
        evidence,
        qdrantFilter: search.qdrantFilter,
        toolCalls: [call],
      };
    },
  });
}

function registerMetaTools(registry: AgentToolRegistry, options: CrmAgentPackOptions): void {
  for (const tool of [
    ['meta.clarify_card', '澄清卡片', 'user_input_required'],
    ['meta.candidate_selection', '候选选择', 'user_input_required'],
    ['meta.plan_builder', '计划生成', 'editable_by_user'],
    ['meta.confirm_writeback', '确认写回', 'required_before_write'],
    [CONTEXT_SUMMARY_TOOL, '上下文摘要', 'read_only'],
  ] as const) {
    registry.register({
      code: tool[0],
      type: 'meta',
      provider: 'agent-runtime',
      description: tool[1],
      whenToUse: '由主 Agent 在交互控制、计划生成、候选选择或确认写回时使用。',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      riskLevel: tool[0] === 'meta.confirm_writeback' ? 'high' : 'low',
      confirmationPolicy: tool[2],
      displayCardType: tool[0],
      owner: 'Agent 平台组',
      enabled: true,
      execute: async (input, context) => {
        if (input.selectedTool.toolCode === CONTEXT_SUMMARY_TOOL) {
          return executeContextSummaryTool(options, input, context);
        }
        const call = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(input.selectedTool.input));
        finishToolCall(call, 'succeeded', 'meta tool response generated');
        return {
          status: 'waiting_input',
          content: input.selectedTool.toolCode === 'meta.clarify_card' && input.selectedTool.input.missingSlots
            ? `我还需要你补充：${(input.selectedTool.input.missingSlots as string[]).join('、')}。`
            : '已进入 Agent 控制工具等待状态。',
          headline: tool[1],
          references: [input.selectedTool.toolCode],
          toolCalls: [call],
        };
      },
    });
  }
}

function isContextSummaryQuery(query: string): boolean {
  return /(客户旅程|旅程|推进|下一步|怎么推进|进展概览|盘点一下|总结一下)/.test(query);
}

function inferContextSummaryType(query: string): 'journey' | 'next_step' {
  return /(下一步|怎么推进|推进建议)/.test(query) ? 'next_step' : 'journey';
}

function hasContextSummarySubject(input: AgentPlannerInput): boolean {
  const subject = input.resolvedContext?.usedContext
    ? input.resolvedContext.subject
    : input.contextFrame?.subject ?? input.resolvedContext?.subject;
  if (subject?.type === 'customer' && (subject.id || subject.name)) {
    return true;
  }
  if (subject?.type === 'company' && subject.name) {
    return true;
  }
  return input.intentFrame.target.objectType === 'customer' && Boolean(input.intentFrame.target.name);
}

async function executeContextSummaryTool(
  options: CrmAgentPackOptions,
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const query = String(input.selectedTool.input.query || input.request.query).trim();
  const summaryType = String(input.selectedTool.input.summaryType || 'journey') === 'next_step' ? 'next_step' : 'journey';
  const toolCalls = [createToolCall(context.runId, CONTEXT_SUMMARY_TOOL, JSON.stringify(input.selectedTool.input))];
  const rootSubject = context.resolvedContext?.usedContext
    ? context.resolvedContext.subject ?? null
    : context.contextFrame?.subject ?? context.resolvedContext?.subject ?? null;

  if (!context.operatorOpenId) {
    finishToolCall(toolCalls[0], 'skipped', '缺少 operatorOpenId，无法执行上下文摘要');
    return {
      status: 'waiting_input',
      content: '生成上下文摘要前需要当前操作人的 `operatorOpenId`。',
      headline: '需要补充操作人身份',
      references: [CONTEXT_SUMMARY_TOOL, 'meta.clarify_card'],
      toolCalls,
    };
  }

  const resolvedSubject = await resolveSummaryCustomerSubject({
    options,
    query,
    context,
    input,
    rootSubject,
    toolCalls,
  });
  if (!resolvedSubject) {
    finishToolCall(toolCalls[0], 'skipped', '缺少可汇总的客户主体');
    return {
      status: 'waiting_input',
      content: '我还需要先确定要汇总的客户。你可以先查询客户，或直接说“查询客户 XXX有限公司”。',
      headline: '需要先确定客户主体',
      references: [CONTEXT_SUMMARY_TOOL, 'meta.clarify_card'],
      toolCalls,
    };
  }

  const customerGetCall = createToolCall(context.runId, 'record.customer.get', resolvedSubject.id);
  const customerDetail = await executeSummaryGetWithRetry(options.shadowMetadataService, 'customer', {
    formInstId: resolvedSubject.id,
    operatorOpenId: context.operatorOpenId,
  });
  finishToolCall(customerGetCall, 'succeeded', 'record loaded');
  toolCalls.push(customerGetCall);

  const relationResults = await loadRelatedRecordSummaries({
    options,
    context,
    customerId: resolvedSubject.id,
    toolCalls,
  });

  finishToolCall(
    toolCalls[0],
    'succeeded',
    `summaryType=${summaryType}, contacts=${relationResults.contact.totalElements}, opportunities=${relationResults.opportunity.totalElements}, followups=${relationResults.followup.totalElements}`,
  );

  const content = buildCustomerSummaryContent({
    query,
    summaryType,
    customerRecord: customerDetail.record,
    relations: relationResults,
  });

  return {
    status: 'completed',
    content,
    headline: summaryType === 'journey' ? '客户旅程摘要已生成' : '推进建议已生成',
    references: [CONTEXT_SUMMARY_TOOL, 'record.customer.get', 'record.contact.search', 'record.opportunity.search', 'record.followup.search'],
    toolCalls,
    contextFrame: {
      subject: {
        kind: 'record',
        type: 'customer',
        id: resolvedSubject.id,
        name: resolvedSubject.name,
      },
      sourceRunId: context.runId,
      evidenceRefs: [],
      confidence: 0.95,
      resolvedBy: 'meta.context_summary',
    },
  };
}

async function resolveSummaryCustomerSubject(input: {
  options: CrmAgentPackOptions;
  query: string;
  context: AgentToolExecuteContext;
  input: AgentToolExecuteInput;
  rootSubject: ContextFrame['subject'] | null;
  toolCalls: AgentToolExecutionResult['toolCalls'];
}): Promise<{ id: string; name: string } | null> {
  const subject = input.rootSubject;
  if (subject?.type === 'customer' && subject.id && subject.name) {
    return { id: subject.id, name: subject.name };
  }

  const targetName = input.input.intentFrame.target.name?.trim() || extractCompanyName(input.query) || subject?.name?.trim() || '';
  if (!targetName) {
    return null;
  }

  const searchCall = createToolCall(input.context.runId, 'record.customer.search', targetName);
  const search = await input.options.shadowMetadataService.executeSearch('customer', {
    filters: [
      {
        field: 'customer_name',
        value: targetName,
        operator: 'like',
      },
    ],
    operatorOpenId: input.context.operatorOpenId ?? undefined,
    pageNumber: 1,
    pageSize: 5,
  });
  finishToolCall(searchCall, 'succeeded', `records=${search.records.length}`);
  input.toolCalls.push(searchCall);
  if (search.records.length !== 1) {
    return null;
  }
  const record = search.records[0];
  return {
    id: record.formInstId,
    name: readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.customer) ?? targetName,
  };
}

async function loadRelatedRecordSummaries(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  customerId: string;
  toolCalls: AgentToolExecutionResult['toolCalls'];
}) {
  const relationObjectKeys: Array<'contact' | 'opportunity' | 'followup'> = ['contact', 'opportunity', 'followup'];
  const results = {
    contact: undefined as Awaited<ReturnType<ShadowMetadataService['executeSearch']>> | undefined,
    opportunity: undefined as Awaited<ReturnType<ShadowMetadataService['executeSearch']>> | undefined,
    followup: undefined as Awaited<ReturnType<ShadowMetadataService['executeSearch']>> | undefined,
  };

  for (const objectKey of relationObjectKeys) {
    const capability = CRM_RECORD_CAPABILITIES[objectKey];
    const field = capability.subjectBinding?.searchFilterField;
    const call = createToolCall(input.context.runId, `record.${objectKey}.search`, input.customerId);
    const search = await executeSummarySearchWithRetry(input.options.shadowMetadataService, objectKey, {
      filters: field
        ? [{ field, value: input.customerId, operator: 'eq' }]
        : [],
      operatorOpenId: input.context.operatorOpenId ?? undefined,
      pageNumber: 1,
      pageSize: 5,
    });
    finishToolCall(call, 'succeeded', `records=${search.records.length}, total=${search.totalElements}`);
    input.toolCalls.push(call);
    results[objectKey] = search;
  }

  return {
    contact: results.contact!,
    opportunity: results.opportunity!,
    followup: results.followup!,
  };
}

async function executeSummarySearchWithRetry(
  service: ShadowMetadataService,
  objectKey: 'contact' | 'opportunity' | 'followup',
  input: Parameters<ShadowMetadataService['executeSearch']>[1],
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(250 * attempt);
      }
      return await service.executeSearch(objectKey, input);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function executeSummaryGetWithRetry(
  service: ShadowMetadataService,
  objectKey: 'customer',
  input: Parameters<ShadowMetadataService['executeGet']>[1],
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(250 * attempt);
      }
      return await service.executeGet(objectKey, input);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isRateLimitError(error: unknown): boolean {
  const record = error as {
    details?: { payload?: { errorCode?: unknown; error?: unknown } };
    message?: unknown;
  };
  return record?.details?.payload?.errorCode === 10000429
    || String(record?.details?.payload?.error ?? '').includes('请求过于频繁')
    || String(record?.message ?? '').includes('请求过于频繁');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCustomerSummaryContent(input: {
  query: string;
  summaryType: 'journey' | 'next_step';
  customerRecord: {
    formInstId?: string;
    fields?: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
    rawRecord?: Record<string, unknown>;
  };
  relations: Record<'contact' | 'opportunity' | 'followup', {
    totalElements: number;
    records: Array<{
      formInstId: string;
      fields: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
      rawRecord?: Record<string, unknown>;
    }>;
  }>;
}): string {
  const customer = input.customerRecord;
  const customerName = readFieldByTitles(customer, ['客户名称']) || readLiveRecordDisplayName(customer, CRM_RECORD_CAPABILITIES.customer) || '当前客户';
  const customerCode = readFieldByTitles(customer, ['客户编码', '客户编号']) || '-';
  const customerStatus = readFieldByTitles(customer, ['客户状态']) || '-';
  const customerType = readFieldByTitles(customer, ['客户类型']) || '-';
  const owner = readFieldByTitles(customer, ['销售负责人', '负责人']) || '-';
  const lastFollowupDate = readFieldByTitles(customer, ['最后跟进日期']) || '-';
  const nextVisitDate = readFieldByTitles(customer, ['下次回访日期']) || '-';
  const contactPreview = summarizeRelationRecords('contact', input.relations.contact.records);
  const opportunityPreview = summarizeRelationRecords('opportunity', input.relations.opportunity.records);
  const followupPreview = summarizeRelationRecords('followup', input.relations.followup.records);
  const suggestions = buildCustomerSuggestions({
    customer,
    relations: input.relations,
  });

  const lines = [
    input.summaryType === 'journey' ? '## 客户旅程摘要' : '## 推进建议摘要',
    `- 客户：${customerName}`,
    `- 客户编码：${customerCode}`,
    `- 客户状态：${customerStatus}`,
    `- 客户类型：${customerType}`,
    `- 销售负责人：${owner}`,
    `- 最后跟进：${lastFollowupDate}`,
    `- 下次回访：${nextVisitDate}`,
    '',
    '## 当前客户画像',
    `- 联系人：${input.relations.contact.totalElements} 条`,
    `- 商机：${input.relations.opportunity.totalElements} 条`,
    `- 跟进记录：${input.relations.followup.totalElements} 条`,
  ];

  if (contactPreview.length) {
    lines.push('', '## 代表性联系人', ...contactPreview.map((item) => `- ${item}`));
  }
  if (opportunityPreview.length) {
    lines.push('', '## 商机进展', ...opportunityPreview.map((item) => `- ${item}`));
  }
  if (followupPreview.length) {
    lines.push('', '## 最近跟进', ...followupPreview.map((item) => `- ${item}`));
  }
  if (suggestions.length) {
    lines.push('', input.summaryType === 'journey' ? '## 建议下一步' : '## 下一步建议', ...suggestions.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}

function buildCustomerSuggestions(input: {
  customer: {
    fields?: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
  };
  relations: Record<'contact' | 'opportunity' | 'followup', { totalElements: number }>;
}): string[] {
  const suggestions: string[] = [];
  const province = readFieldByTitles(input.customer, ['省']) || '';
  const city = readFieldByTitles(input.customer, ['市']) || '';
  const district = readFieldByTitles(input.customer, ['区']) || '';

  if (input.relations.followup.totalElements === 0) {
    suggestions.push('尽快补一条跟进记录，避免客户状态只有静态资料没有过程沉淀。');
  }
  if (input.relations.opportunity.totalElements === 0) {
    suggestions.push('如果这家客户已进入商机阶段，建议补录商机并明确销售阶段、预算、预计成交时间。');
  }
  if (!province || !city || !district) {
    suggestions.push('建议继续补充省、市、区，方便后续做区域经营和拜访路线安排。');
  }
  if (input.relations.contact.totalElements > 0 && input.relations.followup.totalElements < input.relations.contact.totalElements) {
    suggestions.push('联系人数量多于跟进沉淀数量，建议梳理关键联系人分工并补齐最近互动。');
  }

  return suggestions;
}

function summarizeRelationRecords(
  objectKey: 'contact' | 'opportunity' | 'followup',
  records: Array<{
    fields: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
    rawRecord?: Record<string, unknown>;
    formInstId: string;
  }>,
): string[] {
  return records.slice(0, 3).map((record) => {
    if (objectKey === 'contact') {
      const name = readFieldByTitles(record, ['联系人姓名', '姓名']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.contact) || record.formInstId;
      const mobile = readFieldByTitles(record, ['手机', '联系电话']) || '-';
      return `${name} / 手机：${mobile}`;
    }
    if (objectKey === 'opportunity') {
      const name = readFieldByTitles(record, ['机会名称', '商机名称']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.opportunity) || record.formInstId;
      const stage = readFieldByTitles(record, ['销售阶段']) || '-';
      const closeDate = readFieldByTitles(record, ['预计成交时间']) || '-';
      return `${name} / 阶段：${stage} / 预计成交：${closeDate}`;
    }
    const title = readFieldByTitles(record, ['跟进记录']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.followup) || record.formInstId;
    const method = readFieldByTitles(record, ['跟进方式']) || '-';
    return `${title} / 跟进方式：${method}`;
  });
}

function readFieldByTitles(
  record: {
    fields?: Array<{ title?: string | null; value?: unknown; rawValue?: unknown }>;
  },
  titles: string[],
): string {
  const field = (record.fields ?? []).find((item) => item.title && titles.includes(item.title));
  return field ? stringifyPreviewValue(field.value ?? field.rawValue) : '';
}

async function waitForSkillJob(options: CrmAgentPackOptions, jobId: string): Promise<SkillJobWaitResult> {
  let job = await options.externalSkillService.getSkillJob(jobId);
  const maxWaitMs = options.companyResearchMaxWaitMs ?? COMPANY_RESEARCH_MAX_WAIT_MS;
  const maxAttempts = Math.ceil(maxWaitMs / COMPANY_RESEARCH_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (job.status === 'succeeded') {
      return { status: 'succeeded', job };
    }
    if (job.status === 'failed') {
      throw new Error(job.error?.message ?? '公司研究 Skill 执行失败');
    }
    await new Promise((resolve) => setTimeout(resolve, COMPANY_RESEARCH_POLL_INTERVAL_MS));
    job = await options.externalSkillService.getSkillJob(jobId);
  }
  if (job.status === 'succeeded') {
    return { status: 'succeeded', job };
  }
  if (job.status === 'failed') {
    throw new Error(job.error?.message ?? '公司研究 Skill 执行失败');
  }
  return { status: 'still_running', job };
}

async function resolveMarkdownFromJob(options: CrmAgentPackOptions, job: ExternalSkillJobResponse): Promise<string> {
  const markdownArtifact = job.artifacts.find((item) => item.mimeType.includes('markdown')) ?? job.artifacts[0];
  if (markdownArtifact) {
    const { content } = await options.externalSkillService.getSkillJobArtifact(job.jobId, markdownArtifact.artifactId);
    const markdown = content.toString('utf8').trim();
    if (markdown) {
      return markdown;
    }
  }

  if (job.finalText?.trim()) {
    return job.finalText.trim();
  }

  throw new Error('公司研究 Skill 未返回 Markdown 内容');
}

function buildCompanyResearchRunningResult(
  companyName: string,
  job: ExternalSkillJobResponse,
  maxWaitMs: number,
  toolCalls: AgentToolExecutionResult['toolCalls'],
): AgentToolExecutionResult {
  const waitedSeconds = Math.ceil(maxWaitMs / 1000);
  return {
    status: 'running',
    currentStepKey: 'execute-tool',
    content: [
      '## 公司研究仍在运行',
      `- 公司：**${companyName}**`,
      `- Skill Job：\`${job.jobId}\``,
      `- 当前状态：${job.status}`,
      `- 同步等待：已等待约 ${waitedSeconds} 秒，真实联网研究仍在 skill-runtime 中继续执行。`,
      '',
      '## 当前说明',
      '- Agent 已成功触发 company-research。',
      '- 本次响应先保留运行中状态，避免把长耗时研究误判成失败。',
      '- 任务完成后，可通过外部技能任务记录查看 Markdown 产物；后续再接入异步回填 Artifact。',
    ].join('\n'),
    headline: '公司研究任务仍在运行，可稍后查看产物',
    references: [job.jobId, 'company-research'],
    evidence: [],
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName),
    toolCalls,
  };
}

function buildCompanyResearchUnavailableResult(
  companyName: string,
  error: unknown,
  toolCalls: AgentToolExecutionResult['toolCalls'],
): AgentToolExecutionResult {
  const message = getErrorMessage(error);
  return {
    status: 'tool_unavailable',
    currentStepKey: 'execute-tool',
    content: [
      '## 公司研究 Skill 执行失败',
      `- 公司：**${companyName}**`,
      `- 工具：\`${COMPANY_RESEARCH_RUNTIME_TOOL}\``,
      `- 失败原因：${message}`,
      '',
      '## 当前处理',
      '- 未生成降级 Artifact。',
      '- 未写入客户、联系人、商机或跟进记录。',
      '- 请处理外部 Skill / 模型额度 / skill-runtime 可用性后重试。',
    ].join('\n'),
    headline: '公司研究 Skill 执行失败，未生成 Artifact',
    references: [COMPANY_RESEARCH_RUNTIME_TOOL, 'company-research'],
    evidence: [],
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName),
    toolCalls,
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.no_degraded_artifact',
        action: 'block',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: `外部公司研究失败时不得生成降级 Artifact：${message}`,
      }),
    ],
  };
}

function buildCompanyContextFrame(companyName: string, sourceRunId?: string): ContextFrame {
  return {
    subject: {
      kind: 'external_subject',
      type: 'company',
      id: companyName,
      name: companyName,
    },
    sourceRunId,
    evidenceRefs: [],
    confidence: 0.9,
    resolvedBy: 'external.company_research',
  };
}

function buildCompanyAnchor(companyName: string): ArtifactAnchor {
  return {
    type: 'company',
    id: companyName,
    name: companyName,
    role: 'primary',
    confidence: 0.86,
    bindingStatus: 'unbound',
  };
}

function summarizeMarkdown(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .filter((line) => !isMarkdownNoiseLine(line));
  return lines.slice(0, 4).map((line) => `- ${line}`).join('\n') || '公司研究 Markdown 已生成。';
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/-{3,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^>+\s*/, '')
    .replace(/[·\s]+$/g, '')
    .trim();
}

function isMarkdownNoiseLine(line: string): boolean {
  return !line
    || /^[:\-\s|]+$/.test(line)
    || ['项目', '内容', '公司名称', '英文名', '成立时间', '注册资本'].some((token) => line === token)
    || ['生成时间', '研究目的', '研究方法', '方法：', '公开信息检索'].some((token) => line.includes(token));
}

function extractSourceRefs(markdown: string) {
  const lines = markdown
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.includes('http') || item.includes('来源'));
  return lines.slice(0, 6).map((line) => ({ title: line.slice(0, 80), source: 'company-research-skill' }));
}

export function fallbackGenericIntent(request: AgentToolExecuteInput['request'], focusedName?: string | null) {
  return toGenericIntentFrame(inferFallbackIntent(request, focusedName), request, focusedName);
}
