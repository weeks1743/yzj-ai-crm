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
  imageBaseUrl?: string;
  imageApiKey?: string | null;
  imageModel?: string;
  imageTimeoutMs?: number;
  skillRuntimeBaseUrl?: string;
  docmeeBaseUrl?: string;
  docmeeApiKey?: string | null;
  mongodbUri?: string;
  mongodbDb?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string | null;
  qdrantCollectionName?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string | null;
  embeddingModel?: string;
  embeddingDimensions?: number;
  deepseekBaseUrl?: string;
  deepseekApiKey?: string | null;
  deepseekDefaultModel?: AppConfig['deepseek']['defaultModel'];
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
    docmee: {
      baseUrl: options.docmeeBaseUrl ?? 'https://open.docmee.cn',
      apiKey: options.docmeeApiKey ?? 'test-docmee-key',
    },
    storage: {
      sqlitePath: ':memory:',
      mongodbUri: options.mongodbUri ?? 'mongodb://127.0.0.1:27018',
      mongodbDb: options.mongodbDb ?? 'yzj_ai_crm_test',
    },
    qdrant: {
      url: options.qdrantUrl ?? 'http://127.0.0.1:6333',
      apiKey: options.qdrantApiKey ?? null,
      collectionName: options.qdrantCollectionName ?? 'yzj_artifact_chunks_test',
    },
    embedding: {
      baseUrl: options.embeddingBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: options.embeddingApiKey ?? null,
      model: options.embeddingModel ?? 'text-embedding-v4',
      dimensions: options.embeddingDimensions ?? 1024,
    },
    deepseek: {
      baseUrl: options.deepseekBaseUrl ?? 'https://api.deepseek.com',
      apiKey: options.deepseekApiKey ?? null,
      defaultModel: options.deepseekDefaultModel ?? 'deepseek-v4-flash',
    },
    external: {
      image: {
        baseUrl: options.imageBaseUrl ?? 'https://api.linkapi.org',
        apiKey: options.imageApiKey ?? null,
        model: options.imageModel ?? 'gpt-image-2',
        timeoutMs: options.imageTimeoutMs ?? 60000,
      },
      skillRuntime: {
        baseUrl: options.skillRuntimeBaseUrl ?? 'http://127.0.0.1:3012',
      },
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
