import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { YzjEmployee } from '../src/contracts.js';
import { ApprovalFileClient } from '../src/approval-file-client.js';
import { ApprovalFileService } from '../src/approval-file-service.js';
import { ApprovalClient } from '../src/approval-client.js';
import { createAdminApiServer } from '../src/app.js';
import { DictionaryResolver } from '../src/dictionary-resolver.js';
import { LightCloudClient } from '../src/lightcloud-client.js';
import { OrgSyncRepository } from '../src/org-sync-repository.js';
import { OrgSyncService } from '../src/org-sync-service.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { ShadowMetadataService } from '../src/shadow-metadata-service.js';
import { YzjClient } from '../src/yzj-client.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';

const CUSTOMER_FORM_CODE_ID = 'customer-form-001';
const CONTACT_FORM_CODE_ID = 'contact-form-001';
const OPPORTUNITY_FORM_CODE_ID = 'opportunity-form-001';
const FOLLOWUP_FORM_CODE_ID = 'followup-form-001';
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

const OPPORTUNITY_WIDGET_MAP = {
  _S_NAME: {
    codeId: '_S_NAME',
    title: '商机名称',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  _S_TITLE: {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  Te_0: {
    codeId: 'Te_0',
    title: '商机名称',
    type: 'textWidget',
    required: true,
  },
  Ra_0: {
    codeId: 'Ra_0',
    title: '商机状态',
    type: 'radioWidget',
    required: false,
    options: [
      {
        key: 'opportunity-active',
        value: '跟进中',
      },
      {
        key: 'opportunity-won',
        value: '已成交',
      },
    ],
  },
  Da_0: {
    codeId: 'Da_0',
    title: '预计成交日期',
    type: 'dateWidget',
    required: false,
  },
  Bd_0: {
    codeId: 'Bd_0',
    title: '关联客户',
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

const FOLLOWUP_WIDGET_MAP = {
  _S_TITLE: {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    required: false,
    readOnly: true,
  },
  Te_0: {
    codeId: 'Te_0',
    title: '跟进内容',
    type: 'textAreaWidget',
    required: true,
  },
  Da_0: {
    codeId: 'Da_0',
    title: '最后跟进日期',
    type: 'dateWidget',
    required: false,
  },
  Ps_0: {
    codeId: 'Ps_0',
    title: '跟进人',
    type: 'personSelectWidget',
    required: false,
  },
  Bd_0: {
    codeId: 'Bd_0',
    title: '关联商机',
    type: 'basicDataWidget',
    required: false,
    option: 'single',
    extendFieldMap: {
      displayCol: '_S_TITLE',
      extendSettingDataMap: {
        displayCol: '_S_TITLE',
        linkForm: {
          modelName: '商机',
          modelCode: OPPORTUNITY_FORM_CODE_ID,
        },
      },
    },
    dataSource: {
      modelName: '商机',
      modelCode: OPPORTUNITY_FORM_CODE_ID,
      partCode: OPPORTUNITY_FORM_CODE_ID,
      partName: '商机',
    },
    columnData: [
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

class StubYzjClient extends YzjClient {
  constructor(private readonly pages: YzjEmployee[][]) {
    super({ baseUrl: 'https://stub.yzj.local' });
  }

  override async getAccessToken(): Promise<string> {
    return 'access-token';
  }

  override async listActiveEmployees(params: {
    accessToken: string;
    eid: string;
    begin: number;
    count: number;
  }): Promise<YzjEmployee[]> {
    const index = params.begin / params.count;
    return this.pages[index] ?? [];
  }
}

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
    const templateByFormCodeId: Record<string, { formDefId: string; widgetMap: Record<string, unknown> }> = {
      [CUSTOMER_FORM_CODE_ID]: {
        formDefId: 'form-def-customer',
        widgetMap: CUSTOMER_WIDGET_MAP,
      },
      [CONTACT_FORM_CODE_ID]: {
        formDefId: 'form-def-contact',
        widgetMap: CONTACT_WIDGET_MAP,
      },
      [OPPORTUNITY_FORM_CODE_ID]: {
        formDefId: 'form-def-opportunity',
        widgetMap: OPPORTUNITY_WIDGET_MAP,
      },
      [FOLLOWUP_FORM_CODE_ID]: {
        formDefId: 'form-def-followup',
        widgetMap: FOLLOWUP_WIDGET_MAP,
      },
    };
    const template = templateByFormCodeId[params.formCodeId] ?? templateByFormCodeId[CUSTOMER_FORM_CODE_ID];

    return {
      formDefId: template.formDefId,
      formInfo: {
        widgetMap: template.widgetMap,
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
    content: Array<{ id: string; important: Record<string, unknown>; fieldContent: unknown[] }>;
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

class StubApprovalFileService extends ApprovalFileService {
  constructor() {
    super({
      config: createTestConfig(),
      client: new ApprovalFileClient({
        baseUrl: 'https://stub.yzj.local',
      }),
    });
  }

  override async uploadFile(_params: {
    filePath: string;
    bizKey?: string;
  }): Promise<{
    filePath: string;
    bizKey: string;
    accessTokenScope: 'resGroupSecret';
    uploaded: {
      fileId: string;
      fileName: string;
      fileType: string;
      length: number;
      isEncrypted: boolean;
    };
    attachmentValue: {
      fileName: string;
      fileId: string;
      fileSize: string;
      fileType: string;
      fileExt: string;
    };
  }> {
    return {
      filePath: '/tmp/fixture.pptx',
      bizKey: 'cloudflow',
      accessTokenScope: 'resGroupSecret',
      uploaded: {
        fileId: 'file-001',
        fileName: 'fixture.pptx',
        fileType: 'doc',
        length: 1024,
        isEncrypted: false,
      },
      attachmentValue: {
        fileId: 'file-001',
        fileName: 'fixture.pptx',
        fileSize: '1024',
        fileType: 'doc',
        fileExt: 'pptx',
      },
    };
  }
}

async function createTestServer() {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-http-'));
  const config = createTestConfig({
    skillOutputDir: join(tempDir, 'skills'),
    customerFormCodeId: CUSTOMER_FORM_CODE_ID,
    contactFormCodeId: CONTACT_FORM_CODE_ID,
    opportunityFormCodeId: OPPORTUNITY_FORM_CODE_ID,
    followupFormCodeId: FOLLOWUP_FORM_CODE_ID,
  });
  const database = createInMemoryDatabase();
  const orgSyncRepository = new OrgSyncRepository(database);
  const shadowRepository = new ShadowMetadataRepository(database);
  const approvalClient = new StubApprovalClient();
  const orgSyncService = new OrgSyncService({
    config,
    repository: orgSyncRepository,
    client: new StubYzjClient([
      [
        {
          openId: 'open-1',
          uid: 'uid-1',
          name: '张三',
          status: '1',
        },
      ],
    ]),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });
  const shadowMetadataService = new ShadowMetadataService({
    config,
    repository: shadowRepository,
    approvalClient,
    lightCloudClient: new StubLightCloudClient(),
    dictionaryResolver: new DictionaryResolver({
      source: config.shadow.dictionarySource,
      jsonPath: config.shadow.dictionaryJsonPath,
      approvalClient,
    }),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });

  const server = createAdminApiServer({
    config,
    orgSyncService,
    approvalFileService: new StubApprovalFileService(),
    shadowMetadataService,
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    tempDir,
  };
}

test('HTTP endpoints expose settings, org sync, and shadow metadata flow', async () => {
  const runtime = await createTestServer();

  try {
    const tenantResponse = await fetch(`${runtime.baseUrl}/api/settings/tenant-app`);
    const tenantPayload = (await tenantResponse.json()) as { eid: string; appId: string };
    assert.equal(tenantPayload.eid, '21024647');
    assert.equal(tenantPayload.appId, '501037729');

    const authResponse = await fetch(`${runtime.baseUrl}/api/settings/yzj-auth`);
    const authPayload = (await authResponse.json()) as {
      credentials: Array<{ maskedValue: string; label: string }>;
    };
    assert.equal(authPayload.credentials.length, 4);
    assert.match(authPayload.credentials[1].maskedValue, /\*\*\*/);

    const triggerResponse = await fetch(`${runtime.baseUrl}/api/settings/org-sync/manual-sync`, {
      method: 'POST',
    });
    assert.equal(triggerResponse.status, 202);
    const triggerPayload = (await triggerResponse.json()) as { runId: string; status: string };
    assert.equal(triggerPayload.status, 'running');
    assert.ok(triggerPayload.runId);

    let orgPayload = await (await fetch(`${runtime.baseUrl}/api/settings/org-sync`)).json() as {
      isSyncing: boolean;
      employeeCount: number;
      recentRuns: Array<{ status: string }>;
    };

    const deadline = Date.now() + 3000;
    while (orgPayload.isSyncing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      orgPayload = await (await fetch(`${runtime.baseUrl}/api/settings/org-sync`)).json() as {
        isSyncing: boolean;
        employeeCount: number;
        recentRuns: Array<{ status: string }>;
      };
    }

    assert.equal(orgPayload.isSyncing, false);
    assert.equal(orgPayload.employeeCount, 1);
    assert.equal(orgPayload.recentRuns[0].status, 'completed');

    const objectsResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects`);
    const objectsPayload = (await objectsResponse.json()) as Array<{
      objectKey: string;
      activationStatus: string;
    }>;
    assert.equal(objectsPayload.length, 4);
    assert.equal(objectsPayload[0].objectKey, 'contact');
    assert.equal(
      objectsPayload.find((item) => item.objectKey === 'opportunity')?.activationStatus,
      'active',
    );
    assert.equal(
      objectsPayload.find((item) => item.objectKey === 'followup')?.activationStatus,
      'active',
    );

    const refreshResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/refresh`, {
      method: 'POST',
    });
    assert.equal(refreshResponse.status, 200);
    const refreshPayload = (await refreshResponse.json()) as {
      fields: Array<{
        fieldCode: string;
        semanticSlot?: string;
        enumBinding?: { resolutionStatus: string };
        relationBinding?: { formCodeId: string | null };
      }>;
    };
    assert.equal(refreshPayload.fields.length, 18);
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Pw_9')?.enumBinding?.resolutionStatus,
      'pending',
    );
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Ps_1')?.semanticSlot,
      'service_rep_open_id',
    );
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Pw_0')?.semanticSlot,
      undefined,
    );
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Bd_1')?.semanticSlot,
      'linked_contact_form_inst_id',
    );
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Bd_1')?.relationBinding?.formCodeId,
      CONTACT_FORM_CODE_ID,
    );

    const skillsResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/skills`);
    assert.equal(skillsResponse.status, 200);
    const skillsPayload = (await skillsResponse.json()) as Array<{
      skillName: string;
      skillPath: string;
      optionalParams: string[];
      referencePaths: { execution: string };
    }>;
    assert.equal(skillsPayload.length, 5);
    assert.match(skillsPayload[0].skillPath, /\/skills\/customer\//);
    const updateSkill = skillsPayload.find((skill) => skill.skillName === 'shadow.customer_update');
    const deleteSkill = skillsPayload.find((skill) => skill.skillName === 'shadow.customer_delete');
    assert.ok(updateSkill?.optionalParams.includes('service_rep_open_id'));
    assert.ok(updateSkill?.optionalParams.includes('customer_type'));
    assert.equal(updateSkill?.optionalParams.includes('At_0'), true);
    assert.equal(updateSkill?.optionalParams.includes('linked_contact_form_inst_id'), true);
    assert.equal(updateSkill?.optionalParams.includes('Pw_0'), false);
    assert.ok(deleteSkill);
    const searchSkill = skillsPayload.find((skill) => skill.skillName === 'shadow.customer_search');
    assert.ok(searchSkill?.optionalParams.includes('_S_NAME'));
    assert.ok(searchSkill?.optionalParams.includes('Te_0'));
    assert.ok(searchSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(searchSkill?.optionalParams.includes('_S_DISABLE'));
    assert.ok(searchSkill?.optionalParams.includes('Ra_0'));
    assert.ok(searchSkill?.optionalParams.includes('Te_7'));
    assert.ok(searchSkill?.optionalParams.includes('Nu_1'));
    assert.ok(searchSkill?.optionalParams.includes('Nu_0'));
    assert.equal(searchSkill?.optionalParams.includes('customer_name'), false);
    assert.equal(searchSkill?.optionalParams.includes('customer_status'), false);
    assert.equal(searchSkill?.optionalParams.includes('phone'), false);
    const searchSkillMarkdown = readFileSync(searchSkill?.skillPath ?? '', 'utf8');
    const searchSkillExecution = readFileSync(searchSkill?.referencePaths.execution ?? '', 'utf8');
    const deleteSkillExecution = readFileSync(deleteSkill?.referencePaths.execution ?? '', 'utf8');
    assert.match(searchSkillMarkdown, /## Search Coverage/);
    assert.match(searchSkillMarkdown, /linked_contact_form_inst_id -> Bd_1/);
    assert.match(searchSkillMarkdown, /_S_SERIAL/);
    assert.match(searchSkillMarkdown, new RegExp(CUSTOMER_SEARCH_OID));
    assert.match(searchSkillMarkdown, new RegExp(CONTACT_SEARCH_OID));
    assert.match(searchSkillExecution, /linked_contact_form_inst_id__S_SERIAL/);
    assert.doesNotMatch(searchSkillExecution, /"_id_"/);
    assert.match(searchSkillExecution, /"operator": "range"/);
    assert.match(searchSkillExecution, new RegExp(String(SEARCH_RANGE_START_TS)));
    assert.match(deleteSkillExecution, /preview\/delete/);
    assert.match(deleteSkillExecution, /execute\/delete/);

    const opportunityRefreshResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/opportunity/refresh`,
      {
        method: 'POST',
      },
    );
    assert.equal(opportunityRefreshResponse.status, 200);
    const followupRefreshResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/followup/refresh`, {
      method: 'POST',
    });
    assert.equal(followupRefreshResponse.status, 200);

    const opportunitySkillsResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/opportunity/skills`,
    );
    const followupSkillsResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/followup/skills`);
    assert.equal(opportunitySkillsResponse.status, 200);
    assert.equal(followupSkillsResponse.status, 200);
    const opportunitySkillsPayload = (await opportunitySkillsResponse.json()) as Array<{
      skillName: string;
      skillPath: string;
      optionalParams: string[];
    }>;
    const followupSkillsPayload = (await followupSkillsResponse.json()) as Array<{
      skillName: string;
      skillPath: string;
      optionalParams: string[];
    }>;
    assert.equal(opportunitySkillsPayload.length, 5);
    assert.equal(followupSkillsPayload.length, 5);
    assert.match(opportunitySkillsPayload[0]?.skillPath ?? '', /\/skills\/opportunity\//);
    assert.match(followupSkillsPayload[0]?.skillPath ?? '', /\/skills\/followup\//);
    assert.ok(
      opportunitySkillsPayload
        .find((skill) => skill.skillName === 'shadow.opportunity_search')
        ?.optionalParams.includes('linked_customer_form_inst_id'),
    );
    assert.ok(
      followupSkillsPayload
        .find((skill) => skill.skillName === 'shadow.followup_search')
        ?.optionalParams.includes('linked_opportunity_form_inst_id'),
    );

    const uploadResponse = await fetch(`${runtime.baseUrl}/api/approval/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath: '/tmp/fixture.pptx',
      }),
    });
    assert.equal(uploadResponse.status, 200);
    const uploadPayload = (await uploadResponse.json()) as {
      attachmentValue: { fileId: string; fileExt: string };
    };
    assert.equal(uploadPayload.attachmentValue.fileId, 'file-001');
    assert.equal(uploadPayload.attachmentValue.fileExt, 'pptx');

    const getPreviewResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/preview/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        formInstId: 'form-inst-001',
      }),
    });
    const getPreviewPayload = (await getPreviewResponse.json()) as {
      operation: string;
      readyToSend: boolean;
      requestBody: { formInstIds: string[] };
    };
    assert.equal(getPreviewPayload.operation, 'get');
    assert.equal(getPreviewPayload.readyToSend, true);
    assert.deepEqual(getPreviewPayload.requestBody.formInstIds, ['form-inst-001']);

    const previewSearchResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/preview/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        filters: [
          {
            field: 'linked_contact_form_inst_id',
            value: 'contact-inst-001',
            operator: 'eq',
          },
          {
            field: 'Pw_0',
            value: [{ title: '浙江', dicId: 'd-zj' }],
            operator: 'eq',
          },
          {
            field: 'service_rep_open_id',
            value: {
              open_id: 'open-live-1',
            },
            operator: 'eq',
          },
        ],
      }),
    });
    assert.equal(previewSearchResponse.status, 200);
    const previewSearchPayload = (await previewSearchResponse.json()) as {
      readyToSend: boolean;
      requestBody: { searchItems: Array<{ codeId: string; value: unknown; operator?: string }> };
    };
    assert.equal(previewSearchPayload.readyToSend, true);
    assert.equal(previewSearchPayload.requestBody.searchItems.length, 2);
    assert.equal(previewSearchPayload.requestBody.searchItems[0]?.codeId, 'Bd_1');
    assert.equal(previewSearchPayload.requestBody.searchItems[0]?.operator, 'contains');
    assert.deepEqual(previewSearchPayload.requestBody.searchItems[0]?.value, [
      {
        _id_: 'contact-inst-001',
        _name_: 'CON-001',
      },
    ]);
    assert.deepEqual(previewSearchPayload.requestBody.searchItems[1]?.value, ['open-live-1']);

    const executeSearchResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        filters: [
          {
            field: 'linked_contact_form_inst_id',
            value: 'contact-inst-001',
            operator: 'eq',
          },
        ],
      }),
    });
    assert.equal(executeSearchResponse.status, 200);
    const executeSearchPayload = (await executeSearchResponse.json()) as {
      mode: string;
      records: Array<{ formInstId: string }>;
      requestBody: { searchItems: Array<{ codeId: string; operator?: string }> };
    };
    assert.equal(executeSearchPayload.mode, 'live');
    assert.equal(executeSearchPayload.records[0]?.formInstId, 'form-inst-001');
    assert.equal(executeSearchPayload.requestBody.searchItems[0]?.codeId, 'Bd_1');
    assert.equal(executeSearchPayload.requestBody.searchItems[0]?.operator, 'contains');

    const downgradedPreviewSearchResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/customer/preview/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      },
    );
    assert.equal(downgradedPreviewSearchResponse.status, 200);
    const downgradedPreviewSearchPayload = (await downgradedPreviewSearchResponse.json()) as {
      readyToSend: boolean;
      requestBody: { searchItems: Array<Record<string, unknown>> };
    };
    assert.equal(downgradedPreviewSearchPayload.readyToSend, true);
    assert.deepEqual(downgradedPreviewSearchPayload.requestBody.searchItems[0], {
      codeId: 'Bd_1',
      parentCodeId: null,
      type: 'basicDataWidget',
      value: 'CON-001',
    });
    assert.deepEqual(downgradedPreviewSearchPayload.requestBody.searchItems[1], {
      codeId: 'Da_0',
      parentCodeId: null,
      type: 'dateWidget',
      operator: 'range',
      lightFieldMap: {
        plusDay: false,
      },
      value: [SEARCH_RANGE_START_TS, SEARCH_RANGE_END_TS],
    });

    const executeGetResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        formInstId: 'form-inst-001',
      }),
    });
    assert.equal(executeGetResponse.status, 200);
    const executeGetPayload = (await executeGetResponse.json()) as {
      mode: string;
      record: { formInstId: string; fieldMap: Record<string, { value: string }> };
    };
    assert.equal(executeGetPayload.mode, 'live');
    assert.equal(executeGetPayload.record.formInstId, 'form-inst-001');
    assert.equal(executeGetPayload.record.fieldMap.Te_0?.value, '华东制造样板客户');

    const executeUpsertResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
              fileName: 'fixture.pptx',
              fileSize: '1024',
              fileType: 'doc',
              fileExt: 'pptx',
            },
          ],
          linked_contact_form_inst_id: 'contact-inst-001',
          Pw_0: [{ title: '浙江', dicId: 'd-zj' }],
        },
      }),
    });
    assert.equal(executeUpsertResponse.status, 200);
    const executeUpsertPayload = (await executeUpsertResponse.json()) as {
      mode: string;
      writeMode: string;
      formInstIds: string[];
      requestBody: {
        data: Array<{ formInstId: string; widgetValue: Record<string, unknown> }>;
      };
    };
    assert.equal(executeUpsertPayload.mode, 'live');
    assert.equal(executeUpsertPayload.writeMode, 'update');
    assert.deepEqual(executeUpsertPayload.formInstIds, ['form-inst-001']);
    assert.equal(executeUpsertPayload.requestBody.data[0]?.formInstId, 'form-inst-001');
    assert.equal(executeUpsertPayload.requestBody.data[0]?.widgetValue.Te_0, '华东制造更新客户');
    assert.equal(executeUpsertPayload.requestBody.data[0]?.widgetValue.Ra_3, 'EeFfGgHh');
    assert.equal(executeUpsertPayload.requestBody.data[0]?.widgetValue.Da_0, Date.parse('2026-04-23'));
    assert.deepEqual(executeUpsertPayload.requestBody.data[0]?.widgetValue.Ps_1, ['open-live-2']);
    assert.deepEqual(executeUpsertPayload.requestBody.data[0]?.widgetValue.At_0, [
      {
        fileId: 'file-1',
        fileName: 'fixture.pptx',
        fileSize: '1024',
        fileType: 'doc',
        fileExt: 'pptx',
      },
    ]);
    assert.deepEqual(executeUpsertPayload.requestBody.data[0]?.widgetValue.Bd_1, [
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
    assert.equal('Pw_0' in executeUpsertPayload.requestBody.data[0]?.widgetValue, false);

    const previewDeleteResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/preview/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        formInstIds: ['form-inst-001', 'form-inst-002'],
      }),
    });
    assert.equal(previewDeleteResponse.status, 200);
    const previewDeletePayload = (await previewDeleteResponse.json()) as {
      operation: string;
      readyToSend: boolean;
      requestBody: { oid: string; formInstIds: string[] };
    };
    assert.equal(previewDeletePayload.operation, 'delete');
    assert.equal(previewDeletePayload.readyToSend, true);
    assert.equal(previewDeletePayload.requestBody.oid, 'oid-live-1');
    assert.deepEqual(previewDeletePayload.requestBody.formInstIds, ['form-inst-001', 'form-inst-002']);

    const executeDeleteResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        formInstIds: ['form-inst-001'],
      }),
    });
    assert.equal(executeDeleteResponse.status, 200);
    const executeDeletePayload = (await executeDeleteResponse.json()) as {
      mode: string;
      operation: string;
      formInstIds: string[];
      requestBody: { formInstIds: string[] };
    };
    assert.equal(executeDeletePayload.mode, 'live');
    assert.equal(executeDeletePayload.operation, 'delete');
    assert.deepEqual(executeDeletePayload.formInstIds, ['form-inst-001']);
    assert.deepEqual(executeDeletePayload.requestBody.formInstIds, ['form-inst-001']);

    const previewResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/preview/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'create',
        params: {
          customer_name: '华东制造样板客户',
        },
      }),
    });
    const previewPayload = (await previewResponse.json()) as {
      readyToSend: boolean;
      missingRuntimeInputs: string[];
      requestBody: { data: Array<{ widgetValue: Record<string, unknown> }> };
    };
    assert.equal(previewPayload.readyToSend, false);
    assert.deepEqual(previewPayload.missingRuntimeInputs, ['operatorOpenId']);
    assert.equal(previewPayload.requestBody.data[0].widgetValue.Te_0, '华东制造样板客户');
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});
