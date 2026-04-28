import { randomUUID } from 'node:crypto';
import type {
  AgentEvidenceCard,
  AppConfig,
  ArtifactAnchor,
  ExternalSkillJobResponse,
  IntentFrame,
  ShadowObjectKey,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
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
  type RecordToolCapability,
  createPolicyDecision,
  createToolCall,
  finishToolCall,
} from './agent-core.js';
import type { AgentRunRepository } from './agent-run-repository.js';
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
const COMPANY_RESEARCH_POLL_INTERVAL_MS = 1000;
const COMPANY_RESEARCH_MAX_WAIT_MS = 420_000;

const CRM_RECORD_CAPABILITIES: Record<ShadowObjectKey, RecordToolCapability> = {
  customer: {
    subjectBinding: { acceptedSubjectTypes: ['company', 'customer', 'artifact_anchor'] },
    identityFields: ['customer_name'],
    duplicateCheckPolicy: { enabled: true, maxCandidates: 5 },
    previewInputPolicy: {
      subjectNameParam: 'customer_name',
      writableParams: ['customer_name'],
    },
  },
  contact: {
    subjectBinding: { acceptedSubjectTypes: ['contact'] },
    identityFields: ['_S_NAME'],
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: '_S_NAME',
      writableParams: ['_S_NAME'],
    },
  },
  opportunity: {
    subjectBinding: { acceptedSubjectTypes: ['opportunity'] },
    identityFields: ['opportunity_name'],
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: 'opportunity_name',
      writableParams: ['opportunity_name'],
    },
  },
  followup: {
    subjectBinding: { acceptedSubjectTypes: ['followup'] },
    identityFields: ['Te_0'],
    duplicateCheckPolicy: { enabled: false },
    previewInputPolicy: {
      subjectNameParam: 'Te_0',
      writableParams: ['Te_0', 'content', 'summary'],
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
  async plan(input: AgentPlannerInput): Promise<AgentPlannerResult> {
    const selectedTool = selectTool(input);
    const taskPlan = buildToolTaskPlan(input.intentFrame.legacyIntentFrame, selectedTool);
    return {
      taskPlan,
      selectedTool,
      policyDecisions: [
        createPolicyDecision({
          policyCode: 'runtime.no_scene_tools',
          action: 'audit',
          toolCode: selectedTool?.toolCode,
          reason: '运行时只允许 record/external/meta/artifact 工具，不选择 scene.*。',
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
  registerMetaTools(registry);

  return {
    registry,
    intentResolver: new CrmIntentResolver({
      intentFrameService: options.intentFrameService,
    }),
    planner: new CrmAgentPlanner(),
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

function selectTool(input: AgentPlannerInput): AgentToolSelection | null {
  const query = input.request.query.trim();
  const target = input.intentFrame.target;

  if (hasAudioInput(input.request)) {
    return {
      toolCode: 'meta.clarify_card',
      reason: '当前 MVP 不做录音转写，需要用户补充文字纪要。',
      input: {
        missingSlots: ['文字纪要'],
      },
      confidence: 0.82,
    };
  }

  if (target.kind === 'artifact' || isArtifactFollowupQuestion(query)) {
    return {
      toolCode: 'artifact.search',
      reason: '用户正在追问已有研究或资产证据。',
      input: {
        query,
        anchorName: target.name || input.focusedName,
      },
      confidence: 0.78,
    };
  }

  if (target.kind === 'external_subject' && target.objectType === 'company') {
    return {
      toolCode: COMPANY_RESEARCH_TOOL,
      reason: '用户请求公司研究，选择外部研究工具。',
      input: {
        companyName: target.name || extractCompanyName(query),
      },
      confidence: 0.86,
    };
  }

  if (target.kind === 'record' && target.objectType) {
    const objectKey = target.objectType;
    const operation = resolveRecordOperation(query, input.intentFrame.legacyIntentFrame);
    const toolCode = `record.${objectKey}.${operation}`;
    const tool = input.availableTools.find((item) => item.code === toolCode);
    return {
      toolCode,
      reason: `用户意图落在记录对象 ${objectKey} 的 ${operation} 能力。`,
      input: buildRecordToolInput({
        query,
        objectKey,
        operation,
        operatorOpenId: input.request.tenantContext?.operatorOpenId,
        targetName: target.name,
        tool,
      }),
      confidence: 0.76,
    };
  }

  return {
    toolCode: 'meta.clarify_card',
    reason: '目标对象或任务动作不完整。',
    input: {
      missingSlots: input.intentFrame.missingSlots.length
        ? input.intentFrame.missingSlots
        : ['目标对象或任务类型'],
    },
    confidence: 0.6,
  };
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
}): Record<string, unknown> {
  const name = input.targetName || extractRecordName(input.query, input.objectKey);
  const capability = input.tool?.recordCapability ?? CRM_RECORD_CAPABILITIES[input.objectKey as ShadowObjectKey];
  const identityField = capability.identityFields?.[0] ?? inferRecordNameParam(input.objectKey);
  if (input.operation === 'search') {
    return {
      filters: name
        ? [
            {
              field: identityField,
              value: name,
              operator: 'like',
            },
          ]
        : [],
      operatorOpenId: input.operatorOpenId,
      pageNumber: 1,
      pageSize: 5,
    };
  }
  if (input.operation === 'get') {
    return {
      formInstId: extractFormInstId(input.query),
      operatorOpenId: input.operatorOpenId,
    };
  }
  if (input.operation === 'preview_update') {
    return {
      mode: 'update',
      formInstId: extractFormInstId(input.query),
      params: buildRecordParams(input.objectKey, input.query, name, capability),
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
    params: buildRecordParams(input.objectKey, input.query, name, capability),
    operatorOpenId: input.operatorOpenId,
    ...(duplicateCheck ? { agentControl: { duplicateCheck, subjectName: name } } : {}),
  };
}

function buildRecordParams(
  objectKey: string,
  query: string,
  name: string,
  capability: RecordToolCapability,
): Record<string, unknown> {
  const subjectNameParam = capability.previewInputPolicy?.subjectNameParam ?? inferRecordNameParam(objectKey);
  const params: Record<string, unknown> = name ? { [subjectNameParam]: name } : {};
  if (objectKey === 'followup' && query.trim()) {
    params.content = query.trim();
    params.summary = query.trim();
    params[subjectNameParam] = name || query.trim();
  }
  return params;
}

function inferRecordNameParam(objectKey: string): string {
  if (objectKey === 'opportunity') {
    return 'opportunity_name';
  }
  if (objectKey === 'customer') {
    return 'customer_name';
  }
  return '_S_NAME';
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
  return ['最近', '关注', '值得关注', '有什么', '卡在哪里', '风险'].some((token) => query.includes(token))
    && !/(研究|分析一下|公司分析|客户分析)/.test(query);
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
    execute: (input, context) => executeRecordReadTool(options, objectKey, 'search', input, context),
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
    execute: (input, context) => executeRecordReadTool(options, objectKey, 'get', input, context),
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
    const result = operation === 'search'
      ? await options.shadowMetadataService.executeSearch(objectKey, {
          ...input.selectedTool.input,
          operatorOpenId: context.operatorOpenId ?? undefined,
        })
      : await options.shadowMetadataService.executeGet(objectKey, {
          ...input.selectedTool.input,
          operatorOpenId: context.operatorOpenId ?? undefined,
        });
    finishToolCall(toolCall, 'succeeded', operation === 'search' ? `records=${(result as any).records?.length ?? 0}` : 'record loaded');
    return {
      status: 'completed',
      content: `## 记录工具已执行\n- 工具：\`${input.selectedTool.toolCode}\`\n- 对象：\`${objectKey}\`\n\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 3000)}\n\`\`\``,
      headline: '记录对象读取完成',
      references: [input.selectedTool.toolCode],
      toolCalls: [toolCall],
    };
  } catch (error) {
    finishToolCall(toolCall, 'failed', '记录读取失败', error);
    throw error;
  }
}

interface RecordAgentControl {
  duplicateCheck?: {
    enabled?: boolean;
    searchToolCode?: string;
    filters?: ShadowPreviewSearchInput['filters'];
    pageNumber?: number;
    pageSize?: number;
  };
  subjectName?: string;
}

function readRecordAgentControl(input: Record<string, unknown>): RecordAgentControl {
  const control = input.agentControl;
  return control && typeof control === 'object' ? control as RecordAgentControl : {};
}

function stripRecordAgentControl(input: Record<string, unknown>): Record<string, unknown> {
  const { agentControl: _agentControl, ...rest } = input;
  return rest;
}

async function executeDuplicateCheckIfNeeded(input: {
  options: CrmAgentPackOptions;
  objectKey: ShadowObjectKey;
  mode: 'create' | 'update';
  context: AgentToolExecuteContext;
  agentControl: RecordAgentControl;
}): Promise<{
  toolCalls: AgentToolExecutionResult['toolCalls'];
  result?: AgentToolExecutionResult;
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
  if (!input.context.operatorOpenId) {
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

  const search = await input.options.shadowMetadataService.executeSearch(input.objectKey, searchInput);
  const records = Array.isArray(search.records) ? search.records : [];
  finishToolCall(searchCall, 'succeeded', `duplicateCandidates=${records.length}`);

  if (records.length === 0) {
    return { toolCalls: [searchCall] };
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

async function executeRecordPreviewTool(
  options: CrmAgentPackOptions,
  objectKey: ShadowObjectKey,
  mode: 'create' | 'update',
  input: AgentToolExecuteInput,
  context: AgentToolExecuteContext,
): Promise<AgentToolExecutionResult> {
  const agentControl = readRecordAgentControl(input.selectedTool.input);
  const requestInput = {
    ...stripRecordAgentControl(input.selectedTool.input),
    mode,
    operatorOpenId: context.operatorOpenId ?? undefined,
  } as ShadowPreviewUpsertInput;
  const toolCall = createToolCall(context.runId, input.selectedTool.toolCode, JSON.stringify(requestInput));
  const guardToolCalls = await executeDuplicateCheckIfNeeded({
    options,
    objectKey,
    mode,
    context,
    agentControl,
  });
  if (guardToolCalls.result) {
    finishToolCall(toolCall, 'skipped', '写入预览前发现候选记录或缺少运行输入');
    return {
      ...guardToolCalls.result,
      toolCalls: [...guardToolCalls.toolCalls, toolCall],
    };
  }

  const preview = await options.shadowMetadataService.previewUpsert(objectKey, requestInput);
  const toolCalls = [...guardToolCalls.toolCalls, toolCall];
  if (!preview.readyToSend) {
    finishToolCall(toolCall, 'skipped', '写入预览参数不完整');
    const hasVisibleReason = preview.missingRequiredParams.length > 0
      || preview.blockedReadonlyParams.length > 0
      || preview.missingRuntimeInputs.length > 0
      || preview.validationErrors.length > 0;
    return {
      status: 'waiting_input',
      content: [
        preview.blockedReadonlyParams.length ? '## 写入参数包含只读字段' : '## 写入前还需要补充信息',
        `- 工具：\`${input.selectedTool.toolCode}\``,
        `- 缺少必填：${preview.missingRequiredParams.join('、') || '无'}`,
        `- 只读字段：${preview.blockedReadonlyParams.join('、') || '无'}`,
        `- 缺少运行输入：${preview.missingRuntimeInputs.join('、') || '无'}`,
        `- 校验错误：${preview.validationErrors.join('、') || '无'}`,
        ...(hasVisibleReason
          ? []
          : ['- 阻断原因：记录工具返回 `readyToSend=false`，但未给出具体缺失项；请检查工具契约或字段映射。']),
      ].join('\n'),
      headline: preview.blockedReadonlyParams.length ? '写入参数被工具契约阻断' : '写入预览未就绪',
      references: ['meta.clarify_card', input.selectedTool.toolCode],
      toolCalls,
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

  const confirmation: ConfirmationRequest = {
    confirmationId: randomUUID(),
    runId: context.runId,
    toolCode: input.selectedTool.toolCode,
    title: `${objectKey} ${mode} 写回确认`,
    summary: `确认后将通过轻云记录系统执行 ${objectKey} ${mode} 写回。`,
    preview,
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
    content: [
      '## 已生成写入预览，等待确认',
      `- 工具：\`${input.selectedTool.toolCode}\``,
      `- 确认 ID：\`${confirmation.confirmationId}\``,
      '- 确认后才会执行真实轻云写回。',
      '',
      '```json',
      JSON.stringify(preview, null, 2).slice(0, 3000),
      '```',
    ].join('\n'),
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

  if (input.resumeDecision?.decision !== 'approve') {
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

  const result = await options.shadowMetadataService.executeUpsert(
    objectKey,
    pending.requestInput as unknown as ShadowPreviewUpsertInput,
  );
  const approved = options.repository.resolveConfirmation({
    runId: context.runId,
    confirmationId,
    status: 'approved',
  }) ?? pending;
  finishToolCall(toolCall, 'succeeded', `formInstIds=${result.formInstIds.join(',')}`);
  return {
    status: 'completed',
    content: [
      '## 写回已完成',
      `- 工具：\`${input.selectedTool.toolCode}\``,
      `- 确认 ID：\`${confirmationId}\``,
      `- 表单实例：${result.formInstIds.map((item) => `\`${item}\``).join('、')}`,
    ].join('\n'),
    headline: `${objectKey} ${mode} 写回完成`,
    references: [input.selectedTool.toolCode, 'meta.confirm_writeback'],
    toolCalls: [toolCall],
    pendingConfirmation: approved,
  };
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

function registerMetaTools(registry: AgentToolRegistry): void {
  for (const tool of [
    ['meta.clarify_card', '澄清卡片', 'user_input_required'],
    ['meta.candidate_selection', '候选选择', 'user_input_required'],
    ['meta.plan_builder', '计划生成', 'editable_by_user'],
    ['meta.confirm_writeback', '确认写回', 'required_before_write'],
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
