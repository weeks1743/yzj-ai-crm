import type { AppConfig, ShadowDictionarySource } from '../src/contracts.js';
import { openDatabase } from '../src/database.js';

interface TestConfigOptions {
  dictionarySource?: ShadowDictionarySource;
  dictionaryJsonPath?: string;
  skillOutputDir?: string;
  customerFormCodeId?: string;
  contactFormCodeId?: string | null;
  opportunityFormCodeId?: string | null;
  followupFormCodeId?: string | null;
}

export function createTestConfig(options: TestConfigOptions = {}): AppConfig {
  return {
    yzj: {
      eid: '21024647',
      appId: '501037729',
      appSecret: 'app-secret',
      signKey: 'sign-key',
      orgReadSecret: 'org-read-secret',
      baseUrl: 'https://stub.yzj.local',
      approval: {
        appId: 'approval-app-id',
        appSecret: 'approval-app-secret',
        developerKey: 'approval-developer-key',
        fileSecret: 'approval-file-secret',
      },
      lightCloud: {
        appId: 'lightcloud-app-id',
        appSecret: 'lightcloud-app-secret',
        secret: 'lightcloud-secret',
      },
    },
    shadow: {
      dictionarySource: options.dictionarySource ?? 'manual_json',
      dictionaryJsonPath: options.dictionaryJsonPath ?? '/tmp/non-existent-shadow-dictionaries.json',
      skillOutputDir: options.skillOutputDir ?? '/tmp/yzj-shadow-skills',
      objects: {
        customer: {
          key: 'customer',
          label: '客户',
          formCodeId: options.customerFormCodeId ?? 'customer-form-001',
          enabled: true,
        },
        contact: {
          key: 'contact',
          label: '联系人',
          formCodeId: options.contactFormCodeId ?? null,
          enabled: true,
        },
        opportunity: {
          key: 'opportunity',
          label: '商机',
          formCodeId: options.opportunityFormCodeId ?? null,
          enabled: true,
        },
        followup: {
          key: 'followup',
          label: '商机跟进记录',
          formCodeId: options.followupFormCodeId ?? null,
          enabled: true,
        },
      },
    },
    server: {
      port: 3001,
    },
    storage: {
      sqlitePath: ':memory:',
    },
    meta: {
      configSource: '.env',
      envFilePath: '.env',
    },
  };
}

export function createInMemoryDatabase() {
  return openDatabase(':memory:');
}
