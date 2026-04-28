import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike, YzjEmployee } from '../src/contracts.js';
import * as XLSX from 'xlsx';
import { ApprovalFileClient } from '../src/approval-file-client.js';
import { ApprovalFileService } from '../src/approval-file-service.js';
import { ApprovalClient } from '../src/approval-client.js';
import { createAdminApiServer } from '../src/app.js';
import { DictionaryResolver } from '../src/dictionary-resolver.js';
import { ExternalSkillService } from '../src/external-skill-service.js';
import { LightCloudClient } from '../src/lightcloud-client.js';
import { OrgSyncRepository } from '../src/org-sync-repository.js';
import { OrgSyncService } from '../src/org-sync-service.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { ShadowMetadataService } from '../src/shadow-metadata-service.js';
import type { ShadowInternalTemplateProvider } from '../src/shadow-template-providers.js';
import { YzjClient } from '../src/yzj-client.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';

const CUSTOMER_FORM_CODE_ID = 'customer-form-001';
const CONTACT_FORM_CODE_ID = 'contact-form-001';
const OPPORTUNITY_FORM_CODE_ID = 'opportunity-form-001';
const FOLLOWUP_FORM_CODE_ID = 'followup-form-001';
const ORDER_CHANGE_FORM_CODE_ID = 'order-change-form-001';
const CUSTOMER_FORM_INST_ID = 'form-inst-001';
const CONTACT_FORM_INST_ID = 'contact-inst-001';
const OPPORTUNITY_FORM_INST_ID = 'opportunity-inst-001';
const FOLLOWUP_FORM_INST_ID = 'followup-inst-001';
const ORDER_CHANGE_FORM_INST_ID = 'change-inst-001';
const CUSTOMER_SEARCH_OID = '69e75eb5e4b0e65b61c014da';
const CONTACT_SEARCH_OID = '66160cfde4b014e237ba75ca';
const SEARCH_RANGE_START_TS = 1777046400000;
const SEARCH_RANGE_END_TS = 1777132799999;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function writeFieldBoundWorkbook(workbookPath: string) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { dicId: 'meta', title: 'meta', parentId: '0', code: '', sort: 0, type: 2 },
    { dicId: 'd005', title: '省', parentId: '0', code: 'province', sort: 1, type: 1 },
    { dicId: 'd006', title: '市', parentId: '0', code: 'city', sort: 2, type: 1 },
    { dicId: 'd007', title: '区', parentId: '0', code: 'district', sort: 3, type: 1 },
    { dicId: 'd-province-js', title: '江苏', parentId: 'd005', code: '320000', sort: 4, type: 0 },
    { dicId: 'd-province-zj', title: '浙江', parentId: 'd005', code: '330000', sort: 1, type: 0 },
    { dicId: 'd-city-nt', title: '南通市', parentId: 'd006', code: '320600', sort: 4, type: 0 },
    { dicId: 'd-city-hz', title: '杭州', parentId: 'd006', code: '330100', sort: 1, type: 0 },
    { dicId: 'd-district-ct-a', title: '城区', parentId: 'd007', code: '320601', sort: 10, type: 0 },
    { dicId: 'd-district-ct-b', title: '城区', parentId: 'd007', code: '310112', sort: 11, type: 0 },
    { dicId: 'd-district-hm', title: '海门市', parentId: 'd007', code: '320684', sort: 12, type: 0 },
    { dicId: 'd-district-bj', title: '滨江', parentId: 'd007', code: '330108', sort: 1, type: 0 },
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  XLSX.writeFile(workbook, workbookPath);
}

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
    displaylinkageVos: [
      {
        additional: {
          targetList: [
            {
              label: '售后服务代表',
              value: 'Ps_1',
            },
          ],
          option: [
            {
              label: '活跃',
              value: 'customer-active',
            },
          ],
          state: {
            label: '必填',
            value: 'required',
          },
        },
        behavior: {
          Ps_1: {
            state: 'required',
          },
        },
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
    linkCodeId: 'Pw_1',
    required: false,
  },
  Pw_1: {
    codeId: 'Pw_1',
    title: '市',
    type: 'publicOptBoxWidget',
    linkCodeId: 'Pw_2',
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
  Ps_0: {
    codeId: 'Ps_0',
    title: '负责人',
    type: 'personSelectWidget',
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
  Bd_1: {
    codeId: 'Bd_1',
    title: '关联联系人',
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
      { colEnName: '_S_TITLE', widgetType: 'textWidget' },
      { colEnName: '_S_NAME', widgetType: 'textWidget' },
    ],
  },
  At_0: {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    required: false,
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
  Ra_0: {
    codeId: 'Ra_0',
    title: '跟进方式',
    type: 'radioWidget',
    required: false,
    options: [
      {
        key: 'followup-phone',
        value: '电话',
      },
      {
        key: 'followup-visit',
        value: '拜访',
      },
    ],
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
  Bd_3: {
    codeId: 'Bd_3',
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
  Bd_4: {
    codeId: 'Bd_4',
    title: '关联订单变更',
    type: 'basicDataWidget',
    required: false,
    option: 'single',
    extendFieldMap: {
      displayCol: '_S_SERIAL',
      extendSettingDataMap: {
        displayCol: '_S_SERIAL',
        linkForm: {
          modelName: '订单变更',
          modelCode: ORDER_CHANGE_FORM_CODE_ID,
        },
      },
    },
    dataSource: {
      modelName: '订单变更',
      modelCode: ORDER_CHANGE_FORM_CODE_ID,
      partCode: ORDER_CHANGE_FORM_CODE_ID,
      partName: '订单变更',
    },
    columnData: [
      { colEnName: '_S_SERIAL', widgetType: 'serialNumWidget' },
      { colEnName: '_S_TITLE', widgetType: 'textWidget' },
    ],
  },
  At_0: {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    required: false,
  },
  Lo_0: {
    codeId: 'Lo_0',
    title: '跟进定位',
    type: 'locationWidget',
    required: false,
  },
} satisfies Record<string, unknown>;

const CUSTOMER_INTERNAL_WIDGET_MAP = {
  _S_NAME: {
    ...CUSTOMER_WIDGET_MAP._S_NAME,
    required: true,
    readOnly: true,
    edit: true,
    view: true,
    placeholder: '请输入',
    extendFieldMap: {
      wordLimit: 200,
    },
  },
  _S_DISABLE: {
    ...CUSTOMER_WIDGET_MAP._S_DISABLE,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
    placeholder: '请选择',
  },
  _S_TITLE: {
    ...CUSTOMER_WIDGET_MAP._S_TITLE,
    required: true,
    readOnly: false,
    edit: true,
    view: false,
    systemDefault: '1',
    placeholder: '标题自动生成',
    extendFieldMap: {
      titleEntity: {
        kind: 'TITLE_DYNAMIC',
        list: [
          {
            formItem: '_S_NAME',
            kind: 'ITEM_FORM_ITEM',
          },
        ],
      },
      defaultTitle: true,
    },
  },
  Nu_1: {
    ...CUSTOMER_WIDGET_MAP.Nu_1,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
  Ra_0: {
    ...CUSTOMER_WIDGET_MAP.Ra_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
  Ra_3: {
    ...CUSTOMER_WIDGET_MAP.Ra_3,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
} satisfies Record<string, unknown>;

const CONTACT_INTERNAL_WIDGET_MAP = {
  _S_NAME: {
    ...CONTACT_WIDGET_MAP._S_NAME,
    required: true,
    readOnly: true,
    edit: true,
    view: true,
    placeholder: '请输入',
  },
  _S_TITLE: {
    ...CONTACT_WIDGET_MAP._S_TITLE,
    required: true,
    readOnly: false,
    edit: true,
    view: false,
    systemDefault: '1',
    placeholder: '请输入',
    extendFieldMap: {
      titleEntity: {
        kind: 'TITLE_DYNAMIC',
        list: [
          {
            formItem: '_S_NAME',
            kind: 'ITEM_FORM_ITEM',
          },
        ],
      },
      defaultTitle: true,
    },
  },
  _S_ENCODE: {
    ...CONTACT_WIDGET_MAP._S_ENCODE,
    readOnly: true,
    edit: false,
  },
} satisfies Record<string, unknown>;

const OPPORTUNITY_INTERNAL_WIDGET_MAP = {
  _S_NAME: {
    ...OPPORTUNITY_WIDGET_MAP._S_NAME,
    readOnly: true,
    edit: false,
  },
  _S_TITLE: {
    ...OPPORTUNITY_WIDGET_MAP._S_TITLE,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
    systemDefault: '1',
    extendFieldMap: {
      titleEntity: {
        kind: 'TITLE_DEFAULT',
        list: [
          {
            formItem: '_S_APPLY',
            kind: 'ITEM_FORM_ITEM',
          },
          {
            formItem: '的',
            kind: 'ITEM_STRING',
          },
          {
            formItem: '商机',
            kind: 'ITEM_TEMPLATENAME',
          },
        ],
      },
      defaultTitle: true,
    },
  },
  Te_0: {
    ...OPPORTUNITY_WIDGET_MAP.Te_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
} satisfies Record<string, unknown>;

const FOLLOWUP_INTERNAL_WIDGET_MAP = {
  _S_TITLE: {
    ...FOLLOWUP_WIDGET_MAP._S_TITLE,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
    systemDefault: '1',
    extendFieldMap: {
      titleEntity: {
        kind: 'TITLE_DEFAULT',
        list: [
          {
            formItem: '_S_APPLY',
            kind: 'ITEM_FORM_ITEM',
          },
          {
            formItem: '的',
            kind: 'ITEM_STRING',
          },
          {
            formItem: '商机跟进记录',
            kind: 'ITEM_TEMPLATENAME',
          },
        ],
      },
      defaultTitle: true,
    },
  },
  Te_0: {
    ...FOLLOWUP_WIDGET_MAP.Te_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
  Ps_0: {
    ...FOLLOWUP_WIDGET_MAP.Ps_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
  Ra_0: {
    ...FOLLOWUP_WIDGET_MAP.Ra_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
  },
  Bd_0: {
    ...FOLLOWUP_WIDGET_MAP.Bd_0,
    required: true,
    readOnly: false,
    edit: true,
    view: true,
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

const OPPORTUNITY_FIELD_CONTENT = [
  {
    codeId: '_S_NAME',
    title: '商机名称',
    type: 'textWidget',
    value: '华东制造样板商机',
    rawValue: '华东制造样板商机',
    parentCodeId: null,
  },
  {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    value: '华东制造样板商机',
    rawValue: '华东制造样板商机',
    parentCodeId: null,
  },
  {
    codeId: 'Te_0',
    title: '商机名称',
    type: 'textWidget',
    value: '华东制造样板商机',
    rawValue: '华东制造样板商机',
    parentCodeId: null,
  },
  {
    codeId: 'Ra_0',
    title: '商机状态',
    type: 'radioWidget',
    value: '跟进中',
    rawValue: 'opportunity-active',
    parentCodeId: null,
  },
  {
    codeId: 'Da_0',
    title: '预计成交日期',
    type: 'dateWidget',
    value: '2026-05-01',
    rawValue: Date.parse('2026-05-01'),
    parentCodeId: null,
  },
  {
    codeId: 'Ps_0',
    title: '负责人',
    type: 'personSelectWidget',
    value: ['open-sales-1'],
    rawValue: ['open-sales-1'],
    parentCodeId: null,
  },
  {
    codeId: 'Bd_0',
    title: '关联客户',
    type: 'basicDataWidget',
    value: '华东制造样板客户',
    rawValue: [
      {
        id: CUSTOMER_FORM_INST_ID,
        formCodeId: CUSTOMER_FORM_CODE_ID,
        formDefId: 'form-def-customer',
        flowInstId: '',
        showName: '华东制造样板客户',
        _S_TITLE: '华东制造样板客户',
        _S_NAME: '华东制造样板客户',
        _name_: '华东制造样板客户',
      },
    ],
    parentCodeId: null,
  },
  {
    codeId: 'Bd_1',
    title: '关联联系人',
    type: 'basicDataWidget',
    value: 'CON-001',
    rawValue: [
      {
        id: CONTACT_FORM_INST_ID,
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
    parentCodeId: null,
  },
  {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    value: [
      {
        fileId: 'file-opportunity-001',
        fileName: 'opportunity.pdf',
        fileSize: '256',
        fileType: 'doc',
        fileExt: 'pdf',
      },
    ],
    rawValue: [
      {
        fileId: 'file-opportunity-001',
        fileName: 'opportunity.pdf',
        fileSize: '256',
        fileType: 'doc',
        fileExt: 'pdf',
      },
    ],
    parentCodeId: null,
  },
];

const FOLLOWUP_FIELD_CONTENT = [
  {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    value: '样板跟进记录',
    rawValue: '样板跟进记录',
    parentCodeId: null,
  },
  {
    codeId: 'Te_0',
    title: '跟进内容',
    type: 'textAreaWidget',
    value: '已完成电话回访',
    rawValue: '已完成电话回访',
    parentCodeId: null,
  },
  {
    codeId: 'Da_0',
    title: '最后跟进日期',
    type: 'dateWidget',
    value: '2026-04-24',
    rawValue: Date.parse('2026-04-24'),
    parentCodeId: null,
  },
  {
    codeId: 'Ps_0',
    title: '跟进人',
    type: 'personSelectWidget',
    value: ['open-followup-1'],
    rawValue: ['open-followup-1'],
    parentCodeId: null,
  },
  {
    codeId: 'Ra_0',
    title: '跟进方式',
    type: 'radioWidget',
    value: '电话',
    rawValue: 'followup-phone',
    parentCodeId: null,
  },
  {
    codeId: 'Bd_0',
    title: '关联客户',
    type: 'basicDataWidget',
    value: '华东制造样板客户',
    rawValue: [
      {
        id: CUSTOMER_FORM_INST_ID,
        formCodeId: CUSTOMER_FORM_CODE_ID,
        formDefId: 'form-def-customer',
        flowInstId: '',
        showName: '华东制造样板客户',
        _S_TITLE: '华东制造样板客户',
        _S_NAME: '华东制造样板客户',
        _name_: '华东制造样板客户',
      },
    ],
    parentCodeId: null,
  },
  {
    codeId: 'Bd_3',
    title: '关联商机',
    type: 'basicDataWidget',
    value: '华东制造样板商机',
    rawValue: [
      {
        id: OPPORTUNITY_FORM_INST_ID,
        formCodeId: OPPORTUNITY_FORM_CODE_ID,
        formDefId: 'form-def-opportunity',
        flowInstId: '',
        showName: '华东制造样板商机',
        _S_TITLE: '华东制造样板商机',
        _S_NAME: '华东制造样板商机',
        _name_: '华东制造样板商机',
      },
    ],
    parentCodeId: null,
  },
  {
    codeId: 'Bd_4',
    title: '关联订单变更',
    type: 'basicDataWidget',
    value: 'OC-001',
    rawValue: [
      {
        id: ORDER_CHANGE_FORM_INST_ID,
        formCodeId: ORDER_CHANGE_FORM_CODE_ID,
        formDefId: 'form-def-order-change',
        flowInstId: '',
        showName: '订单变更OC-001',
        _S_TITLE: '订单变更OC-001',
        _S_NAME: '订单变更OC-001',
        _name_: '订单变更OC-001',
        _S_SERIAL: 'OC-001',
      },
    ],
    parentCodeId: null,
  },
  {
    codeId: 'At_0',
    title: '附件',
    type: 'attachmentWidget',
    value: [
      {
        fileId: 'file-followup-001',
        fileName: 'followup.pptx',
        fileSize: '1024',
        fileType: 'doc',
        fileExt: 'pptx',
      },
    ],
    rawValue: [
      {
        fileId: 'file-followup-001',
        fileName: 'followup.pptx',
        fileSize: '1024',
        fileType: 'doc',
        fileExt: 'pptx',
      },
    ],
    parentCodeId: null,
  },
];

const ORDER_CHANGE_FIELD_CONTENT = [
  {
    codeId: '_S_TITLE',
    title: '标题',
    type: 'textWidget',
    value: '订单变更OC-001',
    rawValue: '订单变更OC-001',
    parentCodeId: null,
  },
  {
    codeId: '_S_SERIAL',
    title: '订单变更编号',
    type: 'serialNumWidget',
    value: 'OC-001',
    rawValue: 'OC-001',
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

class StubInternalTemplateProvider implements ShadowInternalTemplateProvider {
  async getTemplate(params: { formCodeId: string }) {
    const templateByFormCodeId: Record<string, { formDefId: string; templateTitle: string; widgetMap: Record<string, unknown> }> = {
      [CUSTOMER_FORM_CODE_ID]: {
        formDefId: 'form-def-customer',
        templateTitle: '客户',
        widgetMap: CUSTOMER_INTERNAL_WIDGET_MAP,
      },
      [CONTACT_FORM_CODE_ID]: {
        formDefId: 'form-def-contact',
        templateTitle: '联系人',
        widgetMap: CONTACT_INTERNAL_WIDGET_MAP,
      },
      [OPPORTUNITY_FORM_CODE_ID]: {
        formDefId: 'form-def-opportunity',
        templateTitle: '商机',
        widgetMap: OPPORTUNITY_INTERNAL_WIDGET_MAP,
      },
      [FOLLOWUP_FORM_CODE_ID]: {
        formDefId: 'form-def-followup',
        templateTitle: '商机跟进记录',
        widgetMap: FOLLOWUP_INTERNAL_WIDGET_MAP,
      },
    };
    const template = templateByFormCodeId[params.formCodeId];
    if (!template) {
      return null;
    }

    return {
      formCodeId: params.formCodeId,
      formDefId: template.formDefId,
      templateTitle: template.templateTitle,
      payload: {
        data: {
          formTemplate: {
            id: template.formDefId,
            formTemplateId: template.formDefId,
            title: template.templateTitle,
            formWidgets: Object.values(template.widgetMap),
          },
        },
      },
      widgetMap: template.widgetMap as Record<string, any>,
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

  override async searchList(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<{
    pageNumber: number;
    totalPages: number;
    pageSize: number;
    totalElements: number;
    content: Array<{ id: string; important: Record<string, unknown>; fieldContent: unknown[] }>;
  }> {
    const formCodeId = typeof params.body.formCodeId === 'string' ? params.body.formCodeId : CUSTOMER_FORM_CODE_ID;
    const record =
      formCodeId === OPPORTUNITY_FORM_CODE_ID
        ? {
            id: OPPORTUNITY_FORM_INST_ID,
            important: { 标题: '华东制造样板商机' },
            fieldContent: OPPORTUNITY_FIELD_CONTENT,
          }
        : formCodeId === FOLLOWUP_FORM_CODE_ID
          ? {
              id: FOLLOWUP_FORM_INST_ID,
              important: { 标题: '样板跟进记录' },
              fieldContent: FOLLOWUP_FIELD_CONTENT,
            }
          : {
              id: CUSTOMER_FORM_INST_ID,
              important: { 标题: '华东制造样板客户' },
              fieldContent: CUSTOMER_FIELD_CONTENT,
            };

    return {
      pageNumber: 1,
      totalPages: 1,
      pageSize: 20,
      totalElements: 1,
      content: [record],
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
      if (!requestedIds.includes(CONTACT_FORM_INST_ID)) {
        return [];
      }

      return [
        {
          id: CONTACT_FORM_INST_ID,
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

    if (params.body.formCodeId === OPPORTUNITY_FORM_CODE_ID) {
      if (!requestedIds.includes(OPPORTUNITY_FORM_INST_ID)) {
        return [];
      }

      return [
        {
          id: OPPORTUNITY_FORM_INST_ID,
          formDefId: 'form-def-opportunity',
          title: '华东制造样板商机',
          formCodeId: OPPORTUNITY_FORM_CODE_ID,
          flowInstId: '',
          important: {
            标题: '华东制造样板商机',
          },
          fieldContent: OPPORTUNITY_FIELD_CONTENT,
        },
      ];
    }

    if (params.body.formCodeId === FOLLOWUP_FORM_CODE_ID) {
      if (!requestedIds.includes(FOLLOWUP_FORM_INST_ID)) {
        return [];
      }

      return [
        {
          id: FOLLOWUP_FORM_INST_ID,
          formDefId: 'form-def-followup',
          title: '样板跟进记录',
          formCodeId: FOLLOWUP_FORM_CODE_ID,
          flowInstId: '',
          important: {
            标题: '样板跟进记录',
          },
          fieldContent: FOLLOWUP_FIELD_CONTENT,
        },
      ];
    }

    if (params.body.formCodeId === ORDER_CHANGE_FORM_CODE_ID) {
      if (!requestedIds.includes(ORDER_CHANGE_FORM_INST_ID)) {
        return [];
      }

      return [
        {
          id: ORDER_CHANGE_FORM_INST_ID,
          formDefId: 'form-def-order-change',
          title: '订单变更OC-001',
          formCodeId: ORDER_CHANGE_FORM_CODE_ID,
          flowInstId: '',
          important: {
            标题: '订单变更OC-001',
          },
          fieldContent: ORDER_CHANGE_FIELD_CONTENT,
        },
      ];
    }

    if (!requestedIds.includes(CUSTOMER_FORM_INST_ID)) {
      return [];
    }

    return [
      {
        id: CUSTOMER_FORM_INST_ID,
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

  override async batchSave(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<string[]> {
    const firstItem =
      Array.isArray(params.body.data) && params.body.data[0] && typeof params.body.data[0] === 'object'
        ? (params.body.data[0] as Record<string, unknown>)
        : null;
    const existingFormInstId =
      firstItem && typeof firstItem.formInstId === 'string' ? firstItem.formInstId : null;

    if (existingFormInstId) {
      return [existingFormInstId];
    }

    if (params.body.formCodeId === OPPORTUNITY_FORM_CODE_ID) {
      return [OPPORTUNITY_FORM_INST_ID];
    }

    if (params.body.formCodeId === FOLLOWUP_FORM_CODE_ID) {
      return [FOLLOWUP_FORM_INST_ID];
    }

    return [CUSTOMER_FORM_INST_ID];
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

async function createTestServer(options: {
  imageApiKey?: string | null;
  imageFetchImpl?: FetchLike;
  skillRuntimeFetchImpl?: FetchLike;
} = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-http-'));
  const fieldBoundWorkbookPath = join(tempDir, 'province-city-district.xlsx');
  writeFieldBoundWorkbook(fieldBoundWorkbookPath);
  const config = createTestConfig({
    skillOutputDir: join(tempDir, 'skills'),
    customerFormCodeId: CUSTOMER_FORM_CODE_ID,
    contactFormCodeId: CONTACT_FORM_CODE_ID,
    opportunityFormCodeId: OPPORTUNITY_FORM_CODE_ID,
    followupFormCodeId: FOLLOWUP_FORM_CODE_ID,
    imageApiKey: options.imageApiKey ?? null,
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
      fieldBoundWorkbookPath,
    }),
    internalTemplateProvider: new StubInternalTemplateProvider(),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });

  const combinedFetchImpl: FetchLike = (async (input, init) => {
    const url = String(input);
    if (url.startsWith(config.external.skillRuntime.baseUrl)) {
      if (options.skillRuntimeFetchImpl) {
        return options.skillRuntimeFetchImpl(input, init);
      }

      if (url.endsWith('/api/models')) {
        return jsonResponse([
          { name: 'deepseek-v4-flash', label: 'deepseek-v4-flash', isDefault: true },
          { name: 'deepseek-v4-pro', label: 'deepseek-v4-pro', isDefault: false },
        ]);
      }

      if (url.endsWith('/api/skills')) {
        return jsonResponse([
          {
            skillName: 'company-research',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY', 'env:ARK_API_KEY'],
            missingDependencies: [],
            summary: 'company summary',
          },
          {
            skillName: 'visit-conversation-understanding',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'conversation summary',
          },
          {
            skillName: 'customer-needs-todo-analysis',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'needs todo summary',
          },
          {
            skillName: 'problem-statement',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'problem summary',
          },
          {
            skillName: 'customer-value-positioning',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'value positioning summary',
          },
          {
            skillName: 'super-ppt',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DOCMEE_API_KEY'],
            missingDependencies: [],
            summary: 'super-ppt summary',
          },
        ]);
      }

      throw new Error(`Unexpected skill-runtime url: ${url}`);
    }

    if (options.imageFetchImpl) {
      return options.imageFetchImpl(input, init);
    }

    throw new Error(`Unexpected external fetch url: ${url}`);
  }) as FetchLike;

  const server = createAdminApiServer({
    config,
    orgSyncService,
    approvalFileService: new StubApprovalFileService(),
    shadowMetadataService,
    externalSkillService: new ExternalSkillService({
      config,
      fetchImpl: combinedFetchImpl,
      now: () => new Date('2026-04-24T09:00:00.000Z'),
    }),
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
    assert.deepEqual(
      objectsPayload.map((item) => item.objectKey).sort(),
      ['contact', 'customer', 'followup', 'opportunity'],
    );
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
        required: boolean;
        requiredMode?: string;
        requiredRules?: Array<{ description: string }>;
        semanticSlot?: string;
        linkCodeId?: string;
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
    assert.equal(refreshPayload.fields.find((field) => field.fieldCode === 'Ps_1')?.required, false);
    assert.equal(refreshPayload.fields.find((field) => field.fieldCode === 'Ps_1')?.requiredMode, 'conditional');
    assert.match(
      refreshPayload.fields.find((field) => field.fieldCode === 'Ps_1')?.requiredRules?.[0]?.description ?? '',
      /客户状态/,
    );
    assert.equal(
      refreshPayload.fields.find((field) => field.fieldCode === 'Pw_0')?.semanticSlot,
      'province',
    );
    assert.equal(refreshPayload.fields.find((field) => field.fieldCode === 'Pw_0')?.linkCodeId, 'Pw_1');
    assert.equal(refreshPayload.fields.find((field) => field.fieldCode === 'Pw_1')?.linkCodeId, 'Pw_2');
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
    assert.equal(updateSkill?.optionalParams.includes('province'), true);
    assert.equal(updateSkill?.optionalParams.includes('city'), true);
    assert.equal(updateSkill?.optionalParams.includes('district'), true);
    assert.equal(updateSkill?.optionalParams.includes('Pw_0'), false);
    assert.ok(deleteSkill);
    const searchSkill = skillsPayload.find((skill) => skill.skillName === 'shadow.customer_search');
    assert.ok(searchSkill?.optionalParams.includes('_S_NAME'));
    assert.ok(searchSkill?.optionalParams.includes('Te_0'));
    assert.ok(searchSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(searchSkill?.optionalParams.includes('_S_DISABLE'));
    assert.ok(searchSkill?.optionalParams.includes('customer_status'));
    assert.ok(searchSkill?.optionalParams.includes('Te_7'));
    assert.ok(searchSkill?.optionalParams.includes('Nu_1'));
    assert.ok(searchSkill?.optionalParams.includes('Nu_0'));
    assert.equal(searchSkill?.optionalParams.includes('customer_name'), false);
    assert.equal(searchSkill?.optionalParams.includes('Ra_0'), false);
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
    assert.ok(
      followupSkillsPayload
        .find((skill) => skill.skillName === 'shadow.followup_search')
        ?.optionalParams.includes('Bd_4'),
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
        formInstId: CUSTOMER_FORM_INST_ID,
      }),
    });
    const getPreviewPayload = (await getPreviewResponse.json()) as {
      operation: string;
      readyToSend: boolean;
      requestBody: { formInstIds: string[] };
    };
    assert.equal(getPreviewPayload.operation, 'get');
    assert.equal(getPreviewPayload.readyToSend, true);
    assert.deepEqual(getPreviewPayload.requestBody.formInstIds, [CUSTOMER_FORM_INST_ID]);

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
            value: CONTACT_FORM_INST_ID,
            operator: 'eq',
          },
          {
            field: 'province',
            value: '浙江',
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
    assert.equal(previewSearchPayload.requestBody.searchItems.length, 3);
    const linkedContactSearchItem = previewSearchPayload.requestBody.searchItems.find(
      (item) => item.codeId === 'Bd_1',
    );
    const serviceRepSearchItem = previewSearchPayload.requestBody.searchItems.find(
      (item) => item.codeId === 'Ps_1',
    );
    const provinceSearchItem = previewSearchPayload.requestBody.searchItems.find(
      (item) => item.codeId === 'Pw_0',
    );
    assert.equal(linkedContactSearchItem?.operator, 'contains');
    assert.deepEqual(linkedContactSearchItem?.value, [
      {
        _id_: CONTACT_FORM_INST_ID,
        _name_: 'CON-001',
      },
    ]);
    assert.deepEqual(serviceRepSearchItem?.value, ['open-live-1']);
    assert.deepEqual(provinceSearchItem, {
      codeId: 'Pw_0',
      parentCodeId: null,
      type: 'publicOptBoxWidget',
      operator: 'eq',
      value: [
        {
          title: '浙江',
          dicId: 'd-province-zj',
        },
      ],
    });

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
            value: CONTACT_FORM_INST_ID,
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
    assert.equal(executeSearchPayload.records[0]?.formInstId, CUSTOMER_FORM_INST_ID);
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
        formInstId: CUSTOMER_FORM_INST_ID,
      }),
    });
    assert.equal(executeGetResponse.status, 200);
    const executeGetPayload = (await executeGetResponse.json()) as {
      mode: string;
      record: { formInstId: string; fieldMap: Record<string, { value: string }> };
    };
    assert.equal(executeGetPayload.mode, 'live');
    assert.equal(executeGetPayload.record.formInstId, CUSTOMER_FORM_INST_ID);
    assert.equal(executeGetPayload.record.fieldMap.Te_0?.value, '华东制造样板客户');

    const executeUpsertResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'update',
        operatorOpenId: 'oid-live-1',
        formInstId: CUSTOMER_FORM_INST_ID,
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
          linked_contact_form_inst_id: CONTACT_FORM_INST_ID,
          province: '浙江',
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
    assert.deepEqual(executeUpsertPayload.formInstIds, [CUSTOMER_FORM_INST_ID]);
    assert.equal(executeUpsertPayload.requestBody.data[0]?.formInstId, CUSTOMER_FORM_INST_ID);
    assert.equal(executeUpsertPayload.requestBody.data[0]?.widgetValue._S_NAME, '华东制造更新客户');
    assert.equal(executeUpsertPayload.requestBody.data[0]?.widgetValue._S_TITLE, '华东制造更新客户');
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
        id: CONTACT_FORM_INST_ID,
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
    assert.deepEqual(executeUpsertPayload.requestBody.data[0]?.widgetValue.Pw_0, [
      {
        title: '浙江',
        dicId: 'd-province-zj',
      },
    ]);

    const ambiguousDistrictPreviewResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/customer/preview/upsert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'update',
          operatorOpenId: 'oid-live-1',
          formInstId: CUSTOMER_FORM_INST_ID,
          params: {
            district: '城区',
          },
        }),
      },
    );
    assert.equal(ambiguousDistrictPreviewResponse.status, 200);
    const ambiguousDistrictPreviewPayload = (await ambiguousDistrictPreviewResponse.json()) as {
      readyToSend: boolean;
      validationErrors: string[];
    };
    assert.equal(ambiguousDistrictPreviewPayload.readyToSend, false);
    assert.match(ambiguousDistrictPreviewPayload.validationErrors[0] ?? '', /多个候选/);

    const explicitDistrictPreviewResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/customer/preview/upsert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'update',
          operatorOpenId: 'oid-live-1',
          formInstId: CUSTOMER_FORM_INST_ID,
          params: {
            province: '江苏',
            city: '南通市',
            district: {
              title: '海门市',
              dicId: 'd-district-hm',
            },
          },
        }),
      },
    );
    assert.equal(explicitDistrictPreviewResponse.status, 200);
    const explicitDistrictPreviewPayload = (await explicitDistrictPreviewResponse.json()) as {
      readyToSend: boolean;
      validationErrors: string[];
      requestBody: {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      };
    };
    assert.equal(explicitDistrictPreviewPayload.readyToSend, true);
    assert.deepEqual(explicitDistrictPreviewPayload.validationErrors, []);
    assert.deepEqual(explicitDistrictPreviewPayload.requestBody.data[0]?.widgetValue.Pw_0, [
      {
        title: '江苏',
        dicId: 'd-province-js',
      },
    ]);
    assert.deepEqual(explicitDistrictPreviewPayload.requestBody.data[0]?.widgetValue.Pw_1, [
      {
        title: '南通市',
        dicId: 'd-city-nt',
      },
    ]);
    assert.deepEqual(explicitDistrictPreviewPayload.requestBody.data[0]?.widgetValue.Pw_2, [
      {
        title: '海门市',
        dicId: 'd-district-hm',
      },
    ]);

    const previewDeleteResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/preview/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        formInstIds: [CUSTOMER_FORM_INST_ID, 'form-inst-002'],
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
    assert.deepEqual(previewDeletePayload.requestBody.formInstIds, [CUSTOMER_FORM_INST_ID, 'form-inst-002']);

    const executeDeleteResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/customer/execute/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorOpenId: 'oid-live-1',
        formInstIds: [CUSTOMER_FORM_INST_ID],
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
    assert.deepEqual(executeDeletePayload.formInstIds, [CUSTOMER_FORM_INST_ID]);
    assert.deepEqual(executeDeletePayload.requestBody.formInstIds, [CUSTOMER_FORM_INST_ID]);

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
    assert.equal(previewPayload.requestBody.data[0].widgetValue._S_NAME, '华东制造样板客户');
    assert.equal(previewPayload.requestBody.data[0].widgetValue._S_TITLE, '华东制造样板客户');
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});

test('HTTP endpoints expose external skill catalog and readable config errors', async () => {
  const runtime = await createTestServer({
    imageApiKey: null,
  });

  try {
    const skillsResponse = await fetch(`${runtime.baseUrl}/api/external-skills`);
    assert.equal(skillsResponse.status, 200);
    const skillsPayload = (await skillsResponse.json()) as Array<{
      skillCode: string;
      status: string;
      implementationType: string;
      supportsInvoke: boolean;
      debugMode?: string;
    }>;
    const imageSkill = skillsPayload.find((item) => item.skillCode === 'ext.image_generate');
    const companySkill = skillsPayload.find((item) => item.skillCode === 'ext.company_research_pm');
    const superPptSkill = skillsPayload.find((item) => item.skillCode === 'ext.super_ppt');
    assert.ok(imageSkill);
    assert.ok(companySkill);
    assert.ok(superPptSkill);
    assert.equal(imageSkill.status, '告警中');
    assert.equal(imageSkill.implementationType, 'http_request');
    assert.equal(imageSkill.supportsInvoke, true);
    assert.equal(companySkill.implementationType, 'skill');
    assert.equal(companySkill.supportsInvoke, true);
    assert.equal(companySkill.debugMode, 'skill_job');
    assert.equal(superPptSkill.implementationType, 'skill');
    assert.equal(superPptSkill.supportsInvoke, true);

    const invokeResponse = await fetch(`${runtime.baseUrl}/api/external-skills/image-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '生成一张橙色商务科技海报',
      }),
    });
    assert.equal(invokeResponse.status, 503);
    const invokePayload = (await invokeResponse.json()) as { message: string };
    assert.match(invokePayload.message, /EXT_IMAGE_API_KEY/);
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});

test('HTTP endpoints execute image generation and return preview metadata', async () => {
  const runtime = await createTestServer({
    imageApiKey: 'image-api-key',
    imageFetchImpl: (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: 'ZmFrZS1pbWFnZS1iYXNlNjQ=',
              mime_type: 'image/png',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      )) as FetchLike,
  });

  try {
    const skillsResponse = await fetch(`${runtime.baseUrl}/api/external-skills`);
    assert.equal(skillsResponse.status, 200);
    const skillsPayload = (await skillsResponse.json()) as Array<{
      skillCode: string;
      status: string;
      implementationType?: string;
    }>;
    const imageSkill = skillsPayload.find((item) => item.skillCode === 'ext.image_generate');
    const problemSkill = skillsPayload.find((item) => item.skillCode === 'ext.problem_statement_pm');
    assert.ok(imageSkill);
    assert.ok(problemSkill);
    assert.equal(imageSkill.status, '运行中');
    assert.equal(problemSkill.implementationType, 'skill');

    const invokeResponse = await fetch(`${runtime.baseUrl}/api/external-skills/image-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '生成一张面向制造业 CRM 的品牌海报',
        size: '1024x1024',
        quality: 'medium',
      }),
    });
    assert.equal(invokeResponse.status, 200);

    const invokePayload = (await invokeResponse.json()) as {
      skillCode: string;
      model: string;
      provider: string;
      size: string;
      quality: string;
      previewDataUrl: string;
      latencyMs: number;
      generatedAt: string;
    };
    assert.equal(invokePayload.skillCode, 'ext.image_generate');
    assert.equal(invokePayload.model, 'gpt-image-2');
    assert.equal(invokePayload.provider, 'linkapi_images_provider');
    assert.equal(invokePayload.size, '1024x1024');
    assert.equal(invokePayload.quality, 'medium');
    assert.equal(invokePayload.generatedAt, '2026-04-24T09:00:00.000Z');
    assert.match(invokePayload.previewDataUrl, /^data:image\/png;base64,/);
    assert.equal(typeof invokePayload.latencyMs, 'number');
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});

test('HTTP endpoints proxy skill-runtime jobs for external skills', async () => {
  const runtime = await createTestServer({
    skillRuntimeFetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/models')) {
        return jsonResponse([
          { name: 'deepseek-v4-flash', label: 'deepseek-v4-flash', isDefault: true },
          { name: 'deepseek-v4-pro', label: 'deepseek-v4-pro', isDefault: false },
        ]);
      }
      if (url.endsWith('/api/skills')) {
        return jsonResponse([
          {
            skillName: 'problem-statement',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'problem summary',
          },
        ]);
      }
      if (url.endsWith('/api/jobs') && init?.method === 'POST') {
        return jsonResponse({
          jobId: 'job-001',
          skillName: 'problem-statement',
          model: 'deepseek-v4-pro',
          status: 'queued',
          finalText: null,
          events: [
            {
              id: 'evt-1',
              type: 'status',
              message: 'Job 已入队',
              createdAt: '2026-04-25T10:00:00.000Z',
            },
          ],
          artifacts: [],
          error: null,
          createdAt: '2026-04-25T10:00:00.000Z',
          updatedAt: '2026-04-25T10:00:00.000Z',
        }, 202);
      }
      if (url.endsWith('/api/jobs/job-001')) {
        return jsonResponse({
          jobId: 'job-001',
          skillName: 'problem-statement',
          model: 'deepseek-v4-pro',
          status: 'succeeded',
          finalText: '# 问题陈述',
          events: [
            {
              id: 'evt-1',
              type: 'status',
              message: 'Job 已完成',
              createdAt: '2026-04-25T10:01:00.000Z',
            },
          ],
          artifacts: [
            {
              artifactId: 'artifact-001',
              jobId: 'job-001',
              fileName: 'problem-statement.md',
              mimeType: 'text/markdown',
              byteSize: 128,
              createdAt: '2026-04-25T10:01:00.000Z',
              downloadPath: '/api/jobs/job-001/artifacts/artifact-001',
            },
          ],
          error: null,
          createdAt: '2026-04-25T10:00:00.000Z',
          updatedAt: '2026-04-25T10:01:00.000Z',
        });
      }
      if (url.endsWith('/api/jobs/job-001/artifacts/artifact-001')) {
        return new Response('# 问题陈述', {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown',
            'Content-Disposition': 'attachment; filename="problem-statement.md"',
          },
        });
      }

      if (
        (
          url.endsWith('/api/jobs/job-002/presentation-session')
          || url.endsWith('/api/jobs/job-002/presentation-session?refresh=1')
        )
        && init?.method === 'POST'
      ) {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-002',
          pptId: 'ppt-002',
          token: 'sk-session-002',
          subject: '绍兴贝斯美化工企业研究',
          animation: true,
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
          clientId: 'legacy-job-002',
        });
      }

      if (url.endsWith('/api/jobs/job-002/presentation-session/open') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-002',
          pptId: 'ppt-002',
          token: 'sk-session-003',
          subject: '绍兴贝斯美化工企业研究',
          animation: false,
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
          clientId: 'client-a',
        });
      }

      if (url.endsWith('/api/jobs/job-002/presentation-session/heartbeat') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-002',
          clientId: 'client-a',
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
        });
      }

      if (url.endsWith('/api/jobs/job-002/presentation-session/close') && init?.method === 'POST') {
        return jsonResponse({
          status: 'closed',
          jobId: 'job-002',
          clientId: 'client-a',
          released: true,
        });
      }

      throw new Error(`Unexpected skill-runtime url: ${url}`);
    }) as FetchLike,
  });

  try {
    const createResponse = await fetch(`${runtime.baseUrl}/api/external-skills/ext.problem_statement_pm/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestText: '整理问题陈述',
        model: 'deepseek-v4-pro',
      }),
    });
    assert.equal(createResponse.status, 202);
    const createdJob = (await createResponse.json()) as {
      skillCode: string;
      runtimeSkillName: string;
      model: string;
      status: string;
    };
    assert.equal(createdJob.skillCode, 'ext.problem_statement_pm');
    assert.equal(createdJob.runtimeSkillName, 'problem-statement');
    assert.equal(createdJob.model, 'deepseek-v4-pro');
    assert.equal(createdJob.status, 'queued');

    const jobResponse = await fetch(`${runtime.baseUrl}/api/external-skills/jobs/job-001`);
    assert.equal(jobResponse.status, 200);
    const jobPayload = (await jobResponse.json()) as {
      skillCode: string;
      finalText: string;
      artifacts: Array<{ downloadPath: string }>;
    };
    assert.equal(jobPayload.skillCode, 'ext.problem_statement_pm');
    assert.equal(jobPayload.finalText, '# 问题陈述');
    assert.equal(
      jobPayload.artifacts[0]?.downloadPath,
      '/api/external-skills/jobs/job-001/artifacts/artifact-001',
    );

    const artifactResponse = await fetch(`${runtime.baseUrl}/api/external-skills/jobs/job-001/artifacts/artifact-001`);
    assert.equal(artifactResponse.status, 200);
    assert.equal(artifactResponse.headers.get('content-type'), 'text/markdown');
    assert.equal(await artifactResponse.text(), '# 问题陈述');

    const sessionResponse = await fetch(
      `${runtime.baseUrl}/api/external-skills/jobs/job-002/presentation-session`,
      {
        method: 'POST',
      },
    );
    assert.equal(sessionResponse.status, 200);
    const sessionPayload = (await sessionResponse.json()) as {
      pptId: string;
      token: string;
    };
    assert.equal(sessionPayload.pptId, 'ppt-002');
    assert.equal(sessionPayload.token, 'sk-session-002');

    const refreshedSessionResponse = await fetch(
      `${runtime.baseUrl}/api/external-skills/jobs/job-002/presentation-session?refresh=1`,
      {
        method: 'POST',
      },
    );
    assert.equal(refreshedSessionResponse.status, 200);
    const refreshedSessionPayload = (await refreshedSessionResponse.json()) as {
      pptId: string;
      token: string;
    };
    assert.equal(refreshedSessionPayload.pptId, 'ppt-002');
    assert.equal(refreshedSessionPayload.token, 'sk-session-002');

    const openedSessionResponse = await fetch(
      `${runtime.baseUrl}/api/external-skills/jobs/job-002/presentation-session/open`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'client-a',
          clientLabel: 'Chrome · client-a',
        }),
      },
    );
    assert.equal(openedSessionResponse.status, 200);
    const openedSessionPayload = (await openedSessionResponse.json()) as {
      token: string;
      clientId: string;
    };
    assert.equal(openedSessionPayload.token, 'sk-session-003');
    assert.equal(openedSessionPayload.clientId, 'client-a');

    const heartbeatSessionResponse = await fetch(
      `${runtime.baseUrl}/api/external-skills/jobs/job-002/presentation-session/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'client-a',
          clientLabel: 'Chrome · client-a',
        }),
      },
    );
    assert.equal(heartbeatSessionResponse.status, 200);

    const closeSessionResponse = await fetch(
      `${runtime.baseUrl}/api/external-skills/jobs/job-002/presentation-session/close`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'client-a',
        }),
      },
    );
    assert.equal(closeSessionResponse.status, 200);
    const closeSessionPayload = (await closeSessionResponse.json()) as {
      released: boolean;
    };
    assert.equal(closeSessionPayload.released, true);
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});

