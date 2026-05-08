import { randomUUID } from 'node:crypto';
import type {
  AgentEvidenceCard,
  AgentRecordResultFieldView,
  AgentRecordResultRecordView,
  AgentRecordResultViewModel,
  AgentRecordSearchPageQuery,
  AgentRecordSearchPageRequest,
  AgentRecordSearchPageResponse,
  AgentMetaQuestionOptionsRequest,
  AgentMetaQuestionOptionsResponse,
  AgentUiSurface,
  AppConfig,
  ArtifactAnchor,
  ArtifactDetailResponse,
  ExternalSkillJobResponse,
  IntentFrame,
  ShadowExecuteGetResponse,
  ShadowExecuteSearchResponse,
  ShadowLiveRecord,
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
  type MetaQuestionLookup,
  type PendingInteraction,
  type RecordWritePreviewRow,
  type RecordWritePreviewView,
  type RecordToolCapability,
  type TargetSanitizationTrace,
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
import {
  cleanupCompanyName,
  extractCompanyName,
  inferFallbackIntent,
  isContextualQuestionQuery,
  isUsableCompanyName,
} from './agent-utils.js';
import type { ArtifactService } from './artifact-service.js';
import type { ExternalSkillService } from './external-skill-service.js';
import type { IntentFrameService } from './intent-frame-service.js';
import type { OrgEmployeeCandidate, OrgSyncRepository } from './org-sync-repository.js';
import type { RecordingTaskService } from './recording-task-service.js';
import type { ShadowMetadataService } from './shadow-metadata-service.js';
import { AgentToolRegistry } from './tool-registry.js';
import { getErrorMessage } from './errors.js';

const CRM_RECORD_OBJECTS: ShadowObjectKey[] = ['customer', 'contact', 'opportunity', 'followup'];
const COMPANY_RESEARCH_TOOL = 'external.company_research';
const COMPANY_RESEARCH_RUNTIME_TOOL = 'ext.company_research_pm';
const COMPANY_RESEARCH_SERVICE_LABEL = '公司研究服务';
const COMPANY_RESEARCH_MATERIAL_LABEL = '公司研究资料';
const RECORDING_MATERIAL_TOOL = 'artifact.recording_material.prepare';
const CONTEXT_SUMMARY_TOOL = 'meta.context_summary';
const EXTERNAL_INFO_SOURCE_LABEL = '外部信息';
const INTERNAL_RECORDS_SOURCE_LABEL = '系统内记录';
const RECORD_RESULT_A2UI_CATALOG_ID = 'local://yzj-crm/record-result/v1' as const;
const RECORD_RESULT_PAGE_ENDPOINT = '/api/agent/record-search-page' as const;
const META_QUESTION_OPTIONS_ENDPOINT = '/api/agent/meta-question-options' as const;
const DEFAULT_RECORD_SEARCH_PAGE_SIZE = 5;
const DEFAULT_META_QUESTION_OPTION_PAGE_SIZE = 10;
const COMPANY_RESEARCH_POLL_INTERVAL_MS = 1000;
const COMPANY_RESEARCH_MAX_WAIT_MS = 70_000;
const COMPANY_RESEARCH_BACKGROUND_MAX_WAIT_MS = 420_000;
const DUPLICATE_CHECK_MAX_ATTEMPTS = 2;
const DUPLICATE_CHECK_RETRY_DELAY_MS = 300;
const RECORDING_FOLLOWUP_REQUIRED_PARAMS = [
  'linked_customer_form_inst_id',
  'linked_opportunity_form_inst_id',
  'followup_method',
  'owner_open_id',
] as const;
const SEARCH_EXTRACTOR_WIDGET_TYPES = new Set([
  'textWidget',
  'textAreaWidget',
  'numberWidget',
  'moneyWidget',
  'radioWidget',
  'checkboxWidget',
  'dateWidget',
  'personSelectWidget',
  'departmentSelectWidget',
  'publicOptBoxWidget',
  'basicDataWidget',
  'switchWidget',
  'serialNumWidget',
]);

type DataSourceScope = 'auto' | 'external_info' | 'internal_records' | 'combined';

interface DataSourceScopeResolution {
  scope: DataSourceScope;
  normalizedQuery: string;
  explicit: boolean;
}

const CRM_RECORD_CAPABILITIES: Record<ShadowObjectKey, RecordToolCapability> = {
  customer: {
    objectLabels: ['客户', '公司'],
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
    objectLabels: ['联系人'],
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
    objectLabels: ['商机', '机会', '项目', '单子'],
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
    objectLabels: ['跟进记录', '拜访记录', '回访记录', '跟进', '拜访', '回访'],
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

interface PersonResolutionIssue {
  kind: 'ambiguous' | 'not_found';
  paramKey: string;
  label: string;
  rawValue: string;
  candidates: OrgEmployeeCandidate[];
}

interface PersonResolutionResult {
  requestInput: ShadowPreviewUpsertInput;
  issues: PersonResolutionIssue[];
}

interface ReferenceResolutionIssue {
  paramKey: string;
  label: string;
  rawValue: string;
  targetObjectKey?: ShadowObjectKey;
  options: FieldOptionHint[];
}

interface ReferenceResolutionResult {
  requestInput: ShadowPreviewUpsertInput;
  issues: ReferenceResolutionIssue[];
}

export interface CrmAgentPackOptions {
  config: AppConfig;
  repository: AgentRunRepository;
  intentFrameService: IntentFrameService;
  shadowMetadataService: ShadowMetadataService;
  orgSyncRepository?: Pick<OrgSyncRepository, 'findEmployees'>;
  externalSkillService: ExternalSkillService;
  artifactService: ArtifactService;
  recordingTaskService?: Pick<RecordingTaskService, 'archiveTask' | 'getTask'>;
  companyResearchMaxWaitMs?: number;
  companyResearchBackgroundMaxWaitMs?: number;
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
    return toGenericIntentFrame(legacyIntentFrame, input, focusedName, contextFrame ?? null);
  }
}

export class CrmAgentPlanner implements AgentPlanner {
  constructor(
    private readonly options: {
      arbitrationRules: ToolArbitrationRule[];
      shadowMetadataService: ShadowMetadataService;
    },
  ) {}

  async plan(input: AgentPlannerInput): Promise<AgentPlannerResult> {
    const toolSelection = selectTool(input, this.options.arbitrationRules, this.options.shadowMetadataService);
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
  registerRecordingMaterialTool(registry);
  registerMetaTools(registry, options);

  return {
    registry,
    intentResolver: new CrmIntentResolver({
      intentFrameService: options.intentFrameService,
    }),
    planner: new CrmAgentPlanner({
      arbitrationRules: CRM_TOOL_ARBITRATION_RULES,
      shadowMetadataService: options.shadowMetadataService,
    }),
  };
}

function toGenericIntentFrame(
  legacyIntentFrame: IntentFrame,
  request: AgentToolExecuteInput['request'],
  focusedName?: string | null,
  contextFrame?: ContextFrame | null,
) {
  const recordObject = resolveRecordObject(request.query, legacyIntentFrame, contextFrame ?? null);
  let targetSanitization: TargetSanitizationTrace | undefined;
  const target = (() => {
    if (recordObject) {
      const contextSubject = contextFrame?.subject?.type === recordObject ? contextFrame.subject : null;
      const rawTarget = legacyIntentFrame.targets[0];
      const targetGrounding = resolveRecordTargetGrounding({
        query: request.query,
        objectKey: recordObject,
        actionType: legacyIntentFrame.actionType,
        targetName: rawTarget?.name,
        targetId: rawTarget?.id,
        capability: CRM_RECORD_CAPABILITIES[recordObject],
      });
      targetSanitization = targetGrounding.targetSanitization;
      const useContextSubjectAsFallback = Boolean(contextSubject)
        && shouldUseRecordTargetContextFallback({
          query: request.query,
          objectKey: recordObject,
          actionType: legacyIntentFrame.actionType,
        });
      const recordTargetName = resolveRecordSubjectName({
        query: request.query,
        objectKey: recordObject,
        targetName: targetGrounding.targetName,
        fallbackName: (useContextSubjectAsFallback ? contextSubject?.name : undefined)
          || extractRecordName(request.query, recordObject),
        capability: CRM_RECORD_CAPABILITIES[recordObject],
      });
      return {
        kind: 'record' as const,
        objectType: recordObject,
        id: targetGrounding.targetId || (useContextSubjectAsFallback ? contextSubject?.id : undefined),
        name: recordTargetName || undefined,
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
  const normalizedLegacyIntentFrame = recordObject
    ? normalizeRecordLegacyIntentFrame(legacyIntentFrame, recordObject, target.name)
    : legacyIntentFrame;

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
    ...(targetSanitization ? { targetSanitization } : {}),
    legacyIntentFrame: normalizedLegacyIntentFrame,
  };
}

function normalizeRecordLegacyIntentFrame(
  intentFrame: IntentFrame,
  objectKey: ShadowObjectKey,
  targetName?: string,
): IntentFrame {
  const fallbackName = CRM_RECORD_CAPABILITIES[objectKey].objectLabels?.[0] ?? objectKey;
  const originalTarget = intentFrame.targets[0];
  const normalizedTarget = {
    type: objectKey,
    id: targetName || objectKey,
    name: targetName || fallbackName,
  };
  return {
    ...intentFrame,
    targetType: objectKey,
    targets: [
      {
        ...originalTarget,
        ...normalizedTarget,
      },
    ],
  };
}

function resolveRecordObject(query: string, intentFrame: IntentFrame, contextFrame?: ContextFrame | null): ShadowObjectKey | null {
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
  if (explicitObject === '跟进记录' || explicitObject === '拜访记录' || explicitObject === '回访记录' || explicitObject === '跟进' || explicitObject === '拜访' || explicitObject === '回访') {
    return 'followup';
  }

  const contextRecordObject = resolveContextRecordObjectForWrite(query, intentFrame, contextFrame ?? null);
  if (contextRecordObject) {
    return contextRecordObject;
  }

  if (intentFrame.targetType === 'company' && (intentFrame.actionType === 'analyze' || /(公司研究|研究|分析)/.test(query))) {
    return null;
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

function resolveContextRecordObjectForWrite(
  query: string,
  intentFrame: IntentFrame,
  contextFrame?: ContextFrame | null,
): ShadowObjectKey | null {
  const subjectType = contextFrame?.subject?.type;
  if (!subjectType || !CRM_RECORD_OBJECTS.includes(subjectType as ShadowObjectKey)) {
    return null;
  }
  if (/(公司研究|客户分析|研究|分析)/.test(query)) {
    return null;
  }
  const isWriteIntent = intentFrame.actionType === 'write' || /修改|更新|改成|改为|变更|调整|设置/.test(query);
  if (!isWriteIntent && !isRecordFieldAssignmentQuery(query)) {
    return null;
  }
  return subjectType as ShadowObjectKey;
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

  return query.match(/(?:录入|创建|新增|新建|补录|写入|查询|查一下|查|搜索|找一下|查看|看下|帮我查|帮我搜|更新|修改|打开)\s*(?:一个|一条|一位|一名|这?个|该|当前|所有|全部|全量|全体)?\s*(?:的)?\s*(客户|公司|联系人|商机|机会|跟进记录|拜访记录|回访记录|跟进|拜访|回访)/)?.[1] ?? null;
}

function resolveDataSourceScope(query: string): DataSourceScopeResolution {
  const normalized = query.replace(/\s+/g, '').trim();
  const hasExternalInfo = /(外部信息|系统外信息|系统外资料|公开资料|公开信息|公司研究|录音资料|录音资料包|拜访录音|录音分析|最近拜访|这次拜访|上次拜访|下次拜访|需求待办|问题陈述|价值定位|价值主张|分析结果|客户诉求|价值点|风险|推进阻塞|客户问题|方案|时机)/.test(normalized);
  const hasInternalRecords = /(系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录|客户|商机|机会|跟进记录|拜访记录|回访记录|待办情况|预算|关键人)/i.test(normalized);

  if (
    (/(结合|综合|融合|同时看|一起看)/.test(normalized) && hasExternalInfo && hasInternalRecords)
    || (/(结合|综合|融合|同时看|一起看|基于|整理|判断)/.test(normalized) && hasExternalInfo && hasInternalRecords)
    || /外部信息(?:和|与|及|以及|、)系统(?:内)?记录/.test(normalized)
    || /系统(?:内)?记录(?:和|与|及|以及|、)外部信息/.test(normalized)
    || (hasExternalInfo && /(判断|简报|推进|阻塞|赢单|开场|下一步|经营|值不值得|为什么)/.test(normalized))
  ) {
    return {
      scope: 'combined',
      normalizedQuery: stripDataSourceScopePhrases(query),
      explicit: true,
    };
  }

  if (/(只看|仅看|只用|仅用|基于|使用|从|根据).*(外部信息|系统外信息|系统外资料|公开资料|公开信息)/.test(normalized)) {
    return {
      scope: 'external_info',
      normalizedQuery: stripDataSourceScopePhrases(query),
      explicit: true,
    };
  }

  if (/(只看|仅看|只用|仅用|基于|使用|从|根据).*(系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录)/i.test(normalized)) {
    return {
      scope: 'internal_records',
      normalizedQuery: stripDataSourceScopePhrases(query),
      explicit: true,
    };
  }

  return {
    scope: 'auto',
    normalizedQuery: query.trim(),
    explicit: false,
  };
}

function normalizeDataSourceScope(value: unknown): DataSourceScope {
  return value === 'external_info' || value === 'internal_records' || value === 'combined'
    ? value
    : 'auto';
}

function inferContextSummaryDataSourceScope(query: string, currentScope: DataSourceScope): DataSourceScope {
  if (currentScope !== 'auto') {
    return currentScope;
  }
  return /(公司研究|录音|拜访|需求|待办|问题陈述|客户问题|价值|风险|阻塞|简报|赢单|开场|客户诉求)/.test(query)
    ? 'combined'
    : 'auto';
}

function stripDataSourceScopePhrases(query: string): string {
  return query
    .replace(/(?:请)?(?:结合|综合|融合|同时看|一起看)?\s*(?:外部信息|系统外信息|系统外资料|公开资料|公开信息)\s*(?:和|与|及|以及|、|,|，)?\s*(?:系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录)?/gi, '')
    .replace(/(?:请)?(?:结合|综合|融合|同时看|一起看)?\s*(?:系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录)\s*(?:和|与|及|以及|、|,|，)?\s*(?:外部信息|系统外信息|系统外资料|公开资料|公开信息)?/gi, '')
    .replace(/(?:只看|仅看|只用|仅用|基于|使用|从|根据|请|帮我|麻烦)\s*/g, '')
    .replace(/^[，,、：:\s]+/g, '')
    .trim();
}

function shouldRouteToExternalInfo(input: AgentPlannerInput, scopeResolution: DataSourceScopeResolution): boolean {
  const query = scopeResolution.normalizedQuery || input.request.query;
  if (isWriteLikeRecordMutationQuery(query, input.intentFrame.actionType)) {
    return false;
  }
  if (scopeResolution.scope === 'external_info') {
    return true;
  }
  if (scopeResolution.scope !== 'auto') {
    return false;
  }
  if (resolveExplicitCustomerRecordInfoName(query, input.intentFrame.target)) {
    return false;
  }
  if (isDirectRecordLookupQuery(query) && inferExplicitRecordObject(query)) {
    return false;
  }
  if (input.intentFrame.target.kind === 'artifact' || isArtifactFollowupQuestion(input)) {
    return true;
  }
  return Boolean(resolveExternalInfoAnchorName(input, scopeResolution))
    && isExternalInfoConsumptionQuery(query)
    && !isInternalRecordsConsumptionQuery(query);
}

function shouldRouteToContextSummary(input: AgentPlannerInput, scopeResolution: DataSourceScopeResolution): boolean {
  const query = scopeResolution.normalizedQuery || input.request.query;
  if (isWriteLikeRecordMutationQuery(query, input.intentFrame.actionType)) {
    return false;
  }

  if (scopeResolution.scope === 'combined') {
    return true;
  }

  if (scopeResolution.scope === 'internal_records') {
    if (isDirectRecordLookupQuery(query) && !isCustomerRecordSummaryQuery(query)) {
      return false;
    }
    return true;
  }

  return hasContextSummarySubject(input)
    && (isContextSummaryQuery(query) || isInternalRecordsSummaryQuery(query));
}

function isExternalInfoConsumptionQuery(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }
  return isContextualQuestionQuery(normalized)
    || /(?:介绍|说明|讲一下|说说|了解一下|概览|概况|信息|资料|详情|业务|主营|产品|服务|经营范围|优势|竞争优势|核心能力|做什么|风险|值得关注)/.test(normalized);
}

function isInternalRecordsConsumptionQuery(query: string): boolean {
  return /(系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录|客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|商机进展|机会进展|商机阶段|联系人|跟进记录|拜访记录|回访记录|商机|机会|待办情况)/i.test(query);
}

function isInternalRecordsSummaryQuery(query: string): boolean {
  return isContextSummaryQuery(query)
    || /(系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录|客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|商机进展|机会进展|商机阶段|拜访前摘要)/i.test(query);
}

function isCustomerRecordSummaryQuery(query: string): boolean {
  return /(客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|系统内记录|系统记录|内部记录|记录系统|CRM记录|客户记录|商机进展|机会进展|商机阶段|拜访前摘要)/i.test(query);
}

function isDirectRecordLookupQuery(query: string): boolean {
  return /^(?:查询|查一下|查|搜索|找一下|查看|看下|打开|帮我查|帮我搜)\s*/.test(query.trim());
}

function isWriteLikeRecordMutationQuery(query: string, actionType: IntentFrame['actionType']): boolean {
  const isReadQuestion = /(?:是什么|有什么|有哪些|多少|谁|吗|呢|[？?])/.test(query);
  return actionType === 'write'
    || /(?:录入|创建|新增|新建|补录|写入|修改|更新|改成|改为|变更|调整|设置|设为|关联|绑定|选择)/.test(query)
    || (isRecordFieldAssignmentQuery(query) && !isReadQuestion);
}

function hasExplicitRecordMutationVerb(query: string, actionType: IntentFrame['actionType']): boolean {
  return actionType === 'write'
    || /(?:录入|创建|新增|新建|补录|写入|修改|更新|改成|改为|变更|调整|设置|设为|关联|绑定|选择)/.test(query);
}

function resolveCustomerRecordLookupName(query: string): string {
  const normalized = query.trim();
  if (!normalized || isWriteLikeRecordMutationQuery(normalized, 'query')) {
    return '';
  }

  const explicitObject = mapExplicitRecordObjectToKey(inferExplicitRecordObject(normalized));
  if (explicitObject) {
    return '';
  }

  if (isReadOnlyRecordQuery(normalized) && /(客户信息|客户资料|客户详情|公司信息|公司资料|公司详情)/.test(normalized)) {
    return '';
  }

  const internalSubject = extractInternalRecordsSubjectName(normalized);
  if (internalSubject) {
    return internalSubject;
  }

  if (!isReadOnlyRecordQuery(normalized)) {
    return '';
  }

  const withoutVerb = normalized
    .replace(/^\/\S+\s*/, '')
    .replace(/^(?:查询|查一下|查|搜索|找一下|查看|看下|打开|看看|先查|帮我查|帮我搜)\s*/, '')
    .trim();
  const cleaned = cleanupCustomerRecordLookupName(withoutVerb);
  return isUsableCompanyName(cleaned) ? cleaned : '';
}

function resolveExternalInfoAnchorName(input: AgentPlannerInput, scopeResolution?: DataSourceScopeResolution): string | undefined {
  const query = scopeResolution?.normalizedQuery || input.request.query;
  const explicitName = extractExternalInfoSubjectName(query);
  if (explicitName) {
    return explicitName;
  }
  return resolveArtifactAnchorName(input);
}

function extractExternalInfoSubjectName(query: string): string {
  const normalized = stripDataSourceScopePhrases(query);
  const patterns = [
    /(?:介绍|说明|讲一下|说说|了解一下)\s*([^，。！？\n]+?)(?:的)?(?:业务|主营业务|产品|服务|经营范围|优势|竞争优势|核心能力|公司信息|客户信息|公司资料|客户资料|信息|资料|详情)?(?:[？?。！!]|$)/,
    /([^，。！？\n]+?)(?:的)?(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情|有什么业务|有哪些业务|主营业务|业务是什么|做什么|经营范围|产品|服务|优势是什么|竞争优势|核心优势)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = cleanupExternalInfoSubjectName(match?.[1] ?? '');
    if (isUsableCompanyName(candidate)) {
      return candidate;
    }
  }

  const companyName = extractCompanyName(normalized);
  if (isUsableCompanyName(companyName)) {
    return companyName;
  }

  return '';
}

function extractInternalRecordsSubjectName(query: string): string {
  const normalized = stripDataSourceScopePhrases(query);
  const patterns = [
    /([^，。！？\n]+?)(?:的)?(?:客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|客户资料|商机进展|机会进展|商机阶段|联系人|跟进记录|拜访记录|回访记录|系统内记录|系统记录|内部记录|记录系统)/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = cleanupCustomerRecordLookupName(match?.[1] ?? '');
    if (isUsableCompanyName(candidate)) {
      return candidate;
    }
  }
  return '';
}

function cleanupCustomerRecordLookupName(value: string): string {
  return cleanupCompanyName(value)
    .replace(/(?:的)?(?:客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|客户资料|客户信息|客户详情)$/g, '')
    .replace(/(?:处于什么状态|是什么状态|状态是什么|状态)$/g, '')
    .replace(/^(?:这个|该|当前)(?:客户|公司)$/g, '')
    .replace(/[？?。！!]+$/g, '')
    .trim();
}

function cleanupExternalInfoSubjectName(value: string): string {
  return cleanupCompanyName(value)
    .replace(/^(?:介绍|说明|讲一下|说说|了解一下)/, '')
    .replace(/(?:的)?(?:业务|主营业务|产品|服务|经营范围|优势|竞争优势|核心能力)$/g, '')
    .replace(/^(?:这个|该|当前)(?:客户|公司)$/g, '')
    .replace(/[？?。！!]+$/g, '')
    .trim();
}

interface CrmToolSelectionResult {
  selectedTool: AgentToolSelection | null;
  toolArbitration?: ToolArbitrationTrace | null;
}

function selectTool(
  input: AgentPlannerInput,
  arbitrationRules: ToolArbitrationRule[],
  shadowMetadataService: ShadowMetadataService,
): CrmToolSelectionResult {
  const query = input.request.query.trim();
  const dataSourceScope = resolveDataSourceScope(query);
  const scopedQuery = dataSourceScope.normalizedQuery || query;
  const target = input.intentFrame.target;
  const recordOpenAction = readRecordOpenClientAction(input.request.clientAction);
  const recordPreviewCreateAction = readRecordPreviewCreateClientAction(input.request.clientAction);

  if (recordPreviewCreateAction) {
    const objectKey = recordPreviewCreateAction.objectKey;
    const toolCode = `record.${objectKey}.preview_create`;
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return wrapSelectedTool({
      toolCode,
      reason: recordPreviewCreateAction.source?.kind === 'recording_material'
        ? '用户从录音资料包卡片发起记录新建，优先选择记录系统预创建工具。'
        : `用户通过客户端动作发起 ${objectKey} 新建预览，选择记录系统预创建工具。`,
      input: buildRecordPreviewCreateInputFromClientAction({
        action: recordPreviewCreateAction,
        query: scopedQuery,
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        tool,
        fields: readRecordFields({ shadowMetadataService }, objectKey),
        contextFrame: input.contextFrame ?? null,
        resolvedContext: input.resolvedContext ?? null,
      }),
      confidence: 0.96,
    });
  }

  if (hasAudioInput(input.request)) {
    return wrapSelectedTool({
      toolCode: RECORDING_MATERIAL_TOOL,
      reason: '用户上传或提到录音，选择录音资料包处理入口。',
      input: {
        attachmentNames: (input.request.attachments ?? []).map((item) => item.name),
        query,
      },
      confidence: 0.82,
    });
  }

  if (recordOpenAction) {
    return wrapSelectedTool({
      toolCode: `record.${recordOpenAction.objectKey}.get`,
      reason: '用户通过记录结果组件选择查看详情，使用隐藏 clientAction 绑定内部记录 ID。',
      input: {
        formInstId: recordOpenAction.formInstId,
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
      },
      confidence: 0.98,
    });
  }

  const customerLookupName = resolveCustomerRecordLookupName(scopedQuery);
  if (isComplexContextSummaryQuery(scopedQuery) && !hasExplicitRecordMutationVerb(scopedQuery, input.intentFrame.legacyIntentFrame.actionType)) {
    const summaryType = inferContextSummaryType(scopedQuery);
    const summaryDataSourceScope = inferContextSummaryDataSourceScope(scopedQuery, dataSourceScope.scope);
    return wrapSelectedTool({
      toolCode: CONTEXT_SUMMARY_TOOL,
      reason: summaryDataSourceScope === 'combined'
        ? '用户要求融合外部信息和系统内记录，选择通用上下文摘要工具。'
        : '用户要求消费系统内记录，选择通用上下文摘要工具。',
      input: {
        query: scopedQuery,
        dataSourceScope: summaryDataSourceScope,
        summaryType,
      },
      confidence: dataSourceScope.explicit ? 0.9 : 0.84,
    });
  }

  if (dataSourceScope.scope === 'auto' && customerLookupName && isSimpleCustomerRecordLookupQuery(scopedQuery)) {
    const objectKey: ShadowObjectKey = 'customer';
    const toolCode = 'record.customer.search';
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return wrapSelectedTool({
      toolCode,
      reason: '用户以简称查询客户或客户状态，选择系统内客户记录查询。',
      input: buildRecordToolInput({
        query: scopedQuery,
        objectKey,
        operation: 'search',
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        targetName: customerLookupName,
        tool,
        fields: readRecordFields({ shadowMetadataService }, objectKey),
        contextFrame: input.contextFrame ?? null,
        resolvedContext: input.resolvedContext ?? null,
      }),
      confidence: 0.8,
    });
  }

  if (dataSourceScope.scope === 'auto' && customerLookupName && !isContextSummaryQuery(scopedQuery)) {
    const objectKey: ShadowObjectKey = 'customer';
    const toolCode = 'record.customer.search';
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return wrapSelectedTool({
      toolCode,
      reason: '用户以简称查询客户或客户状态，选择系统内客户记录查询。',
      input: buildRecordToolInput({
        query: scopedQuery,
        objectKey,
        operation: 'search',
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        targetName: customerLookupName,
        tool,
        fields: readRecordFields({ shadowMetadataService }, objectKey),
        contextFrame: input.contextFrame ?? null,
        resolvedContext: input.resolvedContext ?? null,
      }),
      confidence: 0.8,
    });
  }

  if (shouldRouteToContextSummary(input, dataSourceScope)) {
    const summaryType = inferContextSummaryType(scopedQuery);
    const summaryDataSourceScope = inferContextSummaryDataSourceScope(scopedQuery, dataSourceScope.scope);
    return wrapSelectedTool({
      toolCode: CONTEXT_SUMMARY_TOOL,
      reason: summaryDataSourceScope === 'combined'
        ? '用户要求融合外部信息和系统内记录，选择通用上下文摘要工具。'
        : '用户要求消费系统内记录，选择通用上下文摘要工具。',
      input: {
        query: scopedQuery,
        dataSourceScope: summaryDataSourceScope,
        summaryType,
      },
      confidence: dataSourceScope.explicit ? 0.88 : 0.82,
    });
  }

  if (shouldRouteToExternalInfo(input, dataSourceScope)) {
    return wrapSelectedTool({
      toolCode: 'artifact.search',
      reason: dataSourceScope.scope === 'external_info'
        ? '用户明确要求只消费外部信息。'
        : '用户正在追问已有外部信息或上下文证据。',
      input: {
        query: scopedQuery,
        anchorName: resolveExternalInfoAnchorName(input, dataSourceScope),
        dataSourceScope: dataSourceScope.scope,
      },
      confidence: dataSourceScope.explicit ? 0.88 : 0.78,
    });
  }

  if (customerLookupName) {
    const objectKey: ShadowObjectKey = 'customer';
    const toolCode = 'record.customer.search';
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return wrapSelectedTool({
      toolCode,
      reason: '用户以简称查询客户或客户状态，选择系统内客户记录查询。',
      input: buildRecordToolInput({
        query: scopedQuery,
        objectKey,
        operation: 'search',
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        targetName: customerLookupName,
        tool,
        fields: readRecordFields({ shadowMetadataService }, objectKey),
        contextFrame: input.contextFrame ?? null,
        resolvedContext: input.resolvedContext ?? null,
      }),
      confidence: 0.8,
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

  if (
    target.kind === 'external_subject'
    && target.objectType === 'company'
    && (input.intentFrame.actionType === 'analyze' || isExplicitCompanyResearchQuery(query))
  ) {
    return wrapSelectedTool({
      toolCode: COMPANY_RESEARCH_TOOL,
      reason: '用户请求公司研究，选择外部研究工具。',
      input: {
        companyName: target.name || extractCompanyName(query),
      },
      confidence: 0.86,
    });
  }

  if (
    isContextSummaryQuery(query)
    && hasContextSummarySubject(input)
    && !isWriteLikeRecordMutationQuery(query, input.intentFrame.actionType)
  ) {
    const summaryType = inferContextSummaryType(query);
    return wrapSelectedTool({
      toolCode: CONTEXT_SUMMARY_TOOL,
      reason: summaryType === 'journey'
        ? '用户要求基于当前主体汇总连续业务旅程，选择通用上下文摘要工具。'
        : '用户要求基于当前主体给出推进建议，选择通用上下文摘要工具。',
      input: {
        query,
        dataSourceScope: 'internal_records',
        summaryType,
      },
      confidence: 0.81,
    });
  }

  const contextualFieldWrite = resolveContextualFieldWriteSelection({
    query,
    intentFrame: input.intentFrame,
    operatorOpenId: input.request.tenantContext?.operatorOpenId,
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
    shadowMetadataService,
  });
  if (contextualFieldWrite) {
    return wrapSelectedTool(contextualFieldWrite);
  }

  if (target.kind === 'record' && target.objectType) {
    const objectKey = target.objectType as ShadowObjectKey;
    const hasRecordContext = Boolean(resolveContextRecordFormInstId({
      objectKey,
      contextFrame: input.contextFrame ?? null,
      resolvedContext: input.resolvedContext ?? null,
    }));
    const operation = resolveRecordOperation(query, input.intentFrame.legacyIntentFrame, hasRecordContext);
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
        targetId: target.id,
        targetSanitization: input.intentFrame.targetSanitization,
        tool,
        fields: readRecordFields({ shadowMetadataService }, objectKey),
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

function resolveContextualFieldWriteSelection(input: {
  query: string;
  intentFrame: AgentPlannerInput['intentFrame'];
  operatorOpenId?: string;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'] | null;
  shadowMetadataService: ShadowMetadataService;
}): AgentToolSelection | null {
  if (isReadOnlyRecordQuery(input.query) || /(公司研究|客户分析|研究|分析)/.test(input.query)) {
    return null;
  }
  if (/(?:录入|创建|新增|新建|补录|写入)\s*(?:一个|这?个)?\s*(?:客户|公司|联系人|商机|机会|跟进记录|跟进|拜访记录)/.test(input.query)) {
    return null;
  }
  const subject = input.resolvedContext?.subject ?? input.contextFrame?.subject;
  const objectKey = subject?.kind === 'record' && subject.type && CRM_RECORD_OBJECTS.includes(subject.type as ShadowObjectKey)
    ? subject.type as ShadowObjectKey
    : null;
  if (!objectKey || !subject?.id) {
    return null;
  }
  const explicitObject = mapExplicitRecordObjectToKey(inferExplicitRecordObject(input.query));
  if (explicitObject && explicitObject !== objectKey) {
    return null;
  }
  const capability = CRM_RECORD_CAPABILITIES[objectKey];
  const fields = readRecordFields({ shadowMetadataService: input.shadowMetadataService }, objectKey);
  const fieldIntent = findExplicitWriteFieldIntent({
    query: input.query,
    capability,
    fields,
    allowValueless: true,
  });
  const hasWriteSignal = input.intentFrame.actionType === 'write'
    || /修改|更新|改成|改为|变更|调整|设置|设为|关联|绑定|选择/.test(input.query)
    || Boolean(fieldIntent?.hasValue);
  if (!fieldIntent || !hasWriteSignal) {
    return null;
  }
  return {
    toolCode: `record.${objectKey}.preview_update`,
    reason: `用户表达命中当前记录 ${objectKey} 的可写字段“${fieldIntent.alias}”，按当前上下文执行更新预览。`,
    input: buildRecordToolInput({
      query: input.query,
      objectKey,
      operation: 'preview_update',
      operatorOpenId: input.operatorOpenId,
      targetName: subject.name,
      fields,
      contextFrame: input.contextFrame ?? null,
      resolvedContext: input.resolvedContext ?? null,
    }),
    confidence: 0.82,
  };
}

function isReadOnlyRecordQuery(query: string): boolean {
  return /^(?:查询|查一下|查看|搜索|找一下|打开|看看|看下|先查|帮我查|帮我搜)/.test(query.trim());
}

function mapExplicitRecordObjectToKey(value: string | null): ShadowObjectKey | null {
  if (value === '客户' || value === '公司') {
    return 'customer';
  }
  if (value === '联系人') {
    return 'contact';
  }
  if (value === '商机' || value === '机会') {
    return 'opportunity';
  }
  if (value === '跟进记录' || value === '拜访记录' || value === '回访记录' || value === '跟进' || value === '拜访' || value === '回访') {
    return 'followup';
  }
  return null;
}

function readRecordOpenClientAction(action: AgentPlannerInput['request']['clientAction']): {
  objectKey: ShadowObjectKey;
  formInstId: string;
} | null {
  if (!action || action.type !== 'record.open') {
    return null;
  }
  if (!CRM_RECORD_OBJECTS.includes(action.objectKey)) {
    return null;
  }
  const formInstId = action.formInstId.trim();
  if (!formInstId) {
    return null;
  }
  return {
    objectKey: action.objectKey,
    formInstId,
  };
}

function readRecordPreviewCreateClientAction(action: AgentPlannerInput['request']['clientAction']): {
  objectKey: ShadowObjectKey;
  title?: string;
	  source?: {
	    kind: 'recording_material';
	    recordingTaskId?: string;
	    artifactId?: string;
	    fileName?: string;
	    sourceFileMd5?: string;
	    anchors?: {
      customer?: string;
      opportunity?: string;
      followup?: string;
    };
  };
} | null {
  if (!action || action.type !== 'record.preview_create') {
    return null;
  }
  if (!CRM_RECORD_OBJECTS.includes(action.objectKey)) {
    return null;
  }
  return {
    objectKey: action.objectKey,
    title: action.title,
    source: action.source?.kind === 'recording_material' ? action.source : undefined,
  };
}

function buildRecordPreviewCreateInputFromClientAction(input: {
  action: NonNullable<ReturnType<typeof readRecordPreviewCreateClientAction>>;
  query: string;
  operatorOpenId?: string;
  tool?: AgentToolDefinition;
  fields?: ShadowStandardizedField[];
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'];
}): Record<string, unknown> {
  const baseInput = buildRecordToolInput({
    query: input.query,
    objectKey: input.action.objectKey,
    operation: 'preview_create',
    operatorOpenId: input.operatorOpenId,
    targetName: input.action.title,
    tool: input.tool,
    fields: input.fields ?? [],
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  });

  if (input.action.objectKey !== 'followup' || input.action.source?.kind !== 'recording_material') {
    return baseInput;
  }

  const source = input.action.source;
  const params: Record<string, unknown> = {
    ...readPlainObject(baseInput.params),
    followup_record: buildRecordingFollowupRecordTitle(source.fileName),
  };
  if (source.anchors?.customer && !hasMeaningfulValue(params.linked_customer_form_inst_id)) {
    params.linked_customer_form_inst_id = source.anchors.customer;
  }
  if (source.anchors?.opportunity && !hasMeaningfulValue(params.linked_opportunity_form_inst_id)) {
    params.linked_opportunity_form_inst_id = source.anchors.opportunity;
  }

  return {
    ...baseInput,
    params,
    agentControl: {
      ...readPlainObject(baseInput.agentControl),
      subjectName: String(params.followup_record),
	      source: {
	        kind: 'recording_material',
	        recordingTaskId: source.recordingTaskId,
	        artifactId: source.artifactId,
	        fileName: source.fileName,
	        sourceFileMd5: source.sourceFileMd5,
	        anchors: source.anchors,
	      },
    },
  };
}

function buildRecordingFollowupRecordTitle(fileName?: string): string {
  const normalizedFileName = fileName?.trim();
  return normalizedFileName
    ? `基于录音资料包「${normalizedFileName}」新增拜访记录`
    : '基于录音资料包新增拜访记录';
}

function readPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
  return /\/公司研究|\/客户分析|公司研究|客户分析|研究|分析一下|分析\s*(?:这家|这个)?(?:公司|客户)/.test(query);
}

function isAmbiguousCompanyInfoQuery(query: string): boolean {
  if (/^(?:查询|查一下|查看|打开)\s*/.test(query.trim())) {
    return false;
  }
  return /(?:给出|提供|展示|显示|看一下)\s*.+(?:公司信息|客户信息|公司资料|客户资料|信息|资料|详情)/.test(query)
    || /(?:给出|提供|展示|显示)\s*.+(?:公司|客户)/.test(query);
}

function resolveRecordOperation(query: string, intentFrame: IntentFrame, hasRecordContext = false) {
  if (/修改|更新|改成|变更/.test(query)) {
    return 'preview_update';
  }
  if (/详情|详细|具体|打开/.test(query)) {
    return 'get';
  }
  if (/录入|创建|新增|新建|补录|写入/.test(query)) {
    return 'preview_create';
  }
  if (hasRecordContext && isRecordFieldAssignmentQuery(query)) {
    return 'preview_update';
  }
  if (intentFrame.actionType === 'write') {
    return 'preview_create';
  }
  return 'search';
}

function isRecordFieldAssignmentQuery(query: string): boolean {
  return /(?:为|是|=|：|:)/.test(query);
}

function buildRecordToolInput(input: {
  query: string;
  objectKey: string;
  operation: string;
  operatorOpenId?: string;
  targetName?: string;
  targetId?: string;
  targetSanitization?: TargetSanitizationTrace;
  tool?: AgentToolDefinition;
  fields?: ShadowStandardizedField[];
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentPlannerInput['resolvedContext'];
}): Record<string, unknown> {
  const capability = input.tool?.recordCapability ?? CRM_RECORD_CAPABILITIES[input.objectKey as ShadowObjectKey];
  const identityField = capability.identityFields?.[0] ?? inferRecordNameParam(input.objectKey);
  const objectKey = input.objectKey as ShadowObjectKey;
  const targetGrounding = CRM_RECORD_OBJECTS.includes(objectKey)
    ? resolveRecordTargetGrounding({
        query: input.query,
        objectKey,
        actionType: input.operation === 'search' || input.operation === 'get' ? 'query' : 'write',
        targetName: input.targetName,
        targetId: input.targetId,
        capability,
      })
    : {};
  const localTargetSanitization = targetGrounding.targetSanitization;
  const targetSanitization = input.targetSanitization ?? localTargetSanitization;
  const effectiveTargetName = localTargetSanitization ? undefined : targetGrounding.targetName ?? input.targetName;
  const name = resolveRecordSubjectName({
    query: input.query,
    objectKey: input.objectKey,
    targetName: effectiveTargetName,
    fallbackName: extractRecordName(input.query, input.objectKey),
    capability,
  });
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
    return buildRecordSearchInput({
      query: input.query,
      objectKey: input.objectKey,
      capability,
      identityField,
      targetName: effectiveTargetName,
      fields: input.fields ?? [],
      boundFilters: boundSearchInput?.filters ?? [],
      operatorOpenId: input.operatorOpenId,
      targetSanitization,
    });
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
        fields: input.fields ?? [],
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
      fields: input.fields ?? [],
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

type RecordSearchFilter = NonNullable<ShadowPreviewSearchInput['filters']>[number];

interface RecordSearchExtraction {
  filters: RecordSearchFilter[];
  consumedTexts: string[];
  conditions: Array<{
    field: string;
    label: string;
    value: string;
    source: 'explicit' | 'implicit';
  }>;
  ambiguities: Array<{
    value: string;
    candidateFields: Array<{ field: string; label: string }>;
  }>;
  unresolvedValues: Array<{
    field: string;
    label: string;
    value: string;
    reason: string;
  }>;
}

function buildRecordSearchInput(input: {
  query: string;
  objectKey: string;
  capability: RecordToolCapability;
  identityField: string;
  targetName?: string;
  fields: ShadowStandardizedField[];
  boundFilters: RecordSearchFilter[];
  operatorOpenId?: string;
  targetSanitization?: TargetSanitizationTrace;
}): Record<string, unknown> {
  const pagination = extractRecordSearchPagination(input.query);
  const queryWithoutPagination = removeRecordSearchPaginationText(input.query);
  const extraction = extractRecordSearchConditions({
    query: queryWithoutPagination,
    objectKey: input.objectKey,
    capability: input.capability,
    fields: input.fields,
    identityField: input.identityField,
  });
  const structuredFilters = [
    ...input.boundFilters,
    ...extraction.filters,
  ];
  const fallbackName = resolveRecordSearchFallbackName({
    query: queryWithoutPagination,
    objectKey: input.objectKey,
    targetName: input.targetName,
    consumedTexts: extraction.consumedTexts,
    hasStructuredFilters: structuredFilters.length > 0 || extraction.ambiguities.length > 0 || extraction.unresolvedValues.length > 0,
  });
  const filters = [
    ...structuredFilters,
    ...(fallbackName
      ? [
          {
            field: input.identityField,
            value: fallbackName,
            operator: 'like',
          },
        ]
      : []),
  ];
  const searchExtraction = buildSearchExtractionControl({
    extraction,
    fallbackName,
    filterSources: buildRecordSearchFilterSources({
      boundFilters: input.boundFilters,
      extraction,
      fallbackName,
      identityField: input.identityField,
    }),
  });
  const agentControl = {
    ...(searchExtraction ? { searchExtraction } : {}),
    ...(input.targetSanitization ? { targetSanitization: input.targetSanitization } : {}),
  };

  return {
    filters,
    operatorOpenId: input.operatorOpenId,
    pageNumber: pagination.pageNumber,
    pageSize: pagination.pageSize,
    ...(Object.keys(agentControl).length ? { agentControl } : {}),
  };
}

function extractRecordSearchPagination(query: string): { pageNumber: number; pageSize: number } {
  const pageNumber = readPositiveIntegerMatch(query, [
    /第\s*(\d{1,3})\s*页/,
    /page(?:Number)?\s*[:=]?\s*(\d{1,3})/i,
  ]) ?? 1;
  const pageSize = readPositiveIntegerMatch(query, [
    /每页\s*(\d{1,3})\s*(?:条|个|项)?/,
    /pageSize\s*[:=]?\s*(\d{1,3})/i,
  ]) ?? DEFAULT_RECORD_SEARCH_PAGE_SIZE;

  return {
    pageNumber: Math.min(Math.max(pageNumber, 1), 999),
    pageSize: Math.min(Math.max(pageSize, 1), 100),
  };
}

function readPositiveIntegerMatch(query: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const matched = query.match(pattern)?.[1];
    if (!matched) {
      continue;
    }
    const value = Number.parseInt(matched, 10);
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function removeRecordSearchPaginationText(query: string): string {
  return query
    .replace(/第\s*\d{1,3}\s*页/g, ' ')
    .replace(/每页\s*\d{1,3}\s*(?:条|个|项)?/g, ' ')
    .replace(/page(?:Number)?\s*[:=]?\s*\d{1,3}/gi, ' ')
    .replace(/pageSize\s*[:=]?\s*\d{1,3}/gi, ' ')
    .replace(/[，,：:。！？、；;\s]+$/g, '')
    .trim();
}

function extractRecordSearchConditions(input: {
  query: string;
  objectKey: string;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
  identityField: string;
}): RecordSearchExtraction {
  const fieldRefs = buildSearchFieldRefs(input.fields, input.capability, input.identityField);
  const extraction: RecordSearchExtraction = {
    filters: [],
    consumedTexts: [],
    conditions: [],
    ambiguities: [],
    unresolvedValues: [],
  };
  const usedFields = new Set<string>();

  for (const ref of fieldRefs) {
    const explicit = extractExplicitSearchCondition({
      query: input.query,
      objectKey: input.objectKey,
      ref,
    });
    if (!explicit) {
      continue;
    }

    const value = buildSearchFilterValue(ref.field, explicit.value, 'explicit');
    extraction.consumedTexts.push(explicit.sourceText);
    usedFields.add(ref.parameterKey);
    if (value.status === 'ok') {
      extraction.filters.push({
        field: ref.parameterKey,
        value: value.value,
        ...(value.operator ? { operator: value.operator } : {}),
      });
      extraction.conditions.push({
        field: ref.parameterKey,
        label: ref.field.label,
        value: explicit.value,
        source: 'explicit',
      });
    } else {
      extraction.unresolvedValues.push({
        field: ref.parameterKey,
        label: ref.field.label,
        value: explicit.value,
        reason: value.reason,
      });
    }
  }

  const implicitText = buildImplicitSearchPredicateText(input.query, input.objectKey);
  if (implicitText) {
    const implicitMatches = fieldRefs
      .filter((ref) => !usedFields.has(ref.parameterKey) && canImplicitlyExtractField(ref.field))
      .map((ref) => {
        const value = buildSearchFilterValue(ref.field, implicitText, 'implicit');
        return value.status === 'ok'
          ? {
              ref,
              value,
            }
          : null;
      })
      .filter((item): item is { ref: SearchFieldRef; value: SearchFilterValueResult & { status: 'ok' } } => Boolean(item));

    if (implicitMatches.length === 1) {
      const match = implicitMatches[0]!;
      extraction.filters.push({
        field: match.ref.parameterKey,
        value: match.value.value,
        ...(match.value.operator ? { operator: match.value.operator } : {}),
      });
      extraction.consumedTexts.push(implicitText);
      extraction.conditions.push({
        field: match.ref.parameterKey,
        label: match.ref.field.label,
        value: implicitText,
        source: 'implicit',
      });
    } else if (implicitMatches.length > 1) {
      extraction.ambiguities.push({
        value: implicitText,
        candidateFields: implicitMatches.map((match) => ({
          field: match.ref.parameterKey,
          label: match.ref.field.label,
        })),
      });
      extraction.consumedTexts.push(implicitText);
    }
  }

  return extraction;
}

interface SearchFieldRef {
  field: ShadowStandardizedField;
  parameterKey: string;
  labels: string[];
}

function buildSearchFieldRefs(
  fields: ShadowStandardizedField[],
  capability: RecordToolCapability,
  identityField: string,
): SearchFieldRef[] {
  return fields
    .filter(isFieldEligibleForSearchExtraction)
    .filter((field) => !isRecordIdentitySearchField(field, identityField))
    .map((field) => {
      const parameterKey = field.searchParameterKey ?? field.semanticSlot ?? field.fieldCode;
      return {
        field,
        parameterKey,
        labels: buildSearchFieldLabels(field, capability, parameterKey, identityField),
      };
    })
    .filter((ref) => ref.labels.length > 0)
    .sort((a, b) => Math.max(...b.labels.map((label) => label.length)) - Math.max(...a.labels.map((label) => label.length)));
}

function isRecordIdentitySearchField(field: ShadowStandardizedField, identityField: string): boolean {
  return [
    field.fieldCode,
    field.searchParameterKey,
    field.writeParameterKey,
    field.semanticSlot,
  ].some((key) => key === identityField || key === '_S_NAME' || key === '_S_TITLE');
}

function isFieldEligibleForSearchExtraction(field: ShadowStandardizedField): boolean {
  if (!SEARCH_EXTRACTOR_WIDGET_TYPES.has(field.widgetType) || field.widgetType === 'attachmentWidget') {
    return false;
  }
  if (field.widgetType === 'publicOptBoxWidget') {
    return field.enumBinding?.resolutionStatus === 'resolved' || field.options.length > 0;
  }
  if (field.widgetType === 'basicDataWidget') {
    return Boolean(field.relationBinding?.formCodeId);
  }
  return true;
}

function buildSearchFieldLabels(
  field: ShadowStandardizedField,
  capability: RecordToolCapability,
  parameterKey: string,
  identityField: string,
): string[] {
  const keys = [
    field.fieldCode,
    field.searchParameterKey,
    field.writeParameterKey,
    field.semanticSlot,
    parameterKey,
  ].filter((item): item is string => Boolean(item?.trim()));
  const labels = [
    field.label,
    ...keys.map((key) => capability.fieldLabels?.[key]),
    ...keys,
  ];
  const variants = labels
    .filter((item): item is string => Boolean(item?.trim()))
    .flatMap((label) => [label, ...buildShortLabelVariants(label)])
    .map((label) => label.replace(/（.*?）/g, '').trim())
    .filter(Boolean);
  const objectLabels = new Set(['客户', '公司', '联系人', '商机', '机会', '跟进', '记录']);

  return Array.from(new Set(variants))
    .filter((label) => {
      if (objectLabels.has(label) && (parameterKey === identityField || field.fieldCode === identityField)) {
        return false;
      }
      return label.length > 0;
    })
    .sort((a, b) => b.length - a.length);
}

function extractExplicitSearchCondition(input: {
  query: string;
  objectKey: string;
  ref: SearchFieldRef;
}): { value: string; sourceText: string } | null {
  const connector = '(?:为|是|=|：|:|在|属于|包含|含有|等于)';
  for (const label of input.ref.labels) {
    const escaped = escapeRegExp(label);
    const pattern = label.length <= 1
      ? new RegExp(`${escaped}\\s*${connector}\\s*([^，。；;！？\\n]+)`)
      : new RegExp(`${escaped}\\s*(?:${connector}\\s*)?([^，。；;！？\\n]+)`);
    const matched = input.query.match(pattern);
    const rawValue = matched?.[1]?.trim();
    if (!matched?.[0] || !rawValue) {
      continue;
    }
    const value = trimSearchConditionValue(rawValue, input.objectKey);
    if (value) {
      return {
        value,
        sourceText: matched[0],
      };
    }
  }
  return null;
}

type SearchFilterValueResult =
  | { status: 'ok'; value: unknown; operator?: string }
  | { status: 'unresolved'; reason: string };

function buildSearchFilterValue(
  field: ShadowStandardizedField,
  rawValue: string,
  source: 'explicit' | 'implicit',
): SearchFilterValueResult {
  const normalizedValue = rawValue.replace(/[，,：:。！？、；;\s]+$/g, '').trim();
  if (!normalizedValue) {
    return {
      status: 'unresolved',
      reason: '字段值为空',
    };
  }

  if (field.widgetType === 'radioWidget' || field.widgetType === 'checkboxWidget' || field.widgetType === 'publicOptBoxWidget') {
    const option = findMatchingFieldOption(field, normalizedValue);
    if (!option) {
      return {
        status: 'unresolved',
        reason: `${field.label} 的值未命中可选项`,
      };
    }
    return {
      status: 'ok',
      value: option.title || option.value || option.key || normalizedValue,
      operator: 'eq',
    };
  }

  if (field.widgetType === 'switchWidget') {
    const switchValue = normalizeSearchSwitchValue(normalizedValue);
    if (!switchValue) {
      return {
        status: 'unresolved',
        reason: `${field.label} 的开关值无法识别`,
      };
    }
    return {
      status: 'ok',
      value: switchValue,
      operator: 'eq',
    };
  }

  if (field.widgetType === 'dateWidget') {
    const dateValue = normalizeSearchDateValue(normalizedValue);
    if (!dateValue) {
      return {
        status: 'unresolved',
        reason: `${field.label} 的日期值无法识别`,
      };
    }
    return {
      status: 'ok',
      value: dateValue,
    };
  }

  if (field.widgetType === 'numberWidget' || field.widgetType === 'moneyWidget') {
    const comparable = normalizeSearchComparable(normalizedValue);
    const isPhoneField = /手机|电话|phone/i.test(`${field.label}${field.semanticSlot ?? ''}${field.searchParameterKey ?? ''}`);
    const phoneValue = isPhoneField ? comparable.match(/1[3-9]\d{9}/)?.[0] : undefined;
    if (phoneValue) {
      return {
        status: 'ok',
        value: phoneValue,
      };
    }
    if (source === 'implicit' && isPhoneField) {
      return {
        status: 'unresolved',
        reason: `${field.label} 不支持非手机号文本的隐式识别`,
      };
    }
    if (source === 'implicit' && !isPhoneField && !/^-?\d+(?:\.\d+)?$/.test(comparable)) {
      return {
        status: 'unresolved',
        reason: `${field.label} 不支持非数字文本的隐式识别`,
      };
    }
  }

  if (source === 'implicit' && (field.widgetType === 'textWidget' || field.widgetType === 'textAreaWidget' || field.widgetType === 'serialNumWidget')) {
    return {
      status: 'unresolved',
      reason: `${field.label} 不支持隐式文本字段识别`,
    };
  }

  return {
    status: 'ok',
    value: normalizedValue,
    ...(field.widgetType === 'textWidget' || field.widgetType === 'textAreaWidget' || field.widgetType === 'serialNumWidget'
      ? { operator: 'like' }
      : {}),
  };
}

function findMatchingFieldOption(field: ShadowStandardizedField, rawValue: string): ShadowStandardizedField['options'][number] | undefined {
  const valueVariants = buildSearchValueVariants(rawValue, field.semanticSlot);
  return field.options.find((option) => {
    const optionValues = [
      option.title,
      option.value,
      option.key,
      option.code ?? undefined,
      ...(option.aliases ?? []),
    ].filter((item): item is string => Boolean(item?.trim()));
    const optionVariants = optionValues.flatMap((item) => buildSearchValueVariants(item, field.semanticSlot));
    return valueVariants.some((value) => optionVariants.includes(value));
  });
}

function buildSearchValueVariants(value: string, semanticSlot?: string): string[] {
  const normalized = normalizeSearchComparable(value);
  const variants = new Set([normalized]);
  variants.add(normalized.replace(/(?:客户|公司|联系人|商机|机会)$/, ''));
  if (semanticSlot === 'province') {
    variants.add(normalized.replace(/省$/, ''));
  }
  if (semanticSlot === 'city') {
    variants.add(normalized.replace(/市$/, ''));
  }
  if (semanticSlot === 'district') {
    variants.add(normalized.replace(/[区县]$/, ''));
  }
  return [...variants].filter(Boolean);
}

function normalizeSearchComparable(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[：:，。！？、；;]/g, '')
    .toLowerCase();
}

function normalizeSearchSwitchValue(value: string): string | null {
  const normalized = normalizeSearchComparable(value);
  if (/^(1|true|yes|y|on|enable|enabled|open|开启|启用|打开|是)$/.test(normalized)) {
    return '1';
  }
  if (/^(0|false|no|n|off|disable|disabled|close|关闭|停用|禁用|关|否)$/.test(normalized)) {
    return '0';
  }
  return null;
}

function normalizeSearchDateValue(value: string): string | null {
  const normalized = value.trim();
  const chineseDate = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (chineseDate) {
    const [, year, month, day] = chineseDate;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }
  const slashDate = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (slashDate) {
    const [, year, month, day] = slashDate;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }
  return null;
}

function canImplicitlyExtractField(field: ShadowStandardizedField): boolean {
  if (field.widgetType === 'switchWidget') {
    return true;
  }
  if (field.widgetType === 'radioWidget' || field.widgetType === 'checkboxWidget' || field.widgetType === 'publicOptBoxWidget') {
    return field.options.length > 0;
  }
  if (field.widgetType === 'numberWidget' && /手机|电话|phone/i.test(`${field.label}${field.semanticSlot ?? ''}`)) {
    return true;
  }
  return false;
}

function buildImplicitSearchPredicateText(query: string, objectKey: string): string {
  const labels = getRecordObjectLabelPattern(objectKey);
  const scope = getRecordCollectionScopePattern();
  const text = query
    .replace(/^\/\S+\s*/, '')
    .replace(/^(?:查询|查一下|找一下|搜索|查看|打开)\s*(?:一个|这?个)?\s*/, '')
    .replace(new RegExp(`^(?:${scope})\\s*(?:的)?\\s*`), '')
    .replace(new RegExp(`^(?:${labels})[，,：:\\s]*`), '')
    .replace(new RegExp(`(?:\\s*的)?\\s*(?:${scope})?\\s*(?:${labels})(?:数据|列表|信息|资料)?$`), '')
    .replace(/(?:数据|列表|信息|资料)$/, '')
    .replace(/[，,：:。！？、；;\s]+$/g, '')
    .trim();
  return text.replace(/的$/, '').trim();
}

function trimSearchConditionValue(value: string, objectKey: string): string {
  const labels = getRecordObjectLabelPattern(objectKey);
  const scope = getRecordCollectionScopePattern();
  return value
    .replace(new RegExp(`(?:\\s*的)?\\s*(?:${scope})?\\s*(?:${labels})(?:数据|列表|信息|资料)?$`), '')
    .replace(/(?:数据|列表|信息|资料)$/, '')
    .replace(/[，,：:。！？、；;\s]+$/g, '')
    .trim();
}

function resolveRecordSearchFallbackName(input: {
  query: string;
  objectKey: string;
  targetName?: string;
  consumedTexts: string[];
  hasStructuredFilters: boolean;
}): string {
  if (!input.hasStructuredFilters && input.targetName?.trim()) {
    const targetName = cleanupRecordNameCandidate(input.targetName, input.objectKey);
    return isMeaningfulRecordNameCandidate(targetName, input.objectKey) ? targetName : '';
  }

  const remainingQuery = removeConsumedSearchTexts(input.query, input.consumedTexts);
  const name = extractRecordName(remainingQuery, input.objectKey);
  const normalized = cleanupRecordNameCandidate(name, input.objectKey);
  return isMeaningfulRecordNameCandidate(normalized, input.objectKey) ? normalized : '';
}

function buildRecordSearchFilterSources(input: {
  boundFilters: RecordSearchFilter[];
  extraction: RecordSearchExtraction;
  fallbackName: string;
  identityField: string;
}): Array<{ field: string; value: string; source: string; label?: string }> {
  return [
    ...input.boundFilters.map((filter) => ({
      field: String(filter.field),
      value: String(filter.value ?? ''),
      source: 'relation_context',
      label: '关系上下文绑定',
    })),
    ...input.extraction.conditions.map((condition) => ({
      field: condition.field,
      value: condition.value,
      source: condition.source === 'explicit' ? 'explicit_condition' : 'implicit_condition',
      label: condition.label,
    })),
    ...(input.fallbackName
      ? [{
          field: input.identityField,
          value: input.fallbackName,
          source: 'name_fallback',
          label: '名称 fallback',
        }]
      : []),
  ];
}

function removeConsumedSearchTexts(query: string, consumedTexts: string[]): string {
  return consumedTexts
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((text, consumed) => text.replace(consumed, ' '), query);
}

function cleanupRecordNameCandidate(value: string, objectKey: string): string {
  const labels = getRecordObjectLabelPattern(objectKey);
  const scope = getRecordCollectionScopePattern();
  return cleanupCompanyName(value)
    .replace(new RegExp(`(?:\\s*的)?\\s*(?:${scope})?\\s*(?:${labels})$`), '')
    .trim();
}

function isMeaningfulRecordNameCandidate(value: string, objectKey: string): boolean {
  const labels = getRecordObjectLabelPattern(objectKey);
  const scope = getRecordCollectionScopePattern();
  const operation = getRecordOperationVerbPattern();
  const quantity = getRecordQuantityWordPattern();
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (new RegExp(`^(?:${operation})\\s*(?:${quantity})?\\s*(?:${labels})?(?:信息|资料|数据|记录)?$`).test(trimmed)) {
    return false;
  }
  if (new RegExp(`^(?:${quantity})?\\s*(?:${labels})(?:信息|资料|数据|记录)?$`).test(trimmed)) {
    return false;
  }
  const normalized = value
    .replace(new RegExp(`^(?:${operation})?\\s*(?:${quantity})?\\s*(?:的)?(?:${labels})?$`), '')
    .replace(new RegExp(`(?:\\s*的)?\\s*(?:${scope})?\\s*(?:${labels})(?:数据|列表|信息|资料)?$`), '')
    .replace(/(?:数据|列表|信息|资料|记录)$/, '')
    .replace(/^的$/, '')
    .trim();
  if (isRecordCollectionScopeCandidate(normalized)) {
    return false;
  }
  return normalized.length > 0;
}

function getRecordObjectLabelPattern(objectKey: string): string {
  if (objectKey === 'contact') {
    return '联系人';
  }
  if (objectKey === 'opportunity') {
    return '商机|机会';
  }
  if (objectKey === 'followup') {
    return '跟进记录|拜访记录|跟进';
  }
  return '客户|公司';
}

function getRecordOperationVerbPattern(): string {
  return '录入|创建|新增|新建|补录|写入|添加|建立|查询|查一下|找一下|搜索|查看|打开|修改|更新|改成|改为|变更|调整|设置|改';
}

function getRecordQuantityWordPattern(): string {
  return '一个|一条|一位|一名|这?个|该|当前';
}

function isRecordCollectionScopeCandidate(value: string): boolean {
  const normalized = normalizeSearchComparable(value)
    .replace(/^(?:的)/, '')
    .replace(/(?:的)$/, '');
  return new RegExp(`^(?:${getRecordCollectionScopePattern()}|列表|清单|数据|记录|所有数据|全部数据|所有记录|全部记录)$`).test(normalized);
}

function getRecordCollectionScopePattern(): string {
  return '所有|全部|全量|全体';
}

function buildSearchExtractionControl(input: {
  extraction: RecordSearchExtraction;
  fallbackName: string;
  filterSources: Array<{ field: string; value: string; source: string; label?: string }>;
}): Record<string, unknown> | null {
  const { extraction } = input;
  if (
    extraction.conditions.length === 0 &&
    extraction.ambiguities.length === 0 &&
    extraction.unresolvedValues.length === 0 &&
    !input.fallbackName &&
    input.filterSources.length === 0
  ) {
    return null;
  }
  return {
    conditions: extraction.conditions,
    ambiguities: extraction.ambiguities,
    unresolvedValues: extraction.unresolvedValues,
    ...(input.fallbackName ? { fallbackName: input.fallbackName } : {}),
    ...(input.filterSources.length ? { filterSources: input.filterSources } : {}),
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
    fields?: ShadowStandardizedField[];
  },
): Record<string, unknown> {
  const subjectNameParam = capability.previewInputPolicy?.subjectNameParam ?? inferRecordNameParam(objectKey);
  const normalizedName = normalizeRecordSubjectNameCandidate({
    value: name,
    objectKey,
    capability,
    subjectNameParam,
  });
  const params: Record<string, unknown> = options.includeSubjectName && normalizedName ? { [subjectNameParam]: normalizedName } : {};

  const metadataParams = extractRecordWriteParamsFromQuery({
    query,
    capability,
    fields: options.fields ?? [],
    currentParams: params,
  });
  for (const [paramKey, value] of Object.entries(metadataParams)) {
    if (!hasMeaningfulValue(params[paramKey])) {
      params[paramKey] = value;
    }
  }

  for (const { paramKey } of buildWritableFieldEntries({
    capability,
    fields: options.fields ?? [],
  })) {
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

function resolveRecordSubjectName(input: {
  query: string;
  objectKey: string;
  targetName?: string;
  fallbackName?: string;
  capability: RecordToolCapability;
}): string {
  const subjectNameParam = input.capability.previewInputPolicy?.subjectNameParam ?? inferRecordNameParam(input.objectKey);
  const targetName = normalizeRecordSubjectNameCandidate({
    value: input.targetName ?? '',
    objectKey: input.objectKey,
    capability: input.capability,
    subjectNameParam,
  });
  if (targetName) {
    return targetName;
  }
  return normalizeRecordSubjectNameCandidate({
    value: input.fallbackName ?? extractRecordName(input.query, input.objectKey),
    objectKey: input.objectKey,
    capability: input.capability,
    subjectNameParam,
  });
}

function resolveRecordTargetGrounding(input: {
  query: string;
  objectKey: ShadowObjectKey;
  actionType: IntentFrame['actionType'];
  targetName?: string;
  targetId?: string;
  capability: RecordToolCapability;
}): {
  targetName?: string;
  targetId?: string;
  targetSanitization?: TargetSanitizationTrace;
} {
  const targetName = input.targetName?.trim();
  const targetId = input.targetId?.trim();
  if (!targetName && !targetId) {
    return {};
  }
  if (input.actionType === 'query' && targetName) {
    const targetIsGrounded = isRecordTargetGroundedInQuery({
      query: input.query,
      objectKey: input.objectKey,
      targetName,
      capability: input.capability,
    });
    const userExplicitName = normalizeRecordSubjectNameCandidate({
      value: extractRecordName(input.query, input.objectKey),
      objectKey: input.objectKey,
      capability: input.capability,
      subjectNameParam: input.capability.previewInputPolicy?.subjectNameParam ?? inferRecordNameParam(input.objectKey),
    });
    if (!targetIsGrounded && (isBareRecordCollectionQuery(input.query, input.objectKey) || userExplicitName)) {
      return {
        targetSanitization: {
          reasonCode: 'ignored_ungrounded_target',
          reason: userExplicitName
            ? '查询中的 LLM target 未出现在用户输入中，已优先使用用户显式查询条件。'
            : '集合查询中的 LLM target 未出现在用户输入中，已忽略以避免历史上下文污染搜索条件。',
          source: 'intent_target',
          ignoredTargetName: targetName,
          ...(targetId ? { ignoredTargetId: targetId } : {}),
        },
      };
    }
  }
  return {
    ...(targetName ? { targetName } : {}),
    ...(targetId ? { targetId } : {}),
  };
}

function isRecordTargetGroundedInQuery(input: {
  query: string;
  objectKey: ShadowObjectKey;
  targetName: string;
  capability: RecordToolCapability;
}): boolean {
  const query = normalizeSearchComparable(input.query);
  const target = normalizeSearchComparable(input.targetName);
  if (!target) {
    return false;
  }
  if (query.includes(target)) {
    return true;
  }
  const objectLabels = new Set([
    input.objectKey,
    ...(input.capability.objectLabels ?? []),
    ...(input.capability.identityFields ?? []).map((field) => input.capability.fieldLabels?.[field] ?? field),
  ].map(normalizeSearchComparable));
  return objectLabels.has(target);
}

function shouldUseRecordTargetContextFallback(input: {
  query: string;
  objectKey: ShadowObjectKey;
  actionType: IntentFrame['actionType'];
}): boolean {
  if (input.actionType === 'query' && isBareRecordCollectionQuery(input.query, input.objectKey)) {
    return false;
  }
  return true;
}

function isBareRecordCollectionQuery(query: string, objectKey: ShadowObjectKey): boolean {
  if (!isReadOnlyRecordQuery(query)) {
    return false;
  }
  if (hasRecordContextReference(query)) {
    return false;
  }
  if (extractRecordName(query, objectKey)) {
    return false;
  }
  const explicitObject = mapExplicitRecordObjectToKey(inferExplicitRecordObject(query));
  return explicitObject === objectKey || isRecordCollectionScopeCandidate(cleanupRecordNameCandidate(query, objectKey));
}

function hasRecordContextReference(query: string): boolean {
  return /(?:这个|该|当前|刚才|上一|上个|前面|上面)/.test(query);
}

function normalizeRecordSubjectNameCandidate(input: {
  value: string;
  objectKey: string;
  capability: RecordToolCapability;
  subjectNameParam: string;
}): string {
  const trimmed = trimValueBeforeKnownLabels(input.value, input.capability, input.subjectNameParam);
  const labels = getRecordObjectLabelPattern(input.objectKey);
  const commandStripped = isBareRecordWriteCommand(trimmed, labels)
    ? ''
    : stripRecordWriteCommandPrefix(trimmed, labels) || trimmed;
  const cleaned = cleanupCompanyName(commandStripped);
  return isMeaningfulRecordNameCandidate(cleaned, input.objectKey) ? cleaned : '';
}

function extractRecordWriteParamsFromQuery(input: {
  query: string;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
  currentParams?: Record<string, unknown>;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const entry of buildWritableFieldEntries({
    capability: input.capability,
    fields: input.fields,
  })) {
    const { paramKey } = entry;
    if (hasMeaningfulValue(input.currentParams?.[paramKey])) {
      continue;
    }
    const field = entry.field ?? findFieldByParamKey(paramKey, input.fields);
    if (field && field.writePolicy !== undefined && field.writePolicy !== 'promptable') {
      continue;
    }
    const rawValue = extractExplicitWriteValue(input.query, {
      paramKey,
      field,
      capability: input.capability,
    });
    if (rawValue === undefined) {
      continue;
    }
    const normalized = normalizeExplicitWriteValue(rawValue, field);
    if (normalized !== undefined && hasMeaningfulValue(normalized)) {
      params[paramKey] = normalized;
    }
  }
  return params;
}

interface FieldSemanticEntry {
  paramKey: string;
  field?: ShadowStandardizedField;
  aliases: string[];
  isReference: boolean;
  targetModelName?: string;
}

interface ExplicitWriteFieldIntent {
  paramKey: string;
  field?: ShadowStandardizedField;
  alias: string;
  value?: string;
  hasValue: boolean;
  isReference: boolean;
}

function extractExplicitWriteValue(
  query: string,
  input: {
    paramKey: string;
    field?: ShadowStandardizedField;
    capability: RecordToolCapability;
  },
): string | undefined {
  const entry = buildFieldSemanticEntry({
    paramKey: input.paramKey,
    field: input.field,
    capability: input.capability,
  });
  return matchExplicitWriteFieldValue(query, entry, input.capability);
}

function buildWriteFieldLabels(input: {
  paramKey: string;
  field?: ShadowStandardizedField;
  capability: RecordToolCapability;
}): string[] {
  return buildFieldSemanticEntry(input).aliases;
}

function buildFieldSemanticCatalog(input: {
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
}): FieldSemanticEntry[] {
  return buildWritableFieldEntries(input).map(({ paramKey, field }) =>
    buildFieldSemanticEntry({
      paramKey,
      field,
      capability: input.capability,
    }),
  );
}

function buildWritableFieldEntries(input: {
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
}): Array<{ paramKey: string; field?: ShadowStandardizedField }> {
  const entries: Array<{ paramKey: string; field?: ShadowStandardizedField }> = [];
  const seen = new Set<string>();
  const addEntry = (paramKey: string, field?: ShadowStandardizedField): void => {
    const key = paramKey.trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({
      paramKey: key,
      ...(field ? { field } : {}),
    });
  };

  for (const paramKey of input.capability.previewInputPolicy?.writableParams ?? []) {
    addEntry(paramKey, findFieldByParamKey(paramKey, input.fields));
  }
  for (const field of input.fields) {
    if (!isMetadataPromptableWriteField(field)) {
      continue;
    }
    addEntry(field.writeParameterKey?.trim() || field.fieldCode, field);
  }

  return entries;
}

function isMetadataPromptableWriteField(field: ShadowStandardizedField): boolean {
  const paramKey = field.writeParameterKey?.trim() || field.fieldCode?.trim();
  if (!paramKey || field.readOnly || field.edit === false) {
    return false;
  }
  return field.writePolicy === 'promptable';
}

function buildFieldSemanticEntry(input: {
  paramKey: string;
  field?: ShadowStandardizedField;
  capability: RecordToolCapability;
}): FieldSemanticEntry {
  const targetModelName = input.field?.relationBinding?.modelName?.trim();
  const relationAliases = input.field?.widgetType === 'basicDataWidget' && targetModelName
    ? [
        targetModelName,
        `关联${targetModelName}`,
        `绑定${targetModelName}`,
        `选择${targetModelName}`,
        `所属${targetModelName}`,
        `${targetModelName}信息`,
        `${targetModelName}名称`,
        `${targetModelName}编号`,
      ]
    : [];
  const candidates = [
    input.capability.fieldLabels?.[input.paramKey],
    input.field?.label,
    input.field?.writeParameterKey,
    input.field?.searchParameterKey,
    input.field?.semanticSlot,
    input.paramKey,
    ...relationAliases,
  ].filter((item): item is string => Boolean(item?.trim()));
  const aliases = Array.from(
    new Set(
      candidates
        .flatMap((label) => [label, ...buildShortLabelVariants(label)])
        .map((label) => label.trim())
        .filter((label) => label.length >= 2 && !isAmbiguousFieldAlias(label, input.field)),
    ),
  ).sort((left, right) => right.length - left.length);
  return {
    paramKey: input.paramKey,
    ...(input.field ? { field: input.field } : {}),
    aliases,
    isReference: input.field?.widgetType === 'basicDataWidget',
    ...(targetModelName ? { targetModelName } : {}),
  };
}

function isAmbiguousFieldAlias(alias: string, field?: ShadowStandardizedField): boolean {
  if (alias === '信息') {
    return true;
  }
  if (field?.widgetType === 'basicDataWidget' && ['名称', '编号'].includes(alias)) {
    return true;
  }
  return false;
}

function findExplicitWriteFieldIntent(input: {
  query: string;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
  referenceOnly?: boolean;
  allowValueless?: boolean;
}): ExplicitWriteFieldIntent | null {
  const entries = buildFieldSemanticCatalog({
    capability: input.capability,
    fields: input.fields,
  }).filter((entry) => !input.referenceOnly || entry.isReference);
  for (const entry of entries) {
    const value = matchExplicitWriteFieldValue(input.query, entry, input.capability);
    if (value !== undefined) {
      return {
        paramKey: entry.paramKey,
        alias: findMatchedFieldAlias(input.query, entry) ?? entry.aliases[0] ?? entry.paramKey,
        value,
        hasValue: true,
        isReference: entry.isReference,
        ...(entry.field ? { field: entry.field } : {}),
      };
    }
  }
  if (!input.allowValueless) {
    return null;
  }
  for (const entry of entries) {
    const alias = findValuelessFieldIntentAlias(input.query, entry);
    if (alias) {
      return {
        paramKey: entry.paramKey,
        alias,
        hasValue: false,
        isReference: entry.isReference,
        ...(entry.field ? { field: entry.field } : {}),
      };
    }
  }
  return null;
}

function matchExplicitWriteFieldValue(
  query: string,
  entry: FieldSemanticEntry,
  capability: RecordToolCapability,
): string | undefined {
  for (const alias of entry.aliases) {
    if (!entry.isReference) {
      continue;
    }
    const escaped = escapeRegExp(alias);
    const matched = query.match(new RegExp(`(?:关联|绑定|选择)\\s*([^，。；;\\n]+?)\\s*的?\\s*${escaped}(?:$|[，。；;\\n])`));
    const value = matched?.[1]?.trim();
    if (value) {
      return trimValueBeforeKnownLabels(value, capability, entry.paramKey);
    }
  }

  for (const alias of entry.aliases) {
    if (entry.targetModelName && alias === entry.targetModelName) {
      continue;
    }
    const escaped = escapeRegExp(alias);
    const patterns = [
      new RegExp(`${escaped}\\s*(?:改成|改为|更新为|调整为|设置为|设为|变更为|变为|为|是|=|：|:)\\s*([^，。；;\\n]+)`),
      new RegExp(`(?:更新|修改|变更|调整|设置|改)\\s*(?:这个|该|当前)?[^，。；;\\n]{0,12}?${escaped}\\s*[，,]\\s*([^，。；;\\n]+)`),
      new RegExp(`(?:更新|修改|变更|调整|设置|改|关联|绑定|选择)\\s*(?:这个|该|当前)?[^，。；;\\n]{0,12}?${escaped}\\s*(?:到|至|成|为)?\\s*([^，。；;\\n]+)`),
    ];
    for (const pattern of patterns) {
      const matched = query.match(pattern);
      const value = matched?.[1]?.trim();
      if (value) {
        return trimValueBeforeKnownLabels(value, capability, entry.paramKey);
      }
    }
  }
  return undefined;
}

function findMatchedFieldAlias(query: string, entry: FieldSemanticEntry): string | undefined {
  return entry.aliases.find((alias) => query.includes(alias));
}

function findValuelessFieldIntentAlias(query: string, entry: FieldSemanticEntry): string {
  for (const alias of entry.aliases) {
    if (entry.targetModelName && alias === entry.targetModelName) {
      continue;
    }
    const escaped = escapeRegExp(alias);
    if (new RegExp(`(?:更新|修改|变更|调整|设置|改|关联|绑定|选择)\\s*(?:这个|该|当前)?[^，。；;\\n]{0,12}?${escaped}(?:$|[，。；;\\n])`).test(query)) {
      return alias;
    }
  }
  return '';
}

function normalizeExplicitWriteValue(rawValue: string, field?: ShadowStandardizedField): unknown {
  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }
  if (!field) {
    return value;
  }
  const option = field.options?.length ? resolveFieldOptionFromText(value, field) : undefined;
  if (option) {
    return normalizeOptionHintValue(field, option);
  }
  if (field.widgetType === 'switchWidget') {
    const switchValue = normalizeSwitchDisplayInput(value);
    if (switchValue !== null) {
      return switchValue ? '1' : '0';
    }
  }
  if (field.widgetType === 'numberWidget' || field.widgetType === 'moneyWidget') {
    return parseNumericWriteValue(value);
  }
  return value;
}

function resolveFieldOptionFromText(
  value: string,
  field: ShadowStandardizedField,
): ShadowStandardizedField['options'][number] | undefined {
  const comparable = normalizeDisplayComparable(value);
  return field.options.find((option) => {
    const values = [option.title, option.value, option.key, option.dicId, ...(option.aliases ?? [])]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return values.some((item) => normalizeDisplayComparable(item) === comparable);
  });
}

function parseNumericWriteValue(value: string): number | string {
  const normalized = value.replace(/[,\s，人民币元]/g, '');
  const matched = normalized.match(/(-?\d+(?:\.\d+)?)/);
  if (!matched) {
    return value;
  }
  const base = Number.parseFloat(matched[1]);
  if (!Number.isFinite(base)) {
    return value;
  }
  const multiplier = normalized.includes('亿')
    ? 100_000_000
    : normalized.includes('万')
      ? 10_000
      : 1;
  const result = base * multiplier;
  return Number.isInteger(result) ? result : Number(result.toFixed(2));
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
    .replace(new RegExp(`^(?:${labelPattern})\\s*(?:为|是|=|：|:).*$`), '')
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
    label.includes('预算') ? '预算' : '',
    label.includes('销售阶段') ? '阶段' : '',
    label.includes('预计成交时间') ? '成交时间' : '',
    label.replace(/^(?:商机|机会|客户|联系人)/, ''),
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
  if (isBareRecordWriteCommand(withoutSlash, labels)) {
    return '';
  }
  const commandStripped = stripRecordWriteCommandPrefix(withoutSlash, labels);
  if (commandStripped && commandStripped !== withoutSlash) {
    const candidate = cleanupCompanyName(commandStripped);
    return isMeaningfulRecordNameCandidate(candidate, objectKey) ? candidate : '';
  }
  const pattern = new RegExp(`(?:录入|创建|新增|新建|补录|查询|查一下|找一下|搜索)?(?:一个|这?个)?(?:${labels})?[，,：:\\s]*([^，。！？\\n]+)`);
  const matched = withoutSlash.match(pattern)?.[1] ?? '';
  const candidate = cleanupCompanyName(matched) || cleanupCompanyName(withoutSlash);
  return isMeaningfulRecordNameCandidate(candidate, objectKey) ? candidate : '';
}

function isBareRecordWriteCommand(query: string, labels: string): boolean {
  const operation = '录入|创建|新增|新建|补录|写入|添加|建立';
  return new RegExp(`^(?:帮我|请|麻烦)?\\s*(?:${operation})\\s*(?:一个|一条|一位|一名|这?个)?\\s*(?:${labels})\\s*$`).test(query);
}

function stripRecordWriteCommandPrefix(query: string, labels: string): string {
  const operation = '录入|创建|新增|新建|补录|写入|添加|建立';
  return query
    .replace(new RegExp(`^(?:帮我|请|麻烦)?\\s*(?:${operation})\\s*(?:一个|一条|一位|一名|这?个)?\\s*(?:${labels})\\s*[，,：:\\s]*`), '')
    .trim();
}

function extractFormInstId(query: string): string | undefined {
  return query.match(/formInstId[:：=]?\s*([A-Za-z0-9_-]+)/)?.[1];
}

function isArtifactFollowupQuestion(input: AgentPlannerInput): boolean {
  const query = input.request.query;
  const normalized = query.trim();
  const startsNewResearch = /^(?:研究|分析一下|分析|公司分析|公司研究|客户分析|\/公司研究|\/客户分析)/.test(normalized);
  const startsRecordTask = /^(?:新增|新建|创建|录入|写入|补录|更新|修改|删除|查询|查一下|查|搜索|找一下|查看|打开|看下|帮我查|帮我搜)/.test(normalized);
  const hasContextEvidence = Boolean(
    input.resolvedContext?.usedContext
    || input.contextFrame?.subject
    || input.focusedName
  );
  return hasContextEvidence
    && isExternalInfoConsumptionQuery(normalized)
    && !startsNewResearch
    && !startsRecordTask
    && !isInternalRecordsConsumptionQuery(normalized)
    && !inferExplicitRecordObject(normalized);
}

function resolveArtifactAnchorName(input: AgentPlannerInput): string | undefined {
  const resolvedName = input.resolvedContext?.usedContext ? input.resolvedContext.subject?.name : undefined;
  if (resolvedName) {
    return resolvedName;
  }
  const targetName = input.intentFrame.target.name;
  if (targetName && input.intentFrame.target.kind !== 'unknown') {
    return targetName;
  }
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
  if ((request.attachments ?? []).some((item) => item.type.includes('audio') || item.name.match(/\.(mp3|m4a|wav)$/i))) {
    return true;
  }
  const normalized = request.query.replace(/\s+/g, '').trim();
  return /(?:上传|处理|解析|转写|导入|整理).{0,8}(?:录音|音频)|(?:录音|音频)(?:文件)?(?:上传|处理|解析|转写|导入)|这段(?:拜访)?录音/.test(normalized);
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

  if (selectedTool.toolCode === RECORDING_MATERIAL_TOOL) {
    return {
      planId,
      kind: 'recording_material',
      title: '录音资料包处理计划',
      status: 'running',
      steps: [
        step('create-recording-task', '创建录音处理任务', 'query', [selectedTool.toolCode], 'pending'),
        step('materialize-recording', '生成可消费录音资料包', 'query', [selectedTool.toolCode], 'pending'),
        step('continue-actions', '等待用户选择继续使用动作', 'meta', ['meta.candidate_selection'], 'pending'),
      ],
      evidenceRequired: true,
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

  const extractionIssue = operation === 'search'
    ? readSearchExtractionIssue(readRecordAgentControl(input.selectedTool.input))
    : null;
  if (extractionIssue) {
    finishToolCall(toolCall, 'skipped', extractionIssue.headline);
    return {
      status: 'waiting_input',
      content: extractionIssue.content,
      headline: extractionIssue.headline,
      references: ['meta.clarify_card'],
      toolCalls: [toolCall],
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'record.search_condition_extraction',
          action: 'clarify',
          toolCode: input.selectedTool.toolCode,
          reason: extractionIssue.reason,
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
    const presentation = buildRecordReadPresentation({
      runId: context.runId,
      toolCode: input.selectedTool.toolCode,
      objectKey,
      operation,
      result: result as ShadowExecuteSearchResponse | ShadowExecuteGetResponse,
      capability: CRM_RECORD_CAPABILITIES[objectKey],
      queryText: input.request.query,
      searchInput: operation === 'search'
        ? {
            ...selectedInput,
            operatorOpenId: context.operatorOpenId ?? undefined,
          } as ShadowPreviewSearchInput
        : undefined,
    });

    return {
      status: 'completed',
      content: presentation.content,
      headline: '记录对象读取完成',
      references: [input.selectedTool.toolCode],
      uiSurfaces: [presentation.uiSurface],
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

type RecordResultFieldView = AgentRecordResultFieldView;
type RecordResultRecordView = AgentRecordResultRecordView;
type RecordResultViewModel = AgentRecordResultViewModel;

function buildRecordReadPresentation(input: {
  runId: string;
  toolCode: string;
  objectKey: ShadowObjectKey;
  operation: 'search' | 'get';
  result: ShadowExecuteSearchResponse | ShadowExecuteGetResponse;
  capability: RecordToolCapability;
  queryText?: string;
  searchInput?: ShadowPreviewSearchInput;
}): {
  content: string;
  uiSurface: AgentUiSurface;
} {
  const view = buildRecordResultViewModel(input);
  const surfaceId = `record-${input.operation}-${input.runId}-${randomUUID().slice(0, 8)}`;
  const pagination = input.operation === 'search' && input.searchInput
    ? buildRecordSearchPageQuery({
        objectKey: input.objectKey,
        toolCode: input.toolCode,
        searchInput: input.searchInput,
        queryText: input.queryText,
      })
    : undefined;
  const viewWithPagination = pagination ? { ...view, pagination } : view;
  const component = view.displayMode === 'empty'
    ? 'RecordResultEmpty'
    : view.displayMode === 'list'
      ? 'RecordResultList'
      : 'RecordResultCard';
  const uiSurface: AgentUiSurface = {
    kind: input.operation === 'search' ? 'record-search-results' : 'record-detail',
    protocol: 'a2ui',
    version: 'v0.9',
    surfaceId,
    catalogId: RECORD_RESULT_A2UI_CATALOG_ID,
    commands: [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId,
          catalogId: RECORD_RESULT_A2UI_CATALOG_ID,
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId,
          path: '/recordResult',
          value: viewWithPagination,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId,
          components: [
            {
              id: 'root',
              component,
              result: { path: '/recordResult' },
            },
          ],
        },
      },
    ],
    summary: {
      objectKey: input.objectKey,
      operation: input.operation,
      total: view.total,
      pageNumber: view.pageNumber,
      pageSize: view.pageSize,
      totalPages: view.totalPages,
      returnedCount: view.returnedCount,
      displayMode: view.displayMode,
    },
    ...(pagination ? { pagination } : {}),
    rawResult: input.result,
  };

  return {
    content: buildRecordReadContent(view),
    uiSurface,
  };
}

function buildRecordSearchPageQuery(input: {
  objectKey: ShadowObjectKey;
  toolCode: string;
  searchInput: ShadowPreviewSearchInput;
  queryText?: string;
}): AgentRecordSearchPageQuery {
  return {
    endpoint: RECORD_RESULT_PAGE_ENDPOINT,
    request: {
      objectKey: input.objectKey,
      toolCode: input.toolCode,
      ...(input.queryText ? { queryText: input.queryText } : {}),
      searchInput: {
        ...input.searchInput,
      },
    },
  };
}

export async function buildRecordSearchPageResponse(input: {
  shadowMetadataService: ShadowMetadataService;
  request: AgentRecordSearchPageRequest;
}): Promise<AgentRecordSearchPageResponse> {
  const objectKey = input.request.objectKey;
  const toolCode = input.request.toolCode || `record.${objectKey}.search`;
  const searchInput = {
    ...input.request.searchInput,
  };
  const result = await input.shadowMetadataService.executeSearch(objectKey, searchInput);
  const pagination = buildRecordSearchPageQuery({
    objectKey,
    toolCode,
    searchInput,
    queryText: input.request.queryText,
  });
  const view = buildRecordResultViewModel({
    toolCode,
    objectKey,
    operation: 'search',
    result,
    capability: CRM_RECORD_CAPABILITIES[objectKey],
    queryText: input.request.queryText,
  });

  return {
    result: {
      ...view,
      pagination,
    },
    rawResult: result,
  };
}

export async function buildMetaQuestionOptionsResponse(input: {
  config: AppConfig;
  shadowMetadataService: ShadowMetadataService;
  orgSyncRepository?: Pick<OrgSyncRepository, 'findEmployees'>;
  request: AgentMetaQuestionOptionsRequest;
}): Promise<AgentMetaQuestionOptionsResponse> {
  const pageSize = clampMetaQuestionPageSize(input.request.pageSize);
  const keyword = input.request.keyword.trim();
  if (!keyword) {
    return { options: [] };
  }

  const context = resolveMetaQuestionFieldContext({
    shadowMetadataService: input.shadowMetadataService,
    toolCode: input.request.toolCode,
    paramKey: input.request.paramKey,
  });
  if (!context) {
    return { options: [] };
  }

  if (context.field.widgetType === 'personSelectWidget') {
    return {
      options: buildEmployeeOptionHints(
        await input.orgSyncRepository?.findEmployees({
          eid: input.config.yzj.eid,
          appId: input.config.yzj.appId,
          keyword,
          limit: pageSize,
        }) ?? [],
      ),
    };
  }

  if (context.field.widgetType === 'basicDataWidget') {
    const targetObjectKey = resolveRelationTargetObjectKey(input.shadowMetadataService, context.field);
    if (!targetObjectKey || !input.request.tenantContext?.operatorOpenId?.trim()) {
      return { options: [] };
    }
    return {
      options: await buildRecordLookupOptionHints({
        shadowMetadataService: input.shadowMetadataService,
        objectKey: targetObjectKey,
        keyword,
        pageSize,
        operatorOpenId: input.request.tenantContext.operatorOpenId.trim(),
      }),
    };
  }

  return { options: [] };
}

function resolveMetaQuestionFieldContext(input: {
  shadowMetadataService: ShadowMetadataService;
  toolCode: string;
  paramKey: string;
}): {
  objectKey: ShadowObjectKey;
  field: ShadowStandardizedField;
} | null {
  const objectKey = parseRecordObjectKeyFromToolCode(input.toolCode);
  if (!objectKey) {
    return null;
  }
  const field = findFieldByParamKey(input.paramKey, readRecordFields({
    shadowMetadataService: input.shadowMetadataService,
  }, objectKey));
  return field ? { objectKey, field } : null;
}

function parseRecordObjectKeyFromToolCode(toolCode: string): ShadowObjectKey | null {
  const matched = toolCode.match(/^record\.(customer|contact|opportunity|followup)\./);
  const objectKey = matched?.[1] as ShadowObjectKey | undefined;
  return objectKey && CRM_RECORD_OBJECTS.includes(objectKey) ? objectKey : null;
}

function clampMetaQuestionPageSize(pageSize: unknown): number {
  const parsed = typeof pageSize === 'number' ? pageSize : Number(pageSize);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_META_QUESTION_OPTION_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 20);
}

function buildEmployeeOptionHints(candidates: OrgEmployeeCandidate[]): FieldOptionHint[] {
  return candidates.map((candidate) => ({
    label: formatEmployeeCandidateLabel(candidate),
    value: candidate.openId,
    key: candidate.openId,
    description: candidate.jobTitle ?? undefined,
    source: 'employee' as const,
  }));
}

async function buildRecordLookupOptionHints(input: {
  shadowMetadataService: ShadowMetadataService;
  objectKey: ShadowObjectKey;
  keyword: string;
  pageSize: number;
  operatorOpenId: string;
}): Promise<FieldOptionHint[]> {
  const fields = readRecordFields({
    shadowMetadataService: input.shadowMetadataService,
  }, input.objectKey);
  const capability = CRM_RECORD_CAPABILITIES[input.objectKey];
  const identityField = capability.identityFields?.[0] ?? inferRecordNameParam(input.objectKey);
  const searchInputs = dedupeRecordLookupSearchInputs([
    {
      ...buildRecordSearchInput({
        query: input.keyword,
        objectKey: input.objectKey,
        capability,
        identityField,
        fields,
        boundFilters: [],
        operatorOpenId: input.operatorOpenId,
      }),
      pageNumber: 1,
      pageSize: input.pageSize,
    } as ShadowPreviewSearchInput,
    {
      filters: [
        {
          field: identityField,
          value: input.keyword,
          operator: 'like',
        },
      ],
      operatorOpenId: input.operatorOpenId,
      pageNumber: 1,
      pageSize: input.pageSize,
    },
  ]);
  const records: ShadowLiveRecord[] = [];
  const seen = new Set<string>();
  for (const searchInput of searchInputs) {
    const result = await input.shadowMetadataService.executeSearch(input.objectKey, searchInput);
    for (const record of result.records ?? []) {
      if (!record.formInstId || seen.has(record.formInstId)) {
        continue;
      }
      seen.add(record.formInstId);
      records.push(record);
      if (records.length >= input.pageSize) {
        break;
      }
    }
    if (records.length >= input.pageSize) {
      break;
    }
  }
  return records.map((record) => {
    const view = buildRecordResultRecordView({
      objectKey: input.objectKey,
      record,
      capability,
    });
    const description = [
      view.subtitle,
      ...view.primaryFields.slice(0, 3).map((field) => `${field.label}：${field.value}`),
    ].filter(Boolean).join(' · ');
    return {
      label: view.title,
      value: view.formInstId,
      key: view.formInstId,
      ...(description ? { description } : {}),
      source: 'record' as const,
    };
  });
}

function dedupeRecordLookupSearchInputs(inputs: ShadowPreviewSearchInput[]): ShadowPreviewSearchInput[] {
  const seen = new Set<string>();
  const output: ShadowPreviewSearchInput[] = [];
  for (const input of inputs) {
    const { agentControl: _agentControl, ...cleanInput } = input as ShadowPreviewSearchInput & { agentControl?: unknown };
    const fingerprint = JSON.stringify({
      filters: cleanInput.filters ?? [],
      operatorOpenId: cleanInput.operatorOpenId ?? '',
      pageNumber: cleanInput.pageNumber ?? 1,
      pageSize: cleanInput.pageSize ?? DEFAULT_META_QUESTION_OPTION_PAGE_SIZE,
    });
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    output.push(cleanInput);
  }
  return output;
}

function buildRecordResultViewModel(input: {
  toolCode: string;
  objectKey: ShadowObjectKey;
  operation: 'search' | 'get';
  result: ShadowExecuteSearchResponse | ShadowExecuteGetResponse;
  capability: RecordToolCapability;
  queryText?: string;
}): RecordResultViewModel {
  const records = input.operation === 'search'
    ? (input.result as ShadowExecuteSearchResponse).records
    : [(input.result as ShadowExecuteGetResponse).record].filter(Boolean);
  const total = input.operation === 'search'
    ? (input.result as ShadowExecuteSearchResponse).totalElements ?? records.length
    : records.length;
  const pageNumber = input.operation === 'search'
    ? (input.result as ShadowExecuteSearchResponse).pageNumber ?? 1
    : 1;
  const pageSize = input.operation === 'search'
    ? (input.result as ShadowExecuteSearchResponse).pageSize ?? records.length
    : records.length;
  const totalPages = input.operation === 'search'
    ? (input.result as ShadowExecuteSearchResponse).totalPages ?? Math.max(1, Math.ceil(total / Math.max(pageSize, 1)))
    : 1;
  const mappedRecords = records.map((record) =>
    buildRecordResultRecordView({
      objectKey: input.objectKey,
      record,
      capability: input.capability,
      fallbackTitle: records.length === 1
        ? readRecordQueryDisplayFallbackName(input.queryText, input.objectKey)
        : undefined,
    }),
  );
  const objectLabel = mapRecordObjectLabel(input.objectKey);
  const displayMode = mappedRecords.length === 0
    ? 'empty'
    : input.operation === 'get' || total === 1
      ? 'card'
      : 'list';

  return {
    objectKey: input.objectKey,
    operation: input.operation,
    toolCode: input.toolCode,
    title: displayMode === 'empty'
      ? `未查询到${objectLabel}`
      : input.operation === 'get'
        ? `${objectLabel}详情`
        : `查询到 ${total} 个${objectLabel}`,
    total,
    pageNumber,
    pageSize,
    totalPages,
    returnedCount: mappedRecords.length,
    ...(input.queryText ? { queryText: input.queryText } : {}),
    displayMode,
    records: mappedRecords,
    ...(displayMode === 'card' ? { record: mappedRecords[0] } : {}),
  };
}

function buildRecordResultRecordView(input: {
  objectKey: ShadowObjectKey;
  record: ShadowLiveRecord;
  capability: RecordToolCapability;
  fallbackTitle?: string;
}): RecordResultRecordView {
  const record = input.record;
  const title = readLiveRecordDisplayName(record, input.capability) || input.fallbackTitle || `${mapRecordObjectLabel(input.objectKey)}记录`;
  const primaryFields = buildRecordResultFields(record, getPrimaryRecordFieldTitles(input.objectKey));
  const relationFields = buildRecordResultFields(record, getRelationRecordFieldTitles(input.objectKey));
  const usedLabels = new Set(primaryFields.map((field) => field.label));
  const secondaryFields = [
    ...(record.fields ?? []).map((field) => ({
      label: field.title ?? field.codeId,
      value: stringifyRecordDisplayCandidate(field.value ?? field.rawValue, record.formInstId),
    })),
    ...readImportantRecordFields(record),
  ]
    .filter((field) => field.label && field.value && field.value !== title && !usedLabels.has(field.label))
    .slice(0, 8);
  const tags = buildRecordResultTags(record, input.objectKey);
  const subtitle = buildRecordResultSubtitle(record, input.objectKey);

  return {
    formInstId: record.formInstId,
    title,
    ...(subtitle ? { subtitle } : {}),
    tags,
    relationFields,
    primaryFields,
    secondaryFields,
  };
}

function buildRecordResultFields(record: ShadowLiveRecord, orderedTitles: string[]): RecordResultFieldView[] {
  const fields: RecordResultFieldView[] = [];
  for (const title of orderedTitles) {
    const value = readFieldByTitles(record, [title]);
    if (value) {
      fields.push({ label: title, value });
    }
  }
  return dedupeRecordResultFields(fields).slice(0, 10);
}

function dedupeRecordResultFields(fields: RecordResultFieldView[]): RecordResultFieldView[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.label}:${field.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildRecordResultTags(record: ShadowLiveRecord, objectKey: ShadowObjectKey): string[] {
  const candidates = objectKey === 'customer'
    ? ['客户状态', '客户类型', '启用状态', '行业']
    : objectKey === 'opportunity'
      ? ['销售阶段', '商机状态']
      : objectKey === 'contact'
        ? ['启用状态']
        : ['跟进方式'];
  return candidates
    .map((title) => readFieldByTitles(record, [title]))
    .filter(Boolean)
    .slice(0, 4);
}

function buildRecordResultSubtitle(record: ShadowLiveRecord, objectKey: ShadowObjectKey): string {
  const region = [readFieldByTitles(record, ['省']), readFieldByTitles(record, ['市']), readFieldByTitles(record, ['区'])]
    .filter(Boolean)
    .join(' / ');
  const relation = readFieldByTitles(record, getRelationRecordFieldTitles(objectKey));
  if (objectKey === 'customer') {
    return region;
  }
  if (objectKey === 'contact') {
    return [relation, region].filter(Boolean).join(' / ');
  }
  if (objectKey === 'opportunity') {
    return relation || readFieldByTitles(record, ['预计成交时间']);
  }
  return readFieldByTitles(record, ['跟进时间', '拜访时间']) || relation;
}

function getPrimaryRecordFieldTitles(objectKey: ShadowObjectKey): string[] {
  if (objectKey === 'customer') {
    return ['客户状态', '客户类型', '启用状态', '行业', '省', '市', '区', '联系人姓名', '联系人手机', '公司电话', '办公电话', '负责人', '销售负责人', '售后服务代表'];
  }
  if (objectKey === 'contact') {
    return ['联系人姓名', '手机', '启用状态', ...getRelationRecordFieldTitles(objectKey), '省', '市', '区', '办公电话'];
  }
  if (objectKey === 'opportunity') {
    return ['机会名称', '商机名称', ...getRelationRecordFieldTitles(objectKey), '销售阶段', '预计成交时间', '商机预算（元）', '负责人'];
  }
  return ['跟进记录', ...getRelationRecordFieldTitles(objectKey), '跟进方式', '跟进时间', '下次回访日期', '负责人', '跟进负责人'];
}

function getRelationRecordFieldTitles(objectKey: ShadowObjectKey): string[] {
  const customerRelationTitles = ['关联客户', '客户编号', '客户名称', '所属客户', '绑定客户', '选择客户', '客户'];
  if (objectKey === 'contact') {
    return customerRelationTitles;
  }
  if (objectKey === 'opportunity') {
    return [
      ...customerRelationTitles,
      '关联联系人',
      '联系人',
      '联系人姓名',
      '联系人编号',
    ];
  }
  if (objectKey === 'followup') {
    return [
      ...customerRelationTitles,
      '关联商机',
      '商机',
      '商机名称',
      '商机编号',
      '关联联系人',
      '联系人',
      '联系人姓名',
      '联系人编号',
    ];
  }
  return [];
}

function buildRecordReadContent(view: RecordResultViewModel): string {
  const objectLabel = mapRecordObjectLabel(view.objectKey);
  if (view.displayMode === 'empty') {
    return `未查询到符合条件的${objectLabel}。`;
  }
  if (view.displayMode === 'list') {
    return `已查询到 ${view.total} 个${objectLabel}，请在下方列表查看。`;
  }
  const title = view.record?.title ? `：${view.record.title}` : '';
  return `已查询到${objectLabel}${title}，请在下方卡片查看。`;
}

function mapRecordObjectLabel(objectKey: ShadowObjectKey): string {
  switch (objectKey) {
    case 'contact':
      return '联系人';
    case 'opportunity':
      return '商机';
    case 'followup':
      return '跟进记录';
    default:
      return '客户';
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
      aliases: ['/公司研究', '公司研究', '进行公司研究', '外部公司研究', '重新研究', '重新进行公司研究'],
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
              .map((record) => readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.customer) ?? '客户记录')
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
          : '未查到已有客户，外部公司研究会生成新的公司研究资料。',
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
      return null;
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
  important?: Record<string, unknown>;
  fields?: Array<{ codeId?: string | null; title?: string | null; value?: unknown; rawValue?: unknown }>;
  rawRecord?: Record<string, unknown>;
}, capability: RecordToolCapability): string | undefined {
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const formInstId = typeof record.formInstId === 'string' ? record.formInstId.trim() : '';
  const preferredTitles = new Set(
    (capability.identityFields ?? [])
      .flatMap((paramKey) => [capability.fieldLabels?.[paramKey], capability.fieldLabels?._S_NAME, capability.fieldLabels?._S_TITLE])
      .filter((item): item is string => Boolean(item?.trim())),
  );

  for (const field of fields) {
    const isPreferredField =
      Boolean(field?.title && preferredTitles.has(field.title))
      || field?.codeId === '_S_NAME'
      || field?.codeId === '_S_TITLE';
    if (!isPreferredField) {
      continue;
    }
    const value = stringifyRecordDisplayCandidate(field.value ?? field.rawValue, formInstId);
    if (value) {
      return value;
    }
  }

  const important = isRecordLike(record.important) ? record.important : null;
  const rawImportant = isRecordLike(record.rawRecord?.important) ? record.rawRecord.important : null;
  const importantKeys = [
    ...preferredTitles,
    '客户名称',
    '联系人姓名',
    '机会名称',
    '商机名称',
    '跟进记录',
    '标题',
    '_S_NAME',
    '_S_TITLE',
    'showName',
    'displayName',
    'title',
    'name',
    '_name_',
  ];

  for (const source of [important, rawImportant, record.rawRecord]) {
    if (!source) {
      continue;
    }
    for (const key of importantKeys) {
      const value = stringifyRecordDisplayCandidate(source[key], formInstId);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

function readRecordQueryDisplayFallbackName(query: string | undefined, objectKey: ShadowObjectKey): string | undefined {
  if (!query?.trim()) {
    return undefined;
  }
  const objectLabels = objectKey === 'customer'
    ? '(?:客户|公司)'
    : objectKey === 'contact'
      ? '(?:联系人|人员)'
      : objectKey === 'opportunity'
        ? '(?:商机|机会)'
        : '(?:跟进记录|拜访记录|回访记录|跟进|拜访|回访)';
  const cleaned = query
    .trim()
    .replace(/^\/\S+\s*/, '')
    .replace(/^(?:查询|查一下|查|搜索|找一下|查看|看下|打开|帮我查|帮我搜)\s*/, '')
    .replace(new RegExp(`^${objectLabels}\\s*[：:,，]?\\s*`), '')
    .replace(/(?:客户情况|客户状态|客户处于什么状态|客户是什么状态|详情|信息|资料|列表|结果)$/g, '')
    .replace(/^[：:，。！？、\s]+/g, '')
    .replace(/[：:，。！？、\s]+$/g, '')
    .trim();
  const value = objectKey === 'customer' ? cleanupCustomerRecordLookupName(cleaned) : cleaned;
  return isUsableCompanyName(value) && !isLikelyInternalRecordIdentifier(value)
    ? value
    : undefined;
}

function stringifyRecordDisplayCandidate(value: unknown, formInstId?: string): string {
  const candidate = sanitizeRecordDisplayText(stringifyPreviewValue(value).trim());
  return candidate && !isLikelyInternalRecordIdentifier(candidate, formInstId)
    ? candidate
    : '';
}

function sanitizeRecordDisplayText(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(
    /((?:负责人|销售负责人|所有者|所属人|跟进人|跟进负责人|服务代表|售后服务代表|申请人|创建人|openId|open_id)\s*[：:]\s*)[0-9a-f]{16,64}/gi,
    '$1已绑定人员',
  );
}

function isLikelyInternalRecordIdentifier(value: string, formInstId?: string): boolean {
  const normalized = value.replace(/\s+/g, '').trim();
  if (!normalized) {
    return false;
  }
  if (formInstId && normalized === formInstId.replace(/\s+/g, '').trim()) {
    return true;
  }
  return /^[0-9a-f]{16,64}$/i.test(normalized)
    || /^(?:customer|contact|opportunity|followup|form|record)[-_][A-Za-z0-9_-]+$/i.test(normalized);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const IMPORTANT_FIELD_ALIASES: Record<string, string[]> = {
  客户名称: ['客户名称', '客户名', '公司名称', '公司名', '名称', '_S_NAME'],
  联系人姓名: ['联系人姓名', '联系人', '姓名', '_S_NAME'],
  机会名称: ['机会名称', '商机名称', '名称', '_S_NAME'],
  商机名称: ['商机名称', '机会名称', '名称', '_S_NAME'],
  跟进记录: ['跟进记录', '拜访记录', '回访记录'],
  客户状态: ['客户状态', '状态'],
  客户类型: ['客户类型', '类型'],
  启用状态: ['启用状态', '状态'],
  行业: ['行业', '所属行业'],
  省: ['省', '省份', '所在省', '所属省份'],
  市: ['市', '城市', '所在市', '所在城市'],
  区: ['区', '区县', '县区', '所在区'],
  联系人手机: ['联系人手机', '手机', '手机号', '联系电话'],
  手机: ['手机', '手机号', '联系人手机', '联系电话'],
  公司电话: ['公司电话', '企业电话', '电话'],
  办公电话: ['办公电话', '座机', '电话'],
  负责人: ['负责人', '销售负责人', '所有者', 'ownerName'],
  销售负责人: ['销售负责人', '负责人', '所有者', 'ownerName'],
  售后服务代表: ['售后服务代表', '服务代表'],
  销售阶段: ['销售阶段', '商机阶段', '阶段'],
  商机状态: ['商机状态', '状态'],
  预计成交时间: ['预计成交时间', '预计成交日期'],
  '商机预算（元）': ['商机预算（元）', '商机预算', '预算'],
  跟进方式: ['跟进方式', '拜访方式'],
  跟进时间: ['跟进时间', '拜访时间', '回访时间'],
  下次回访日期: ['下次回访日期', '下次跟进日期'],
  跟进负责人: ['跟进负责人', '负责人'],
};

function readImportantRecordFields(record: {
  formInstId?: string;
  important?: Record<string, unknown>;
  rawRecord?: Record<string, unknown>;
}): RecordResultFieldView[] {
  const fields: RecordResultFieldView[] = [];
  const seen = new Set<string>();
  for (const source of readImportantSources(record)) {
    for (const [label, rawValue] of Object.entries(source)) {
      if (!label || isInternalRecordIdentityParam(label) || /^(?:id|_id_|formInstId|form_inst_id)$/i.test(label)) {
        continue;
      }
      const value = stringifyRecordDisplayCandidate(rawValue, record.formInstId);
      if (!value) {
        continue;
      }
      const key = `${label}:${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fields.push({ label, value });
    }
  }
  return fields;
}

function readImportantValueByTitles(record: {
  formInstId?: string;
  important?: Record<string, unknown>;
  rawRecord?: Record<string, unknown>;
}, titles: string[]): string {
  const lookupKeys = titles.flatMap((title) => IMPORTANT_FIELD_ALIASES[title] ?? [title]);
  for (const source of [...readImportantSources(record), record.rawRecord].filter(isRecordLike)) {
    for (const key of lookupKeys) {
      const value = stringifyRecordDisplayCandidate(source[key], record.formInstId);
      if (value) {
        return value;
      }
    }
  }
  return '';
}

function readImportantSources(record: {
  important?: Record<string, unknown>;
  rawRecord?: Record<string, unknown>;
}): Array<Record<string, unknown>> {
  return [record.important, record.rawRecord?.important]
    .filter(isRecordLike);
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
  searchExtraction?: {
    conditions?: Array<{
      field?: string;
      label?: string;
      value?: string;
      source?: string;
    }>;
    ambiguities?: Array<{
      value?: string;
      candidateFields?: Array<{ field?: string; label?: string }>;
    }>;
    unresolvedValues?: Array<{
      field?: string;
      label?: string;
      value?: string;
      reason?: string;
    }>;
    fallbackName?: string;
    filterSources?: Array<{
      field?: string;
      value?: string;
      source?: string;
      label?: string;
    }>;
  };
  targetSanitization?: TargetSanitizationTrace;
  choiceRouting?: {
    answerParamKey?: string;
    choices?: Record<string, unknown>;
  };
  source?: {
    kind?: string;
    recordingTaskId?: string;
    artifactId?: string;
    fileName?: string;
    sourceFileMd5?: string;
    anchors?: {
      customer?: string;
      opportunity?: string;
      followup?: string;
    };
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

function hasRecordAgentControlPayload(control: RecordAgentControl): boolean {
  return Boolean(
    control.duplicateCheck
    || control.searchExtraction
    || control.subjectName
    || control.choiceRouting
    || control.targetSanitization
    || control.source,
  );
}

function attachRecordAgentControl(
  input: Record<string, unknown>,
  control: RecordAgentControl,
): Record<string, unknown> {
  if (!hasRecordAgentControlPayload(control)) {
    return input;
  }
  const existingAgentControl = readRecordAgentControl(input);
  return {
    ...input,
    agentControl: {
      ...existingAgentControl,
      ...control,
    },
  };
}

function buildConfirmationRequestInput(
  requestInput: ShadowPreviewUpsertInput,
  agentControl: RecordAgentControl,
): Record<string, unknown> {
  if (!agentControl.source) {
    return requestInput as unknown as Record<string, unknown>;
  }
  return {
    ...(requestInput as unknown as Record<string, unknown>),
    agentControl: {
      source: agentControl.source,
    },
  };
}

function readSearchExtractionIssue(control: RecordAgentControl): {
  headline: string;
  content: string;
  reason: string;
} | null {
  const unresolved = control.searchExtraction?.unresolvedValues?.find((item) => item.field || item.label || item.value);
  if (unresolved) {
    const label = unresolved.label || unresolved.field || '查询字段';
    const value = unresolved.value || '当前值';
    return {
      headline: '需要确认查询条件',
      content: `已识别到字段「${label}」的查询值「${value}」，但该值无法匹配当前字段配置。请改用系统中的有效选项或补充更明确的条件。`,
      reason: unresolved.reason || '字段值无法解析为可执行查询条件。',
    };
  }

  const ambiguity = control.searchExtraction?.ambiguities?.find((item) => item.value && item.candidateFields?.length);
  if (ambiguity) {
    const fields = (ambiguity.candidateFields ?? [])
      .map((field) => field.label || field.field)
      .filter(Boolean)
      .join('、');
    return {
      headline: '需要确认查询字段',
      content: `「${ambiguity.value}」同时命中多个可查询字段：${fields}。请补充字段名称后再查询。`,
      reason: '隐式查询条件命中多个字段，系统不会降级为标题搜索。',
    };
  }

  return null;
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
    const preferredKeys = [
      'showName',
      'displayName',
      'label',
      'title',
      'name',
      '_S_TITLE',
      '_S_NAME',
      'text',
      'value',
      'open_id',
      'openId',
      'formInstId',
      'id',
    ];
    for (const key of preferredKeys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === 'number' || typeof candidate === 'boolean') {
        return String(candidate);
      }
    }
    return JSON.stringify(value);
  }
  return '';
}

function getPersonDisplayName(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return String(record.name ?? record.title ?? record.open_id ?? record.openId ?? '').trim();
  }
  return stringifyPreviewValue(value);
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
  const explicitReferenceIntent = findExplicitWriteFieldIntent({
    query: input.query,
    capability: input.capability,
    fields: input.fields,
    referenceOnly: true,
    allowValueless: true,
  });
  const metadataParams = extractRecordWriteParamsFromQuery({
    query: input.query,
    capability: input.capability,
    fields: input.fields,
    currentParams: params,
  });
  for (const [paramKey, value] of Object.entries(metadataParams)) {
    if (!hasMeaningfulValue(params[paramKey])) {
      params[paramKey] = value;
    }
  }
  if (explicitReferenceIntent) {
    return params;
  }
  for (const { paramKey } of buildWritableFieldEntries({
    capability: input.capability,
    fields: input.fields,
  })) {
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

async function resolvePersonSelectParams(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
}): Promise<PersonResolutionResult> {
  const params = readRequestParams(input.requestInput);
  const nextParams = { ...params };
  const issues: PersonResolutionIssue[] = [];

  for (const { paramKey } of buildWritableFieldEntries({
    capability: input.capability,
    fields: input.fields,
  })) {
    if (!hasMeaningfulValue(nextParams[paramKey])) {
      continue;
    }
    const field = findFieldByParamKey(paramKey, input.fields);
    if (field?.widgetType !== 'personSelectWidget') {
      continue;
    }
    const resolved = await resolvePersonParamValue({
      options: input.options,
      context: input.context,
      paramKey,
      label: getFieldLabel(input.capability, paramKey),
      rawValue: nextParams[paramKey],
    });
    if (resolved.issue) {
      issues.push(resolved.issue);
      continue;
    }
    if (resolved.value !== undefined) {
      nextParams[paramKey] = resolved.value;
    }
  }

  return {
    requestInput: {
      ...input.requestInput,
      params: nextParams,
    },
    issues,
  };
}

async function resolvePersonParamValue(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  paramKey: string;
  label: string;
  rawValue: unknown;
}): Promise<{
  value?: unknown;
  issue?: PersonResolutionIssue;
}> {
  if (Array.isArray(input.rawValue)) {
    const values: unknown[] = [];
    for (const item of input.rawValue) {
      const resolved = await resolveSinglePersonValue({ ...input, rawValue: item });
      if (resolved.issue) {
        return resolved;
      }
      if (resolved.value !== undefined) {
        values.push(resolved.value);
      }
    }
    return { value: values };
  }

  return resolveSinglePersonValue(input);
}

async function resolveSinglePersonValue(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  paramKey: string;
  label: string;
  rawValue: unknown;
}): Promise<{
  value?: unknown;
  issue?: PersonResolutionIssue;
}> {
  const directOpenId = readPersonOpenId(input.rawValue);
  if (directOpenId) {
    const candidate = await findExactEmployeeCandidate(input, directOpenId);
    return {
      value: candidate ? buildPersonParamObject(candidate) : input.rawValue,
    };
  }

  const keyword = typeof input.rawValue === 'string' ? input.rawValue.trim() : '';
  if (!keyword) {
    return { value: input.rawValue };
  }
  const candidates = await input.options.orgSyncRepository?.findEmployees({
    eid: input.context.eid,
    appId: input.context.appId,
    keyword,
    limit: 20,
  }) ?? [];
  const exactIdentifierCandidates = candidates.filter((candidate) => isExactEmployeeIdentifierMatch(candidate, keyword));
  if (exactIdentifierCandidates.length === 1) {
    return { value: buildPersonParamObject(exactIdentifierCandidates[0]!) };
  }
  if (isLikelyOpenId(keyword) && exactIdentifierCandidates.length === 0) {
    return { value: keyword };
  }
  if (candidates.length === 1) {
    return { value: buildPersonParamObject(candidates[0]!) };
  }
  return {
    issue: {
      kind: candidates.length ? 'ambiguous' : 'not_found',
      paramKey: input.paramKey,
      label: input.label,
      rawValue: keyword,
      candidates,
    },
  };
}

function isExactEmployeeIdentifierMatch(candidate: OrgEmployeeCandidate, keyword: string): boolean {
  return [
    candidate.openId,
    candidate.uid,
    candidate.phone,
    candidate.email,
  ].filter((item): item is string => Boolean(item?.trim()))
    .some((item) => item.toLowerCase() === keyword.toLowerCase());
}

function readPersonOpenId(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const openId = record.open_id ?? record.openId;
    return typeof openId === 'string' && openId.trim() ? openId.trim() : '';
  }
  return '';
}

async function findExactEmployeeCandidate(
  input: {
    options: CrmAgentPackOptions;
    context: AgentToolExecuteContext;
  },
  openId: string,
): Promise<OrgEmployeeCandidate | null> {
  const candidates = await input.options.orgSyncRepository?.findEmployees({
    eid: input.context.eid,
    appId: input.context.appId,
    keyword: openId,
    limit: 5,
  }) ?? [];
  return candidates.find((candidate) => candidate.openId === openId) ?? null;
}

function buildPersonParamObject(candidate: OrgEmployeeCandidate): Record<string, string> {
  return {
    open_id: candidate.openId,
    ...(candidate.name ? { name: candidate.name } : {}),
    ...(candidate.phone ? { phone: candidate.phone } : {}),
    ...(candidate.email ? { email: candidate.email } : {}),
  };
}

function isLikelyOpenId(value: string): boolean {
  return /^[0-9a-f][0-9a-f_-]{19,}$/i.test(value) || /^open[-_]/i.test(value);
}

function buildPersonResolutionWaitingResult(input: {
  runId: string;
  toolCode: string;
  partialInput: Record<string, unknown>;
  toolCall: AgentToolExecutionResult['toolCalls'][number];
  issues: PersonResolutionIssue[];
  context: AgentToolExecuteContext;
}): AgentToolExecutionResult {
  const firstIssue = input.issues[0]!;
  const isAmbiguous = firstIssue.kind === 'ambiguous';
  const title = isAmbiguous ? '需要确认具体人员' : '未找到匹配人员';
  const summary = isAmbiguous
    ? `${firstIssue.label}“${firstIssue.rawValue}”命中 ${firstIssue.candidates.length} 位员工，请选择具体人员。`
    : `未在组织员工表中找到 ${firstIssue.label}“${firstIssue.rawValue}”，请补充更完整姓名、手机号或邮箱。`;
  finishToolCall(input.toolCall, 'skipped', summary);
  return {
    status: 'waiting_input',
    currentStepKey: 'execute-tool',
    content: [
      `## ${title}`,
      `- 字段：${firstIssue.label}`,
      `- 输入：${firstIssue.rawValue}`,
      `- 处理：${summary}`,
    ].join('\n'),
    headline: title,
    references: ['meta.clarify_card', input.toolCode],
    toolCalls: [input.toolCall],
    pendingInteraction: buildPendingInteraction({
      runId: input.runId,
      kind: 'input_required',
      toolCode: input.toolCode,
      title,
      summary,
      partialInput: input.partialInput,
      questionCard: buildPersonQuestionCard({
        toolCode: input.toolCode,
        title,
        summary,
        issue: firstIssue,
      }),
      context: input.context,
    }),
    policyDecisions: [
      createPolicyDecision({
        policyCode: isAmbiguous ? 'record.person_resolution_ambiguous' : 'record.person_resolution_not_found',
        action: 'clarify',
        toolCode: input.toolCode,
        reason: summary,
      }),
    ],
  };
}

function buildPersonQuestionCard(input: {
  toolCode: string;
  title: string;
  summary: string;
  issue: PersonResolutionIssue;
}): PendingInteraction['questionCard'] {
  const options = input.issue.kind === 'ambiguous'
    ? buildEmployeeOptionHints(input.issue.candidates)
    : undefined;
  return {
    title: input.title,
    description: input.summary,
    toolCode: input.toolCode,
    submitLabel: options?.length ? '选择并继续预览' : '补充并继续预览',
    currentValues: {},
    questions: [
      {
        questionId: `${input.toolCode}:${input.issue.paramKey}:person_resolution`,
        paramKey: input.issue.paramKey,
        label: input.issue.label,
        type: 'reference',
        required: true,
        placeholder: '输入姓名、手机号或邮箱搜索并选择',
        options,
        lookup: buildEmployeeMetaQuestionLookup(),
        reason: input.summary,
      },
    ],
  };
}

async function resolveReferenceSelectParams(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
}): Promise<ReferenceResolutionResult> {
  const params = readRequestParams(input.requestInput);
  const nextParams = { ...params };
  const issues: ReferenceResolutionIssue[] = [];

  for (const { paramKey } of buildWritableFieldEntries({
    capability: input.capability,
    fields: input.fields,
  })) {
    if (!hasMeaningfulValue(nextParams[paramKey])) {
      continue;
    }
    const field = findFieldByParamKey(paramKey, input.fields);
    if (field?.widgetType !== 'basicDataWidget') {
      continue;
    }
    const issue = await resolveReferenceParamValue({
      options: input.options,
      context: input.context,
      field,
      paramKey,
      label: getFieldLabel(input.capability, paramKey),
      rawValue: nextParams[paramKey],
    });
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    requestInput: {
      ...input.requestInput,
      params: nextParams,
    },
    issues,
  };
}

function resolveMissingReferenceFieldIntent(input: {
  query: string;
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
  shadowMetadataService: ShadowMetadataService;
}): ReferenceResolutionIssue | null {
  const intent = findExplicitWriteFieldIntent({
    query: input.query,
    capability: input.capability,
    fields: input.fields,
    referenceOnly: true,
    allowValueless: true,
  });
  if (!intent || intent.hasValue || hasMeaningfulValue(readRequestParams(input.requestInput)[intent.paramKey])) {
    return null;
  }
  const field = intent.field ?? findFieldByParamKey(intent.paramKey, input.fields);
  if (!field || field.widgetType !== 'basicDataWidget') {
    return null;
  }
  return {
    paramKey: intent.paramKey,
    label: getFieldLabel(input.capability, intent.paramKey),
    rawValue: '',
    targetObjectKey: resolveRelationTargetObjectKey(input.shadowMetadataService, field),
    options: [],
  };
}

async function resolveReferenceParamValue(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  field: ShadowStandardizedField;
  paramKey: string;
  label: string;
  rawValue: unknown;
}): Promise<ReferenceResolutionIssue | undefined> {
  const values = Array.isArray(input.rawValue) ? input.rawValue : [input.rawValue];
  for (const value of values) {
    if (isAcceptableReferenceValue(value)) {
      continue;
    }
    const rawValue = typeof value === 'string' ? value.trim() : stringifyPreviewValue(value).trim();
    if (!rawValue) {
      continue;
    }
    const targetObjectKey = resolveRelationTargetObjectKey(input.options.shadowMetadataService, input.field);
    const options = targetObjectKey && input.context.operatorOpenId
      ? await buildRecordLookupOptionHints({
          shadowMetadataService: input.options.shadowMetadataService,
          objectKey: targetObjectKey,
          keyword: rawValue,
          pageSize: DEFAULT_META_QUESTION_OPTION_PAGE_SIZE,
          operatorOpenId: input.context.operatorOpenId,
        })
      : [];
    return {
      paramKey: input.paramKey,
      label: input.label,
      rawValue,
      targetObjectKey,
      options,
    };
  }
  return undefined;
}

function isAcceptableReferenceValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return isLikelyRecordFormInstId(value.trim());
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Boolean(readReferenceRecordId(record));
}

function readReferenceRecordId(value: Record<string, unknown>): string {
  for (const key of ['formInstId', 'id', '_id_']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function isLikelyRecordFormInstId(value: string): boolean {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{20,}$/i.test(value) || /^[A-Za-z0-9_-]{10,}$/.test(value);
}

function buildReferenceResolutionWaitingResult(input: {
  runId: string;
  toolCode: string;
  partialInput: Record<string, unknown>;
  toolCall: AgentToolExecutionResult['toolCalls'][number];
  issues: ReferenceResolutionIssue[];
  context: AgentToolExecuteContext;
}): AgentToolExecutionResult {
  const firstIssue = input.issues[0]!;
  const title = `需要选择${firstIssue.label}`;
  const summary = firstIssue.rawValue
    ? `${firstIssue.label}“${firstIssue.rawValue}”需要从候选记录中选择，不能直接手动录入文本。`
    : `请从候选记录中选择${firstIssue.label}，不能直接空预览写入。`;
  finishToolCall(input.toolCall, 'skipped', summary);
  return {
    status: 'waiting_input',
    currentStepKey: 'execute-tool',
    content: [
      `## ${title}`,
      `- 字段：${firstIssue.label}`,
      `- 输入：${firstIssue.rawValue || '待选择'}`,
      '- 处理：请在下方搜索并选择一条系统记录后继续预览。',
    ].join('\n'),
    headline: title,
    references: ['meta.clarify_card', input.toolCode],
    toolCalls: [input.toolCall],
    pendingInteraction: buildPendingInteraction({
      runId: input.runId,
      kind: 'input_required',
      toolCode: input.toolCode,
      title,
      summary,
      partialInput: input.partialInput,
      questionCard: buildReferenceQuestionCard({
        toolCode: input.toolCode,
        title,
        summary,
        issue: firstIssue,
      }),
      context: input.context,
    }),
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'record.reference_resolution_required',
        action: 'clarify',
        toolCode: input.toolCode,
        reason: summary,
      }),
    ],
  };
}

function buildReferenceQuestionCard(input: {
  toolCode: string;
  title: string;
  summary: string;
  issue: ReferenceResolutionIssue;
}): PendingInteraction['questionCard'] {
  return {
    title: input.title,
    description: input.summary,
    toolCode: input.toolCode,
    submitLabel: '选择并继续预览',
    currentValues: {},
    questions: [
      {
        questionId: `${input.toolCode}:${input.issue.paramKey}:reference_resolution`,
        paramKey: input.issue.paramKey,
        label: input.issue.label,
        type: 'reference',
        required: true,
        placeholder: `输入关键词搜索并选择${input.issue.label}`,
        options: input.issue.options,
        lookup: input.issue.targetObjectKey
          ? buildRecordMetaQuestionLookup(input.issue.targetObjectKey)
          : undefined,
        reason: input.summary,
      },
    ],
  };
}

function formatEmployeeCandidateLabel(candidate: OrgEmployeeCandidate): string {
  return [
    candidate.name || '未命名员工',
    candidate.phone,
    candidate.email,
  ].filter((item): item is string => Boolean(item?.trim())).join(' · ');
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
  shadowMetadataService?: ShadowMetadataService;
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
      lookup: buildFieldQuestionLookup({
        paramKey,
        fields: input.fields,
        shadowMetadataService: input.shadowMetadataService,
      }),
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

function withRecordingFollowupRequiredRows(input: {
  userPreview: RecordWritePreviewView;
  requestInput: ShadowPreviewUpsertInput;
  capability: RecordToolCapability;
  fields: ShadowStandardizedField[];
  shadowMetadataService: ShadowMetadataService;
}): RecordWritePreviewView {
  const params = readRequestParams(input.requestInput);
  const existing = new Set((input.userPreview.missingRequiredRows ?? []).map((row) => row.paramKey).filter(Boolean));
  const extraRows = RECORDING_FOLLOWUP_REQUIRED_PARAMS
    .filter((paramKey) => !hasMeaningfulValue(params[paramKey]) && !existing.has(paramKey))
    .map((paramKey) => ({
      label: getFieldLabel(input.capability, paramKey),
      paramKey,
      reason: '录音来源拜访记录正式归档前必须补齐该业务锚点',
      source: 'system' as const,
      options: buildFieldOptionHints(paramKey, input.fields),
      lookup: buildFieldQuestionLookup({
        paramKey,
        fields: input.fields,
        shadowMetadataService: input.shadowMetadataService,
      }),
    }));
  if (!extraRows.length) {
    return input.userPreview;
  }
  return {
    ...input.userPreview,
    missingRequiredRows: [
      ...(input.userPreview.missingRequiredRows ?? []),
      ...extraRows,
    ],
    recommendedRows: (input.userPreview.recommendedRows ?? []).filter((row) => !extraRows.some((extra) => extra.paramKey === row.paramKey)),
  };
}

function hasMissingRequiredRows(userPreview: RecordWritePreviewView): boolean {
  return Boolean(userPreview.missingRequiredRows?.length || userPreview.blockedRows?.length);
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
      placeholder: row.lookup ? `输入关键词搜索并选择${row.label}` : row.options?.length ? '请选择' : `请输入${row.label}`,
      options: row.options,
      lookup: row.lookup,
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
  if (row.lookup) {
    return 'reference';
  }
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

function buildFieldQuestionLookup(input: {
  paramKey: string;
  fields?: ShadowStandardizedField[];
  shadowMetadataService?: ShadowMetadataService;
}): MetaQuestionLookup | undefined {
  const field = findFieldByParamKey(input.paramKey, input.fields);
  if (!field) {
    return undefined;
  }
  if (field.widgetType === 'personSelectWidget') {
    return buildEmployeeMetaQuestionLookup();
  }
  if (field.widgetType === 'basicDataWidget') {
    const targetObjectKey = input.shadowMetadataService
      ? resolveRelationTargetObjectKey(input.shadowMetadataService, field)
      : inferRelationTargetObjectKey(field);
    return targetObjectKey ? buildRecordMetaQuestionLookup(targetObjectKey) : undefined;
  }
  return undefined;
}

function buildEmployeeMetaQuestionLookup(): MetaQuestionLookup {
  return {
    kind: 'remote_select',
    endpoint: META_QUESTION_OPTIONS_ENDPOINT,
    source: 'employee',
    minKeywordLength: 1,
    pageSize: DEFAULT_META_QUESTION_OPTION_PAGE_SIZE,
    allowFreeText: false,
  };
}

function buildRecordMetaQuestionLookup(targetObjectKey: ShadowObjectKey): MetaQuestionLookup {
  return {
    kind: 'remote_select',
    endpoint: META_QUESTION_OPTIONS_ENDPOINT,
    source: 'record',
    targetObjectKey,
    minKeywordLength: 1,
    pageSize: DEFAULT_META_QUESTION_OPTION_PAGE_SIZE,
    allowFreeText: false,
  };
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

  if (field.widgetType === 'personSelectWidget') {
    return stringifyPersonFieldValueForDisplay(value);
  }

  return stringifyPreviewValue(value);
}

function stringifyPersonFieldValueForDisplay(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const person = value as Record<string, unknown>;
    const displayParts = [
      typeof person.name === 'string' ? person.name : '',
      typeof person.phone === 'string' ? person.phone : '',
      typeof person.email === 'string' ? person.email : '',
    ].filter((item) => item.trim());
    if (displayParts.length) {
      return displayParts.join(' · ');
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

function readRecordFields(options: Pick<CrmAgentPackOptions, 'shadowMetadataService'>, objectKey: ShadowObjectKey): ShadowStandardizedField[] {
  try {
    return options.shadowMetadataService.getObject(objectKey).fields ?? [];
  } catch {
    return [];
  }
}

function resolveRelationTargetObjectKey(
  shadowMetadataService: Pick<ShadowMetadataService, 'listObjects'>,
  field: ShadowStandardizedField,
): ShadowObjectKey | undefined {
  const formCodeId = field.relationBinding?.formCodeId?.trim();
  if (!formCodeId) {
    return inferRelationTargetObjectKey(field);
  }
  try {
    const objectSummary = shadowMetadataService.listObjects().find((item) => item.formCodeId === formCodeId);
    if (objectSummary?.objectKey && CRM_RECORD_OBJECTS.includes(objectSummary.objectKey)) {
      return objectSummary.objectKey;
    }
  } catch {
    // Fall through to parameter naming fallback.
  }
  return inferRelationTargetObjectKey(field);
}

function inferRelationTargetObjectKey(field: ShadowStandardizedField): ShadowObjectKey | undefined {
  const text = `${field.writeParameterKey ?? ''} ${field.searchParameterKey ?? ''} ${field.semanticSlot ?? ''} ${field.label}`;
  if (/customer|客户/.test(text)) {
    return 'customer';
  }
  if (/contact|联系人/.test(text)) {
    return 'contact';
  }
  if (/opportunity|商机|机会/.test(text)) {
    return 'opportunity';
  }
  if (/followup|跟进/.test(text)) {
    return 'followup';
  }
  return undefined;
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
        agentControl: input.agentControl,
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
  agentControl: RecordAgentControl;
  fingerprint: string;
}): Record<string, unknown> {
  const existingAgentControl = readRecordAgentControl(input.partialInput);
  const duplicateCheck = input.agentControl.duplicateCheck ?? existingAgentControl.duplicateCheck ?? {};
  return {
    ...input.partialInput,
    agentControl: {
      ...existingAgentControl,
      ...input.agentControl,
      duplicateCheck: {
        ...duplicateCheck,
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
  const initialRequestInput = {
    ...selectedInput,
    ...(Object.keys(enrichedParams).length ? { params: enrichedParams } : {}),
    ...(mode === 'update' && !readRecordFormInstId(selectedInput) && contextRecordId
      ? { formInstId: contextRecordId }
      : {}),
    mode,
    operatorOpenId: context.operatorOpenId ?? undefined,
  } as ShadowPreviewUpsertInput;
  const archivedRecordingFollowupResult = await buildArchivedRecordingFollowupResult({
    options,
    objectKey,
    mode,
    toolCode: input.selectedTool.toolCode,
    source: agentControl.source,
    context,
    requestInput: initialRequestInput,
  });
  if (archivedRecordingFollowupResult) {
    return archivedRecordingFollowupResult;
  }
  if (mode === 'update' && !readRecordFormInstId(initialRequestInput)) {
    const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(initialRequestInput));
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
        partialInput: initialRequestInput as unknown as Record<string, unknown>,
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

  const missingReferenceIntent = resolveMissingReferenceFieldIntent({
    query: input.request.query,
    requestInput: initialRequestInput,
    capability,
    fields,
    shadowMetadataService: options.shadowMetadataService,
  });
  if (missingReferenceIntent) {
    const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(initialRequestInput));
    return buildReferenceResolutionWaitingResult({
      runId: context.runId,
      toolCode: input.selectedTool.toolCode,
      partialInput: attachRecordAgentControl(initialRequestInput as unknown as Record<string, unknown>, agentControl),
      toolCall,
      issues: [missingReferenceIntent],
      context,
    });
  }

  const personResolution = await resolvePersonSelectParams({
    options,
    context,
    requestInput: initialRequestInput,
    capability,
    fields,
  });
  if (personResolution.issues.length) {
    const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(initialRequestInput));
    return buildPersonResolutionWaitingResult({
      runId: context.runId,
      toolCode: input.selectedTool.toolCode,
      partialInput: attachRecordAgentControl(initialRequestInput as unknown as Record<string, unknown>, agentControl),
      toolCall,
      issues: personResolution.issues,
      context,
    });
  }
  const referenceResolution = await resolveReferenceSelectParams({
    options,
    context,
    requestInput: personResolution.requestInput,
    capability,
    fields,
  });
  if (referenceResolution.issues.length) {
    const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(personResolution.requestInput));
    return buildReferenceResolutionWaitingResult({
      runId: context.runId,
      toolCode: input.selectedTool.toolCode,
      partialInput: attachRecordAgentControl(personResolution.requestInput as unknown as Record<string, unknown>, agentControl),
      toolCall,
      issues: referenceResolution.issues,
      context,
    });
  }
  const requestInput = referenceResolution.requestInput;
  const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(requestInput));

  const guardToolCalls = await executeDuplicateCheckIfNeeded({
    options,
    objectKey,
    mode,
    context,
    agentControl,
    partialInput: attachRecordAgentControl(requestInput as unknown as Record<string, unknown>, agentControl),
  });
  const effectiveSelectedInput = guardToolCalls.partialInput
    ?? attachRecordAgentControl(requestInput as unknown as Record<string, unknown>, agentControl);
  if (guardToolCalls.result) {
    finishToolCall(toolCall, 'skipped', '写入预览前发现候选记录、缺少运行输入或查重不可用');
    return {
      ...guardToolCalls.result,
      toolCalls: [...guardToolCalls.toolCalls, toolCall],
    };
  }

  const preview = await options.shadowMetadataService.previewUpsert(objectKey, requestInput);
  const toolCalls = [...guardToolCalls.toolCalls, toolCall];
  const baseUserPreview = buildRecordPreviewView({
    objectKey,
    mode,
    requestInput,
    preview,
    capability,
    fields,
    shadowMetadataService: options.shadowMetadataService,
  });
  const userPreview = objectKey === 'followup' && mode === 'create' && agentControl.source?.kind === 'recording_material'
    ? withRecordingFollowupRequiredRows({
        userPreview: baseUserPreview,
        requestInput,
        capability,
        fields,
        shadowMetadataService: options.shadowMetadataService,
      })
    : baseUserPreview;
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

  if (hasMissingRequiredRows(userPreview)) {
    finishToolCall(toolCall, 'skipped', '录音来源拜访记录仍缺少正式归档必填字段');
    return {
      status: 'waiting_input',
      currentStepKey: 'execute-tool',
      content: buildPreviewWaitingInputContent({
        toolCode: input.selectedTool.toolCode,
        userPreview,
        preview,
      }),
      headline: '录音拜访记录还需要补齐信息',
      references: ['meta.clarify_card', input.selectedTool.toolCode],
      toolCalls,
      pendingInteraction: buildPendingInteraction({
        runId: context.runId,
        kind: 'input_required',
        toolCode: input.selectedTool.toolCode,
        title: '录音拜访记录还需要补齐信息',
        summary: '录音资料正式归档前必须补齐客户、商机、跟进方式和跟进负责人。',
        partialInput: effectiveSelectedInput,
        userPreview,
        context,
      }),
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'recording.followup_required_anchors',
          action: 'clarify',
          toolCode: input.selectedTool.toolCode,
          reason: '录音来源拜访记录正式写入前必须补齐客户、商机、跟进方式和跟进负责人。',
        }),
      ],
    };
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
	    requestInput: buildConfirmationRequestInput(requestInput, agentControl),
	    status: 'pending',
	    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  await options.repository.saveConfirmation(confirmation);
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
  const pending = await options.repository.findPendingConfirmation(context.runId, confirmationId);
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
    const rejected = await options.repository.resolveConfirmation({
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

	  const pendingRequestInput = pending.requestInput as unknown as ShadowPreviewUpsertInput;
	  const requestInput = stripRecordAgentControl(pendingRequestInput as unknown as Record<string, unknown>) as unknown as ShadowPreviewUpsertInput;
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
    shadowMetadataService: options.shadowMetadataService,
  });
  const approved = await options.repository.resolveConfirmation({
    runId: context.runId,
    confirmationId,
    status: 'approved',
	  }) ?? pending;
	  finishToolCall(toolCall, 'succeeded', `formInstIds=${result.formInstIds.join(',')}`);
	  const archiveResult = await archiveRecordingMaterialAfterFollowupCommit({
	    options,
	    objectKey,
	    mode,
	    context,
	    requestInput: pendingRequestInput,
	    followupId: result.formInstIds[0],
	  });
	  const recommendedRows = userPreview.recommendedRows ?? [];
  const committedContextFrame = buildCommittedRecordContextFrame({
    objectKey,
    mode,
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
	      ...(archiveResult.contentLines.length ? ['', ...archiveResult.contentLines] : []),
	    ].join('\n'),
    headline: `${objectKey} ${mode} 写回完成`,
    references: [input.selectedTool.toolCode, 'meta.confirm_writeback'],
	    toolCalls: [toolCall, ...archiveResult.toolCalls],
    contextFrame: committedContextFrame,
    pendingConfirmation: {
      ...approved,
      userPreview,
      debugPayload: result,
    },
	  };
	}

async function archiveRecordingMaterialAfterFollowupCommit(input: {
  options: CrmAgentPackOptions;
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  context: AgentToolExecuteContext;
  requestInput: ShadowPreviewUpsertInput;
  followupId?: string;
}): Promise<{
  toolCalls: AgentToolExecutionResult['toolCalls'];
  contentLines: string[];
}> {
  const source = readRecordingMaterialSource(input.requestInput);
  if (
    input.objectKey !== 'followup'
    || input.mode !== 'create'
    || !source?.recordingTaskId
    || !input.followupId
  ) {
    return { toolCalls: [], contentLines: [] };
  }

  const params = readRequestParams(input.requestInput);
  const customerId = readArchiveParam(params.linked_customer_form_inst_id)
    || source.anchors?.customer
    || '';
  const opportunityId = readArchiveParam(params.linked_opportunity_form_inst_id)
    || source.anchors?.opportunity
    || '';
  const call = createToolCall(
    input.context.runId,
    'artifact.recording_material.archive',
    JSON.stringify({
      recordingTaskId: source.recordingTaskId,
      customerId,
      opportunityId,
      followupId: input.followupId,
      sourceFileMd5: source.sourceFileMd5,
    }),
  );

  if (!input.options.recordingTaskService) {
    finishToolCall(call, 'skipped', '录音资料归档服务未启用');
    return {
      toolCalls: [call],
      contentLines: ['## 录音资料归档', '- 拜访记录已写入，但当前运行环境未启用录音资料归档服务。'],
    };
  }

  if (!customerId || !opportunityId) {
    finishToolCall(call, 'skipped', '缺少客户或商机锚点，不能归档录音资料');
    return {
      toolCalls: [call],
      contentLines: ['## 录音资料归档', '- 拜访记录已写入，但录音资料缺少客户或商机锚点，暂未进入跨会话资料库。'],
    };
  }

  try {
    const archived = await input.options.recordingTaskService.archiveTask({
      taskId: source.recordingTaskId,
      customerId,
      opportunityId,
      followupId: input.followupId,
      createdBy: input.context.operatorOpenId ?? 'assistant-web',
    });
    finishToolCall(call, 'succeeded', `artifact=${archived.material?.artifactId ?? '-'}, followup=${input.followupId}`);
    return {
      toolCalls: [call],
      contentLines: [
        '## 录音资料归档',
        `- 已将录音资料包归档到本次拜访记录：${archived.file.fileName}`,
      ],
    };
  } catch (error) {
    finishToolCall(call, 'failed', '录音资料归档失败', error);
    return {
      toolCalls: [call],
      contentLines: [
        '## 录音资料归档',
        `- 拜访记录已写入，但录音资料归档失败：${getErrorMessage(error)}`,
      ],
    };
  }
}

function readRecordingMaterialSource(requestInput: ShadowPreviewUpsertInput): RecordAgentControl['source'] | null {
  const source = readRecordAgentControl(requestInput as unknown as Record<string, unknown>).source;
  return source?.kind === 'recording_material' ? source : null;
}

async function buildArchivedRecordingFollowupResult(input: {
  options: CrmAgentPackOptions;
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  toolCode: string;
  source?: RecordAgentControl['source'];
  context: AgentToolExecuteContext;
  requestInput: ShadowPreviewUpsertInput;
}): Promise<AgentToolExecutionResult | null> {
  if (
    input.objectKey !== 'followup'
    || input.mode !== 'create'
    || input.source?.kind !== 'recording_material'
    || !input.source.recordingTaskId
    || !input.options.recordingTaskService?.getTask
  ) {
    return null;
  }
  let task: Awaited<ReturnType<RecordingTaskService['getTask']>>;
  try {
    task = await input.options.recordingTaskService.getTask(input.source.recordingTaskId);
  } catch {
    return null;
  }
  if (task.archive?.status !== 'archived' || !task.archive.followupId) {
    return null;
  }
  const call = createToolCall(input.context.runId, input.toolCode, JSON.stringify(input.requestInput));
  finishToolCall(call, 'skipped', `recordingTask already archived followup=${task.archive.followupId}`);
  return {
    status: 'completed',
    currentStepKey: 'execute-tool',
    content: [
      '## 已存在拜访记录',
      `- 录音文件：${task.file.fileName}`,
      `- 拜访记录：${task.archive.followupId}`,
      '- 该录音资料包已经正式归档，不会重复创建新的拜访记录。',
    ].join('\n'),
    headline: '已存在拜访记录',
    references: [input.toolCode, 'artifact.recording_material.archive'],
    toolCalls: [call],
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'recording.followup_create_idempotent',
        action: 'block',
        toolCode: input.toolCode,
        reason: '同一录音任务已归档到正式拜访记录，阻止重复发起录音来源 followup 新建。',
      }),
    ],
  };
}

function readArchiveParam(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(readArchiveParam).find(Boolean) ?? '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['formInstId', 'form_inst_id', 'id', 'value', 'key', 'name', 'title']) {
      const candidate = readArchiveParam(record[key]);
      if (candidate) {
        return candidate;
      }
    }
  }
  return '';
}

function buildCommittedRecordContextFrame(input: {
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
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
  if (input.mode === 'create' && input.objectKey !== 'customer' && boundSubjectType) {
    const previousSubject = boundSubjectId
      ? findMatchingSubject({
          subjectType: boundSubjectType,
          subjectId: boundSubjectId,
          contextFrame: input.contextFrame ?? null,
          resolvedContext: input.resolvedContext ?? null,
        })
      : findSubjectByType({
          subjectType: boundSubjectType,
          contextFrame: input.contextFrame ?? null,
          resolvedContext: input.resolvedContext ?? null,
        });
    if (boundSubjectId || previousSubject?.id) {
      const subjectId = boundSubjectId || previousSubject?.id || '';
      return {
        subject: {
          kind: 'record',
          type: boundSubjectType,
          id: subjectId,
          name: previousSubject?.name || subjectId,
        },
        sourceRunId: input.runId,
        evidenceRefs: [],
        confidence: previousSubject ? 0.95 : 0.86,
        resolvedBy: 'record.commit.subject_binding',
      };
    }
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
  return readContextSubjects({
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  }).find((subject) => (
    subject.type === input.subjectType
    && (!subject.id || subject.id === input.subjectId)
    && Boolean(subject.name)
  )) ?? null;
}

function findSubjectByType(input: {
  subjectType: string;
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentToolExecuteInput['resolvedContext'];
}): ContextFrame['subject'] | null {
  return readContextSubjects({
    contextFrame: input.contextFrame ?? null,
    resolvedContext: input.resolvedContext ?? null,
  }).find((subject) => subject.type === input.subjectType && Boolean(subject.id)) ?? null;
}

function readContextSubjects(input: {
  contextFrame?: ContextFrame | null;
  resolvedContext?: AgentToolExecuteInput['resolvedContext'];
}): Array<NonNullable<ContextFrame['subject']>> {
  return [
    input.resolvedContext?.subject,
    input.contextFrame?.subject,
  ].filter((item): item is NonNullable<ContextFrame['subject']> => Boolean(item?.type));
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
    description: '对目标公司进行外部研究并沉淀公司研究资料',
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
      aliases: ['/公司研究', '公司研究', '进行公司研究', '外部公司研究', '重新研究', '重新进行公司研究', '客户分析'],
    },
    execute: (input, context) => executeCompanyResearch(options, input, context),
  });
}

async function executeCompanyResearch(
  options: CrmAgentPackOptions,
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const rawCompanyName = String(
    input.selectedTool.input.companyName
      || input.intentFrame.target.name
      || extractCompanyName(input.request.query)
      || '',
  ).trim();
  const companyName = cleanupCompanyName(rawCompanyName);
  if (!isUsableCompanyName(companyName)) {
    return buildCompanyResearchInputRequiredResult(rawCompanyName, input.taskPlan);
  }

  const lookupCall = createToolCall(context.runId, 'artifact.company_research.lookup', companyName);
  let reusableArtifact: ArtifactDetailResponse | null = null;
  try {
    reusableArtifact = await findReusableCompanyResearchArtifact(options, {
      eid: context.eid,
      appId: context.appId,
      companyName,
    });
  } catch (error) {
    finishToolCall(lookupCall, 'failed', '已有公司研究资料查询失败，未触发外部服务', error);
    return buildCompanyResearchLookupUnavailableResult(companyName, error, [lookupCall]);
  }
  if (reusableArtifact) {
    finishToolCall(
      lookupCall,
      'succeeded',
      `reused artifact=${reusableArtifact.artifact.artifactId}, version=${reusableArtifact.artifact.version}`,
    );
    return buildCompanyResearchReusedResult(companyName, reusableArtifact, [lookupCall], input.taskPlan);
  }
  finishToolCall(lookupCall, 'skipped', '未找到已有有效公司研究资料，继续调用外部服务');

  const skillCall = createToolCall(context.runId, COMPANY_RESEARCH_RUNTIME_TOOL, companyName);
  let markdown: string;

  try {
    const job = await options.externalSkillService.createSkillJob(COMPANY_RESEARCH_RUNTIME_TOOL, {
      requestText: `研究这家公司：${companyName}。输出公司概览、业务定位、成长驱动、核心风险和来源引用，使用结构化 Markdown。`,
      model: options.config.deepseek.defaultModel,
    });
    const waitResult = await waitForSkillJob(options, job.jobId);
    if (waitResult.status === 'still_running') {
      finishToolCall(skillCall, 'running', `job=${waitResult.job.jobId}, status=${waitResult.job.status}, 已超过同步等待窗口`);
      scheduleCompanyResearchArtifactBackfill({
        options,
        companyName,
        job: waitResult.job,
        context,
      });
      return buildCompanyResearchRunningResult(companyName, waitResult.job, options.companyResearchMaxWaitMs ?? COMPANY_RESEARCH_MAX_WAIT_MS, [lookupCall, skillCall]);
    }

    const finishedJob = waitResult.job;
    markdown = await resolveMarkdownFromJob(options, finishedJob);
    finishToolCall(skillCall, 'succeeded', `job=${finishedJob.jobId}, artifacts=${finishedJob.artifacts.length}`);
  } catch (error) {
    finishToolCall(skillCall, 'failed', '公司研究服务执行失败，未生成降级资料', error);
    return buildCompanyResearchUnavailableResult(companyName, error, [lookupCall, skillCall]);
  }

  const evaluation = evaluateCompanyResearchResult(companyName, markdown);
  if (!evaluation.usable) {
    return buildCompanyResearchInvalidResult(companyName, evaluation, [lookupCall, skillCall]);
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
  finishToolCall(artifactCall, 'succeeded', `公司研究资料已保存为第 ${artifact.artifact.version} 版`);
  const researchSummary = summarizeMarkdown(markdown);

  const evidence = [
    {
      artifactId: artifact.artifact.artifactId,
      versionId: artifact.artifact.versionId,
      title: artifact.artifact.title,
      version: artifact.artifact.version,
      sourceToolCode: artifact.artifact.sourceToolCode,
      anchorLabel: companyName,
      snippet: researchSummary,
      vectorStatus: artifact.artifact.vectorStatus,
    },
  ];

  return {
    status: 'completed',
    content: `## 公司研究已完成\n- 公司：**${companyName}**\n- 资料：${artifact.artifact.title} 第 ${artifact.artifact.version} 版\n\n## 研究摘要\n${researchSummary}`,
    headline: '已生成公司研究资料',
    references: [COMPANY_RESEARCH_SERVICE_LABEL, artifact.artifact.title],
    evidence,
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName, context.runId),
    toolCalls: [lookupCall, skillCall, artifactCall],
  };
}

function registerArtifactSearchTool(registry: AgentToolRegistry, options: CrmAgentPackOptions): void {
  registry.register({
    code: 'artifact.search',
    type: 'artifact',
    provider: 'ai-crm-native-data',
	    description: '检索已有正式资料资产并返回可引用资料卡',
	    whenToUse: '用户追问已有外部信息、资料资产或上下文证据时使用。当前来源包括公司研究、已归档录音资料包和已归档分析结果。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, anchorName: { type: 'string' }, dataSourceScope: { type: 'string' } } },
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
      finishToolCall(call, 'succeeded', `找到 ${search.evidence.length} 条可引用资料`);
      const evidence: AgentEvidenceCard[] = search.evidence.map((item) => ({
        artifactId: item.artifactId,
        versionId: item.versionId,
        kind: item.kind,
        title: item.title,
        version: item.version,
        sourceToolCode: item.sourceToolCode,
        anchorLabel: item.anchorIds[0] ?? anchorName ?? '公司研究资料',
        snippet: item.snippet,
        score: item.score,
        vectorStatus: search.vectorStatus,
      }));
      return {
        status: 'completed',
        content: evidence.length
          ? buildExternalInfoContent({
              anchorName,
              evidence,
              headingLevel: 2,
            })
          : '当前没有检索到可引用外部信息。你可以先通过“/公司研究 XX有限公司”生成一份外部信息资料。',
        headline: evidence.length ? '已找到可引用外部信息' : '暂无可用外部信息',
        references: [EXTERNAL_INFO_SOURCE_LABEL, ...evidence.map((item) => item.title)],
        evidence,
        qdrantFilter: search.qdrantFilter,
        toolCalls: [call],
      };
    },
  });
}

function registerRecordingMaterialTool(registry: AgentToolRegistry): void {
  registry.register({
    code: RECORDING_MATERIAL_TOOL,
    type: 'artifact',
    provider: 'ai-crm-native-data',
    description: '创建录音处理任务并生成可被对话和外部技能消费的录音资料包',
    whenToUse: '用户上传录音、提到录音整理、或希望基于拜访录音继续拆需求待办时使用。',
    inputSchema: { type: 'object', properties: { attachmentNames: { type: 'array' }, query: { type: 'string' } } },
    outputSchema: { type: 'object' },
    riskLevel: 'low',
    confirmationPolicy: 'read_only',
    displayCardType: 'recording-material-task',
    owner: 'Agent 平台组',
    enabled: true,
    semanticProfile: {
      subjectTypes: ['artifact'],
      intentCodes: ['recording_material_prepare'],
      conflictGroups: [],
      priority: 74,
      risk: 'low_cost',
      aliases: ['录音资料', '录音资料包', '拜访录音'],
    },
    execute: async (input, context) => {
      const attachmentNames = (input.request.attachments ?? []).map((item) => item.name).filter(Boolean);
      const call = createToolCall(context.runId, RECORDING_MATERIAL_TOOL, JSON.stringify(input.selectedTool.input));
      finishToolCall(call, 'succeeded', '录音资料包处理入口已准备，具体上传和轮询由录音处理服务完成');
      return {
        status: 'completed',
        currentStepKey: 'continue-actions',
        content: [
          '## 录音处理已接入',
          attachmentNames.length ? `- 录音文件：${attachmentNames.join('、')}` : '- 录音文件：请在输入框上传音频。',
          '- 当前会先生成录音资料包，不展示逐字转写。',
          '- 未关联客户/商机时可以先处理，生成正式跟进记录前必须补齐关联并确认。',
          '',
          '完成后可以点击录音卡片打开录音查看页，或继续调用：拜访会话理解、客户需求工作待办分析、问题陈述、客户价值定位、新增拜访记录。',
        ].join('\n'),
        headline: '录音资料包处理入口已准备',
        references: ['录音处理服务', '录音资料包'],
        attachments: [],
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
  return /(客户旅程|旅程|推进|下一步|怎么推进|进展概览|盘点一下|总结一下|拜访前摘要|商机进展|机会进展|客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|系统内记录|系统记录|内部记录|记录系统|值不值得|重点推进|赢单概率|下次拜访|怎么开场|价值点|推进阻塞|经营简报|给老板看|客户诉求|待办情况|反复强调|需求|问题陈述|价值主张)/.test(query);
}

function isComplexContextSummaryQuery(query: string): boolean {
  return /(结合|综合|融合|同时看|一起看|值不值得|重点推进|赢单概率|下次拜访|怎么开场|问哪些问题|推什么价值点|推进阻塞|经营简报|给老板看|客户诉求|待办情况|反复强调|问题陈述|价值主张|价值定位|行动建议|主要提了什么需求|需求.*待办)/.test(query);
}

function isSimpleCustomerRecordLookupQuery(query: string): boolean {
  const normalized = stripDataSourceScopePhrases(query).trim();
  if (isComplexContextSummaryQuery(normalized)) {
    return false;
  }
  if (/(公司研究|录音资料|录音资料包|拜访录音|录音分析|最近拜访|这次拜访|上次拜访|需求待办|问题陈述|价值定位|价值主张|分析结果)/.test(normalized)) {
    return false;
  }
  return isDirectRecordLookupQuery(normalized)
    || /(?:客户情况|客户状态|客户处于什么状态|客户是什么状态|客户档案|客户资料|客户信息|客户详情)\s*[？?。！!]*$/.test(normalized);
}

function inferContextSummaryType(query: string): 'journey' | 'next_step' {
  return /(下一步|怎么推进|推进建议|下次拜访|怎么开场|问哪些问题|推什么价值点)/.test(query) ? 'next_step' : 'journey';
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
  const dataSourceScope = normalizeDataSourceScope(input.selectedTool.input.dataSourceScope);
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

	  const externalInfo = dataSourceScope === 'combined'
	    ? await loadExternalInfoEvidenceForSummary({
	        options,
	        context,
	        query,
	        anchorName: resolvedSubject.name,
	        resolvedSubject,
	        rootSubject,
	        toolCalls,
	      })
    : null;

  finishToolCall(
    toolCalls[0],
    'succeeded',
    `scope=${dataSourceScope}, summaryType=${summaryType}, contacts=${readSearchTotal(relationResults.contact)}, opportunities=${readSearchTotal(relationResults.opportunity)}, followups=${readSearchTotal(relationResults.followup)}`,
  );

  const internalContent = buildCustomerSummaryContent({
    query,
    summaryType,
    customerRecord: customerDetail.record,
    relations: relationResults,
    includeSourceLabel: dataSourceScope !== 'combined',
  });
  const content = dataSourceScope === 'combined'
    ? buildCombinedDataSourceContent({
        internalContent,
        externalEvidence: externalInfo?.evidence ?? [],
        externalAnchorName: externalInfo?.anchorName || resolvedSubject.name,
        relations: relationResults,
      })
    : internalContent;

  return {
    status: 'completed',
    content,
    headline: dataSourceScope === 'combined'
      ? '已融合外部信息与系统内记录'
      : summaryType === 'journey' ? '客户旅程摘要已生成' : '推进建议已生成',
    references: dataSourceScope === 'combined'
      ? [
          INTERNAL_RECORDS_SOURCE_LABEL,
          EXTERNAL_INFO_SOURCE_LABEL,
          CONTEXT_SUMMARY_TOOL,
          'record.customer.get',
          'record.contact.search',
          'record.opportunity.search',
          'record.followup.search',
          'artifact.search',
          ...(externalInfo?.evidence.map((item) => item.title) ?? []),
        ]
      : [INTERNAL_RECORDS_SOURCE_LABEL, CONTEXT_SUMMARY_TOOL, 'record.customer.get', 'record.contact.search', 'record.opportunity.search', 'record.followup.search'],
    evidence: externalInfo?.evidence ?? [],
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

  const intentTargetName = cleanupCompanyName(input.input.intentFrame.target.name?.trim() ?? '');
  const targetName = extractInternalRecordsSubjectName(input.query)
    || extractExternalInfoSubjectName(input.query)
    || extractCompanyName(input.query)
    || subject?.name?.trim()
    || (isUsableCompanyName(intentTargetName) ? intentTargetName : '');
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

async function loadExternalInfoEvidenceForSummary(input: {
  options: CrmAgentPackOptions;
  context: AgentToolExecuteContext;
  query: string;
  anchorName: string;
  resolvedSubject?: { id: string; name: string };
  rootSubject: ContextFrame['subject'] | null;
  toolCalls: AgentToolExecutionResult['toolCalls'];
}): Promise<{ anchorName: string; evidence: AgentEvidenceCard[] }> {
  const anchorName = input.anchorName || input.rootSubject?.name || extractExternalInfoSubjectName(input.query);
  const anchors = [
    ...(anchorName ? [buildCompanyAnchor(anchorName)] : []),
    ...(input.resolvedSubject?.id
      ? [{ type: 'customer' as const, id: input.resolvedSubject.id, name: input.resolvedSubject.name, role: 'primary' as const }]
      : []),
  ];
  const searches = await Promise.all((['company_research', 'recording_material', 'analysis_material'] as const).map(async (kind) => {
    const call = createToolCall(input.context.runId, 'artifact.search', `${kind}:${input.query}`);
    const search = await input.options.artifactService.search({
      eid: input.context.eid,
      appId: input.context.appId,
      query: input.query,
      kinds: [kind],
      anchors: anchors.length ? anchors : undefined,
      limit: 5,
    });
    finishToolCall(call, 'succeeded', `${artifactKindBusinessLabel(kind)} 找到 ${search.evidence.length} 条`);
    input.toolCalls.push(call);
    return search;
  }));
  const evidenceRefs = searches.flatMap((search) => (
    search.evidence.map((item) => ({ item, vectorStatus: search.vectorStatus }))
  ));
  return {
    anchorName,
    evidence: evidenceRefs.map(({ item, vectorStatus }) => ({
      artifactId: item.artifactId,
      versionId: item.versionId,
      kind: item.kind,
      title: item.title,
      version: item.version,
      sourceToolCode: item.sourceToolCode,
      anchorLabel: item.anchorIds[0] ?? anchorName ?? EXTERNAL_INFO_SOURCE_LABEL,
      snippet: item.snippet,
      score: item.score,
      vectorStatus,
    })),
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

function buildExternalInfoContent(input: {
  anchorName?: string;
  evidence: AgentEvidenceCard[];
  headingLevel: 2 | 3;
}): string {
  const heading = '#'.repeat(input.headingLevel);
  const targetLabel = input.anchorName || '当前会话对象';
  const snippets = input.evidence.slice(0, 2).map((item) => `- ${item.snippet}`);
  const sources = summarizeEvidenceBusinessSources(input.evidence);
  return [
    `${heading} ${EXTERNAL_INFO_SOURCE_LABEL}`,
    `- 对象：**${targetLabel}**`,
    `- 可引用资料：${input.evidence.length} 条`,
    ...sources.map((item) => `- ${item}`),
    '',
    ...snippets,
  ].join('\n');
}

function summarizeEvidenceBusinessSources(evidence: AgentEvidenceCard[]): string[] {
  const grouped = new Map<string, Set<string>>();
  for (const item of evidence) {
    const label = artifactKindBusinessLabel(item.kind);
    const titles = grouped.get(label) ?? new Set<string>();
    titles.add(item.title);
    grouped.set(label, titles);
  }
  return Array.from(grouped.entries()).map(([label, titles]) => (
    `${label}：${Array.from(titles).slice(0, 3).join('、')}`
  ));
}

function artifactKindBusinessLabel(kind: AgentEvidenceCard['kind']): string {
  if (kind === 'company_research') {
    return '公司研究';
  }
  if (kind === 'recording_material') {
    return '拜访录音';
  }
  if (kind === 'analysis_material') {
    return '分析结果';
  }
  return EXTERNAL_INFO_SOURCE_LABEL;
}

function buildCombinedDataSourceContent(input: {
  internalContent: string;
  externalEvidence: AgentEvidenceCard[];
  externalAnchorName: string;
  relations: Record<'contact' | 'opportunity' | 'followup', {
    totalElements: number;
    records: Array<unknown>;
  }>;
}): string {
  const externalContent = input.externalEvidence.length
    ? buildExternalInfoContent({
        anchorName: input.externalAnchorName,
        evidence: input.externalEvidence,
        headingLevel: 3,
      })
    : [
        `### ${EXTERNAL_INFO_SOURCE_LABEL}`,
        `- 对象：**${input.externalAnchorName || '当前会话对象'}**`,
        '- 当前没有检索到可引用外部信息。',
      ].join('\n');

  return [
    `## ${INTERNAL_RECORDS_SOURCE_LABEL}`,
    demoteMarkdownHeadings(input.internalContent).trim(),
    '',
    externalContent,
    '',
    '## 判断建议',
    ...buildCombinedDataSourceAdvice({
      hasExternalInfo: input.externalEvidence.length > 0,
      relations: input.relations,
    }).map((item) => `- ${item}`),
  ].join('\n');
}

function demoteMarkdownHeadings(content: string): string {
  return content.replace(/^## /gm, '### ');
}

function buildCombinedDataSourceAdvice(input: {
  hasExternalInfo: boolean;
  relations: Record<'contact' | 'opportunity' | 'followup', { totalElements: number; records: Array<unknown> }>;
}): string[] {
  const suggestions: string[] = [];
  const opportunityTotal = readSearchTotal(input.relations.opportunity);
  const followupTotal = readSearchTotal(input.relations.followup);
  const contactTotal = readSearchTotal(input.relations.contact);

  if (!input.hasExternalInfo) {
    suggestions.push('缺少外部信息，建议先通过公司研究或后续外部资料入口补齐公开背景，再做综合判断。');
  }
  if (opportunityTotal === 0) {
    suggestions.push('系统内记录未看到商机，若客户已进入销售推进，应先补齐商机阶段、金额和预计成交时间。');
  }
  if (followupTotal === 0) {
    suggestions.push('系统内记录未看到跟进沉淀，拜访前需要补充最近互动和客户反馈，避免只依据外部信息判断。');
  }
  if (contactTotal === 0) {
    suggestions.push('系统内记录未看到联系人，建议先确认关键人和影响人，再安排下一步动作。');
  }
  if (suggestions.length === 0) {
    suggestions.push('优先核对系统内商机阶段与外部公开业务方向是否一致，再把差异点转成拜访问题。');
  }

  return suggestions;
}

function readSearchTotal(search: { totalElements?: number; records?: Array<unknown> }): number {
  return Number.isFinite(search.totalElements) ? Number(search.totalElements) : search.records?.length ?? 0;
}

function buildCustomerSummaryContent(input: {
  query: string;
  summaryType: 'journey' | 'next_step';
  includeSourceLabel?: boolean;
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
  const contactTotal = readSearchTotal(input.relations.contact);
  const opportunityTotal = readSearchTotal(input.relations.opportunity);
  const followupTotal = readSearchTotal(input.relations.followup);
  const suggestions = buildCustomerSuggestions({
    customer,
    relations: input.relations,
  });
  const heading = input.includeSourceLabel ? '###' : '##';

  const lines = [
    ...(input.includeSourceLabel ? [`## ${INTERNAL_RECORDS_SOURCE_LABEL}`] : []),
    input.summaryType === 'journey' ? `${heading} 客户旅程摘要` : `${heading} 推进建议摘要`,
    `- 客户：${customerName}`,
    `- 客户编码：${customerCode}`,
    `- 客户状态：${customerStatus}`,
    `- 客户类型：${customerType}`,
    `- 销售负责人：${owner}`,
    `- 最后跟进：${lastFollowupDate}`,
    `- 下次回访：${nextVisitDate}`,
    '',
    `${heading} 当前客户画像`,
    `- 联系人：${contactTotal} 条`,
    `- 商机：${opportunityTotal} 条`,
    `- 跟进记录：${followupTotal} 条`,
  ];

  if (contactPreview.length) {
    lines.push('', `${heading} 代表性联系人`, ...contactPreview.map((item) => `- ${item}`));
  }
  if (opportunityPreview.length) {
    lines.push('', `${heading} 商机进展`, ...opportunityPreview.map((item) => `- ${item}`));
  }
  if (followupPreview.length) {
    lines.push('', `${heading} 最近跟进`, ...followupPreview.map((item) => `- ${item}`));
  }
  if (suggestions.length) {
    lines.push('', input.summaryType === 'journey' ? `${heading} 建议下一步` : `${heading} 下一步建议`, ...suggestions.map((item) => `- ${item}`));
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
  const contactTotal = readSearchTotal(input.relations.contact);
  const opportunityTotal = readSearchTotal(input.relations.opportunity);
  const followupTotal = readSearchTotal(input.relations.followup);

  if (followupTotal === 0) {
    suggestions.push('尽快补一条跟进记录，避免客户状态只有静态资料没有过程沉淀。');
  }
  if (opportunityTotal === 0) {
    suggestions.push('如果这家客户已进入商机阶段，建议补录商机并明确销售阶段、预算、预计成交时间。');
  }
  if (!province || !city || !district) {
    suggestions.push('建议继续补充省、市、区，方便后续做区域经营和拜访路线安排。');
  }
  if (contactTotal > 0 && followupTotal < contactTotal) {
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
      const name = readFieldByTitles(record, ['联系人姓名', '姓名']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.contact) || '联系人记录';
      const mobile = readFieldByTitles(record, ['手机', '联系电话']) || '-';
      return `${name} / 手机：${mobile}`;
    }
    if (objectKey === 'opportunity') {
      const name = readFieldByTitles(record, ['机会名称', '商机名称']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.opportunity) || '商机记录';
      const stage = readFieldByTitles(record, ['销售阶段']) || '-';
      const closeDate = readFieldByTitles(record, ['预计成交时间']) || '-';
      return `${name} / 阶段：${stage} / 预计成交：${closeDate}`;
    }
    const title = readFieldByTitles(record, ['跟进记录']) || readLiveRecordDisplayName(record, CRM_RECORD_CAPABILITIES.followup) || '跟进记录';
    const method = readFieldByTitles(record, ['跟进方式']) || '-';
    return `${title} / 跟进方式：${method}`;
  });
}

function readFieldByTitles(
  record: {
    formInstId?: string;
    important?: Record<string, unknown>;
    fields?: Array<{ codeId?: string | null; title?: string | null; value?: unknown; rawValue?: unknown }>;
    rawRecord?: Record<string, unknown>;
  },
  titles: string[],
): string {
  const fields = record.fields ?? [];
  const lookupKeys = new Set(titles.flatMap((title) => IMPORTANT_FIELD_ALIASES[title] ?? [title]));
  for (const title of titles) {
    const field = fields.find((item) =>
      item.title === title
      || Boolean(item.title && lookupKeys.has(item.title))
      || Boolean(item.codeId && lookupKeys.has(item.codeId))
    );
    const value = field ? stringifyRecordDisplayCandidate(field.value ?? field.rawValue, record.formInstId) : '';
    if (value) {
      return value;
    }
  }
  return readImportantValueByTitles(record, titles);
}

async function waitForSkillJob(options: CrmAgentPackOptions, jobId: string): Promise<SkillJobWaitResult> {
  return waitForSkillJobWithin(options, {
    jobId,
    maxWaitMs: options.companyResearchMaxWaitMs ?? COMPANY_RESEARCH_MAX_WAIT_MS,
    keepProcessAlive: true,
  });
}

async function waitForSkillJobWithin(
  options: CrmAgentPackOptions,
  input: {
    jobId: string;
    maxWaitMs: number;
    keepProcessAlive: boolean;
  },
): Promise<SkillJobWaitResult> {
  let job = await options.externalSkillService.getSkillJob(input.jobId);
  const maxAttempts = Math.ceil(Math.max(0, input.maxWaitMs) / COMPANY_RESEARCH_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (job.status === 'succeeded') {
      return { status: 'succeeded', job };
    }
    if (job.status === 'failed') {
      throw new Error(job.error?.message ?? '公司研究服务执行失败');
    }
    await delay(COMPANY_RESEARCH_POLL_INTERVAL_MS, input.keepProcessAlive);
    job = await options.externalSkillService.getSkillJob(input.jobId);
  }
  if (job.status === 'succeeded') {
    return { status: 'succeeded', job };
  }
  if (job.status === 'failed') {
    throw new Error(job.error?.message ?? '公司研究服务执行失败');
  }
  return { status: 'still_running', job };
}

function delay(ms: number, keepProcessAlive: boolean): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (!keepProcessAlive) {
      timer.unref();
    }
  });
}

function scheduleCompanyResearchArtifactBackfill(input: {
  options: CrmAgentPackOptions;
  companyName: string;
  job: ExternalSkillJobResponse;
  context: AgentToolExecuteContext;
}): void {
  const maxWaitMs = input.options.companyResearchBackgroundMaxWaitMs ?? COMPANY_RESEARCH_BACKGROUND_MAX_WAIT_MS;
  void backfillCompanyResearchArtifact(input.options, {
    companyName: input.companyName,
    jobId: input.job.jobId,
    eid: input.context.eid,
    appId: input.context.appId,
    maxWaitMs,
  }).catch((error) => {
    console.warn(`[agent] company research background backfill failed: ${getErrorMessage(error)}`);
  });
}

async function backfillCompanyResearchArtifact(
  options: CrmAgentPackOptions,
  input: {
    companyName: string;
    jobId: string;
    eid: string;
    appId: string;
    maxWaitMs: number;
  },
): Promise<void> {
  const waitResult = await waitForSkillJobWithin(options, {
    jobId: input.jobId,
    maxWaitMs: input.maxWaitMs,
    keepProcessAlive: false,
  });
  if (waitResult.status === 'still_running') {
    console.warn(`[agent] company research background backfill still running: job=${input.jobId}`);
    return;
  }

  const reusableArtifact = await findReusableCompanyResearchArtifact(options, {
    eid: input.eid,
    appId: input.appId,
    companyName: input.companyName,
  });
  if (reusableArtifact) {
    return;
  }

  const markdown = await resolveMarkdownFromJob(options, waitResult.job);
  const evaluation = evaluateCompanyResearchResult(input.companyName, markdown);
  if (!evaluation.usable) {
    console.warn(`[agent] company research background backfill skipped invalid result: job=${input.jobId}, reason=${evaluation.reason}`);
    return;
  }

  await options.artifactService.createCompanyResearchArtifact({
    eid: input.eid,
    appId: input.appId,
    title: `${input.companyName} 公司研究`,
    markdown,
    sourceToolCode: COMPANY_RESEARCH_RUNTIME_TOOL,
    anchors: [buildCompanyAnchor(input.companyName)],
    createdBy: 'agent-runtime-background',
    summary: summarizeMarkdown(markdown),
    sourceRefs: extractSourceRefs(markdown),
  });
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

  throw new Error('公司研究服务未返回可用研究资料');
}

async function findReusableCompanyResearchArtifact(
  options: CrmAgentPackOptions,
  input: { eid: string; appId: string; companyName: string },
): Promise<ArtifactDetailResponse | null> {
  const artifactService = options.artifactService as ArtifactService & {
    findLatestCompanyResearchArtifact?: ArtifactService['findLatestCompanyResearchArtifact'];
  };
  if (typeof artifactService.findLatestCompanyResearchArtifact !== 'function') {
    return null;
  }

  return artifactService.findLatestCompanyResearchArtifact(input);
}

function buildCompanyResearchReusedResult(
  companyName: string,
  detail: ArtifactDetailResponse,
  toolCalls: AgentToolExecutionResult['toolCalls'],
  taskPlan?: TaskPlan,
): AgentToolExecutionResult {
  const snippet = summarizeMarkdown(detail.markdown) || detail.summary?.trim() || '已有公司研究资料可供参考。';
  const anchorLabel = detail.artifact.anchors.find((item) => item.type === 'company')?.name
    || detail.artifact.anchors.find((item) => item.type === 'company')?.id
    || companyName;
  const evidence: AgentEvidenceCard[] = [
    {
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      version: detail.artifact.version,
      sourceToolCode: detail.artifact.sourceToolCode,
      anchorLabel,
      snippet,
      vectorStatus: detail.artifact.vectorStatus,
    },
  ];

  return {
    status: 'completed',
    currentStepKey: 'execute-tool',
    content: [
      '## 已使用已有公司研究资料',
      `- 公司：**${companyName}**`,
      `- 资料：${detail.artifact.title} 第 ${detail.artifact.version} 版`,
      '',
      '## 研究摘要',
      snippet,
    ].join('\n'),
    headline: '已使用已有公司研究资料',
    references: [COMPANY_RESEARCH_MATERIAL_LABEL, COMPANY_RESEARCH_SERVICE_LABEL],
    evidence,
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName),
    toolCalls,
    taskPlan: markCompanyResearchReusedPlan(taskPlan),
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.reuse_existing_artifact',
        action: 'allow',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: '已有有效公司研究资料，直接复用，不重复调用外部研究服务。',
      }),
    ],
  };
}

function buildCompanyResearchLookupUnavailableResult(
  companyName: string,
  error: unknown,
  toolCalls: AgentToolExecutionResult['toolCalls'],
): AgentToolExecutionResult {
  const message = sanitizeCompanyResearchUserError(getErrorMessage(error));
  return {
    status: 'tool_unavailable',
    currentStepKey: 'execute-tool',
    content: [
      '## 公司研究资料查询失败',
      `- 公司：**${companyName}**`,
      `- 失败原因：${message}`,
      '',
      '## 当前处理',
      '- 未调用外部公司研究服务。',
      '- 未生成降级资料。',
      '- 请检查研究资料存储后重试。',
    ].join('\n'),
    headline: '公司研究资料查询失败，未触发外部服务',
    references: [COMPANY_RESEARCH_MATERIAL_LABEL, COMPANY_RESEARCH_SERVICE_LABEL],
    evidence: [],
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName),
    toolCalls,
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.lookup_required',
        action: 'block',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: `公司研究复用查询失败，为避免重复研究已阻止外部服务调用：${message}`,
      }),
    ],
  };
}

function markCompanyResearchReusedPlan(taskPlan?: TaskPlan): TaskPlan | undefined {
  if (!taskPlan) {
    return undefined;
  }

  return {
    ...taskPlan,
    status: 'completed',
    steps: taskPlan.steps.map((item) => {
      if (item.key === 'lookup-company-research') {
        return { ...item, status: 'succeeded' };
      }
      if (item.key === 'run-company-research' || item.key === 'persist-artifact') {
        return { ...item, status: 'skipped' };
      }
      return item;
    }),
  };
}

function buildCompanyResearchInputRequiredResult(
  rawCompanyName: string,
  taskPlan?: TaskPlan,
): AgentToolExecutionResult {
  const hint = cleanupCompanyName(rawCompanyName);
  return {
    status: 'waiting_input',
    currentStepKey: 'execute-tool',
    content: [
      '## 需要公司全称',
      '请在 `/公司研究` 后输入要研究的公司全称，例如：上海松井机械有限公司。',
      '',
      '## 当前处理',
      '- 未调用公司研究服务。',
      '- 未查询或保存公司研究资料。',
      hint ? `- 已忽略占位或无效输入：${hint}` : '',
    ].filter(Boolean).join('\n'),
    headline: '请补充公司全称',
    references: [COMPANY_RESEARCH_SERVICE_LABEL],
    evidence: [],
    attachments: [],
    toolCalls: [],
    taskPlan: markCompanyResearchInputRequiredPlan(taskPlan),
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.input_required',
        action: 'block',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: '公司研究缺少有效公司全称，已阻止外部服务调用和资料落库。',
      }),
    ],
  };
}

function markCompanyResearchInputRequiredPlan(taskPlan?: TaskPlan): TaskPlan | undefined {
  if (!taskPlan) {
    return undefined;
  }

  return {
    ...taskPlan,
    status: 'waiting_input',
    steps: taskPlan.steps.map((item) => {
      if (item.key === 'lookup-company-research' || item.key === 'run-company-research' || item.key === 'persist-artifact') {
        return { ...item, status: 'skipped' };
      }
      return item;
    }),
  };
}

interface CompanyResearchEvaluation {
  usable: boolean;
  reason: string;
}

function buildCompanyResearchInvalidResult(
  companyName: string,
  evaluation: CompanyResearchEvaluation,
  toolCalls: AgentToolExecutionResult['toolCalls'],
): AgentToolExecutionResult {
  return {
    status: 'tool_unavailable',
    currentStepKey: 'execute-tool',
    content: [
      '## 未生成公司研究资料',
      `- 公司：**${companyName}**`,
      `- 原因：${evaluation.reason}`,
      '',
      '## 当前处理',
      '- 已完成一次真实公司研究服务调用。',
      '- 返回内容不足以确认目标公司或缺少有效研究信息。',
      '- 本次结果不会进入可引用资料库，也不会显示公司研究资料卡。',
    ].join('\n'),
    headline: '未生成公司研究资料',
    references: [COMPANY_RESEARCH_SERVICE_LABEL],
    evidence: [],
    attachments: [],
    toolCalls,
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.invalid_result_no_artifact',
        action: 'block',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: `真实公司研究结果不可用，已阻止资料落库：${evaluation.reason}`,
      }),
    ],
  };
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
      '- 当前状态：研究任务仍在处理中。',
      `- 同步等待：已等待约 ${waitedSeconds} 秒，真实联网研究仍在继续执行。`,
      '',
      '## 当前说明',
      '- 系统已成功触发公司研究服务。',
      '- 本次响应先保留运行中状态，避免把长耗时研究误判成失败。',
      '- 任务完成后，可通过外部技能任务记录查看研究资料；后续再接入异步回填。',
    ].join('\n'),
    headline: '公司研究任务仍在运行，可稍后查看产物',
    references: [COMPANY_RESEARCH_SERVICE_LABEL],
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
  const rawMessage = getErrorMessage(error);
  const message = sanitizeCompanyResearchUserError(rawMessage);
  return {
    status: 'tool_unavailable',
    currentStepKey: 'execute-tool',
    content: [
      '## 公司研究服务执行失败',
      `- 公司：**${companyName}**`,
      `- 服务：${COMPANY_RESEARCH_SERVICE_LABEL}`,
      `- 失败原因：${message}`,
      '',
      '## 当前处理',
      '- 未生成降级资料。',
      '- 未写入客户、联系人、商机或跟进记录。',
      '- 请处理外部服务、模型额度或运行时可用性后重试。',
    ].join('\n'),
    headline: '公司研究服务执行失败，未生成资料',
    references: [COMPANY_RESEARCH_SERVICE_LABEL],
    evidence: [],
    attachments: [],
    contextFrame: buildCompanyContextFrame(companyName),
    toolCalls,
    policyDecisions: [
      createPolicyDecision({
        policyCode: 'external.company_research.no_degraded_artifact',
        action: 'block',
        toolCode: COMPANY_RESEARCH_TOOL,
        reason: `外部公司研究失败时不得生成降级资料：${rawMessage}`,
      }),
    ],
  };
}

