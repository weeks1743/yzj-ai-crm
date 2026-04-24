import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ApprovalClient } from '../src/approval-client.js';
import { DictionaryResolver } from '../src/dictionary-resolver.js';
import { LightCloudClient } from '../src/lightcloud-client.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { ShadowMetadataService } from '../src/shadow-metadata-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';

const CUSTOMER_FORM_CODE_ID = 'customer-form-001';
const CONTACT_FORM_CODE_ID = 'contact-form-001';
const CUSTOMER_SEARCH_OID = '69e75eb5e4b0e65b61c014da';
const CONTACT_SEARCH_OID = '66160cfde4b014e237ba75ca';
const SEARCH_RANGE_START_TS = 1777046400000;
const SEARCH_RANGE_END_TS = 1777132799999;

const CUSTOMER_WIDGET_MAP = {
  _S_NAME: {
    codeId: '_S_NAME',
    title: '客户名称',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  _S_ENCODE: {
    codeId: '_S_ENCODE',
    title: '编码',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  _S_DISABLE: {
    codeId: '_S_DISABLE',
    title: '启用状态',
    type: 'switchWidget',
    required: false,
    readOnly: true,
  },
  Te_0: {
    codeId: 'Te_0',
    title: '客户名称',
    type: 'textWidget',
    required: true,
  },
  Da_0: {
    codeId: 'Da_0',
    title: '最后跟进日期',
    type: 'dateWidget',
    required: false,
  },
  Ra_0: {
    codeId: 'Ra_0',
    title: '客户状态',
    type: 'radioWidget',
    required: false,
    options: [
      {
        key: 'customer-active',
        value: '活跃',
      },
      {
        key: 'customer-pending',
        value: '待跟进',
      },
    ],
  },
  Te_7: {
    codeId: 'Te_7',
    title: '办公电话',
    type: 'textWidget',
    required: false,
  },
  Nu_1: {
    codeId: 'Nu_1',
    title: '联系人手机',
    type: 'numberWidget',
    required: false,
  },
  Nu_0: {
    codeId: 'Nu_0',
    title: '公司电话',
    type: 'numberWidget',
    required: false,
  },
  Ps_1: {
    codeId: 'Ps_1',
    title: '售后服务代表',
    type: 'personSelectWidget',
    required: false,
  },
  Ra_3: {
    codeId: 'Ra_3',
    title: '客户类型',
    type: 'radioWidget',
    required: false,
    options: [
      {
        key: 'AaBaCcDd',
        value: '普通客户',
      },
      {
        key: 'EeFfGgHh',
        value: 'VIP客户',
      },
    ],
  },
  Pw_9: {
    codeId: 'Pw_9',
    title: '经营区域',
    type: 'publicOptBoxWidget',
    referId: 'd_region',
    required: false,
  },
  Pw_0: {
    codeId: 'Pw_0',
    title: '省',
    type: 'publicOptBoxWidget',
    required: false,
  },
  Pw_1: {
    codeId: 'Pw_1',
    title: '市',
    type: 'publicOptBoxWidget',
    required: false,
  },
  Pw_2: {
    codeId: 'Pw_2',
    title: '区',
    type: 'publicOptBoxWidget',
    required: false,
  },
  At_0: {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    required: false,
  },
  Bd_1: {
    codeId: 'Bd_1',
    title: '联系人编号',
    type: 'basicDataWidget',
    required: false,
    option: 'single',
    extendFieldMap: {
      displayCol: '_S_SERIAL',
      extendSettingDataMap: {
        displayCol: '_S_SERIAL',
        linkForm: {
          modelName: '联系人',
          modelCode: CONTACT_FORM_CODE_ID,
        },
      },
    },
    dataSource: {
      modelName: '联系人',
      modelCode: CONTACT_FORM_CODE_ID,
      partCode: CONTACT_FORM_CODE_ID,
      partName: '联系人',
    },
    columnData: [
      { colEnName: '_S_SERIAL', widgetType: 'serialNumWidget' },
      { colEnName: '_S_ENCODE', widgetType: 'textWidget' },
      { colEnName: '_S_TITLE', widgetType: 'textWidget' },
      { colEnName: '_S_NAME', widgetType: 'textWidget' },
    ],
  },
  _S_TITLE: {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    required: false,
  },
} satisfies Record<string, unknown>;

const CONTACT_WIDGET_MAP = {
  _S_NAME: {
    codeId: '_S_NAME',
    title: '联系人姓名',
    type: 'textWidget',
    required: true,
  },
  _S_TITLE: {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    required: false,
  },
  _S_ENCODE: {
    codeId: '_S_ENCODE',
    title: '编码',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  _S_SERIAL: {
    codeId: '_S_SERIAL',
    title: '联系人编号',
    type: 'serialNumWidget',
    required: false,
    readOnly: true,
  },
  At_0: {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    required: false,
  },
  Bd_0: {
    codeId: 'Bd_0',
    title: '选择客户',
    type: 'basicDataWidget',
    required: false,
    option: 'single',
    extendFieldMap: {
      displayCol: '_S_TITLE',
      extendSettingDataMap: {
        displayCol: '_S_TITLE',
        linkForm: {
          modelName: '客户',
          modelCode: CUSTOMER_FORM_CODE_ID,
        },
      },
    },
    dataSource: {
      modelName: '客户',
      modelCode: CUSTOMER_FORM_CODE_ID,
      partCode: CUSTOMER_FORM_CODE_ID,
      partName: '客户',
    },
    columnData: [
      { colEnName: '_S_ENCODE', widgetType: 'textWidget' },
      { colEnName: '_S_TITLE', widgetType: 'textWidget' },
      { colEnName: '_S_NAME', widgetType: 'textWidget' },
    ],
  },
} satisfies Record<string, unknown>;

const CUSTOMER_FIELD_CONTENT = [
  {
    codeId: '_S_NAME',
    title: '客户名称',
    type: 'textWidget',
    value: '华东制造样板客户',
    rawValue: '华东制造样板客户',
    parentCodeId: null,
  },
  {
    codeId: '_S_ENCODE',
    title: '编码',
    type: 'textWidget',
    value: 'CUS-001',
    rawValue: 'CUS-001',
    parentCodeId: null,
  },
  {
    codeId: '_S_DISABLE',
    title: '启用状态',
    type: 'switchWidget',
    value: '启用',
    rawValue: true,
    parentCodeId: null,
  },
  {
    codeId: 'Te_0',
    title: '客户名称',
    type: 'textWidget',
    value: '华东制造样板客户',
    rawValue: '华东制造样板客户',
    parentCodeId: null,
  },
  {
    codeId: 'Ra_3',
    title: '客户类型',
    type: 'radioWidget',
    value: 'VIP客户',
    rawValue: 'EeFfGgHh',
    parentCodeId: null,
  },
  {
    codeId: 'Da_0',
    title: '最后跟进日期',
    type: 'dateWidget',
    value: '2026-04-23',
    rawValue: Date.parse('2026-04-23'),
    parentCodeId: null,
  },
  {
    codeId: 'Ra_0',
    title: '客户状态',
    type: 'radioWidget',
    value: '活跃',
    rawValue: 'customer-active',
    parentCodeId: null,
  },
  {
    codeId: 'Te_7',
    title: '办公电话',
    type: 'textWidget',
    value: '021-55550001',
    rawValue: '021-55550001',
    parentCodeId: null,
  },
  {
    codeId: 'Nu_1',
    title: '联系人手机',
    type: 'numberWidget',
    value: '13800138000',
    rawValue: '13800138000',
    parentCodeId: null,
  },
  {
    codeId: 'Nu_0',
    title: '公司电话',
    type: 'numberWidget',
    value: '4008001234',
    rawValue: '4008001234',
    parentCodeId: null,
  },
  {
    codeId: 'Ps_1',
    title: '售后服务代表',
    type: 'personSelectWidget',
    value: ['open-live-1'],
    rawValue: ['open-live-1'],
    parentCodeId: null,
  },
  {
    codeId: 'Bd_1',
    title: '联系人编号',
    type: 'basicDataWidget',
    value: 'CON-001',
    rawValue: [
      {
        id: 'contact-inst-001',
        formCodeId: CONTACT_FORM_CODE_ID,
        formDefId: 'form-def-contact',
        flowInstId: '',
        showName: '张三',
        _S_TITLE: '张三',
        _S_NAME: '张三',
        _name_: '张三',
        _S_SERIAL: 'CON-001',
        _S_ENCODE: 'CON-001',
      },
    ],
    parentCodeId: null,
  },
];

const CONTACT_FIELD_CONTENT = [
  {
    codeId: '_S_NAME',
    title: '联系人姓名',
    type: 'textWidget',
    value: '张三',
    rawValue: '张三',
    parentCodeId: null,
  },
  {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    value: '张三',
    rawValue: '张三',
    parentCodeId: null,
  },
  {
    codeId: '_S_ENCODE',
    title: '编码',
    type: 'textWidget',
    value: 'CON-001',
    rawValue: 'CON-001',
    parentCodeId: null,
  },
  {
    codeId: '_S_SERIAL',
    title: '联系人编号',
    type: 'serialNumWidget',
    value: 'CON-001',
    rawValue: 'CON-001',
    parentCodeId: null,
  },
];

class StubApprovalClient extends ApprovalClient {
  constructor() {
    super({ baseUrl: 'https://stub.yzj.local' });
  }

  override async getTeamAccessToken(): Promise<string> {
    return 'approval-token';
  }

  override async viewFormDef(params: { accessToken: string; formCodeId: string }): Promise<{
    formDefId?: string;
    formInfo?: {
      widgetMap?: Record<string, unknown>;
    };
  }> {
    return {
      formDefId: params.formCodeId === CONTACT_FORM_CODE_ID ? 'form-def-contact' : 'form-def-customer',
      formInfo: {
        widgetMap: params.formCodeId === CONTACT_FORM_CODE_ID ? CONTACT_WIDGET_MAP : CUSTOMER_WIDGET_MAP,
      },
    };
  }
}

class StubLightCloudClient extends LightCloudClient {
  constructor() {
    super({ baseUrl: 'https://stub.yzj.local' });
  }

  override async getTeamAccessToken(): Promise<string> {
    return 'lightcloud-token';
  }

  override async searchList(): Promise<{
    pageNumber: number;
    totalPages: number;
    pageSize: number;
    totalElements: number;
    content: Array<{
      id: string;
      important: Record<string, unknown>;
      fieldContent: Array<{
        codeId: string;
        title: string;
        type: string;
        value: unknown;
        rawValue: unknown;
        parentCodeId: string | null;
      }>;
    }>;
  }> {
    return {
      pageNumber: 1,
      totalPages: 1,
      pageSize: 20,
      totalElements: 1,
      content: [
        {
          id: 'form-inst-001',
          important: {
            标题: '华东制造样板客户',
          },
          fieldContent: CUSTOMER_FIELD_CONTENT,
        },
      ],
    };
  }

  override async listRecords(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<Array<{
    id: string;
    important: Record<string, unknown>;
    fieldContent: Array<{
      codeId: string;
      title: string;
      type: string;
      value: unknown;
      rawValue: unknown;
      parentCodeId: string | null;
    }>;
  }>> {
    const requestedIds = Array.isArray(params.body.formInstIds)
      ? params.body.formInstIds.filter((item): item is string => typeof item === 'string')
      : [];

    if (params.body.formCodeId === CONTACT_FORM_CODE_ID) {
      if (!requestedIds.includes('contact-inst-001')) {
        return [];
      }

      return [
        {
          id: 'contact-inst-001',
          formDefId: 'form-def-contact',
          title: '张三',
          formCodeId: CONTACT_FORM_CODE_ID,
          flowInstId: '',
          important: {
            标题: '张三',
          },
          fieldContent: CONTACT_FIELD_CONTENT,
        },
      ];
    }

    if (!requestedIds.includes('form-inst-001')) {
      return [];
    }

    return [
      {
        id: 'form-inst-001',
        formDefId: 'form-def-customer',
        title: '华东制造样板客户',
        formCodeId: CUSTOMER_FORM_CODE_ID,
        flowInstId: '',
        important: {
          标题: '华东制造样板客户',
        },
        fieldContent: CUSTOMER_FIELD_CONTENT,
      },
    ];
  }

  override async batchSave(): Promise<string[]> {
    return ['form-inst-001'];
  }

  override async batchDelete(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<string[]> {
    return Array.isArray(params.body.formInstIds)
      ? params.body.formInstIds.filter((item): item is string => typeof item === 'string')
      : [];
  }
}

class StubSearchFormInstLightCloudClient extends StubLightCloudClient {
  override async searchList(): Promise<{
    pageNumber: number;
    totalPages: number;
    pageSize: number;
    totalElements: number;
    content: Array<Record<string, unknown>>;
  }> {
    const page = await super.searchList();
    return {
      ...page,
      content: page.content.map(({ id, ...record }) => ({
        ...record,
        formInstId: id,
      })),
    };
  }
}

function createNowSequence() {
  let current = 0;
  return () => new Date(`2026-04-23T09:00:${String(current++).padStart(2, '0')}.000Z`);
}

function writeResolvedDictionary(dictionaryPath: string) {
  mkdirSync(join(dictionaryPath, '..'), { recursive: true });
  writeFileSync(
    dictionaryPath,
    JSON.stringify({
      dictionaries: [
        {
          referId: 'd_region',
          title: '经营区域',
          entries: [
            {
              dicId: 'd005a1',
              title: '北京',
            },
          ],
        },
      ],
    }),
    'utf8',
  );
}

function createService(
  dictionaryJsonPath: string,
  skillOutputDir: string,
  lightCloudClient: LightCloudClient = new StubLightCloudClient(),
) {
  const config = createTestConfig({
    dictionarySource: 'manual_json',
    dictionaryJsonPath,
    skillOutputDir,
    customerFormCodeId: CUSTOMER_FORM_CODE_ID,
    contactFormCodeId: CONTACT_FORM_CODE_ID,
  });
  const repository = new ShadowMetadataRepository(createInMemoryDatabase());
  const approvalClient = new StubApprovalClient();

  return new ShadowMetadataService({
    config,
    repository,
    approvalClient,
    lightCloudClient,
    dictionaryResolver: new DictionaryResolver({
      source: config.shadow.dictionarySource,
      jsonPath: config.shadow.dictionaryJsonPath,
      approvalClient,
    }),
    now: createNowSequence(),
  });
}

const SEARCHABLE_BASE_WIDGET_TYPES = new Set([
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
  'switchWidget',
  'serialNumWidget',
]);

function getFieldParameterKeyForTest(field: { fieldCode: string; semanticSlot?: string }) {
  return field.semanticSlot ?? field.fieldCode;
}

function getSearchFieldParameterKeyForTest(
  field: {
    fieldCode: string;
    semanticSlot?: string;
  },
  fields: Array<{
    fieldCode: string;
    semanticSlot?: string;
  }>,
) {
  if (!field.semanticSlot) {
    return field.fieldCode;
  }

  const semanticSlotMatches = fields.filter((candidate) => candidate.semanticSlot === field.semanticSlot);
  return semanticSlotMatches.length > 1 ? field.fieldCode : field.semanticSlot;
}

function getExpectedSearchParams(fields: Array<{
  fieldCode: string;
  widgetType: string;
  semanticSlot?: string;
  referId?: string;
  enumBinding?: { resolutionStatus?: string };
  relationBinding?: { formCodeId?: string | null };
}>) {
  return fields
    .filter((field) => {
      if (field.widgetType === 'attachmentWidget') {
        return false;
      }

      if (field.widgetType === 'publicOptBoxWidget') {
        return Boolean(field.referId) && field.enumBinding?.resolutionStatus === 'resolved';
      }

      if (field.widgetType === 'basicDataWidget') {
        return Boolean(field.relationBinding?.formCodeId);
      }

      return SEARCHABLE_BASE_WIDGET_TYPES.has(field.widgetType);
    })
    .map((field, _index, list) => getSearchFieldParameterKeyForTest(field, list))
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort();
}

test('ShadowMetadataService refreshes customer metadata and upgrades resolved dictionaries into skill contracts', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-dict-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const skillOutputDir = join(tempDir, 'skills');
  const service = createService(dictionaryPath, skillOutputDir);

  try {
    const firstRefresh = await service.refreshObject('customer');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Ps_1')?.semanticSlot, 'service_rep_open_id');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Da_0')?.semanticSlot, 'last_followup_date');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Ra_3')?.semanticSlot, 'customer_type');
    assert.equal(
      firstRefresh.fields.find((field) => field.fieldCode === 'Bd_1')?.semanticSlot,
      'linked_contact_form_inst_id',
    );
    assert.equal(
      firstRefresh.fields.find((field) => field.fieldCode === 'Bd_1')?.relationBinding?.formCodeId,
      CONTACT_FORM_CODE_ID,
    );
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_0')?.semanticSlot, undefined);
    assert.equal(
      firstRefresh.fields.find((field) => field.fieldCode === 'Pw_9')?.enumBinding?.resolutionStatus,
      'pending',
    );

    const initialCreateSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_create');
    const initialSearchSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_search');
    assert.ok(initialCreateSkill);
    assert.ok(initialSearchSkill);
    assert.deepEqual(initialCreateSkill?.requiredParams, ['customer_name']);
    assert.ok(initialCreateSkill?.optionalParams.includes('service_rep_open_id'));
    assert.ok(initialCreateSkill?.optionalParams.includes('last_followup_date'));
    assert.ok(initialCreateSkill?.optionalParams.includes('customer_type'));
    assert.ok(initialCreateSkill?.optionalParams.includes('At_0'));
    assert.ok(initialCreateSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(initialSearchSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(initialSearchSkill?.optionalParams.includes('_S_NAME'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Te_0'));
    assert.ok(initialSearchSkill?.optionalParams.includes('_S_DISABLE'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Ra_0'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Te_7'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Nu_1'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Nu_0'));
    assert.equal(initialSearchSkill?.optionalParams.includes('customer_name'), false);
    assert.equal(initialSearchSkill?.optionalParams.includes('customer_status'), false);
    assert.equal(initialSearchSkill?.optionalParams.includes('phone'), false);
    assert.equal(initialCreateSkill?.optionalParams.includes('region'), false);
    assert.equal(initialCreateSkill?.optionalParams.includes('Pw_0'), false);
    assert.deepEqual(
      [...(initialSearchSkill?.optionalParams ?? [])].sort(),
      getExpectedSearchParams(firstRefresh.fields),
    );
    assert.equal(existsSync(initialCreateSkill?.skillPath ?? ''), true);
    assert.equal(existsSync(initialCreateSkill?.referencePaths.templateSummary ?? ''), true);
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /open_id/);
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /\$approval\.file_upload/);
    const initialSearchSkillMarkdown = readFileSync(initialSearchSkill?.skillPath ?? '', 'utf8');
    const initialSearchExecution = readFileSync(initialSearchSkill?.referencePaths.execution ?? '', 'utf8');
    assert.match(initialSearchSkillMarkdown, /pageSize/);
    assert.match(initialSearchSkillMarkdown, /search2Gen/);
    assert.match(initialSearchSkillMarkdown, /## Search Coverage/);
    assert.match(initialSearchSkillMarkdown, /linked_contact_form_inst_id -> Bd_1/);
    assert.match(initialSearchSkillMarkdown, /_S_SERIAL/);
    assert.match(initialSearchSkillMarkdown, new RegExp(CUSTOMER_SEARCH_OID));
    assert.match(initialSearchSkillMarkdown, /CON-20260424-001/);
    assert.match(initialSearchExecution, /"codeId": "Bd_1"/);
    assert.match(initialSearchExecution, /linked_contact_form_inst_id__S_SERIAL/);
    assert.doesNotMatch(initialSearchExecution, /"_id_"/);
    assert.match(initialSearchExecution, /"operator": "range"/);
    assert.match(initialSearchExecution, new RegExp(String(SEARCH_RANGE_START_TS)));
    assert.match(initialSearchExecution, new RegExp(String(SEARCH_RANGE_END_TS)));

    writeResolvedDictionary(dictionaryPath);

    const secondRefresh = await service.refreshObject('customer');
    const regionField = secondRefresh.fields.find((field) => field.fieldCode === 'Pw_9');
    assert.equal(regionField?.enumBinding?.resolutionStatus, 'resolved');
    assert.equal(regionField?.options[0]?.dicId, 'd005a1');

    const refreshedCreateSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_create');
    assert.ok(refreshedCreateSkill?.optionalParams.includes('region'));

    const dictionaries = service.listDictionaries('customer');
    assert.equal(dictionaries.find((binding) => binding.fieldCode === 'Pw_9')?.entries[0]?.title, '北京');

    const preview = await service.previewUpsert('customer', {
      mode: 'create',
      operatorOpenId: 'oid-test-1',
      params: {
        customer_name: '华东制造样板客户',
        service_rep_open_id: 'open-1',
        customer_type: 'VIP客户',
        last_followup_date: '2026-04-23',
        region: '北京',
        linked_contact_form_inst_id: 'contact-inst-001',
      },
    });

    const widgetValue = (preview.requestBody as {
      data: Array<{ widgetValue: Record<string, unknown> }>;
    }).data[0]?.widgetValue;

    assert.equal(preview.readyToSend, true);
    assert.deepEqual(preview.validationErrors, []);
    assert.deepEqual(preview.unresolvedDictionaries, []);
    assert.deepEqual(widgetValue.Pw_9, [{ title: '北京', dicId: 'd005a1' }]);
    assert.deepEqual(widgetValue.Ps_1, ['open-1']);
    assert.equal(widgetValue.Ra_3, 'EeFfGgHh');
    assert.equal(widgetValue.Da_0, Date.parse('2026-04-23'));
    assert.deepEqual(widgetValue.Bd_1, [
      {
        id: 'contact-inst-001',
        formCodeId: CONTACT_FORM_CODE_ID,
        formDefId: 'form-def-contact',
        flowInstId: '',
        showName: '张三',
        _S_TITLE: '张三',
        _S_NAME: '张三',
        _name_: '张三',
        _S_SERIAL: 'CON-001',
      },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService enforces strict unresolved dictionary, attachment, and person rules', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-dict-'));
  const dictionaryPath = join(tempDir, 'missing-shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const titleOnlyPreview = await service.previewUpsert('customer', {
      mode: 'create',
      operatorOpenId: 'oid-test-2',
      params: {
        customer_name: '华北样板客户',
        region: '北京',
      },
    });
    assert.equal(titleOnlyPreview.readyToSend, false);
    assert.match(titleOnlyPreview.validationErrors[0] ?? '', /完整 \{title,dicId\}/);

    const explicitPreview = await service.previewUpsert('customer', {
      mode: 'create',
      operatorOpenId: 'oid-test-3',
      params: {
        customer_name: '华北样板客户',
        region: {
          title: '北京',
          dicId: 'd005a1',
        },
      },
    });

    assert.equal(explicitPreview.readyToSend, true);
    assert.deepEqual(
      (explicitPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Pw_9,
      [{ title: '北京', dicId: 'd005a1' }],
    );

    const ignoredFieldPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4',
      formInstId: 'form-inst-001',
      params: {
        service_rep_open_id: {
          open_id: 'open-2',
        },
        At_0: [
          {
            fileId: 'file-1',
            fileName: 'fixture.pdf',
            fileSize: '128',
            fileType: 'doc',
            fileExt: 'pdf',
          },
        ],
        Pw_0: [{ title: '浙江', dicId: 'd-zj' }],
        Pw_1: [{ title: '杭州', dicId: 'd-hz' }],
        Pw_2: [{ title: '滨江', dicId: 'd-bj' }],
      },
    });

    const ignoredWidgetValue = (ignoredFieldPreview.requestBody as {
      data: Array<{ widgetValue: Record<string, unknown> }>;
    }).data[0]?.widgetValue;
    assert.equal(ignoredFieldPreview.readyToSend, true);
    assert.deepEqual(ignoredFieldPreview.validationErrors, []);
    assert.deepEqual(ignoredFieldPreview.blockedReadonlyParams, []);
    assert.deepEqual(ignoredWidgetValue.Ps_1, ['open-2']);
    assert.deepEqual(ignoredWidgetValue.At_0, [
      {
        fileId: 'file-1',
        fileName: 'fixture.pdf',
        fileSize: '128',
        fileType: 'doc',
        fileExt: 'pdf',
      },
    ]);
    assert.equal('Pw_0' in ignoredWidgetValue, false);
    assert.equal('Pw_1' in ignoredWidgetValue, false);
    assert.equal('Pw_2' in ignoredWidgetValue, false);

    const invalidAttachmentPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4a',
      formInstId: 'form-inst-001',
      params: {
        At_0: [{ fileId: 'file-1' }],
      },
    });
    assert.equal(invalidAttachmentPreview.readyToSend, false);
    assert.match(invalidAttachmentPreview.validationErrors[0] ?? '', /fileId、fileName、fileSize、fileType、fileExt/);

    const invalidPersonPreview = await service.previewUpsert('customer', {
      mode: 'create',
      operatorOpenId: 'oid-test-5',
      params: {
        customer_name: '华北样板客户',
        service_rep_open_id: {
          name: '张三',
        },
      },
    });
    assert.equal(invalidPersonPreview.readyToSend, false);
    assert.match(invalidPersonPreview.validationErrors[0] ?? '', /open_id/);

    const invalidBasicDataPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-5a',
      formInstId: 'form-inst-001',
      params: {
        linked_contact_form_inst_id: {
          id: 'contact-inst-001',
          formCodeId: CONTACT_FORM_CODE_ID,
          formDefId: 'form-def-contact',
        },
      },
    });
    assert.equal(invalidBasicDataPreview.readyToSend, true);
    assert.deepEqual(
      (invalidBasicDataPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Bd_1,
      [
        {
          id: 'contact-inst-001',
          formCodeId: CONTACT_FORM_CODE_ID,
          formDefId: 'form-def-contact',
          flowInstId: '',
          showName: '张三',
          _S_TITLE: '张三',
          _S_NAME: '张三',
          _name_: '张三',
          _S_SERIAL: 'CON-001',
        },
      ],
    );

    const displayOnlyBasicDataPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-5b',
      formInstId: 'form-inst-001',
      params: {
        linked_contact_form_inst_id: {
          id: 'contact-inst-001',
          formCodeId: CONTACT_FORM_CODE_ID,
          formDefId: 'form-def-contact',
          _S_SERIAL: 'CON-DISPLAY-ONLY',
        },
      },
    });
    assert.equal(displayOnlyBasicDataPreview.readyToSend, true);
    assert.deepEqual(
      (displayOnlyBasicDataPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Bd_1,
      [
        {
          id: 'contact-inst-001',
          formCodeId: CONTACT_FORM_CODE_ID,
          formDefId: 'form-def-contact',
          flowInstId: '',
          showName: '张三',
          _S_TITLE: '张三',
          _S_NAME: '张三',
          _name_: '张三',
          _S_SERIAL: 'CON-001',
        },
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService generates customer_get skill bundle and preview request mapping', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-dict-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const getSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_get');
    assert.ok(getSkill);
    assert.equal(getSkill?.operation, 'get');
    assert.match(getSkill?.skillPath ?? '', /\/customer\/get\/SKILL\.md$/);
    assert.match(readFileSync(getSkill?.referencePaths.execution ?? '', 'utf8'), /preview\/get/);
    assert.match(readFileSync(getSkill?.referencePaths.execution ?? '', 'utf8'), /execute\/get/);

    const preview = service.previewGet('customer', {
      formInstId: 'form-inst-001',
    });
    assert.equal(preview.readyToSend, true);
    assert.deepEqual(preview.requestBody, {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      formInstIds: ['form-inst-001'],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService generates customer_delete skill bundle and delete request mapping', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-delete-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const deleteSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_delete');
    assert.ok(deleteSkill);
    assert.equal(deleteSkill?.operation, 'delete');
    assert.match(deleteSkill?.skillPath ?? '', /\/customer\/delete\/SKILL\.md$/);
    assert.match(readFileSync(deleteSkill?.referencePaths.execution ?? '', 'utf8'), /preview\/delete/);
    assert.match(readFileSync(deleteSkill?.referencePaths.execution ?? '', 'utf8'), /execute\/delete/);
    assert.match(readFileSync(deleteSkill?.skillPath ?? '', 'utf8'), /form_inst_ids/);

    const preview = service.previewDelete('customer', {
      operatorOpenId: 'oid-delete-1',
      formInstIds: ['form-inst-001', 'form-inst-002'],
    });
    assert.equal(preview.readyToSend, true);
    assert.deepEqual(preview.requestBody, {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      oid: 'oid-delete-1',
      formInstIds: ['form-inst-001', 'form-inst-002'],
    });

    const missingRuntimePreview = service.previewDelete('customer', {
      formInstIds: ['form-inst-001'],
    });
    assert.equal(missingRuntimePreview.readyToSend, false);
    assert.deepEqual(missingRuntimePreview.missingRuntimeInputs, ['operatorOpenId']);

    const result = await service.executeDelete('customer', {
      operatorOpenId: 'oid-delete-1',
      formInstIds: ['form-inst-001'],
    });
    assert.equal(result.mode, 'live');
    assert.equal(result.operation, 'delete');
    assert.deepEqual(result.formInstIds, ['form-inst-001']);
    assert.deepEqual(result.requestBody, {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      oid: 'oid-delete-1',
      formInstIds: ['form-inst-001'],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService normalizes basicData search filters for exact and fuzzy search', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-search-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const exactPreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      pageNumber: 1,
      pageSize: 20,
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: 'contact-inst-001',
          operator: 'eq',
        },
        {
          field: 'service_rep_open_id',
          value: 'open-live-1',
          operator: 'eq',
        },
      ],
    });
    assert.equal(exactPreview.readyToSend, true);
    assert.deepEqual(
      (exactPreview.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Bd_1',
          parentCodeId: null,
          type: 'basicDataWidget',
          operator: 'contains',
          value: [
            {
              _id_: 'contact-inst-001',
              _name_: 'CON-001',
            },
          ],
        },
        {
          codeId: 'Ps_1',
          parentCodeId: null,
          type: 'personSelectWidget',
          operator: 'eq',
          value: ['open-live-1'],
        },
      ],
    );

    const fuzzyPreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: 'CON-001',
        },
      ],
    });
    assert.equal(fuzzyPreview.readyToSend, true);
    assert.deepEqual(
      (fuzzyPreview.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Bd_1',
          parentCodeId: null,
          type: 'basicDataWidget',
          value: 'CON-001',
        },
      ],
    );

    const downgradedExactPreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: 'CON-001',
          operator: 'contains',
        },
      ],
    });
    assert.equal(downgradedExactPreview.readyToSend, true);
    assert.deepEqual(
      (downgradedExactPreview.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Bd_1',
          parentCodeId: null,
          type: 'basicDataWidget',
          value: 'CON-001',
        },
      ],
    );

    const singleDatePreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'last_followup_date',
          value: '2026-04-25',
        },
      ],
    });
    assert.equal(singleDatePreview.readyToSend, true);
    assert.deepEqual(
      (singleDatePreview.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Da_0',
          parentCodeId: null,
          type: 'dateWidget',
          operator: 'range',
          lightFieldMap: {
            plusDay: false,
          },
          value: [SEARCH_RANGE_START_TS, SEARCH_RANGE_END_TS],
        },
      ],
    );

    const explicitDateRangePreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'last_followup_date',
          value: {
            from: '2026-04-25',
            to: '2026-04-25',
          },
          operator: 'eq',
        },
      ],
    });
    assert.equal(explicitDateRangePreview.readyToSend, true);
    assert.deepEqual(
      (explicitDateRangePreview.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Da_0',
          parentCodeId: null,
          type: 'dateWidget',
          operator: 'range',
          lightFieldMap: {
            plusDay: false,
          },
          value: [SEARCH_RANGE_START_TS, SEARCH_RANGE_END_TS],
        },
      ],
    );

    const invalidPreview = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      pageSize: 101,
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: {
            id: 'contact-inst-001',
          },
        },
      ],
    });
    assert.equal(invalidPreview.readyToSend, false);
    assert.match(invalidPreview.validationErrors.join('\n'), /pageSize/);
    assert.match(invalidPreview.validationErrors.join('\n'), /模糊查询需要传展示文本/);

    const explicitSearch2GenShape = await service.previewSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: [{ _id_: 'contact-inst-001', _name_: 'CON-001' }],
          operator: 'contains',
        },
      ],
    });
    assert.equal(explicitSearch2GenShape.readyToSend, true);
    assert.deepEqual(
      (explicitSearch2GenShape.requestBody as { searchItems: Array<Record<string, unknown>> }).searchItems,
      [
        {
          codeId: 'Bd_1',
          parentCodeId: null,
          type: 'basicDataWidget',
          operator: 'contains',
          value: [
            {
              _id_: 'contact-inst-001',
              _name_: 'CON-001',
            },
          ],
        },
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService executes real search and get with live read bindings', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-dict-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const search = await service.executeSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: 'contact-inst-001',
          operator: 'eq',
        },
        {
          field: 'service_rep_open_id',
          value: {
            openId: 'open-live-1',
          },
          operator: 'eq',
        },
        {
          field: 'Pw_0',
          value: [{ title: '浙江', dicId: 'd-zj' }],
          operator: 'eq',
        },
      ],
      pageNumber: 1,
      pageSize: 20,
    });
    assert.equal(search.mode, 'live');
    assert.equal(search.records.length, 1);
    assert.equal(search.records[0]?.formInstId, 'form-inst-001');
    assert.equal(search.requestBody.searchItems.length, 2);
    assert.equal(search.requestBody.searchItems[0]?.codeId, 'Bd_1');
    assert.equal(search.requestBody.searchItems[0]?.operator, 'contains');
    assert.deepEqual(search.requestBody.searchItems[0]?.value, [
      {
        _id_: 'contact-inst-001',
        _name_: 'CON-001',
      },
    ]);
    assert.equal(search.requestBody.searchItems[1]?.codeId, 'Ps_1');
    assert.deepEqual(search.requestBody.searchItems[1]?.value, ['open-live-1']);

    const displayAndDateSearch = await service.executeSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'linked_contact_form_inst_id',
          value: 'CON-001',
          operator: 'contains',
        },
        {
          field: 'last_followup_date',
          value: '2026-04-25',
        },
      ],
      pageNumber: 1,
      pageSize: 20,
    });
    assert.equal(displayAndDateSearch.mode, 'live');
    assert.equal(displayAndDateSearch.requestBody.searchItems.length, 2);
    assert.deepEqual(displayAndDateSearch.requestBody.searchItems[0], {
      codeId: 'Bd_1',
      parentCodeId: null,
      type: 'basicDataWidget',
      value: 'CON-001',
    });
    assert.deepEqual(displayAndDateSearch.requestBody.searchItems[1], {
      codeId: 'Da_0',
      parentCodeId: null,
      type: 'dateWidget',
      operator: 'range',
      lightFieldMap: {
        plusDay: false,
      },
      value: [SEARCH_RANGE_START_TS, SEARCH_RANGE_END_TS],
    });

    const detail = await service.executeGet('customer', {
      operatorOpenId: 'oid-live-1',
      formInstId: 'form-inst-001',
    });
    assert.equal(detail.mode, 'live');
    assert.equal(detail.record.formInstId, 'form-inst-001');
    assert.equal(detail.record.fieldMap.Te_0?.value, '华东制造样板客户');
    assert.equal(detail.record.fieldMap.Ra_3?.rawValue, 'EeFfGgHh');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService maps searchList formInstId when upstream omits top-level id', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-search-forminst-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(
    dictionaryPath,
    join(tempDir, 'skills'),
    new StubSearchFormInstLightCloudClient(),
  );

  try {
    await service.refreshObject('customer');

    const search = await service.executeSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'customer_name',
          value: '华东制造样板客户',
          operator: 'contain',
        },
      ],
      pageNumber: 1,
      pageSize: 20,
    });

    assert.equal(search.mode, 'live');
    assert.equal(search.records.length, 1);
    assert.equal(search.records[0]?.formInstId, 'form-inst-001');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService executes real update write with customer type, followup date, and service rep open_id', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-dict-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('customer');

    const updateSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_update');
    assert.ok(updateSkill?.executionBinding.liveApi);
    assert.match(readFileSync(updateSkill?.referencePaths.execution ?? '', 'utf8'), /execute\/upsert/);
    assert.match(readFileSync(updateSkill?.skillPath ?? '', 'utf8'), /basicDataWidget/);
    assert.match(readFileSync(updateSkill?.referencePaths.execution ?? '', 'utf8'), /_S_SERIAL/);

    const result = await service.executeUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-live-1',
      formInstId: 'form-inst-001',
      params: {
        customer_name: '华东制造更新客户',
        customer_type: 'VIP客户',
        last_followup_date: '2026-04-23',
        service_rep_open_id: {
          openId: 'open-live-2',
        },
        At_0: [
          {
            fileId: 'file-1',
            fileName: 'fixture.pdf',
            fileSize: '128',
            fileType: 'doc',
            fileExt: 'pdf',
          },
        ],
        linked_contact_form_inst_id: 'contact-inst-001',
        Pw_0: [{ title: '浙江', dicId: 'd-zj' }],
      },
    });

    assert.equal(result.mode, 'live');
    assert.equal(result.writeMode, 'update');
    assert.deepEqual(result.formInstIds, ['form-inst-001']);
    assert.equal(result.requestBody.data[0]?.widgetValue.Te_0, '华东制造更新客户');
    assert.equal(result.requestBody.data[0]?.widgetValue.Ra_3, 'EeFfGgHh');
    assert.equal(result.requestBody.data[0]?.widgetValue.Da_0, Date.parse('2026-04-23'));
    assert.deepEqual(result.requestBody.data[0]?.widgetValue.Ps_1, ['open-live-2']);
    assert.deepEqual(result.requestBody.data[0]?.widgetValue.At_0, [
      {
        fileId: 'file-1',
        fileName: 'fixture.pdf',
        fileSize: '128',
        fileType: 'doc',
        fileExt: 'pdf',
      },
    ]);
    assert.deepEqual(result.requestBody.data[0]?.widgetValue.Bd_1, [
      {
        id: 'contact-inst-001',
        formCodeId: CONTACT_FORM_CODE_ID,
        formDefId: 'form-def-contact',
        flowInstId: '',
        showName: '张三',
        _S_TITLE: '张三',
        _S_NAME: '张三',
        _name_: '张三',
        _S_SERIAL: 'CON-001',
      },
    ]);
    assert.equal('Pw_0' in (result.requestBody.data[0]?.widgetValue ?? {}), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService generates object-specific contact skill names instead of customer aliases', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-contact-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const skillOutputDir = join(tempDir, 'skills');
  const config = createTestConfig({
    dictionaryJsonPath: dictionaryPath,
    skillOutputDir,
    customerFormCodeId: 'customer-form-001',
    contactFormCodeId: 'contact-form-001',
  });
  config.shadow.objects.contact.enabled = true;
  const repository = new ShadowMetadataRepository(createInMemoryDatabase());
  const approvalClient = new StubApprovalClient();
  const service = new ShadowMetadataService({
    config,
    repository,
    approvalClient,
    lightCloudClient: new StubLightCloudClient(),
    dictionaryResolver: new DictionaryResolver({
      source: config.shadow.dictionarySource,
      jsonPath: config.shadow.dictionaryJsonPath,
      approvalClient,
    }),
    now: createNowSequence(),
  });

  try {
    await service.refreshObject('contact');

    const contactCreateSkill = service
      .listSkills('contact')
      .find((skill) => skill.skillName === 'shadow.contact_create');
    const contactSearchSkill = service
      .listSkills('contact')
      .find((skill) => skill.skillName === 'shadow.contact_search');
    assert.ok(contactCreateSkill);
    assert.ok(contactSearchSkill);
    assert.equal(contactCreateSkill?.sourceObject, 'contact');
    assert.equal(contactCreateSkill?.skillKey, 'contact_create');
    assert.ok(contactCreateSkill?.requiredParams.includes('_S_NAME'));
    assert.ok(contactCreateSkill?.optionalParams.includes('linked_customer_form_inst_id'));
    assert.ok(contactSearchSkill?.optionalParams.includes('linked_customer_form_inst_id'));
    assert.ok(contactSearchSkill?.optionalParams.includes('_S_NAME'));
    assert.ok(contactSearchSkill?.optionalParams.includes('_S_ENCODE'));
    assert.deepEqual(
      [...(contactSearchSkill?.optionalParams ?? [])].sort(),
      getExpectedSearchParams(service.getObject('contact').fields),
    );
    assert.match(readFileSync(contactCreateSkill?.skillPath ?? '', 'utf8'), /name: shadow\.contact_create/);
    assert.match(
      readFileSync(contactCreateSkill?.referencePaths.skillBundle ?? '', 'utf8'),
      /"skillName": "shadow\.contact_create"/,
    );
    assert.match(readFileSync(contactCreateSkill?.skillPath ?? '', 'utf8'), /basicDataWidget/);
    const contactSearchSkillMarkdown = readFileSync(contactSearchSkill?.skillPath ?? '', 'utf8');
    const contactSearchExecution = readFileSync(contactSearchSkill?.referencePaths.execution ?? '', 'utf8');
    assert.match(contactSearchSkillMarkdown, new RegExp(CONTACT_SEARCH_OID));
    assert.match(contactSearchExecution, /"codeId": "Bd_0"/);
    assert.match(contactSearchExecution, /linked_customer_form_inst_id__S_TITLE/);
    assert.doesNotMatch(contactSearchExecution, /"_id_"/);

    const contactPreview = await service.previewUpsert('contact', {
      mode: 'create',
      operatorOpenId: 'oid-contact-1',
      params: {
        _S_NAME: '张三',
        linked_customer_form_inst_id: 'form-inst-001',
      },
    });
    assert.equal(contactPreview.readyToSend, true);
    assert.deepEqual(
      (contactPreview.requestBody as { data: Array<{ widgetValue: Record<string, unknown> }> }).data[0]
        ?.widgetValue.Bd_0,
      [
        {
          id: 'form-inst-001',
          formCodeId: CUSTOMER_FORM_CODE_ID,
          formDefId: 'form-def-customer',
          flowInstId: '',
          showName: '华东制造样板客户',
          _S_TITLE: '华东制造样板客户',
          _S_NAME: '华东制造样板客户',
          _name_: '华东制造样板客户',
        },
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