test('HTTP shadow preview rejects unsupported followup widgets and preserves external relation metadata', async () => {
  const runtime = await createTestServer();

  try {
    const refreshResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/followup/refresh`, {
      method: 'POST',
    });
    assert.equal(refreshResponse.status, 200);

    const detailResponse = await fetch(`${runtime.baseUrl}/api/shadow/objects/followup`);
    assert.equal(detailResponse.status, 200);
    const detailPayload = (await detailResponse.json()) as {
      fields: Array<{
        fieldCode: string;
        relationBinding?: {
          kind?: string | null;
          formCodeId: string | null;
          modelName: string | null;
          displayCol: string | null;
        };
      }>;
    };
    assert.deepEqual(
      detailPayload.fields.find((field) => field.fieldCode === 'Bd_4')?.relationBinding,
      {
        kind: 'basic_data',
        formCodeId: ORDER_CHANGE_FORM_CODE_ID,
        modelName: '订单变更',
        displayCol: '_S_SERIAL',
      },
    );

    const unsupportedPreviewResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/followup/preview/upsert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'update',
          operatorOpenId: 'oid-followup-1',
          formInstId: FOLLOWUP_FORM_INST_ID,
          params: {
            Lo_0: {
              longitude: 121.5,
              latitude: 31.2,
            },
          },
        }),
      },
    );
    assert.equal(unsupportedPreviewResponse.status, 200);
    const unsupportedPreviewPayload = (await unsupportedPreviewResponse.json()) as {
      readyToSend: boolean;
      validationErrors: string[];
    };
    assert.equal(unsupportedPreviewPayload.readyToSend, false);
    assert.match(unsupportedPreviewPayload.validationErrors[0] ?? '', /Lo_0/);
    assert.match(unsupportedPreviewPayload.validationErrors[0] ?? '', /locationWidget/);

    const supportedPreviewResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/followup/preview/upsert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'create',
          operatorOpenId: 'oid-followup-2',
          params: {
            followup_record: '完成现场回访并记录问题',
            followup_method: '电话',
            owner_open_id: 'open-followup-2',
            linked_customer_form_inst_id: CUSTOMER_FORM_INST_ID,
            linked_opportunity_form_inst_id: OPPORTUNITY_FORM_INST_ID,
            Bd_4: ORDER_CHANGE_FORM_INST_ID,
          },
        }),
      },
    );
    assert.equal(supportedPreviewResponse.status, 200);
    const supportedPreviewPayload = (await supportedPreviewResponse.json()) as {
      readyToSend: boolean;
      requestBody: { data: Array<{ widgetValue: Record<string, unknown> }> };
    };
    assert.equal(supportedPreviewPayload.readyToSend, true);
    assert.deepEqual(supportedPreviewPayload.requestBody.data[0]?.widgetValue.Bd_4, [
      {
        id: ORDER_CHANGE_FORM_INST_ID,
        formCodeId: ORDER_CHANGE_FORM_CODE_ID,
        formDefId: 'form-def-order-change',
        flowInstId: '',
        showName: '订单变更OC-001',
        _S_TITLE: '订单变更OC-001',
        _S_NAME: '订单变更OC-001',
        _name_: '订单变更OC-001',
        _S_SERIAL: 'OC-001',
      },
    ]);

    const unsupportedSearchResponse = await fetch(
      `${runtime.baseUrl}/api/shadow/objects/followup/preview/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operatorOpenId: 'oid-followup-3',
          filters: [
            {
              field: 'Lo_0',
              value: '上海',
            },
          ],
        }),
      },
    );
    assert.equal(unsupportedSearchResponse.status, 200);
    const unsupportedSearchPayload = (await unsupportedSearchResponse.json()) as {
      readyToSend: boolean;
      validationErrors: string[];
    };
    assert.equal(unsupportedSearchPayload.readyToSend, false);
    assert.match(unsupportedSearchPayload.validationErrors[0] ?? '', /Lo_0/);
    assert.match(unsupportedSearchPayload.validationErrors[0] ?? '', /查询支持/);
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
    rmSync(runtime.tempDir, { recursive: true, force: true });
  }
});
