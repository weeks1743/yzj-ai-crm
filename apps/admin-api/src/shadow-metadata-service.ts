import { createHash, randomUUID } from 'node:crypto';
import type {
  AppConfig,
  ShadowExecuteDeleteResponse,
  ShadowExecuteGetResponse,
  ShadowExecuteSearchResponse,
  ShadowExecuteUpsertResponse,
  ShadowDictionaryBindingRecord,
  ShadowDictionaryEntryRecord,
  ShadowLiveRecord,
  ShadowLiveRecordField,
  ShadowObjectConfig,
  ShadowObjectSnapshotRecord,
  ShadowObjectDetailResponse,
  ShadowObjectKey,
  ShadowObjectSummaryResponse,
  ShadowPreviewDeleteInput,
  ShadowPreviewGetInput,
  ShadowPreviewResponse,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
  ShadowResolvedDictionaryMapping,
  ShadowSemanticSlot,
  ShadowSkillContract,
  ShadowStandardizedField,
  YzjApprovalWidget,
} from './contracts.js';
import { ApprovalClient } from './approval-client.js';
import { DictionaryResolver } from './dictionary-resolver.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { LightCloudClient } from './lightcloud-client.js';
import { ShadowSkillBundleWriter } from './shadow-skill-bundle-writer.js';
import { ShadowMetadataRepository } from './shadow-metadata-repository.js';

const SUPPORTED_WRITABLE_WIDGET_TYPES = new Set([
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
  'attachmentWidget',
  'basicDataWidget',
]);