function sanitizeCompanyResearchUserError(value: string): string {
  return value
    .replace(/skill/gi, '服务')
    .replace(/company-research/g, '公司研究服务')
    .replace(/ext\.company_research_pm/g, COMPANY_RESEARCH_SERVICE_LABEL)
    .replace(/Artifact/g, '资料')
    .replace(/Markdown/g, '研究资料')
    .replace(/服务\s+依赖/g, '服务依赖');
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

function evaluateCompanyResearchResult(companyName: string, markdown: string): CompanyResearchEvaluation {
  const normalizedMarkdown = markdown.replace(/\s+/g, '');
  const visibleText = markdown.replace(/\s+/g, ' ').trim();
  if (!visibleText) {
    return { usable: false, reason: '公司研究服务没有返回有效内容。' };
  }

  const invalidPatterns = [
    /未(?:检索|搜索|查询|找到|发现)(?:到)?.{0,24}(?:对应|有效|可靠|公开|目标)?.{0,12}(?:公司|资料|信息|主体|结果)/,
    /没有(?:检索|搜索|查询|找到|发现)(?:到)?.{0,24}(?:对应|有效|可靠|公开|目标)?.{0,12}(?:公司|资料|信息|主体|结果)/,
    /(?:未能|无法|不能).{0,16}(?:确认|核实|验证|识别).{0,16}(?:公司|主体|企业|目标)/,
    /(?:无|缺少).{0,12}(?:有效|可靠|公开).{0,12}(?:资料|信息|来源|数据)/,
    /请(?:提供|补充|确认).{0,12}(?:公司全称|公司名称|准确名称|目标公司)/,
    /(?:疑似)?不存在(?:该|这个|目标)?(?:公司|企业)?/,
    /未生成公司研究资料/,
  ];
  if (invalidPatterns.some((pattern) => pattern.test(visibleText) || pattern.test(normalizedMarkdown))) {
    return { usable: false, reason: '未检索到可确认的目标公司有效公开资料。' };
  }

  if (!mentionsTargetCompany(companyName, markdown)) {
    return { usable: false, reason: '返回内容没有明确指向目标公司主体。' };
  }

  const researchSignals = [
    '公司概览',
    '企业概览',
    '公司概况',
    '企业概况',
    '业务定位',
    '主营业务',
    '主要产品',
    '产品',
    '服务',
    '经营范围',
    '行业',
    '市场',
    '客户',
    '竞争',
    '成长驱动',
    '增长驱动',
    '核心风险',
    '风险',
    '机会',
    '来源',
    '引用',
    '官网',
    '公开资料',
  ];
  if (!researchSignals.some((token) => visibleText.includes(token) || normalizedMarkdown.includes(token))) {
    return { usable: false, reason: '返回内容缺少公司概览、业务定位、风险或来源等有效研究信息。' };
  }

  return { usable: true, reason: '已确认目标公司主体且包含有效研究内容。' };
}

function mentionsTargetCompany(companyName: string, markdown: string): boolean {
  const normalizedMarkdown = normalizeCompanyResearchText(markdown);
  const aliases = buildCompanyNameAliases(companyName);
  return aliases.some((alias) => normalizedMarkdown.includes(alias));
}

function buildCompanyNameAliases(companyName: string): string[] {
  const normalized = normalizeCompanyResearchText(companyName);
  const suffixStripped = normalized.replace(/(?:有限责任公司|股份有限公司|集团有限公司|有限公司|集团|公司|股份)$/g, '');
  const aliases = [normalized, suffixStripped]
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  return Array.from(new Set(aliases));
}

function normalizeCompanyResearchText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

function summarizeMarkdown(markdown: string): string {
  const preferredSectionPattern = /(公司概览|企业概览|业务定位|主营业务|成长驱动|增长驱动|核心风险|风险|机会|竞争|客户画像|价值|建议)/;
  const allItems: string[] = [];
  const preferredItems: string[] = [];
  let currentHeading = '';

  for (const rawLine of markdown.split('\n')) {
    const heading = rawLine.match(/^#{1,6}\s+(.+)$/)?.[1];
    if (heading) {
      currentHeading = cleanMarkdownLine(heading);
      continue;
    }

    const text = cleanMarkdownLine(rawLine);
    if (!text || isMarkdownNoiseLine(text)) {
      continue;
    }
    const item = currentHeading && !text.includes(currentHeading)
      ? `${currentHeading}：${text}`
      : text;
    const normalized = trimSummaryItem(item);
    if (!normalized || allItems.includes(normalized)) {
      continue;
    }
    allItems.push(normalized);
    if (preferredSectionPattern.test(currentHeading) || preferredSectionPattern.test(text)) {
      preferredItems.push(normalized);
    }
  }

  const merged = [...preferredItems, ...allItems.filter((item) => !preferredItems.includes(item))];
  return merged.slice(0, 8).map((line) => `- ${line}`).join('\n') || '已有公司研究资料可供参考。';
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

function trimSummaryItem(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
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
