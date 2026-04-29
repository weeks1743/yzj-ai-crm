import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { ApprovalClient } from '../src/approval-client.js';
import { DictionaryResolver } from '../src/dictionary-resolver.js';
import { LightCloudClient } from '../src/lightcloud-client.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { ShadowMetadataService } from '../src/shadow-metadata-service.js';
import type { ShadowInternalTemplateProvider } from '../src/shadow-template-providers.js';
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

function writeFieldBoundWorkbook(workbookPath: string) {
  mkdirSync(join(workbookPath, '..'), { recursive: true });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { dicId: 'meta', title: 'meta', parentId: '0', code: '', sort: 0, type: 2 },
    { dicId: 'd005', title: '省', parentId: '0', code: 'province', sort: 1, type: 1 },
    { dicId: 'd006', title: '市', parentId: '0', code: 'city', sort: 2, type: 1 },
    { dicId: 'd007', title: '区', parentId: '0', code: 'district', sort: 3, type: 1 },
    { dicId: 'd-province-js', title: '江苏', parentId: 'd005', code: '320000', sort: 4, type: 0 },
    { dicId: 'd-province-zj', title: '浙江', parentId: 'd005', code: '330000', sort: 1, type: 0 },
    { dicId: 'd-province-ah', title: '安徽', parentId: 'd005', code: '340000', sort: 2, type: 0 },
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
  Te_5: {
    codeId: 'Te_5',
    title: '联系人姓名',
    type: 'textWidget',
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
  Ra_1: {
    codeId: 'Ra_1',
    title: '客户是否分配',
    type: 'radioWidget',
    required: true,
    readOnly: false,
    edit: true,
    view: true,
    options: [
      {
        key: 'customer-assigned',
        value: '已分配',
      },
      {
        key: 'customer-unassigned',
        value: '未分配',
      },
    ],
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

class StubSearchFormInstLightCloudClient extends StubLightCloudClient {
  override async searchList(params: {
    accessToken: string;
    body: Record<string, unknown>;
  }): Promise<{
    pageNumber: number;
    totalPages: number;
    pageSize: number;
    totalElements: number;
    content: Array<Record<string, unknown>>;
  }> {
    const page = await super.searchList(params);
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
    opportunityFormCodeId: OPPORTUNITY_FORM_CODE_ID,
    followupFormCodeId: FOLLOWUP_FORM_CODE_ID,
  });
  const repository = new ShadowMetadataRepository(createInMemoryDatabase());
  const approvalClient = new StubApprovalClient();
  const fieldBoundWorkbookPath = join(skillOutputDir, '..', 'province-city-district.xlsx');
  writeFieldBoundWorkbook(fieldBoundWorkbookPath);

  return new ShadowMetadataService({
    config,
    repository,
    approvalClient,
    lightCloudClient,
    dictionaryResolver: new DictionaryResolver({
      source: config.shadow.dictionarySource,
      jsonPath: config.shadow.dictionaryJsonPath,
      approvalClient,
      fieldBoundWorkbookPath,
    }),
    internalTemplateProvider: new StubInternalTemplateProvider(),
    now: createNowSequence(),
  });
}

function buildRequiredCustomerCreateParams(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: '华北样板客户',
    customer_status: '待跟进',
    contact_phone: '13800138000',
    customer_type: 'VIP客户',
    contact_name: '李四',
    Ra_1: '已分配',
    enabled_state: true,
    ...overrides,
  };
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

function getWriteFieldParameterKeyForTest(field: {
  fieldCode: string;
  semanticSlot?: string;
  writeParameterKey?: string;
}) {
  return field.writeParameterKey ?? getFieldParameterKeyForTest(field);
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
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_0')?.semanticSlot, 'province');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_1')?.semanticSlot, 'city');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_2')?.semanticSlot, 'district');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_0')?.linkCodeId, 'Pw_1');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_1')?.linkCodeId, 'Pw_2');
    assert.equal(firstRefresh.fields.find((field) => field.fieldCode === 'Pw_2')?.linkCodeId, undefined);
    assert.equal(
      firstRefresh.fields.find((field) => field.fieldCode === 'Pw_0')?.enumBinding?.resolutionStatus,
      'resolved',
    );
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
    const initialUpdateSkill = service
      .listSkills('customer')
      .find((skill) => skill.skillName === 'shadow.customer_update');
    assert.ok(initialCreateSkill);
    assert.ok(initialSearchSkill);
    assert.ok(initialUpdateSkill);
    assert.ok(initialCreateSkill?.requiredParams.includes('customer_name'));
    assert.ok(initialCreateSkill?.requiredParams.includes('customer_status'));
    assert.ok(initialCreateSkill?.requiredParams.includes('contact_phone'));
    assert.ok(initialCreateSkill?.requiredParams.includes('customer_type'));
    assert.ok(initialCreateSkill?.requiredParams.includes('contact_name'));
    assert.ok(initialCreateSkill?.requiredParams.includes('Ra_1'));
    assert.ok(initialCreateSkill?.requiredParams.includes('enabled_state'));
    assert.ok(initialCreateSkill?.derivedParams.includes('_S_TITLE'));
    const conditionalRequiredField = service
      .getObject('customer')
      .fields.find((field) => field.fieldCode === 'Ps_1');
    assert.equal(conditionalRequiredField?.required, false);
    assert.equal(conditionalRequiredField?.requiredMode, 'conditional');
    assert.match(conditionalRequiredField?.requiredRules?.[0]?.description ?? '', /客户状态/);
    assert.ok(initialCreateSkill?.optionalParams.includes('service_rep_open_id'));
    assert.ok(initialCreateSkill?.optionalParams.includes('last_followup_date'));
    assert.equal(initialCreateSkill?.optionalParams.includes('customer_type'), false);
    assert.ok(initialCreateSkill?.optionalParams.includes('At_0'));
    assert.ok(initialCreateSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(initialCreateSkill?.optionalParams.includes('province'));
    assert.ok(initialCreateSkill?.optionalParams.includes('city'));
    assert.ok(initialCreateSkill?.optionalParams.includes('district'));
    assert.equal(initialCreateSkill?.optionalParams.includes('Te_0'), false);
    assert.ok(initialSearchSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(initialSearchSkill?.optionalParams.includes('_S_NAME'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Te_0'));
    assert.ok(initialSearchSkill?.optionalParams.includes('_S_DISABLE'));
    assert.ok(initialSearchSkill?.optionalParams.includes('customer_status'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Te_7'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Nu_1'));
    assert.ok(initialSearchSkill?.optionalParams.includes('Nu_0'));
    assert.equal(initialSearchSkill?.optionalParams.includes('customer_name'), false);
    assert.equal(initialSearchSkill?.optionalParams.includes('phone'), false);
    assert.equal(initialCreateSkill?.optionalParams.includes('region'), false);
    assert.equal(initialCreateSkill?.optionalParams.includes('Pw_0'), false);
    assert.match(
      initialCreateSkill?.interactionStrategy.parameterCollectionPolicy.join('\n') ?? '',
      /业务标签/,
    );
    assert.match(
      initialUpdateSkill?.interactionStrategy.recommendedFlow.join('\n') ?? '',
      /只收集用户明确想改的字段/,
    );
    assert.match(
      initialUpdateSkill?.interactionStrategy.parameterCollectionPolicy.join('\n') ?? '',
      /把松井客户类型改成 VIP 客户/,
    );
    assert.deepEqual(
      [...(initialSearchSkill?.optionalParams ?? [])].sort(),
      getExpectedSearchParams(firstRefresh.fields),
    );
    assert.equal(existsSync(initialCreateSkill?.skillPath ?? ''), true);
    assert.equal(existsSync(initialCreateSkill?.referencePaths.templateSummary ?? ''), true);
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /open_id/);
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /\$approval\.file_upload/);
    const initialCreateSkillBundle = JSON.parse(
      readFileSync(initialCreateSkill?.referencePaths.skillBundle ?? '', 'utf8'),
    ) as {
      interactionStrategy?: {
        recommendedFlow?: string[];
        clarificationTriggers?: Array<{ when: string }>;
      };
    };
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /## Interaction Strategy/);
    assert.match(readFileSync(initialCreateSkill?.skillPath ?? '', 'utf8'), /### Clarification Rules/);
    assert.match(readFileSync(initialUpdateSkill?.skillPath ?? '', 'utf8'), /先用名称、编码、关联线索或日期条件 search/);
    assert.equal(
      initialCreateSkillBundle.interactionStrategy?.clarificationTriggers?.[0]?.when,
      '缺少必填字段',
    );
    assert.match(
      initialCreateSkillBundle.interactionStrategy?.recommendedFlow?.join('\n') ?? '',
      /业务语义参数/,
    );
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
        ...buildRequiredCustomerCreateParams({
          customer_name: '华东制造样板客户',
        }),
        service_rep_open_id: 'open-1',
        last_followup_date: '2026-04-23',
        region: '北京',
        province: '浙江',
        city: '杭州',
        district: { title: '滨江', dicId: 'd-district-bj' },
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
    assert.deepEqual(widgetValue.Pw_0, [{ title: '浙江', dicId: 'd-province-zj' }]);
    assert.deepEqual(widgetValue.Pw_1, [{ title: '杭州', dicId: 'd-city-hz' }]);
    assert.deepEqual(widgetValue.Pw_2, [{ title: '滨江', dicId: 'd-district-bj' }]);
    assert.deepEqual(widgetValue.Ps_1, ['open-1']);
    assert.equal(widgetValue._S_DISABLE, '1');
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
        ...buildRequiredCustomerCreateParams(),
        region: '北京',
      },
    });
    assert.equal(titleOnlyPreview.readyToSend, false);
    assert.match(titleOnlyPreview.validationErrors[0] ?? '', /完整 \{title,dicId\}/);

    const explicitPreview = await service.previewUpsert('customer', {
      mode: 'create',
      operatorOpenId: 'oid-test-3',
      params: {
        ...buildRequiredCustomerCreateParams(),
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

    const resolvedFieldPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4',
      formInstId: CUSTOMER_FORM_INST_ID,
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
        province: '浙江',
        city: '杭州',
        district: [{ title: '滨江', dicId: 'd-district-bj' }],
      },
    });

    const resolvedWidgetValue = (resolvedFieldPreview.requestBody as {
      data: Array<{ widgetValue: Record<string, unknown> }>;
    }).data[0]?.widgetValue;
    assert.equal(resolvedFieldPreview.readyToSend, true);
    assert.deepEqual(resolvedFieldPreview.validationErrors, []);
    assert.deepEqual(resolvedFieldPreview.blockedReadonlyParams, []);
    assert.deepEqual(resolvedWidgetValue.Ps_1, ['open-2']);
    assert.deepEqual(resolvedWidgetValue.At_0, [
      {
        fileId: 'file-1',
        fileName: 'fixture.pdf',
        fileSize: '128',
        fileType: 'doc',
        fileExt: 'pdf',
      },
    ]);
    assert.deepEqual(resolvedWidgetValue.Pw_0, [{ title: '浙江', dicId: 'd-province-zj' }]);
    assert.deepEqual(resolvedWidgetValue.Pw_1, [{ title: '杭州', dicId: 'd-city-hz' }]);
    assert.deepEqual(resolvedWidgetValue.Pw_2, [{ title: '滨江', dicId: 'd-district-bj' }]);

    const ambiguousDistrictPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4b',
      formInstId: CUSTOMER_FORM_INST_ID,
      params: {
        district: '城区',
      },
    });
    assert.equal(ambiguousDistrictPreview.readyToSend, false);
    assert.match(ambiguousDistrictPreview.validationErrors[0] ?? '', /多个候选/);
    assert.match(ambiguousDistrictPreview.validationErrors[0] ?? '', /完整 \{title,dicId\}/);

    const explicitDistrictPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4c',
      formInstId: CUSTOMER_FORM_INST_ID,
      params: {
        province: '江苏',
        city: '南通市',
        district: {
          title: '海门市',
          dicId: 'd-district-hm',
        },
      },
    });
    const explicitDistrictWidgetValue = (explicitDistrictPreview.requestBody as {
      data: Array<{ widgetValue: Record<string, unknown> }>;
    }).data[0]?.widgetValue;
    assert.equal(explicitDistrictPreview.readyToSend, true);
    assert.deepEqual(explicitDistrictPreview.validationErrors, []);
    assert.deepEqual(explicitDistrictWidgetValue.Pw_0, [{ title: '江苏', dicId: 'd-province-js' }]);
    assert.deepEqual(explicitDistrictWidgetValue.Pw_1, [{ title: '南通市', dicId: 'd-city-nt' }]);
    assert.deepEqual(explicitDistrictWidgetValue.Pw_2, [{ title: '海门市', dicId: 'd-district-hm' }]);

    const mismatchedDistrictPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4d',
      formInstId: CUSTOMER_FORM_INST_ID,
      params: {
        district: {
          title: '海门市',
          dicId: 'd-district-ct-a',
        },
      },
    });
    assert.equal(mismatchedDistrictPreview.readyToSend, false);
    assert.match(mismatchedDistrictPreview.validationErrors[0] ?? '', /title 与 dicId 不匹配/);

    const invalidAttachmentPreview = await service.previewUpsert('customer', {
      mode: 'update',
      operatorOpenId: 'oid-test-4a',
      formInstId: CUSTOMER_FORM_INST_ID,
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
      formInstId: CUSTOMER_FORM_INST_ID,
      params: {
        linked_contact_form_inst_id: {
          id: CONTACT_FORM_INST_ID,
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
      formInstId: CUSTOMER_FORM_INST_ID,
      params: {
        linked_contact_form_inst_id: {
          id: CONTACT_FORM_INST_ID,
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
          field: 'province',
          value: '浙江',
          operator: 'eq',
        },
      ],
      pageNumber: 1,
      pageSize: 20,
    });
    assert.equal(search.mode, 'live');
    assert.equal(search.records.length, 1);
    assert.equal(search.records[0]?.formInstId, CUSTOMER_FORM_INST_ID);
    assert.equal(search.requestBody.searchItems.length, 3);
    assert.equal(search.requestBody.searchItems[0]?.codeId, 'Bd_1');
    assert.equal(search.requestBody.searchItems[0]?.operator, 'contains');
    assert.deepEqual(search.requestBody.searchItems[0]?.value, [
      {
        _id_: CONTACT_FORM_INST_ID,
        _name_: 'CON-001',
      },
    ]);
    assert.equal(search.requestBody.searchItems[1]?.codeId, 'Ps_1');
    assert.deepEqual(search.requestBody.searchItems[1]?.value, ['open-live-1']);
    assert.equal(search.requestBody.searchItems[2]?.codeId, 'Pw_0');
    assert.equal(search.requestBody.searchItems[2]?.operator, 'eq');
    assert.deepEqual(search.requestBody.searchItems[2]?.value, [
      {
        title: '浙江',
        dicId: 'd-province-zj',
      },
    ]);

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

    const metadataFieldSearch = await service.executeSearch('customer', {
      operatorOpenId: 'oid-live-1',
      filters: [
        {
          field: 'province',
          value: '安徽',
          operator: 'eq',
        },
        {
          field: 'customer_status',
          value: '待跟进',
          operator: 'eq',
        },
        {
          field: '_S_DISABLE',
          value: '启用',
          operator: 'eq',
        },
        {
          field: 'Nu_1',
          value: '13800138000',
        },
      ],
      pageNumber: 1,
      pageSize: 20,
    });
    assert.equal(metadataFieldSearch.mode, 'live');
    assert.deepEqual(metadataFieldSearch.requestBody.searchItems[0], {
      codeId: 'Pw_0',
      parentCodeId: null,
      type: 'publicOptBoxWidget',
      operator: 'eq',
      value: [
        {
          title: '安徽',
          dicId: 'd-province-ah',
        },
      ],
    });
    assert.deepEqual(metadataFieldSearch.requestBody.searchItems[1], {
      codeId: 'Ra_0',
      parentCodeId: null,
      type: 'radioWidget',
      operator: 'eq',
      value: 'customer-pending',
    });
    assert.deepEqual(metadataFieldSearch.requestBody.searchItems[2], {
      codeId: '_S_DISABLE',
      parentCodeId: null,
      type: 'switchWidget',
      operator: 'eq',
      value: '1',
    });
    assert.deepEqual(metadataFieldSearch.requestBody.searchItems[3], {
      codeId: 'Nu_1',
      parentCodeId: null,
      type: 'numberWidget',
      value: '13800138000',
    });

    const detail = await service.executeGet('customer', {
      operatorOpenId: 'oid-live-1',
      formInstId: CUSTOMER_FORM_INST_ID,
    });
    assert.equal(detail.mode, 'live');
    assert.equal(detail.record.formInstId, CUSTOMER_FORM_INST_ID);
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
    assert.equal(search.records[0]?.formInstId, CUSTOMER_FORM_INST_ID);
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
            fileName: 'fixture.pdf',
            fileSize: '128',
            fileType: 'doc',
            fileExt: 'pdf',
          },
        ],
        linked_contact_form_inst_id: 'contact-inst-001',
        province: '浙江',
      },
    });

    assert.equal(result.mode, 'live');
    assert.equal(result.writeMode, 'update');
    assert.deepEqual(result.formInstIds, [CUSTOMER_FORM_INST_ID]);
    assert.equal(result.requestBody.data[0]?.widgetValue._S_NAME, '华东制造更新客户');
    assert.equal(result.requestBody.data[0]?.widgetValue._S_TITLE, '华东制造更新客户');
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
    assert.deepEqual(result.requestBody.data[0]?.widgetValue.Pw_0, [
      {
        title: '浙江',
        dicId: 'd-province-zj',
      },
    ]);
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
    internalTemplateProvider: new StubInternalTemplateProvider(),
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
    assert.ok(contactCreateSkill?.requiredParams.includes('contact_name'));
    assert.ok(contactCreateSkill?.derivedParams.includes('_S_TITLE'));
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
        linked_customer_form_inst_id: CUSTOMER_FORM_INST_ID,
      },
    });
    assert.equal(contactPreview.readyToSend, true);
    assert.deepEqual(
      (contactPreview.requestBody as { data: Array<{ widgetValue: Record<string, unknown> }> }).data[0]
        ?.widgetValue.Bd_0,
      [
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
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService refreshes opportunity and followup metadata into object-specific skill bundles', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-opportunity-followup-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const skillOutputDir = join(tempDir, 'skills');
  const service = createService(dictionaryPath, skillOutputDir);

  try {
    const opportunityDetail = await service.refreshObject('opportunity');
    const followupDetail = await service.refreshObject('followup');

    const opportunitySkills = service.listSkills('opportunity');
    const followupSkills = service.listSkills('followup');
    const opportunitySearchSkill = opportunitySkills.find(
      (skill) => skill.skillName === 'shadow.opportunity_search',
    );
    const opportunityCreateSkill = opportunitySkills.find(
      (skill) => skill.skillName === 'shadow.opportunity_create',
    );
    const followupSearchSkill = followupSkills.find(
      (skill) => skill.skillName === 'shadow.followup_search',
    );
    const followupCreateSkill = followupSkills.find(
      (skill) => skill.skillName === 'shadow.followup_create',
    );

    assert.equal(opportunityDetail.fields.length, 9);
    assert.equal(followupDetail.fields.length, 10);
    assert.equal(opportunitySkills.length, 5);
    assert.equal(followupSkills.length, 5);
    assert.ok(opportunityCreateSkill);
    assert.ok(followupCreateSkill);
    assert.ok(opportunitySearchSkill?.optionalParams.includes('linked_customer_form_inst_id'));
    assert.ok(opportunitySearchSkill?.optionalParams.includes('linked_contact_form_inst_id'));
    assert.ok(followupSearchSkill?.optionalParams.includes('linked_opportunity_form_inst_id'));
    assert.ok(followupSearchSkill?.optionalParams.includes('linked_customer_form_inst_id'));
    assert.ok(followupSearchSkill?.optionalParams.includes('Bd_4'));
    assert.ok(opportunityCreateSkill?.requiredParams.includes('opportunity_name'));
    assert.ok(opportunityCreateSkill?.derivedParams.includes('_S_TITLE'));
    assert.ok(opportunityCreateSkill?.optionalParams.includes('owner_open_id'));
    assert.ok(opportunityCreateSkill?.optionalParams.includes('At_0'));
    assert.ok(followupCreateSkill?.requiredParams.includes('followup_record'));
    assert.ok(followupCreateSkill?.requiredParams.includes('followup_method'));
    assert.ok(followupCreateSkill?.requiredParams.includes('owner_open_id'));
    assert.ok(followupCreateSkill?.requiredParams.includes('linked_customer_form_inst_id'));
    assert.ok(followupCreateSkill?.derivedParams.includes('_S_TITLE'));
    assert.ok(followupCreateSkill?.optionalParams.includes('Bd_4'));
    assert.ok(followupCreateSkill?.optionalParams.includes('At_0'));
    assert.equal(
      followupDetail.fields.find((field) => field.fieldCode === 'Bd_4')?.relationBinding?.modelName,
      '订单变更',
    );
    assert.equal(
      followupDetail.fields.find((field) => field.fieldCode === 'Bd_4')?.relationBinding?.formCodeId,
      ORDER_CHANGE_FORM_CODE_ID,
    );
    assert.match(opportunityCreateSkill?.skillPath ?? '', /\/skills\/opportunity\/create\/SKILL\.md$/);
    assert.match(followupCreateSkill?.skillPath ?? '', /\/skills\/followup\/create\/SKILL\.md$/);
    assert.equal(existsSync(opportunityCreateSkill?.skillPath ?? ''), true);
    assert.equal(existsSync(followupCreateSkill?.skillPath ?? ''), true);
    assert.match(
      readFileSync(opportunityCreateSkill?.referencePaths.skillBundle ?? '', 'utf8'),
      /"skillName": "shadow\.opportunity_create"/,
    );
    assert.match(
      readFileSync(followupCreateSkill?.referencePaths.skillBundle ?? '', 'utf8'),
      /"skillName": "shadow\.followup_create"/,
    );
    assert.match(
      readFileSync(opportunityCreateSkill?.referencePaths.skillBundle ?? '', 'utf8'),
      /"interactionStrategy"/,
    );
    assert.match(
      readFileSync(followupCreateSkill?.skillPath ?? '', 'utf8'),
      /## Interaction Strategy/,
    );
    assert.match(readFileSync(opportunitySearchSkill?.skillPath ?? '', 'utf8'), /linked_customer_form_inst_id/);
    assert.match(readFileSync(followupSearchSkill?.skillPath ?? '', 'utf8'), /linked_opportunity_form_inst_id/);
    assert.match(readFileSync(followupSearchSkill?.skillPath ?? '', 'utf8'), /Bd_4/);
    assert.match(
      readFileSync(followupCreateSkill?.skillPath ?? '', 'utf8'),
      /未支持字段/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ShadowMetadataService normalizes opportunity and followup complex fields and rejects unsupported widgets', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-shadow-opportunity-followup-preview-'));
  const dictionaryPath = join(tempDir, 'shadow-dictionaries.json');
  const service = createService(dictionaryPath, join(tempDir, 'skills'));

  try {
    await service.refreshObject('opportunity');
    await service.refreshObject('followup');

    const opportunityPreview = await service.previewUpsert('opportunity', {
      mode: 'create',
      operatorOpenId: 'oid-opportunity-1',
      params: {
        opportunity_name: '华东制造样板商机',
        opportunity_status: '跟进中',
        owner_open_id: 'open-sales-1',
        linked_customer_form_inst_id: CUSTOMER_FORM_INST_ID,
        linked_contact_form_inst_id: CONTACT_FORM_INST_ID,
        Da_0: '2026-05-01',
        At_0: {
          fileId: 'file-opportunity-002',
          fileName: 'opportunity.xlsx',
          fileSize: '512',
          fileType: 'doc',
          fileExt: 'xlsx',
        },
      },
    });
    assert.equal(opportunityPreview.readyToSend, true);
    assert.deepEqual(
      (opportunityPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Bd_0,
      [
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
    );
    assert.deepEqual(
      (opportunityPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Bd_1,
      [
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
    );
    assert.deepEqual(
      (opportunityPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.At_0,
      [
        {
          fileId: 'file-opportunity-002',
          fileName: 'opportunity.xlsx',
          fileSize: '512',
          fileType: 'doc',
          fileExt: 'xlsx',
        },
      ],
    );

    const followupPreview = await service.previewUpsert('followup', {
      mode: 'create',
      operatorOpenId: 'oid-followup-1',
      params: {
        followup_record: '完成现场回访并记录问题',
        followup_method: '电话',
        last_followup_date: '2026-04-24',
        owner_open_id: 'open-followup-1',
        linked_customer_form_inst_id: CUSTOMER_FORM_INST_ID,
        linked_opportunity_form_inst_id: OPPORTUNITY_FORM_INST_ID,
        Bd_4: ORDER_CHANGE_FORM_INST_ID,
        At_0: [
          {
            fileId: 'file-followup-002',
            fileName: 'followup.docx',
            fileSize: '2048',
            fileType: 'doc',
            fileExt: 'docx',
          },
        ],
      },
    });
    assert.equal(followupPreview.readyToSend, true);
    assert.deepEqual(
      (followupPreview.requestBody as {
        data: Array<{ widgetValue: Record<string, unknown> }>;
      }).data[0]?.widgetValue.Bd_4,
      [
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
    );

    const unsupportedWritePreview = await service.previewUpsert('followup', {
      mode: 'update',
      operatorOpenId: 'oid-followup-2',
      formInstId: FOLLOWUP_FORM_INST_ID,
      params: {
        Lo_0: {
          longitude: 121.5,
          latitude: 31.2,
        },
      },
    });
    assert.equal(unsupportedWritePreview.readyToSend, false);
    assert.match(unsupportedWritePreview.validationErrors[0] ?? '', /Lo_0/);
    assert.match(unsupportedWritePreview.validationErrors[0] ?? '', /locationWidget/);

    const unsupportedSearchPreview = await service.previewSearch('followup', {
      operatorOpenId: 'oid-followup-3',
      filters: [
        {
          field: 'Lo_0',
          value: '上海',
        },
      ],
    });
    assert.equal(unsupportedSearchPreview.readyToSend, false);
    assert.match(unsupportedSearchPreview.validationErrors[0] ?? '', /Lo_0/);
    assert.match(unsupportedSearchPreview.validationErrors[0] ?? '', /查询支持/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