const SUPPORTED_SEARCHABLE_WIDGET_TYPES = new Set([
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

const ALWAYS_READONLY_WIDGET_TYPES = new Set([
  'describeWidget',
  'arithmeticWidget',
  'serialNumWidget',
  'relatedWidget',
  'kingGridWidget',
  'imageWidget',
  'detailedWidget',
]);

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PreparedDictionaryBinding {
  fieldCode: string;
  label: string;
  referId: string | null;
  source: ShadowDictionaryBindingRecord['source'];
  resolutionStatus: ShadowDictionaryBindingRecord['resolutionStatus'];
  entries: Array<Omit<ShadowDictionaryEntryRecord, 'sourceVersion'>>;
}

interface ShadowMetadataServiceOptions {
  config: AppConfig;
  repository: ShadowMetadataRepository;
  approvalClient: ApprovalClient;
  lightCloudClient: LightCloudClient;
  dictionaryResolver: DictionaryResolver;
  skillBundleWriter?: ShadowSkillBundleWriter;
  now?: () => Date;
}

interface PreparedUpsertExecution {
  requestBody: Record<string, unknown>;
  resolvedDictionaryMappings: ShadowResolvedDictionaryMapping[];
  missingRequiredParams: string[];
  blockedReadonlyParams: string[];
  missingRuntimeInputs: string[];
  validationErrors: string[];
  readyToSend: boolean;
}

interface PreparedDeleteExecution {
  requestBody: Record<string, unknown>;
  missingRequiredParams: string[];
  missingRuntimeInputs: string[];
  validationErrors: string[];
  readyToSend: boolean;
}

interface SearchFieldNormalizationResult {
  value: unknown;
  validationErrors: string[];
  resolvedMapping?: ShadowResolvedDictionaryMapping;
  searchOperator?: string | null;
  searchItemAttributes?: Record<string, unknown>;
}

function getActivationStatus(config: ShadowObjectConfig): ShadowObjectSummaryResponse['activationStatus'] {
  if (!config.formCodeId) {
    return 'not_configured';
  }

  return config.enabled ? 'active' : 'pending';
}

function parseReferId(widget: YzjApprovalWidget): string | undefined {
  if (typeof widget.referId === 'string' && widget.referId.trim()) {
    return widget.referId.trim();
  }

  const extendFieldReferId = widget.extendFieldMap?.referId;
  return typeof extendFieldReferId === 'string' && extendFieldReferId.trim()
    ? extendFieldReferId.trim()
    : undefined;
}

function parseDateOnlyParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return { year, month, day };
}

function getShanghaiDayBoundsFromParts(parts: {
  year: number;
  month: number;
  day: number;
}): [number, number] {
  const start = Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_UTC_OFFSET_MS;
  return [start, start + DAY_MS - 1];
}

function getShanghaiDayBoundsFromTimestamp(timestamp: number): [number, number] {
  const shifted = new Date(timestamp + SHANGHAI_UTC_OFFSET_MS);
  return getShanghaiDayBoundsFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function parseSearchDateSingleValue(rawValue: unknown): number | null {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const trimmed = rawValue.trim();
  const dateOnlyParts = parseDateOnlyParts(trimmed);
  if (dateOnlyParts) {
    return getShanghaiDayBoundsFromParts(dateOnlyParts)[0];
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseSearchDateRangeBoundary(rawValue: unknown, boundary: 'start' | 'end'): number | null {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const trimmed = rawValue.trim();
  const dateOnlyParts = parseDateOnlyParts(trimmed);
  if (dateOnlyParts) {
    const [start, end] = getShanghaiDayBoundsFromParts(dateOnlyParts);
    return boundary === 'start' ? start : end;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseBasicDataBinding(widget: YzjApprovalWidget): ShadowStandardizedField['relationBinding'] | undefined {
  if (widget.type !== 'basicDataWidget') {
    return undefined;
  }

  const extendFieldMap = widget.extendFieldMap as Record<string, unknown> | null | undefined;
  const extendSettingDataMap =
    extendFieldMap?.extendSettingDataMap &&
    typeof extendFieldMap.extendSettingDataMap === 'object'
      ? (extendFieldMap.extendSettingDataMap as Record<string, unknown>)
      : null;
  const linkForm =
    extendSettingDataMap?.linkForm && typeof extendSettingDataMap.linkForm === 'object'
      ? (extendSettingDataMap.linkForm as Record<string, unknown>)
      : null;
  const dataSource =
    widget.dataSource && typeof widget.dataSource === 'object'
      ? (widget.dataSource as Record<string, unknown>)
      : null;

  const formCodeIdCandidates = [
    typeof linkForm?.modelCode === 'string' ? linkForm.modelCode : null,
    typeof dataSource?.modelCode === 'string' ? dataSource.modelCode : null,
    typeof dataSource?.partCode === 'string' ? dataSource.partCode : null,
  ];
  const displayColCandidates = [
    typeof extendFieldMap?.displayCol === 'string' ? extendFieldMap.displayCol : null,
    typeof extendSettingDataMap?.displayCol === 'string' ? extendSettingDataMap.displayCol : null,
  ];
  const modelNameCandidates = [
    typeof linkForm?.modelName === 'string' ? linkForm.modelName : null,
    typeof dataSource?.modelName === 'string' ? dataSource.modelName : null,
    typeof dataSource?.partName === 'string' ? dataSource.partName : null,
  ];

  const formCodeId = formCodeIdCandidates.find((value): value is string => Boolean(value?.trim())) ?? null;
  const displayCol = displayColCandidates.find((value): value is string => Boolean(value?.trim())) ?? null;
  const modelName = modelNameCandidates.find((value): value is string => Boolean(value?.trim())) ?? null;

  return {
    kind: 'basic_data',
    formCodeId,
    modelName,
    displayCol,
  };
}

function isMultiValue(widget: YzjApprovalWidget): boolean {
  if (widget.type === 'checkboxWidget' || widget.type === 'publicOptBoxWidget') {
    return true;
  }

  return widget.option === 'multi';
}

function isReadOnlyWidget(widget: YzjApprovalWidget): boolean {
  if (widget.codeId.startsWith('_S_')) {
    return true;
  }

  if (widget.readOnly === true) {
    return true;
  }

  return ALWAYS_READONLY_WIDGET_TYPES.has(widget.type);
}

function isWritableSystemShadowField(objectKey: ShadowObjectKey, widget: YzjApprovalWidget): boolean {
  return (
    objectKey === 'contact' &&
    widget.type === 'textWidget' &&
    ['_S_NAME', '_S_TITLE', '_S_ENCODE'].includes(widget.codeId)
  );
}

function normalizeStaticOptions(widget: YzjApprovalWidget) {
  return (widget.options ?? []).map((option) => ({
    title: String(option.value ?? option.key ?? ''),
    key: option.key,
    value: option.value,
  }));
}

function inferSemanticSlot(label: string, widgetType: string): ShadowSemanticSlot | undefined {
  const normalized = label.replace(/\s+/g, '').toLowerCase();

  if (/客户名称|客户简称|名称/.test(label) && widgetType === 'textWidget') {
    return 'customer_name';
  }

  if (/售后服务代表/.test(label) && widgetType === 'personSelectWidget') {
    return 'service_rep_open_id';
  }

  if (/负责人|拥有者|销售|跟进人|所属人/.test(label) && widgetType === 'personSelectWidget') {
    return 'owner_open_id';
  }

  if (/客户类型/.test(label)) {
    return 'customer_type';
  }

  if (/客户状态|状态/.test(label)) {
    return 'customer_status';
  }

  if (/行业/.test(label)) {
    return 'industry';
  }

  if (/最后跟进日期/.test(label)) {
    return 'last_followup_date';
  }

  if (/客户/.test(label) && widgetType === 'basicDataWidget') {
    return 'linked_customer_form_inst_id';
  }

  if (/联系人/.test(label) && widgetType === 'basicDataWidget') {
    return 'linked_contact_form_inst_id';
  }

  if (/地区|区域|省|市/.test(label) || normalized.includes('region')) {
    return 'region';
  }

  if (/电话|手机|联系方式|联系电话/.test(label)) {
    return 'phone';
  }

  return undefined;
}

function buildSchemaHash(fields: ShadowStandardizedField[]): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function getFieldParameterKey(field: ShadowStandardizedField): string {
  return field.semanticSlot ?? field.fieldCode;
}

function getSearchFieldParameterKey(
  field: ShadowStandardizedField,
  searchableFields: ShadowStandardizedField[],
): string {
  if (!field.semanticSlot) {
    return field.fieldCode;
  }

  const semanticSlotMatches = searchableFields.filter(
    (candidate) => candidate.semanticSlot === field.semanticSlot,
  );
  return semanticSlotMatches.length > 1 ? field.fieldCode : field.semanticSlot;
}

function isIgnoredSkillField(field: ShadowStandardizedField): boolean {
  if (field.widgetType === 'publicOptBoxWidget' && !field.referId) {
    return true;
  }

  return false;
}

function isFieldEligibleForContract(field: ShadowStandardizedField): boolean {
  if (
    isIgnoredSkillField(field) ||
    field.readOnly ||
    !SUPPORTED_WRITABLE_WIDGET_TYPES.has(field.widgetType)
  ) {
    return false;
  }

  if (field.widgetType === 'publicOptBoxWidget') {
    return field.enumBinding?.resolutionStatus === 'resolved';
  }

  if (field.widgetType === 'basicDataWidget') {
    return Boolean(field.relationBinding?.formCodeId);
  }

  return true;
}

function isFieldEligibleForSearchContract(field: ShadowStandardizedField): boolean {
  if (
    isIgnoredSkillField(field) ||
    !SUPPORTED_SEARCHABLE_WIDGET_TYPES.has(field.widgetType) ||
    field.widgetType === 'attachmentWidget'
  ) {
    return false;
  }

  if (field.widgetType === 'publicOptBoxWidget') {
    return field.enumBinding?.resolutionStatus === 'resolved';
  }

  if (field.widgetType === 'basicDataWidget') {
    return Boolean(field.relationBinding?.formCodeId);
  }

  return true;
}

function mapShadowObjectLabel(objectKey: ShadowObjectKey): string {
  switch (objectKey) {
    case 'customer':
      return '客户';
    case 'contact':
      return '联系人';
    case 'opportunity':
      return '商机';
    case 'followup':
      return '商机跟进记录';
  }
}

function readFormInstId(input: {
  formInstId?: string;
}): string {
  if (typeof input.formInstId === 'string' && input.formInstId.trim()) {
    return input.formInstId.trim();
  }

  return '';
}

function readFormInstIds(input: {
  formInstIds?: string[];
}): string[] {
  if (!Array.isArray(input.formInstIds)) {
    return [];
  }

  return input.formInstIds
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class ShadowMetadataService {
  private readonly config: AppConfig;
  private readonly repository: ShadowMetadataRepository;
  private readonly approvalClient: ApprovalClient;
  private readonly lightCloudClient: LightCloudClient;
  private readonly dictionaryResolver: DictionaryResolver;
  private readonly skillBundleWriter: ShadowSkillBundleWriter;
  private readonly now: () => Date;

  constructor(options: ShadowMetadataServiceOptions) {
    this.config = options.config;
    this.repository = options.repository;
    this.approvalClient = options.approvalClient;
    this.lightCloudClient = options.lightCloudClient;
    this.dictionaryResolver = options.dictionaryResolver;
    this.skillBundleWriter = options.skillBundleWriter ?? new ShadowSkillBundleWriter({
      outputDir: this.config.shadow.skillOutputDir,
    });
    this.now = options.now ?? (() => new Date());
  }

  listObjects(): ShadowObjectSummaryResponse[] {
    this.syncRegistryConfig();
    return this.repository.listObjectRegistry();
  }

  getObject(objectKey: ShadowObjectKey): ShadowObjectDetailResponse {
    const context = this.getObjectContext(objectKey);
    return {
      ...context.registry,
      fields: context.snapshot?.normalizedFields ?? [],
      snapshotVersion: context.snapshot?.snapshotVersion ?? context.registry.latestSnapshotVersion,
      schemaHash: context.snapshot?.schemaHash ?? context.registry.latestSchemaHash,
    };
  }

  listSkills(objectKey: ShadowObjectKey): ShadowSkillContract[] {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      return [];
    }

    return this.materializeSkillBundles({
      objectKey,
      objectLabel: context.registry.label,
      formCodeId: context.registry.formCodeId,
      formDefId: context.snapshot.formDefId,
      snapshotVersion: context.snapshot.snapshotVersion,
      schemaHash: context.snapshot.schemaHash,
      rawTemplate: context.snapshot.rawTemplate,
      fields: context.snapshot.normalizedFields,
      dictionaryBindings: context.snapshot.dictionaryBindings,
    });
  }

  listDictionaries(objectKey: ShadowObjectKey): ShadowDictionaryBindingRecord[] {
    const context = this.getObjectContext(objectKey);
    return context.snapshot?.dictionaryBindings ?? [];
  }

  async refreshObject(objectKey: ShadowObjectKey): Promise<ShadowObjectDetailResponse> {
    const context = this.getObjectContext(objectKey);
    if (context.registry.activationStatus !== 'active') {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}对象当前未激活，不能执行刷新`);
    }

    if (!context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}未配置 formCodeId`);
    }

    try {
      const accessToken = await this.approvalClient.getTeamAccessToken({
        eid: this.config.yzj.eid,
        appId: this.config.yzj.approval.appId,
        secret: this.config.yzj.approval.appSecret,
      });
      const template = await this.approvalClient.viewFormDef({
        accessToken,
        formCodeId: context.registry.formCodeId,
      });

      const normalized = await this.normalizeTemplate({
        objectKey,
        formCodeId: context.registry.formCodeId,
        accessToken,
        widgetMap: template.formInfo?.widgetMap ?? {},
      });
      const schemaHash = buildSchemaHash(normalized.fields);
      const latestSnapshot = this.repository.getLatestSnapshot(objectKey);

      if (latestSnapshot?.schemaHash === schemaHash) {
        this.materializeSkillBundles({
          objectKey,
          objectLabel: context.registry.label,
          formCodeId: context.registry.formCodeId,
          formDefId: template.formDefId ?? latestSnapshot.formDefId,
          snapshotVersion: latestSnapshot.snapshotVersion,
          schemaHash,
          rawTemplate: template,
          fields: latestSnapshot.normalizedFields,
          dictionaryBindings: latestSnapshot.dictionaryBindings,
        });

        this.repository.markRefreshReady({
          objectKey,
          formCodeId: context.registry.formCodeId,
          formDefId: template.formDefId ?? null,
          snapshotVersion: latestSnapshot.snapshotVersion,
          schemaHash,
          now: this.now().toISOString(),
        });

        return this.getObject(objectKey);
      }

      const snapshotVersion = this.now().toISOString();
      const snapshotId = randomUUID();
      const dictionaryBindings = normalized.dictionaryBindings.map((binding) => ({
        objectKey,
        fieldCode: binding.fieldCode,
        label: binding.label,
        referId: binding.referId,
        source: binding.source,
        resolutionStatus: binding.resolutionStatus,
        acceptedValueShape: 'array<{title,dicId}>' as const,
        snapshotVersion,
        entries: binding.entries.map((entry) => ({
          ...entry,
          sourceVersion: snapshotVersion,
        })),
      }));

      this.repository.saveSnapshot({
        id: snapshotId,
        objectKey,
        snapshotVersion,
        schemaHash,
        formCodeId: context.registry.formCodeId,
        formDefId: template.formDefId ?? null,
        normalizedFields: normalized.fields,
        dictionaryBindings,
        rawTemplate: template,
        createdAt: snapshotVersion,
      });

      this.materializeSkillBundles({
        objectKey,
        objectLabel: context.registry.label,
        formCodeId: context.registry.formCodeId,
        formDefId: template.formDefId ?? null,
        snapshotVersion,
        schemaHash,
        rawTemplate: template,
        fields: normalized.fields,
        dictionaryBindings,
      });

      this.repository.markRefreshReady({
        objectKey,
        formCodeId: context.registry.formCodeId,
        formDefId: template.formDefId ?? null,
        snapshotVersion,
        schemaHash,
        now: snapshotVersion,
      });

      return this.getObject(objectKey);
    } catch (error) {
      this.repository.markRefreshFailed({
        objectKey,
        formCodeId: context.registry.formCodeId,
        formDefId: null,
        message: error instanceof Error ? error.message : '刷新失败',
        now: this.now().toISOString(),
      });
      throw error;
    }
  }

  async previewSearch(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewSearchInput,
  ): Promise<ShadowPreviewResponse> {
    const prepared = await this.prepareSearchExecution(objectKey, input);

    return {
      objectKey,
      operation: 'search',
      unresolvedDictionaries: this.buildUnresolvedDictionarySummaries(objectKey),
      resolvedDictionaryMappings: prepared.resolvedDictionaryMappings,
      missingRequiredParams: [],
      blockedReadonlyParams: [],
      missingRuntimeInputs: prepared.missingRuntimeInputs,
      validationErrors: prepared.validationErrors,
      readyToSend:
        prepared.validationErrors.length === 0 &&
        prepared.missingRuntimeInputs.length === 0,
      requestBody: prepared.requestBody,
    };
  }

  async executeSearch(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewSearchInput,
  ): Promise<ShadowExecuteSearchResponse> {
    const operatorOpenId = input.operatorOpenId?.trim();
    if (!operatorOpenId) {
      throw new BadRequestError('真实查询必须提供 operatorOpenId');
    }

    const prepared = await this.prepareSearchExecution(objectKey, input);
    if (prepared.validationErrors.length > 0) {
      throw new BadRequestError('真实查询前参数校验失败', {
        validationErrors: prepared.validationErrors,
      });
    }

    const requestBody = {
      ...prepared.requestBody,
      oid: operatorOpenId,
    };
    const accessToken = await this.lightCloudClient.getTeamAccessToken({
      eid: this.config.yzj.eid,
      appId: this.config.yzj.lightCloud.appId,
      secret: this.config.yzj.lightCloud.appSecret,
    });
    const page = await this.lightCloudClient.searchList({
      accessToken,
      body: requestBody,
    });

    return {
      objectKey,
      operation: 'search',
      mode: 'live',
      requestBody,
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
      totalElements: page.totalElements,
      records: page.content.map((record) => this.mapLiveRecord(record)),
    };
  }

  private async prepareSearchExecution(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewSearchInput,
  ): Promise<{
    requestBody: Record<string, unknown>;
    resolvedDictionaryMappings: ShadowResolvedDictionaryMapping[];
    missingRuntimeInputs: string[];
    validationErrors: string[];
  }> {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}尚未刷新元数据，无法生成查询预演`);
    }

    const bindingMap = new Map(
      (context.snapshot.dictionaryBindings ?? []).map((binding) => [binding.fieldCode, binding]),
    );
    const validationErrors: string[] = [];
    const resolvedDictionaryMappings: ShadowResolvedDictionaryMapping[] = [];
    const searchItems: Record<string, unknown>[] = [];
    const pagination = this.validateSearchPagination(input);
    validationErrors.push(...pagination.validationErrors);

    const getAccessToken = (() => {
      let tokenPromise: Promise<string> | null = null;
      return () => {
        tokenPromise ??= this.lightCloudClient.getTeamAccessToken({
          eid: this.config.yzj.eid,
          appId: this.config.yzj.lightCloud.appId,
          secret: this.config.yzj.lightCloud.appSecret,
        });
        return tokenPromise;
      };
    })();

    for (const filter of input.filters ?? []) {
      const field = this.findField(context.snapshot.normalizedFields, filter.field);
      if (!field) {
        validationErrors.push(`未知查询字段: ${filter.field}`);
        continue;
      }

      if (isIgnoredSkillField(field)) {
        continue;
      }

      const normalized = await this.normalizeSearchFieldValue({
        snapshot: context.snapshot,
        field,
        rawValue: filter.value,
        operator: filter.operator,
        dictionaryBinding: bindingMap.get(field.fieldCode),
        getAccessToken,
      });

      validationErrors.push(...normalized.validationErrors);
      if (normalized.resolvedMapping) {
        resolvedDictionaryMappings.push(normalized.resolvedMapping);
      }

      if (normalized.value !== undefined) {
        const searchOperator =
          normalized.searchOperator === undefined
            ? this.normalizeSearchOperator(field, filter.operator)
            : normalized.searchOperator;
        searchItems.push({
          codeId: field.fieldCode,
          parentCodeId: null,
          type: field.widgetType,
          ...(searchOperator ? { operator: searchOperator } : {}),
          ...(normalized.searchItemAttributes ?? {}),
          value: normalized.value,
        });
      }
    }

    const missingRuntimeInputs: string[] = [];
    if (!input.operatorOpenId?.trim()) {
      missingRuntimeInputs.push('operatorOpenId');
    }

    return {
      requestBody: this.buildSearchRequestBody({
        formCodeId: context.registry.formCodeId,
        operatorOpenId: input.operatorOpenId?.trim() || '{operatorOpenId}',
        pageNumber: pagination.pageNumber,
        pageSize: pagination.pageSize,
        searchItems,
      }),
      resolvedDictionaryMappings,
      missingRuntimeInputs,
      validationErrors,
    };
  }

  previewGet(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewGetInput,
  ): ShadowPreviewResponse {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}尚未刷新元数据，无法生成详情预演`);
    }

    const missingRequiredParams: string[] = [];
    const formInstId = readFormInstId(input);

    if (!formInstId) {
      missingRequiredParams.push('form_inst_id');
    }

    const request = this.lightCloudClient.buildBatchGetPreview({
      body: this.buildBatchGetRequestBody({
        formCodeId: context.registry.formCodeId,
        formInstIds: [formInstId || '{formInstId}'],
        operatorOpenId: input.operatorOpenId?.trim(),
      }),
    });

    return {
      objectKey,
      operation: 'get',
      unresolvedDictionaries: this.buildUnresolvedDictionarySummaries(objectKey),
      resolvedDictionaryMappings: [],
      missingRequiredParams,
      blockedReadonlyParams: [],
      missingRuntimeInputs: [],
      validationErrors: [],
      readyToSend: missingRequiredParams.length === 0,
      requestBody: request.body,
    };
  }

  async executeGet(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewGetInput,
  ): Promise<ShadowExecuteGetResponse> {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}尚未刷新元数据，无法执行真实详情读取`);
    }

    const formInstId = readFormInstId(input);
    if (!formInstId) {
      throw new BadRequestError('真实详情读取必须提供 formInstId');
    }

    const requestBody = this.buildBatchGetRequestBody({
      formCodeId: context.registry.formCodeId,
      formInstIds: [formInstId],
      operatorOpenId: input.operatorOpenId?.trim(),
    });
    const accessToken = await this.lightCloudClient.getTeamAccessToken({
      eid: this.config.yzj.eid,
      appId: this.config.yzj.lightCloud.appId,
      secret: this.config.yzj.lightCloud.appSecret,
    });
    const records = await this.lightCloudClient.listRecords({
      accessToken,
      body: requestBody,
    });
    const record = records[0];
    if (!record) {
      throw new NotFoundError(`未找到客户记录: ${formInstId}`);
    }

    return {
      objectKey,
      operation: 'get',
      mode: 'live',
      requestBody,
      record: this.mapLiveRecord(record),
    };
  }

  async previewUpsert(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewUpsertInput,
  ): Promise<ShadowPreviewResponse> {
    const prepared = await this.prepareUpsertExecution(objectKey, input);

    return {
      objectKey,
      operation: 'upsert',
      unresolvedDictionaries: this.buildUnresolvedDictionarySummaries(objectKey),
      resolvedDictionaryMappings: prepared.resolvedDictionaryMappings,
      missingRequiredParams: prepared.missingRequiredParams,
      blockedReadonlyParams: prepared.blockedReadonlyParams,
      missingRuntimeInputs: prepared.missingRuntimeInputs,
      validationErrors: prepared.validationErrors,
      readyToSend: prepared.readyToSend,
      requestBody: prepared.requestBody,
    };
  }

  async executeUpsert(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewUpsertInput,
  ): Promise<ShadowExecuteUpsertResponse> {
    const prepared = await this.prepareUpsertExecution(objectKey, input);
    if (!prepared.readyToSend) {
      throw new BadRequestError('真实写入前参数校验失败', {
        missingRequiredParams: prepared.missingRequiredParams,
        blockedReadonlyParams: prepared.blockedReadonlyParams,
        missingRuntimeInputs: prepared.missingRuntimeInputs,
        validationErrors: prepared.validationErrors,
      });
    }

    const accessToken = await this.lightCloudClient.getTeamAccessToken({
      eid: this.config.yzj.eid,
      appId: this.config.yzj.lightCloud.appId,
      secret: this.config.yzj.lightCloud.appSecret,
    });
    const formInstIds = await this.lightCloudClient.batchSave({
      accessToken,
      body: prepared.requestBody,
    });

    return {
      objectKey,
      operation: 'upsert',
      mode: 'live',
      writeMode: input.mode,
      requestBody: prepared.requestBody,
      formInstIds,
    };
  }

  previewDelete(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewDeleteInput,
  ): ShadowPreviewResponse {
    const prepared = this.prepareDeleteExecution(objectKey, input);

    return {
      objectKey,
      operation: 'delete',
      unresolvedDictionaries: this.buildUnresolvedDictionarySummaries(objectKey),
      resolvedDictionaryMappings: [],
      missingRequiredParams: prepared.missingRequiredParams,
      blockedReadonlyParams: [],
      missingRuntimeInputs: prepared.missingRuntimeInputs,
      validationErrors: prepared.validationErrors,
      readyToSend: prepared.readyToSend,
      requestBody: prepared.requestBody,
    };
  }

  async executeDelete(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewDeleteInput,
  ): Promise<ShadowExecuteDeleteResponse> {
    const prepared = this.prepareDeleteExecution(objectKey, input);
    if (!prepared.readyToSend) {
      throw new BadRequestError('真实删除前参数校验失败', {
        missingRequiredParams: prepared.missingRequiredParams,
        missingRuntimeInputs: prepared.missingRuntimeInputs,
        validationErrors: prepared.validationErrors,
      });
    }

    const accessToken = await this.lightCloudClient.getTeamAccessToken({
      eid: this.config.yzj.eid,
      appId: this.config.yzj.lightCloud.appId,
      secret: this.config.yzj.lightCloud.appSecret,
    });
    const formInstIds = await this.lightCloudClient.batchDelete({
      accessToken,
      body: prepared.requestBody,
    });

    return {
      objectKey,
      operation: 'delete',
      mode: 'live',
      requestBody: prepared.requestBody,
      formInstIds,
    };
  }

  private syncRegistryConfig(): void {
    const now = this.now().toISOString();
    for (const objectConfig of Object.values(this.config.shadow.objects)) {
      this.repository.upsertObjectRegistryConfig({
        objectKey: objectConfig.key,
        label: objectConfig.label,
        enabled: objectConfig.enabled,
        activationStatus: getActivationStatus(objectConfig),
        formCodeId: objectConfig.formCodeId,
        now,
      });
    }
  }

  private getObjectContext(objectKey: ShadowObjectKey): {
    registry: ShadowObjectSummaryResponse;
    snapshot: ReturnType<ShadowMetadataRepository['getLatestSnapshot']>;
  } {
    this.syncRegistryConfig();
    const registry = this.repository.getObjectRegistry(objectKey);
    if (!registry) {
      throw new NotFoundError(`未找到影子对象: ${objectKey}`);
    }

    return {
      registry,
      snapshot: this.repository.getLatestSnapshot(objectKey),
    };
  }

  private async prepareUpsertExecution(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewUpsertInput,
  ): Promise<PreparedUpsertExecution> {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}尚未刷新元数据，无法生成写入请求`);
    }

    const params = input.params ?? {};
    const bindings = context.snapshot.dictionaryBindings ?? [];
    const bindingMap = new Map(bindings.map((binding) => [binding.fieldCode, binding]));
    const missingRuntimeInputs: string[] = [];
    const missingRequiredParams: string[] = [];
    const blockedReadonlyParams: string[] = [];
    const validationErrors: string[] = [];
    const resolvedDictionaryMappings: ShadowResolvedDictionaryMapping[] = [];
    const widgetValue: Record<string, unknown> = {};
    let accessTokenPromise: Promise<string> | null = null;

    if (!input.operatorOpenId?.trim()) {
      missingRuntimeInputs.push('operatorOpenId');
    }

    const updateFormInstId = readFormInstId(input);
    if (input.mode === 'update' && !updateFormInstId) {
      missingRequiredParams.push('form_inst_id');
    }

    const contract = this.getContractForMode(objectKey, input.mode, context.registry.latestSnapshotVersion);
    const requiredParams = new Set(contract?.requiredParams ?? []);

    for (const field of context.snapshot.normalizedFields) {
      if (isIgnoredSkillField(field)) {
        continue;
      }

      const providedValue =
        field.readOnly && getFieldParameterKey(field) !== field.fieldCode
          ? Object.prototype.hasOwnProperty.call(params, field.fieldCode)
            ? params[field.fieldCode]
            : undefined
          : this.readParameterValue(params, field);
      const parameterKey = getFieldParameterKey(field);

      if (field.readOnly) {
        if (providedValue !== undefined) {
          blockedReadonlyParams.push(parameterKey);
        }
        continue;
      }

      if (providedValue === undefined) {
        if (requiredParams.has(parameterKey)) {
          missingRequiredParams.push(parameterKey);
        }
        continue;
      }

      const normalized =
        field.widgetType === 'basicDataWidget'
          ? await this.normalizeBasicDataFieldValue({
              snapshot: context.snapshot,
              field,
              rawValue: providedValue,
              getAccessToken: () => {
                if (!accessTokenPromise) {
                  accessTokenPromise = this.lightCloudClient.getTeamAccessToken({
                    eid: this.config.yzj.eid,
                    appId: this.config.yzj.lightCloud.appId,
                    secret: this.config.yzj.lightCloud.appSecret,
                  });
                }

                return accessTokenPromise;
              },
            })
          : this.normalizeFieldValue({
              field,
              rawValue: providedValue,
              dictionaryBinding: bindingMap.get(field.fieldCode),
            });

      validationErrors.push(...normalized.validationErrors);
      if (normalized.resolvedMapping) {
        resolvedDictionaryMappings.push(normalized.resolvedMapping);
      }

      if (normalized.value !== undefined) {
        widgetValue[field.fieldCode] = normalized.value;
      }
    }

    const requestBody = this.lightCloudClient.buildBatchSavePreview({
      body: {
        eid: this.config.yzj.eid,
        formCodeId: context.registry.formCodeId,
        oid: input.operatorOpenId?.trim() || '{operatorOpenId}',
        data: [
          {
            ...(input.mode === 'update' && updateFormInstId
              ? { formInstId: updateFormInstId }
              : {}),
            widgetValue,
          },
        ],
      },
    }).body;

    return {
      requestBody,
      resolvedDictionaryMappings,
      missingRequiredParams,
      blockedReadonlyParams,
      missingRuntimeInputs,
      validationErrors,
      readyToSend:
        missingRequiredParams.length === 0 &&
        blockedReadonlyParams.length === 0 &&
        missingRuntimeInputs.length === 0 &&
        validationErrors.length === 0,
    };
  }

  private prepareDeleteExecution(
    objectKey: ShadowObjectKey,
    input: ShadowPreviewDeleteInput,
  ): PreparedDeleteExecution {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      throw new BadRequestError(`${mapShadowObjectLabel(objectKey)}尚未刷新元数据，无法生成删除请求`);
    }

    const formInstIds = readFormInstIds(input);
    const missingRequiredParams: string[] = [];
    const missingRuntimeInputs: string[] = [];
    const validationErrors: string[] = [];

    if (formInstIds.length === 0) {
      missingRequiredParams.push('form_inst_ids');
    }

    if (!Array.isArray(input.formInstIds) && input.formInstIds !== undefined) {
      validationErrors.push('formInstIds 必须是非空字符串数组');
    }

    if (!input.operatorOpenId?.trim()) {
      missingRuntimeInputs.push('operatorOpenId');
    }

    return {
      requestBody: this.buildBatchDeleteRequestBody({
        formCodeId: context.registry.formCodeId,
        formInstIds: formInstIds.length > 0 ? formInstIds : ['{formInstId}'],
        operatorOpenId: input.operatorOpenId?.trim() || '{operatorOpenId}',
      }),
      missingRequiredParams,
      missingRuntimeInputs,
      validationErrors,
      readyToSend:
        missingRequiredParams.length === 0 &&
        missingRuntimeInputs.length === 0 &&
        validationErrors.length === 0,
    };
  }

  private async normalizeTemplate(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string;
    accessToken: string;
    widgetMap: Record<string, YzjApprovalWidget>;
  }): Promise<{
    fields: ShadowStandardizedField[];
    dictionaryBindings: PreparedDictionaryBinding[];
  }> {
    const widgets = Object.values(params.widgetMap);
    const referIds = widgets
      .filter((widget) => widget.type === 'publicOptBoxWidget')
      .map((widget) => parseReferId(widget))
      .filter((referId): referId is string => Boolean(referId));
    const resolvedDictionaries = await this.dictionaryResolver.resolvePublicOptions({
      referIds,
      accessToken: params.accessToken,
    });

    const fields: ShadowStandardizedField[] = [];
    const dictionaryBindings: PreparedDictionaryBinding[] = [];

    for (const widget of widgets) {
      const referId = parseReferId(widget);
      const relationBinding = parseBasicDataBinding(widget);
      const dictionaryBinding = referId ? resolvedDictionaries.get(referId) : undefined;
      const semanticSlot = inferSemanticSlot(widget.title || widget.codeId, widget.type);

      const field: ShadowStandardizedField = {
        fieldCode: widget.codeId,
        label: widget.title || widget.codeId,
        widgetType: widget.type,
        required: Boolean(widget.required),
        readOnly: isWritableSystemShadowField(params.objectKey, widget) ? false : isReadOnlyWidget(widget),
        multi: isMultiValue(widget),
        options:
          widget.type === 'radioWidget' || widget.type === 'checkboxWidget'
            ? normalizeStaticOptions(widget)
            : widget.type === 'publicOptBoxWidget'
              ? (dictionaryBinding?.entries ?? []).map((entry) => ({
                  title: entry.title,
                  dicId: entry.dicId,
                  code: entry.code,
                  state: entry.state,
                  sort: entry.sort,
                  aliases: entry.aliases,
                }))
              : [],
        semanticSlot:
          widget.type === 'publicOptBoxWidget' && !referId && semanticSlot === 'region'
            ? undefined
            : semanticSlot,
        ...(referId ? { referId } : {}),
        ...(relationBinding ? { relationBinding } : {}),
      };

      if (widget.type === 'publicOptBoxWidget') {
        field.enumBinding = {
          kind: 'public_option',
          referId: referId ?? null,
          source: dictionaryBinding?.source ?? 'unresolved',
          resolutionStatus: dictionaryBinding?.resolutionStatus ?? 'pending',
          acceptedValueShape: 'array<{title,dicId}>',
          resolvedEntryCount: dictionaryBinding?.entries.length ?? 0,
        };

        dictionaryBindings.push({
          fieldCode: field.fieldCode,
          label: field.label,
          referId: referId ?? null,
          source: dictionaryBinding?.source ?? 'unresolved',
          resolutionStatus: dictionaryBinding?.resolutionStatus ?? 'pending',
          entries: (dictionaryBinding?.entries ?? []).map((entry) => ({
            referId: entry.referId,
            dicId: entry.dicId,
            title: entry.title,
            code: entry.code,
            state: entry.state,
            sort: entry.sort,
            source: dictionaryBinding?.source ?? 'unresolved',
            aliases: entry.aliases,
          })),
        });
      }

      fields.push(field);
    }

    return {
      fields,
      dictionaryBindings,
    };
  }

  private materializeSkillBundles(params: {
    objectKey: ShadowObjectKey;
    objectLabel: string;
    formCodeId: string;
    formDefId: string | null;
    snapshotVersion: string;
    schemaHash: string;
    rawTemplate: unknown;
    fields: ShadowStandardizedField[];
    dictionaryBindings: ShadowDictionaryBindingRecord[];
  }): ShadowSkillContract[] {
    const skillContracts = this.buildSkillContracts({
      objectKey: params.objectKey,
      formCodeId: params.formCodeId,
      snapshotVersion: params.snapshotVersion,
      fields: params.fields,
    });
    const skillBundles = this.skillBundleWriter.writeBundles({
      objectKey: params.objectKey,
      objectLabel: params.objectLabel,
      formCodeId: params.formCodeId,
      formDefId: params.formDefId,
      snapshotVersion: params.snapshotVersion,
      schemaHash: params.schemaHash,
      rawTemplate: params.rawTemplate,
      fields: params.fields,
      dictionaryBindings: params.dictionaryBindings,
      skills: skillContracts,
    });
    return skillBundles;
  }

  private buildSkillContracts(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string;
    snapshotVersion: string;
    fields: ShadowStandardizedField[];
  }): ShadowSkillContract[] {
    const objectLabel = mapShadowObjectLabel(params.objectKey);
    const skillPrefix = `shadow.${params.objectKey}`;
    const writableFields = params.fields.filter(isFieldEligibleForContract);
    const searchableFields = params.fields.filter(isFieldEligibleForSearchContract);
    const requiredParams = Array.from(
      new Set(writableFields.filter((field) => field.required).map(getFieldParameterKey)),
    );
    const optionalParams = Array.from(
      new Set(
        writableFields
          .filter((field) => !field.required)
          .map(getFieldParameterKey),
      ),
    );
    const sharedBase = {
      sourceObject: params.objectKey,
      sourceFormCodeId: params.formCodeId,
      sourceVersion: params.snapshotVersion,
      bundleDirectory: '',
      skillPath: '',
      agentMetadataPath: null,
      referencePaths: {
        skillBundle: '',
        templateSummary: '',
        templateRaw: '',
        dictionaries: '',
        execution: '',
      },
    };

    return [
      {
        skillName: `${skillPrefix}_search`,
        skillKey: `${params.objectKey}_search`,
        operation: 'search',
        description: `按${objectLabel}对象已注册字段预演轻云查询条件。`,
        whenToUse: `当用户要搜索${objectLabel}、筛选${objectLabel}列表或按字段查${objectLabel}时使用。`,
        notWhenToUse: `当用户已经明确给出 formInstId，需要直接获取单条${objectLabel}详情时不要使用。`,
        requiredParams: [],
        optionalParams: Array.from(
          new Set(searchableFields.map((field) => getSearchFieldParameterKey(field, searchableFields))),
        ),
        confirmationPolicy: 'no_confirmation_required',
        outputCardType: `${params.objectKey}-search-preview`,
        executionBinding: this.buildExecutionBinding({
          objectKey: params.objectKey,
          formCodeId: params.formCodeId,
          operation: 'search',
          fields: searchableFields,
        }),
        ...sharedBase,
      },
      {
        skillName: `${skillPrefix}_get`,
        skillKey: `${params.objectKey}_get`,
        operation: 'get',
        description: `按 formInstId 获取${objectLabel}单据详情。`,
        whenToUse: `当用户已经明确指定某条${objectLabel}记录时使用。`,
        notWhenToUse: `当用户只提供模糊条件，需要先搜索${objectLabel}时不要使用。`,
        requiredParams: ['form_inst_id'],
        optionalParams: [],
        confirmationPolicy: 'no_confirmation_required',
        outputCardType: `${params.objectKey}-get-preview`,
        executionBinding: this.buildExecutionBinding({
          objectKey: params.objectKey,
          formCodeId: params.formCodeId,
          operation: 'get',
          fields: writableFields,
        }),
        ...sharedBase,
      },
      {
        skillName: `${skillPrefix}_create`,
        skillKey: `${params.objectKey}_create`,
        operation: 'create',
        description: `基于${objectLabel}模板标准化字段预演轻云${objectLabel}创建请求。`,
        whenToUse: `当用户明确要录入${objectLabel}、新建${objectLabel}或补录${objectLabel}时使用。`,
        notWhenToUse: `当用户只是查询${objectLabel}、分析${objectLabel}或未准备写入确认时不要使用。`,
        requiredParams,
        optionalParams,
        confirmationPolicy: 'required_before_write',
        outputCardType: `${params.objectKey}-create-preview`,
        executionBinding: this.buildExecutionBinding({
          objectKey: params.objectKey,
          formCodeId: params.formCodeId,
          operation: 'create',
          fields: writableFields,
        }),
        ...sharedBase,
      },
      {
        skillName: `${skillPrefix}_update`,
        skillKey: `${params.objectKey}_update`,
        operation: 'update',
        description: `基于${objectLabel}模板标准化字段预演轻云${objectLabel}更新请求。`,
        whenToUse: `当用户要更新已有${objectLabel}基础字段时使用。`,
        notWhenToUse: `当用户没有明确 formInstId 或只是在做查询时不要使用。`,
        requiredParams: ['form_inst_id'],
        optionalParams: Array.from(
          new Set(writableFields.map(getFieldParameterKey)),
        ),
        confirmationPolicy: 'required_before_write',
        outputCardType: `${params.objectKey}-update-preview`,
        executionBinding: this.buildExecutionBinding({
          objectKey: params.objectKey,
          formCodeId: params.formCodeId,
          operation: 'update',
          fields: writableFields,
        }),
        ...sharedBase,
      },
      {
        skillName: `${skillPrefix}_delete`,
        skillKey: `${params.objectKey}_delete`,
        operation: 'delete',
        description: `基于${objectLabel}对象 formInstIds 预演或执行轻云批量删除请求。`,
        whenToUse: `当用户已经明确给出要删除的${objectLabel} formInstIds，并确认执行删除时使用。`,
        notWhenToUse: `当用户还在搜索${objectLabel}、核对详情，或未明确确认删除时不要使用。`,
        requiredParams: ['form_inst_ids'],
        optionalParams: [],
        confirmationPolicy: 'required_before_write',
        outputCardType: `${params.objectKey}-delete-preview`,
        executionBinding: this.buildExecutionBinding({
          objectKey: params.objectKey,
          formCodeId: params.formCodeId,
          operation: 'delete',
          fields: writableFields,
        }),
        ...sharedBase,
      },
    ];
  }

  private buildExecutionBinding(params: {
    objectKey: ShadowObjectKey;
    formCodeId: string;
    operation: ShadowSkillContract['operation'];
    fields: ShadowStandardizedField[];
  }): ShadowSkillContract['executionBinding'] {
    const previewApiPath =
      params.operation === 'search'
        ? `/api/shadow/objects/${params.objectKey}/preview/search`
        : params.operation === 'get'
          ? `/api/shadow/objects/${params.objectKey}/preview/get`
          : params.operation === 'delete'
            ? `/api/shadow/objects/${params.objectKey}/preview/delete`
            : `/api/shadow/objects/${params.objectKey}/preview/upsert`;

    if (params.operation === 'search') {
      const exampleFilters = this.buildSearchFilterExample(params.fields);
      const previewBody = this.buildSearchRequestBody({
        formCodeId: params.formCodeId,
        operatorOpenId: '{operatorOpenId}',
        pageNumber: 1,
        pageSize: 20,
        searchItems: this.buildSearchItemExample(params.fields),
      });
      return {
        previewApi: {
          method: 'POST',
          path: previewApiPath,
          payloadExample: {
            operatorOpenId: '{operatorOpenId}',
            filters: exampleFilters,
            pageNumber: 1,
            pageSize: 20,
          },
        },
        lightCloudPreview: this.lightCloudClient.buildSearchPreview({
          body: previewBody,
        }),
        liveApi: {
          method: 'POST',
          path: `/api/shadow/objects/${params.objectKey}/execute/search`,
          payloadExample: {
            operatorOpenId: '{operatorOpenId}',
            filters: exampleFilters,
            pageNumber: 1,
            pageSize: 20,
          },
        },
        lightCloudLive: this.lightCloudClient.buildSearchPreview({
          body: previewBody,
        }),
        phase: 'live_read_enabled',
      };
    }

    if (params.operation === 'get') {
      const previewBody = this.buildBatchGetRequestBody({
        formCodeId: params.formCodeId,
        formInstIds: ['{formInstId}'],
        operatorOpenId: '{operatorOpenId?}',
      });
      return {
        previewApi: {
          method: 'POST',
          path: previewApiPath,
          payloadExample: {
            formInstId: '{formInstId}',
            operatorOpenId: '{operatorOpenId?}',
          },
        },
        lightCloudPreview: this.lightCloudClient.buildBatchGetPreview({
          body: previewBody,
        }),
        liveApi: {
          method: 'POST',
          path: `/api/shadow/objects/${params.objectKey}/execute/get`,
          payloadExample: {
            formInstId: '{formInstId}',
            operatorOpenId: '{operatorOpenId?}',
          },
        },
        lightCloudLive: this.lightCloudClient.buildBatchGetPreview({
          body: previewBody,
        }),
        phase: 'live_read_enabled',
      };
    }

    if (params.operation === 'create') {
      const previewBody = {
        eid: this.config.yzj.eid,
        formCodeId: params.formCodeId,
        oid: '{operatorOpenId}',
        data: [
          {
            widgetValue: this.buildWidgetValueExample(params.fields, false),
          },
        ],
      };
      return {
        previewApi: {
          method: 'POST',
          path: previewApiPath,
          payloadExample: {
            mode: 'create',
            operatorOpenId: '{operatorOpenId}',
            params: this.buildParameterExample(params.fields, false),
          },
        },
        lightCloudPreview: this.lightCloudClient.buildBatchSavePreview({ body: previewBody }),
        liveApi: {
          method: 'POST',
          path: `/api/shadow/objects/${params.objectKey}/execute/upsert`,
          payloadExample: {
            mode: 'create',
            operatorOpenId: '{operatorOpenId}',
            params: this.buildParameterExample(params.fields, false),
          },
        },
        lightCloudLive: this.lightCloudClient.buildBatchSavePreview({ body: previewBody }),
        phase: 'live_write_enabled',
      };
    }

    if (params.operation === 'delete') {
      const previewBody = this.buildBatchDeleteRequestBody({
        formCodeId: params.formCodeId,
        formInstIds: ['{formInstId}'],
        operatorOpenId: '{operatorOpenId}',
      });
      return {
        previewApi: {
          method: 'POST',
          path: previewApiPath,
          payloadExample: {
            formInstIds: ['{formInstId}'],
            operatorOpenId: '{operatorOpenId}',
          },
        },
        lightCloudPreview: this.lightCloudClient.buildBatchDeletePreview({ body: previewBody }),
        liveApi: {
          method: 'POST',
          path: `/api/shadow/objects/${params.objectKey}/execute/delete`,
          payloadExample: {
            formInstIds: ['{formInstId}'],
            operatorOpenId: '{operatorOpenId}',
          },
        },
        lightCloudLive: this.lightCloudClient.buildBatchDeletePreview({ body: previewBody }),
        phase: 'live_write_enabled',
      };
    }

    const previewBody = {
      eid: this.config.yzj.eid,
      formCodeId: params.formCodeId,
      oid: '{operatorOpenId}',
      data: [
        {
          formInstId: '{formInstId}',
          widgetValue: this.buildWidgetValueExample(params.fields, true),
        },
      ],
    };

    return {
      previewApi: {
        method: 'POST',
        path: previewApiPath,
        payloadExample: {
          mode: 'update',
          formInstId: '{formInstId}',
          operatorOpenId: '{operatorOpenId}',
          params: this.buildParameterExample(params.fields, true),
        },
      },
      lightCloudPreview: this.lightCloudClient.buildBatchSavePreview({ body: previewBody }),
      liveApi: {
        method: 'POST',
        path: `/api/shadow/objects/${params.objectKey}/execute/upsert`,
        payloadExample: {
          mode: 'update',
          formInstId: '{formInstId}',
          operatorOpenId: '{operatorOpenId}',
          params: this.buildParameterExample(params.fields, true),
        },
      },
      lightCloudLive: this.lightCloudClient.buildBatchSavePreview({ body: previewBody }),
      phase: 'live_write_enabled',
    };
  }

  private buildSearchRequestBody(params: {
    formCodeId: string;
    operatorOpenId: string;
    pageNumber: number;
    pageSize: number;
    searchItems: Record<string, unknown>[];
  }) {
    return {
      eid: this.config.yzj.eid,
      oid: params.operatorOpenId,
      formCodeId: params.formCodeId,
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
      searchItems: params.searchItems,
    };
  }

  private buildBatchGetRequestBody(params: {
    formCodeId: string;
    formInstIds: string[];
    operatorOpenId?: string;
  }) {
    return {
      eid: this.config.yzj.eid,
      formCodeId: params.formCodeId,
      ...(params.operatorOpenId ? { oid: params.operatorOpenId } : {}),
      formInstIds: params.formInstIds,
    };
  }

  private buildBatchDeleteRequestBody(params: {
    formCodeId: string;
    formInstIds: string[];
    operatorOpenId: string;
  }) {
    return {
      eid: this.config.yzj.eid,
      formCodeId: params.formCodeId,
      oid: params.operatorOpenId,
      formInstIds: params.formInstIds,
    };
  }

  private validateSearchPagination(input: ShadowPreviewSearchInput): {
    pageNumber: number;
    pageSize: number;
    validationErrors: string[];
  } {
    const validationErrors: string[] = [];
    const pageNumber = input.pageNumber ?? 1;
    const pageSize = input.pageSize ?? 20;

    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      validationErrors.push('pageNumber 必须是大于 0 的整数');
    }

    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 100) {
      validationErrors.push('pageSize 必须是 1 到 100 之间的整数');
    }

    return {
      pageNumber,
      pageSize,
      validationErrors,
    };
  }

  private buildSearchFilterExample(fields: ShadowStandardizedField[]) {
    return this.selectSearchExampleFields(fields).map((field) => {
      const operator = this.getSearchExampleOperator(field);
      return {
        field: getFieldParameterKey(field),
        value: this.buildSearchFilterValueExample(field),
        ...(operator ? { operator } : {}),
      };
    });
  }

  private buildSearchItemExample(fields: ShadowStandardizedField[]) {
    return this.selectSearchExampleFields(fields).map((field) => {
      const operator = this.getSearchExampleOperator(field);
      const filterValue = this.buildSearchFilterValueExample(field);
      return {
        codeId: field.fieldCode,
        parentCodeId: null,
        type: field.widgetType,
        ...(operator ? { operator } : {}),
        ...(field.widgetType === 'dateWidget'
          ? {
              lightFieldMap: {
                plusDay: false,
              },
            }
          : {}),
        value: this.buildSearchItemValuePlaceholder(field, filterValue),
      };
    });
  }

  private buildParameterExample(fields: ShadowStandardizedField[], includeOptional: boolean) {
    const fallbackFields = this.selectExampleFields(fields, includeOptional);

    return Object.fromEntries(
      fallbackFields.map((field) => [getFieldParameterKey(field), this.buildParameterPlaceholder(field)]),
    );
  }

  private buildWidgetValueExample(fields: ShadowStandardizedField[], includeOptional: boolean) {
    const parameterExample = this.buildParameterExample(fields, includeOptional);
    const fallbackFields = this.selectExampleFields(fields, includeOptional);

    return Object.fromEntries(
      fallbackFields.map((field) => [
        field.fieldCode,
        this.buildWidgetValuePlaceholder(field, parameterExample[getFieldParameterKey(field)]),
      ]),
    );
  }

  private selectExampleFields(fields: ShadowStandardizedField[], includeOptional: boolean) {
    if (!includeOptional) {
      const requiredFields = fields.filter((field) => field.required);
      return requiredFields.length > 0 ? requiredFields : fields.slice(0, 1);
    }

    const basicDataField = fields.find((field) => field.widgetType === 'basicDataWidget');
    if (!basicDataField) {
      return fields.slice(0, Math.min(fields.length, 2));
    }

    const companionField =
      fields.find((field) => field.fieldCode !== basicDataField.fieldCode && field.widgetType !== 'basicDataWidget') ??
      fields.find((field) => field.fieldCode !== basicDataField.fieldCode);

    return companionField ? [basicDataField, companionField] : [basicDataField];
  }

  private selectSearchExampleFields(fields: ShadowStandardizedField[]) {
    const systemNameField = fields.find((field) => field.fieldCode === '_S_NAME');
    const basicDataField = fields.find((field) => field.widgetType === 'basicDataWidget');
    const dateRangeField = fields.find((field) => field.semanticSlot === 'last_followup_date');
    const fuzzyField =
      systemNameField ??
      fields.find(
        (field) =>
          field.fieldCode !== basicDataField?.fieldCode &&
          (field.widgetType === 'textWidget' || field.widgetType === 'textAreaWidget'),
      ) ??
      fields.find((field) => field.fieldCode !== basicDataField?.fieldCode);

    if (basicDataField && dateRangeField && dateRangeField.fieldCode !== basicDataField.fieldCode) {
      return [basicDataField, dateRangeField];
    }

    if (basicDataField && fuzzyField) {
      return [basicDataField, fuzzyField];
    }

    if (basicDataField) {
      return [basicDataField];
    }

    return fields.slice(0, 1);
  }

  private getSearchExampleOperator(field: ShadowStandardizedField): string | undefined {
    if (field.widgetType === 'basicDataWidget') {
      return undefined;
    }

    if (field.widgetType === 'dateWidget') {
      return 'range';
    }

    if (field.widgetType === 'textWidget' || field.widgetType === 'textAreaWidget') {
      return 'contain';
    }

    return 'eq';
  }

  private buildSearchFilterValueExample(field: ShadowStandardizedField): unknown {
    if (field.widgetType === 'basicDataWidget') {
      return (
        (field.relationBinding?.displayCol && `{${getFieldParameterKey(field)}_${field.relationBinding.displayCol}}`) ||
        `{${getFieldParameterKey(field)}_showName}`
      );
    }

    if (field.widgetType === 'dateWidget') {
      return [1777046400000, 1777132799999];
    }

    return this.buildParameterPlaceholder(field);
  }

  private normalizeSearchOperator(field: ShadowStandardizedField, operator?: string): string | undefined {
    if (typeof operator !== 'string' || !operator.trim()) {
      return undefined;
    }

    const normalized = operator.trim();
    const lower = normalized.toLowerCase();

    if (field.widgetType === 'basicDataWidget' && lower !== 'like' && lower !== 'contain') {
      return 'contains';
    }

    if ((field.widgetType === 'textWidget' || field.widgetType === 'textAreaWidget') && lower === 'like') {
      return 'contain';
    }

    return normalized;
  }

  private buildParameterPlaceholder(field: ShadowStandardizedField): unknown {
    const parameterKey = getFieldParameterKey(field);

    switch (field.widgetType) {
      case 'personSelectWidget':
        return `{${parameterKey}}`;
      case 'departmentSelectWidget':
        return `{${parameterKey}}`;
      case 'dateWidget':
        return '2026-04-23';
      case 'checkboxWidget':
        return field.options[0]?.title ? [field.options[0].title] : [`{${parameterKey}}`];
      case 'radioWidget':
        return field.options[0]?.title ?? `{${parameterKey}}`;
      case 'publicOptBoxWidget':
        return {
          title: field.options[0]?.title ?? `{${parameterKey}_title}`,
          dicId: field.options[0]?.dicId ?? `{${parameterKey}_dicId}`,
        };
      case 'basicDataWidget':
        return {
          formInstId: `{${parameterKey}_formInstId}`,
        };
      case 'attachmentWidget':
        return {
          fileName: `{${parameterKey}_file_name}`,
          fileId: `{${parameterKey}_file_id}`,
          fileSize: `{${parameterKey}_file_size}`,
          fileType: `{${parameterKey}_file_type}`,
          fileExt: `{${parameterKey}_file_ext}`,
        };
      default:
        return `{${parameterKey}}`;
    }
  }

  private buildWidgetValuePlaceholder(field: ShadowStandardizedField, value: unknown): unknown {
    switch (field.widgetType) {
      case 'personSelectWidget':
      case 'departmentSelectWidget':
        return Array.isArray(value) ? value : [value];
      case 'publicOptBoxWidget':
      case 'attachmentWidget':
        return Array.isArray(value) ? value : [value];
      case 'basicDataWidget': {
        const relationBinding = field.relationBinding;
        const linkedFormInstId =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>).formInstId
            : `{${getFieldParameterKey(field)}_formInstId}`;
        const titlePlaceholder = `{${getFieldParameterKey(field)}_showName}`;
        const item: Record<string, unknown> = {
          id: typeof linkedFormInstId === 'string' ? linkedFormInstId : `{${getFieldParameterKey(field)}_formInstId}`,
          formCodeId: relationBinding?.formCodeId ?? `{${getFieldParameterKey(field)}_formCodeId}`,
          formDefId: `{${getFieldParameterKey(field)}_formDefId}`,
          flowInstId: '',
          showName: titlePlaceholder,
          _S_TITLE: titlePlaceholder,
          _S_NAME: titlePlaceholder,
          _name_: titlePlaceholder,
        };

        if (relationBinding?.displayCol) {
          item[relationBinding.displayCol] = `{${getFieldParameterKey(field)}_${relationBinding.displayCol}}`;
        }

        return [item];
      }
      default:
        return value;
    }
  }

  private buildSearchItemValuePlaceholder(field: ShadowStandardizedField, value: unknown): unknown {
    if (field.widgetType === 'basicDataWidget') {
      if (typeof value === 'string' && value.trim()) {
        return value;
      }

      const parameterKey = getFieldParameterKey(field);
      const relationBinding = field.relationBinding;
      const objectValue =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};

      return [
        {
          _id_:
            (typeof objectValue.formInstId === 'string' && objectValue.formInstId) ||
            `{${parameterKey}_formInstId}`,
          _name_:
            (relationBinding?.displayCol && `{${parameterKey}_${relationBinding.displayCol}}`) ||
            `{${parameterKey}_showName}`,
        },
      ];
    }

    return this.buildWidgetValuePlaceholder(field, value);
  }

  private mapLiveRecord(record: {
    id?: string;
    formInstId?: string;
    formInstance?: {
      id?: string;
    };
    important?: Record<string, unknown>;
    fieldContent?: Array<{
      codeId: string;
      title?: string;
      type?: string;
      value?: unknown;
      rawValue?: unknown;
      parentCodeId?: string | null;
    }>;
    [key: string]: unknown;
  }): ShadowLiveRecord {
    const formInstId =
      (typeof record.formInstId === 'string' && record.formInstId.trim()) ||
      (typeof record.id === 'string' && record.id.trim()) ||
      (typeof record.formInstance?.id === 'string' && record.formInstance.id.trim()) ||
      '';
    const fields: ShadowLiveRecordField[] = (record.fieldContent ?? []).map((field) => ({
      codeId: field.codeId,
      title: field.title ?? null,
      type: field.type ?? null,
      value: field.value,
      rawValue: field.rawValue,
      parentCodeId: field.parentCodeId ?? null,
    }));

    return {
      formInstId,
      important: record.important ?? {},
      fields,
      fieldMap: Object.fromEntries(fields.map((field) => [field.codeId, field])),
      rawRecord: record,
    };
  }

  private findField(fields: ShadowStandardizedField[], inputKey: string): ShadowStandardizedField | undefined {
    return fields.find(
      (field) => field.fieldCode === inputKey || field.semanticSlot === inputKey,
    );
  }

  private readParameterValue(
    params: Record<string, unknown>,
    field: ShadowStandardizedField,
  ): unknown {
    const preferredKey = getFieldParameterKey(field);
    if (Object.prototype.hasOwnProperty.call(params, preferredKey)) {
      return params[preferredKey];
    }

    if (preferredKey !== field.fieldCode && Object.prototype.hasOwnProperty.call(params, field.fieldCode)) {
      return params[field.fieldCode];
    }

    return undefined;
  }

  private getContractForMode(
    objectKey: ShadowObjectKey,
    mode: ShadowPreviewUpsertInput['mode'],
    _snapshotVersion: string | null,
  ): ShadowSkillContract | undefined {
    const context = this.getObjectContext(objectKey);
    if (!context.snapshot || !context.registry.formCodeId) {
      return undefined;
    }

    const skills = this.buildSkillContracts({
      objectKey,
      formCodeId: context.registry.formCodeId,
      snapshotVersion: context.snapshot.snapshotVersion,
      fields: context.snapshot.normalizedFields,
    });
    const expectedSkillName = `shadow.${objectKey}_${mode === 'create' ? 'create' : 'update'}`;
    return skills.find((skill) =>
      skill.skillName === expectedSkillName,
    );
  }

  private buildUnresolvedDictionarySummaries(objectKey: ShadowObjectKey) {
    const snapshot = this.getObjectContext(objectKey).snapshot;
    const fieldMap = new Map(
      (snapshot?.normalizedFields ?? []).map((field) => [field.fieldCode, field]),
    );

    return (snapshot?.dictionaryBindings ?? [])
      .filter((binding) => binding.resolutionStatus !== 'resolved')
      .filter((binding) => {
        const field = fieldMap.get(binding.fieldCode);
        return field ? !isIgnoredSkillField(field) : true;
      })
      .map((binding) => ({
        fieldCode: binding.fieldCode,
        label: binding.label,
        referId: binding.referId,
        source: binding.source,
        resolutionStatus: binding.resolutionStatus,
        reason:
          binding.referId
            ? `公共选项 ${binding.referId} 尚未拿到可用码表`
            : '公共选项字段缺少 referId，无法解析码表',
      }));
  }

  private getSnapshotWidget(
    snapshot: ShadowObjectSnapshotRecord,
    fieldCode: string,
  ): YzjApprovalWidget | undefined {
    const rawTemplate = snapshot.rawTemplate as
      | {
          formInfo?: {
            widgetMap?: Record<string, unknown>;
          };
        }
      | undefined;
    const widgetMap = rawTemplate?.formInfo?.widgetMap;
    if (!widgetMap || typeof widgetMap !== 'object') {
      return undefined;
    }

    const widget = (widgetMap as Record<string, unknown>)[fieldCode];
    return widget && typeof widget === 'object' ? (widget as YzjApprovalWidget) : undefined;
  }

  private async normalizeBasicDataFieldValue(params: {
    snapshot: ShadowObjectSnapshotRecord;
    field: ShadowStandardizedField;
    rawValue: unknown;
    getAccessToken: () => Promise<string>;
  }): Promise<{
    value: unknown;
    validationErrors: string[];
    resolvedMapping?: ShadowResolvedDictionaryMapping;
  }> {
    const { snapshot, field, rawValue, getAccessToken } = params;
    const validationErrors: string[] = [];
    const relationBinding = field.relationBinding;
    const widget = this.getSnapshotWidget(snapshot, field.fieldCode);

    if (!relationBinding?.formCodeId || !widget) {
      validationErrors.push(`${field.label} 缺少关联对象配置，无法构造 basicDataWidget 输入值`);
      return {
        value: undefined,
        validationErrors,
        resolvedMapping: undefined,
      };
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (!field.multi && values.length > 1) {
      validationErrors.push(`${field.label} 为单选关联字段，只接受单条关联记录`);
      return {
        value: undefined,
        validationErrors,
        resolvedMapping: undefined,
      };
    }

    const normalizedItems: Array<Record<string, unknown>> = [];

    for (const value of values) {
      const materialized = this.normalizeExplicitBasicDataObject({
        field,
        value,
        relationBinding,
      });
      if (materialized) {
        normalizedItems.push(materialized);
        continue;
      }

      const linkedFormInstId = this.readBasicDataRecordId(value);
      if (!linkedFormInstId) {
        validationErrors.push(
          `${field.label} 需要传入关联记录 formInstId/id，或传入包含 id/formCodeId/formDefId/展示字段 的完整对象`,
        );
        continue;
      }

      const accessToken = await getAccessToken();
      const linkedRecord = await this.getLinkedBasicDataRecord({
        accessToken,
        formCodeId: relationBinding.formCodeId,
        formInstId: linkedFormInstId,
      });
      if (!linkedRecord) {
        validationErrors.push(`${field.label} 未找到关联记录: ${linkedFormInstId}`);
        continue;
      }

      normalizedItems.push(
        this.buildBasicDataAssignItem({
          relationBinding,
          record: linkedRecord,
        }),
      );
    }

    return {
      value: validationErrors.length > 0 ? undefined : normalizedItems,
      validationErrors,
      resolvedMapping: undefined,
    };
  }

  private normalizeExplicitBasicDataObject(params: {
    field: ShadowStandardizedField;
    value: unknown;
    relationBinding: NonNullable<ShadowStandardizedField['relationBinding']>;
  }): Record<string, unknown> | null {
    const { field, value, relationBinding } = params;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const id = this.readBasicDataRecordId(item);
    const formCodeId =
      typeof item.formCodeId === 'string' && item.formCodeId.trim()
        ? item.formCodeId.trim()
        : relationBinding.formCodeId;
    const formDefId = typeof item.formDefId === 'string' && item.formDefId.trim() ? item.formDefId.trim() : '';
    const title =
      (typeof item.showName === 'string' && item.showName.trim()) ||
      (typeof item._S_TITLE === 'string' && item._S_TITLE.trim()) ||
      (typeof item._S_NAME === 'string' && item._S_NAME.trim()) ||
      (typeof item._name_ === 'string' && item._name_.trim()) ||
      '';

    if (!id || !formCodeId || !formDefId || !title) {
      return null;
    }

    const normalized: Record<string, unknown> = {
      id,
      formCodeId,
      formDefId,
      flowInstId: typeof item.flowInstId === 'string' ? item.flowInstId : '',
      showName: typeof item.showName === 'string' && item.showName.trim() ? item.showName.trim() : title,
      _S_TITLE: typeof item._S_TITLE === 'string' && item._S_TITLE.trim() ? item._S_TITLE.trim() : title,
      _S_NAME: typeof item._S_NAME === 'string' && item._S_NAME.trim() ? item._S_NAME.trim() : title,
      _name_: typeof item._name_ === 'string' && item._name_.trim() ? item._name_.trim() : title,
    };

    if (relationBinding.displayCol) {
      const displayValue = item[relationBinding.displayCol];
      if (typeof displayValue === 'string' && displayValue.trim()) {
        normalized[relationBinding.displayCol] = displayValue;
      }
    }

    return normalized;
  }

  private readBasicDataRecordId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (!value || typeof value !== 'object') {
      return '';
    }

    const item = value as Record<string, unknown>;
    const candidateKeys = ['formInstId', 'id', '_id_'];
    for (const key of candidateKeys) {
      if (typeof item[key] === 'string' && item[key].trim()) {
        return item[key].trim();
      }
    }

    return '';
  }

  private async getLinkedBasicDataRecord(params: {
    accessToken: string;
    formCodeId: string;
    formInstId: string;
  }): Promise<ShadowLiveRecord | null> {
    const records = await this.lightCloudClient.listRecords({
      accessToken: params.accessToken,
      body: {
        eid: this.config.yzj.eid,
        formCodeId: params.formCodeId,
        formInstIds: [params.formInstId],
      },
    });

    const record = records[0];
    return record ? this.mapLiveRecord(record) : null;
  }

  private buildBasicDataAssignItem(params: {
    relationBinding: NonNullable<ShadowStandardizedField['relationBinding']>;
    record: ShadowLiveRecord;
  }): Record<string, unknown> {
    const { relationBinding, record } = params;
    const title =
      this.readLiveFieldString(record, '_S_TITLE') ||
      this.readLiveFieldString(record, '_S_NAME') ||
      (typeof record.rawRecord.title === 'string' ? record.rawRecord.title.trim() : '') ||
      record.formInstId;
    const personName = this.readLiveFieldString(record, '_S_NAME') || title;
    const item: Record<string, unknown> = {
      id: record.formInstId,
      formCodeId: relationBinding.formCodeId,
      formDefId:
        (typeof record.rawRecord.formDefId === 'string' && record.rawRecord.formDefId.trim()) ||
        '',
      flowInstId:
        typeof record.rawRecord.flowInstId === 'string' && record.rawRecord.flowInstId.trim()
          ? record.rawRecord.flowInstId.trim()
          : '',
      showName: title,
      _S_TITLE: title,
      _S_NAME: personName,
      _name_: title,
    };

    if (relationBinding.displayCol) {
      const displayValue = this.readLiveFieldString(record, relationBinding.displayCol);
      if (displayValue) {
        item[relationBinding.displayCol] = displayValue;
      }
    }

    return item;
  }

  private buildBasicDataSearchTokenFromRecord(params: {
    relationBinding: NonNullable<ShadowStandardizedField['relationBinding']>;
    record: ShadowLiveRecord;
  }): {
    _id_: string;
    _name_: string;
  } {
    const { relationBinding, record } = params;
    const displayText =
      (relationBinding.displayCol && this.readLiveFieldString(record, relationBinding.displayCol)) ||
      this.readLiveFieldString(record, '_S_NAME') ||
      this.readLiveFieldString(record, '_S_TITLE') ||
      (typeof record.rawRecord.title === 'string' && record.rawRecord.title.trim()) ||
      record.formInstId;

    return {
      _id_: record.formInstId,
      _name_: displayText,
    };
  }

  private readLiveFieldString(record: ShadowLiveRecord, fieldCode: string): string {
    const field = record.fieldMap[fieldCode];
    if (!field) {
      return '';
    }

    if (typeof field.rawValue === 'string' && field.rawValue.trim()) {
      return field.rawValue.trim();
    }

    if (typeof field.value === 'string' && field.value.trim()) {
      return field.value.trim();
    }

    return '';
  }

  private normalizeFieldValue(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
    dictionaryBinding?: ShadowDictionaryBindingRecord;
  }): {
    value: unknown;
    validationErrors: string[];
    resolvedMapping?: ShadowResolvedDictionaryMapping;
  } {
    const { field, rawValue, dictionaryBinding } = params;
    const validationErrors: string[] = [];

    switch (field.widgetType) {
      case 'textWidget':
      case 'textAreaWidget':
        return {
          value: String(rawValue),
          validationErrors,
        };
      case 'numberWidget':
      case 'moneyWidget':
        return {
          value: String(rawValue),
          validationErrors,
        };
      case 'dateWidget':
        if (typeof rawValue === 'number') {
          return {
            value: rawValue,
            validationErrors,
          };
        }

        if (typeof rawValue === 'string') {
          const parsed = Date.parse(rawValue);
          return {
            value: Number.isNaN(parsed) ? rawValue : parsed,
            validationErrors,
          };
        }

        validationErrors.push(`${field.label} 的日期值格式不合法`);
        return {
          value: undefined,
          validationErrors,
        };
      case 'personSelectWidget':
        return this.normalizePersonFieldValue({
          field,
          rawValue,
        });
      case 'departmentSelectWidget': {
        const list = Array.isArray(rawValue) ? rawValue : [rawValue];
        if (list.some((item) => typeof item !== 'string')) {
          validationErrors.push(`${field.label} 需要传入字符串或字符串数组`);
          return {
            value: undefined,
            validationErrors,
          };
        }

        return {
          value: (list as string[]).map((item) => item.trim()).filter(Boolean),
          validationErrors,
        };
      }
      case 'radioWidget': {
        const option = field.options.find(
          (item) =>
            item.key === rawValue ||
            item.title === rawValue ||
            item.value === rawValue,
        );
        if (!option) {
          validationErrors.push(`${field.label} 的单选值未命中模板选项`);
          return {
            value: undefined,
            validationErrors,
          };
        }

        return {
          value: option.key,
          validationErrors,
        };
      }
      case 'checkboxWidget': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const normalizedValues = values
          .map((item) =>
            field.options.find(
              (option) =>
                option.key === item ||
                option.title === item ||
                option.value === item,
            ),
          )
          .filter(Boolean);

        if (normalizedValues.length !== values.length) {
          validationErrors.push(`${field.label} 的多选值存在未命中模板选项的项`);
        }

        return {
          value: normalizedValues.map((item) => item!.key),
          validationErrors,
        };
      }
      case 'publicOptBoxWidget':
        return this.normalizePublicOptionValue({
          field,
          rawValue,
          dictionaryBinding,
        });
      case 'attachmentWidget':
        return this.normalizeAttachmentFieldValue({
          field,
          rawValue,
        });
      default:
        return {
          value: rawValue,
          validationErrors,
        };
    }
  }

  private async normalizeSearchFieldValue(params: {
    snapshot: ShadowObjectSnapshotRecord;
    field: ShadowStandardizedField;
    rawValue: unknown;
    operator?: string;
    dictionaryBinding?: ShadowDictionaryBindingRecord;
    getAccessToken: () => Promise<string>;
  }): Promise<SearchFieldNormalizationResult> {
    const { snapshot, field, rawValue, operator, dictionaryBinding, getAccessToken } = params;

    if (field.widgetType === 'basicDataWidget') {
      return this.normalizeBasicDataSearchFieldValue({
        snapshot,
        field,
        rawValue,
        operator,
        getAccessToken,
      });
    }

    if (field.widgetType === 'dateWidget') {
      return this.normalizeDateSearchFieldValue({
        field,
        rawValue,
      });
    }

    return this.normalizeFieldValue({
      field,
      rawValue,
      dictionaryBinding,
    });
  }

  private async normalizeBasicDataSearchFieldValue(params: {
    snapshot: ShadowObjectSnapshotRecord;
    field: ShadowStandardizedField;
    rawValue: unknown;
    operator?: string;
    getAccessToken: () => Promise<string>;
  }): Promise<SearchFieldNormalizationResult> {
    const { snapshot, field, rawValue, operator, getAccessToken } = params;
    const validationErrors: string[] = [];
    const normalizedOperator = typeof operator === 'string' ? operator.trim().toLowerCase() : '';
    const exactMode =
      normalizedOperator !== '' &&
      normalizedOperator !== 'like' &&
      normalizedOperator !== 'contain';

    if (!exactMode) {
      const displayText = this.readBasicDataSearchDisplayText({
        field,
        rawValue,
      });
      if (!displayText) {
        validationErrors.push(
          `${field.label} 模糊查询需要传展示文本；精确查询请同时提供 operator 和关联记录 formInstId/id`,
        );
        return {
          value: undefined,
          validationErrors,
        };
      }

      return {
        value: displayText,
        validationErrors,
      };
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
      const candidate = rawValue.trim();
      const relationBinding = field.relationBinding;

      if (relationBinding?.formCodeId) {
        try {
          const accessToken = await getAccessToken();
          const linkedRecord = await this.getLinkedBasicDataRecord({
            accessToken,
            formCodeId: relationBinding.formCodeId,
            formInstId: candidate,
          });

          if (linkedRecord) {
            return {
              value: [this.buildBasicDataSearchTokenFromRecord({ relationBinding, record: linkedRecord })],
              validationErrors,
              searchOperator: 'contains',
            };
          }
        } catch {
          // Fall through to display-text search so searchList can still try matching by display column.
        }
      }

      return {
        value: candidate,
        validationErrors,
        searchOperator: null,
      };
    }

    const explicitToken = this.normalizeExplicitBasicDataSearchToken({
      field,
      value: rawValue,
    });
    if (explicitToken) {
      return {
        value: Array.isArray(explicitToken) ? explicitToken : [explicitToken],
        validationErrors,
        searchOperator: 'contains',
      };
    }

    const normalized = await this.normalizeBasicDataFieldValue({
      snapshot,
      field,
      rawValue,
      getAccessToken,
    });
    const tokens =
      Array.isArray(normalized.value)
        ? normalized.value
            .map((item) =>
              this.normalizeExplicitBasicDataSearchToken({
                field,
                value: item,
              }),
            )
            .flatMap((item) => (Array.isArray(item) ? item : item ? [item] : []))
        : [];

    return {
      value: normalized.value !== undefined ? tokens : undefined,
      validationErrors: normalized.validationErrors,
      resolvedMapping: normalized.resolvedMapping,
      searchOperator:
        normalized.value !== undefined && tokens.length > 0
          ? 'contains'
          : normalized.value !== undefined
            ? null
            : undefined,
    };
  }

  private normalizeDateSearchFieldValue(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
  }): SearchFieldNormalizationResult {
    const { field, rawValue } = params;
    const validationErrors: string[] = [];

    const parseRange = (
      startValue: unknown,
      endValue: unknown,
    ): SearchFieldNormalizationResult => {
      const start = parseSearchDateRangeBoundary(startValue, 'start');
      const end = parseSearchDateRangeBoundary(endValue, 'end');

      if (start === null || end === null) {
        validationErrors.push(`${field.label} 的日期值格式不合法`);
        return {
          value: undefined,
          validationErrors,
        };
      }

      if (start > end) {
        validationErrors.push(`${field.label} 的开始时间不能晚于结束时间`);
        return {
          value: undefined,
          validationErrors,
        };
      }

      return {
        value: [start, end],
        validationErrors,
        searchOperator: 'range',
        searchItemAttributes: {
          lightFieldMap: {
            plusDay: false,
          },
        },
      };
    };

    if (Array.isArray(rawValue)) {
      if (rawValue.length !== 2) {
        validationErrors.push(`${field.label} 的日期区间需要传入 [from,to]`);
        return {
          value: undefined,
          validationErrors,
        };
      }

      return parseRange(rawValue[0], rawValue[1]);
    }

    if (rawValue && typeof rawValue === 'object') {
      const value = rawValue as Record<string, unknown>;
      const startValue = value.from ?? value.start;
      const endValue = value.to ?? value.end;

      if (startValue === undefined || endValue === undefined) {
        validationErrors.push(`${field.label} 的日期区间需要同时提供 from/to 或 start/end`);
        return {
          value: undefined,
          validationErrors,
        };
      }

      return parseRange(startValue, endValue);
    }

    const singleValue = parseSearchDateSingleValue(rawValue);
    if (singleValue === null) {
      validationErrors.push(`${field.label} 的日期值格式不合法`);
      return {
        value: undefined,
        validationErrors,
      };
    }

    const [start, end] = getShanghaiDayBoundsFromTimestamp(singleValue);
    return {
      value: [start, end],
      validationErrors,
      searchOperator: 'range',
      searchItemAttributes: {
        lightFieldMap: {
          plusDay: false,
        },
      },
    };
  }

  private readBasicDataSearchDisplayText(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
  }): string {
    const { field, rawValue } = params;
    const relationBinding = field.relationBinding;

    const readObjectDisplayText = (value: unknown): string => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
      }

      const item = value as Record<string, unknown>;
      const candidates = [
        relationBinding?.displayCol ? item[relationBinding.displayCol] : undefined,
        item.value,
        item.showName,
        item._S_TITLE,
        item._S_NAME,
        item._name_,
        item.title,
        item.label,
      ];
      const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
      return typeof match === 'string' ? match.trim() : '';
    };

    if (typeof rawValue === 'string' && rawValue.trim()) {
      return rawValue.trim();
    }

    if (Array.isArray(rawValue) && rawValue.length === 1) {
      return this.readBasicDataSearchDisplayText({
        field,
        rawValue: rawValue[0],
      });
    }

    return readObjectDisplayText(rawValue);
  }

  private normalizeExplicitBasicDataSearchToken(params: {
    field: ShadowStandardizedField;
    value: unknown;
  }):
    | {
        _id_: string;
        _name_: string;
      }
    | Array<{
        _id_: string;
        _name_: string;
      }>
    | null {
    const { field, value } = params;
    if (Array.isArray(value)) {
      const tokens = value
        .map((item) =>
          this.normalizeExplicitBasicDataSearchToken({
            field,
            value: item,
          }),
        )
        .flatMap((item) => (Array.isArray(item) ? item : item ? [item] : []));

      return tokens.length > 0 ? tokens : null;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    const item = value as Record<string, unknown>;
    const id = this.readBasicDataRecordId(item);
    if (!id) {
      return null;
    }

    const displayText = this.readBasicDataSearchDisplayText({
      field,
      rawValue: value,
    });
    if (!displayText) {
      return null;
    }

    return {
      _id_: id,
      _name_: displayText,
    };
  }

  private normalizePublicOptionValue(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
    dictionaryBinding?: ShadowDictionaryBindingRecord;
  }): {
    value: unknown;
    validationErrors: string[];
    resolvedMapping?: ShadowResolvedDictionaryMapping;
  } {
    const { field, rawValue, dictionaryBinding } = params;
    const validationErrors: string[] = [];
    const entries = dictionaryBinding?.entries ?? [];
    const entryByDicId = new Map(entries.map((entry) => [entry.dicId, entry]));
    const entryByTitle = new Map<string, ShadowDictionaryBindingRecord['entries'][number]>();
    for (const entry of entries) {
      entryByTitle.set(entry.title, entry);
      for (const alias of entry.aliases) {
        entryByTitle.set(alias, entry);
      }
    }

    const normalizeExplicitObject = (
      value: unknown,
      matchedBy: ShadowResolvedDictionaryMapping['matchedBy'],
    ) => {
      if (
        value &&
        typeof value === 'object' &&
        'title' in value &&
        'dicId' in value &&
        typeof value.title === 'string' &&
        typeof value.dicId === 'string'
      ) {
        return {
          items: [{ title: value.title, dicId: value.dicId }],
          mapping: field.referId
            ? ({
                fieldCode: field.fieldCode,
                label: field.label,
                referId: field.referId,
                matchedBy,
                value: [{ title: value.title, dicId: value.dicId }],
              } satisfies ShadowResolvedDictionaryMapping)
            : undefined,
        };
      }

      validationErrors.push(`${field.label} 需要传入 {title,dicId} 或可解析的枚举值`);
      return {
        items: undefined,
        mapping: undefined,
      };
    };

    if (Array.isArray(rawValue)) {
      if (rawValue.every((item) => item && typeof item === 'object')) {
        const normalized = rawValue
          .map((item) =>
            item &&
            typeof item === 'object' &&
            'title' in item &&
            'dicId' in item &&
            typeof item.title === 'string' &&
            typeof item.dicId === 'string'
              ? { title: item.title, dicId: item.dicId }
              : null,
          )
          .filter(Boolean) as Array<{ title: string; dicId: string }>;

        if (normalized.length !== rawValue.length) {
          validationErrors.push(`${field.label} 的公共选项数组中存在非法元素`);
        }

        return {
          value: normalized,
          validationErrors,
          resolvedMapping: field.referId
            ? {
                fieldCode: field.fieldCode,
                label: field.label,
                referId: field.referId,
                matchedBy: 'array-object',
                value: normalized,
              }
            : undefined,
        };
      }

      const normalizedValues: Array<{ title: string; dicId: string }> = [];
      for (const item of rawValue) {
        const normalizedItem = this.normalizePublicOptionValue({
          field,
          rawValue: item,
          dictionaryBinding,
        });
        validationErrors.push(...normalizedItem.validationErrors);
        if (Array.isArray(normalizedItem.value)) {
          normalizedValues.push(...(normalizedItem.value as Array<{ title: string; dicId: string }>));
        }
      }

      return {
        value: normalizedValues,
        validationErrors,
        resolvedMapping: field.referId
          ? {
              fieldCode: field.fieldCode,
              label: field.label,
              referId: field.referId,
              matchedBy: 'array-object',
              value: normalizedValues,
            }
          : undefined,
      };
    }

    if (rawValue && typeof rawValue === 'object') {
      const normalized = normalizeExplicitObject(rawValue, 'object');
      return {
        value: normalized.items,
        validationErrors,
        resolvedMapping: normalized.mapping,
      };
    }

    if (typeof rawValue !== 'string') {
      validationErrors.push(`${field.label} 的公共选项值格式不合法`);
      return {
        value: undefined,
        validationErrors,
      };
    }

    const byDicId = entryByDicId.get(rawValue);
    if (byDicId) {
      return {
        value: [{ title: byDicId.title, dicId: byDicId.dicId }],
        validationErrors,
        resolvedMapping: field.referId
          ? {
              fieldCode: field.fieldCode,
              label: field.label,
              referId: field.referId,
              matchedBy: 'dicId',
              value: [{ title: byDicId.title, dicId: byDicId.dicId }],
            }
          : undefined,
      };
    }

    const byTitle = entryByTitle.get(rawValue);
    if (byTitle) {
      return {
        value: [{ title: byTitle.title, dicId: byTitle.dicId }],
        validationErrors,
        resolvedMapping: field.referId
          ? {
              fieldCode: field.fieldCode,
              label: field.label,
              referId: field.referId,
              matchedBy: 'title',
              value: [{ title: byTitle.title, dicId: byTitle.dicId }],
            }
          : undefined,
      };
    }

    if (dictionaryBinding?.resolutionStatus !== 'resolved') {
      validationErrors.push(
        `${field.label} 尚未解析公共选项码表，标题字符串不能直接自动映射，请传入完整 {title,dicId}`,
      );
      return {
        value: undefined,
        validationErrors,
      };
    }

    validationErrors.push(`${field.label} 的公共选项值未命中已解析码表`);
    return {
      value: undefined,
      validationErrors,
    };
  }

  private normalizePersonFieldValue(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
  }): {
    value: unknown;
    validationErrors: string[];
  } {
    const { field, rawValue } = params;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const validationErrors: string[] = [];
    const openIds: string[] = [];

    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          openIds.push(trimmed);
          continue;
        }
      }

      if (value && typeof value === 'object') {
        const person = value as Record<string, unknown>;
        const openId =
          (typeof person.open_id === 'string' && person.open_id.trim()) ||
          (typeof person.openId === 'string' && person.openId.trim());

        if (openId) {
          openIds.push(openId);
          continue;
        }
      }

      validationErrors.push(`${field.label} 需要传入人员 open_id 字符串、{open_id} 对象或它们的数组`);
      return {
        value: undefined,
        validationErrors,
      };
    }

    return {
      value: openIds,
      validationErrors,
    };
  }

  private normalizeAttachmentFieldValue(params: {
    field: ShadowStandardizedField;
    rawValue: unknown;
  }): {
    value: unknown;
    validationErrors: string[];
  } {
    const { field, rawValue } = params;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const validationErrors: string[] = [];
    const attachments: Array<{
      fileName: string;
      fileId: string;
      fileSize: string;
      fileType: string;
      fileExt: string;
    }> = [];

    for (const value of values) {
      if (!value || typeof value !== 'object') {
        validationErrors.push(
          `${field.label} 需要传入上传结果对象，至少包含 fileId、fileName、fileSize、fileType、fileExt`,
        );
        return {
          value: undefined,
          validationErrors,
        };
      }

      const file = value as Record<string, unknown>;
      const fileId = typeof file.fileId === 'string' ? file.fileId.trim() : '';
      const fileName = typeof file.fileName === 'string' ? file.fileName.trim() : '';
      const fileSize =
        typeof file.fileSize === 'string'
          ? file.fileSize.trim()
          : typeof file.fileSize === 'number'
            ? String(file.fileSize)
            : '';
      const fileType = typeof file.fileType === 'string' ? file.fileType.trim() : '';
      const fileExt = typeof file.fileExt === 'string' ? file.fileExt.trim().toLowerCase() : '';

      if (!fileId || !fileName || !fileSize || !fileType || !fileExt) {
        validationErrors.push(
          `${field.label} 的附件值缺少必要字段，必须同时提供 fileId、fileName、fileSize、fileType、fileExt`,
        );
        return {
          value: undefined,
          validationErrors,
        };
      }

      attachments.push({
        fileId,
        fileName,
        fileSize,
        fileType,
        fileExt,
      });
    }

    return {
      value: attachments,
      validationErrors,
    };
  }
}
