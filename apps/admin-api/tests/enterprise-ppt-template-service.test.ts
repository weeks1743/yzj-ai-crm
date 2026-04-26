import assert from 'node:assert/strict';
import test from 'node:test';
import type { FetchLike } from '../src/contracts.js';
import { DocmeeTemplateClient } from '../src/docmee-template-client.js';
import { EnterprisePptTemplateRepository } from '../src/enterprise-ppt-template-repository.js';
import { EnterprisePptTemplateService } from '../src/enterprise-ppt-template-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

test('EnterprisePptTemplateService manages upload, rename, activate, download, and delete flow', async () => {
  const seen: Array<{ url: string; method: string; bodyText?: string | null }> = [];
  const database = createInMemoryDatabase();
  const repository = new EnterprisePptTemplateRepository(database);
  const client = new DocmeeTemplateClient({
    baseUrl: 'https://docmee.example',
    apiKey: 'docmee-key',
    fetchImpl: (async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const bodyText = typeof init?.body === 'string' ? init.body : null;
      seen.push({ url, method, bodyText });

      if (url === 'https://docmee.example/api/user/createApiToken') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            token: 'docmee-token-001',
            expireTime: 3600,
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/uploadTemplate') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            id: 'tpl-001',
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/updateTemplate') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: true,
        });
      }

      if (url === 'https://docmee.example/api/ppt/updateUserTemplate') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: true,
        });
      }

      if (url === 'https://docmee.example/api/ppt/downloadTemplate') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            id: 'tpl-001',
            fileUrl: 'https://files.example/tpl-001.pptx',
          },
        });
      }

      if (url === 'https://files.example/tpl-001.pptx') {
        return new Response(Buffer.from('pptx-template-binary'), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/delTemplateId') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: true,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });
  const service = new EnterprisePptTemplateService({
    config: createTestConfig({
      docmeeBaseUrl: 'https://docmee.example',
      docmeeApiKey: 'docmee-key',
    }),
    repository,
    client,
  });

  assert.equal(
    service.getDefaultPrompt(),
    '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT',
  );
  const updatedPrompt = service.updateDefaultPrompt('请基于完整材料生成专业董事会汇报PPT');
  assert.equal(updatedPrompt.defaultPrompt, '请基于完整材料生成专业董事会汇报PPT');
  assert.equal(updatedPrompt.effectivePrompt, '请基于完整材料生成专业董事会汇报PPT');
  assert.equal(updatedPrompt.isFallbackApplied, false);
  assert.equal(service.listTemplates().defaultPrompt, '请基于完整材料生成专业董事会汇报PPT');
  assert.equal(service.getEffectivePrompt(), '请基于完整材料生成专业董事会汇报PPT');

  const uploadResult = await service.uploadTemplate({
    fileName: '金蝶ppt模板.pptx',
    file: Buffer.from('pptx-template-binary'),
  });
  assert.equal(uploadResult.item.templateId, 'tpl-001');
  assert.equal(uploadResult.item.name, '金蝶ppt模板');
  assert.equal(service.listTemplates().activeTemplate, null);

  const renameResult = await service.renameTemplate('tpl-001', '金蝶企业标准模板');
  assert.equal(renameResult.item.name, '金蝶企业标准模板');

  const activated = await service.activateTemplate('tpl-001');
  assert.equal(activated.item.isActive, true);
  assert.equal(service.getActiveTemplate()?.templateId, 'tpl-001');

  const downloaded = await service.downloadTemplate('tpl-001');
  assert.equal(downloaded.file.toString('utf8'), 'pptx-template-binary');
  assert.equal(downloaded.fileName, '金蝶ppt模板.pptx');

  const deleted = await service.deleteTemplate('tpl-001');
  assert.equal(deleted.deletedTemplateId, 'tpl-001');
  assert.equal(service.listTemplates().items.length, 0);
  assert.equal(service.getActiveTemplate(), null);

  assert.ok(
    seen.some(
      (item) =>
        item.url === 'https://docmee.example/api/ppt/updateTemplate'
        && item.bodyText?.includes('金蝶企业标准模板'),
    ),
  );
  assert.ok(
    seen.some(
      (item) =>
        item.url === 'https://docmee.example/api/ppt/updateUserTemplate'
        && item.bodyText?.includes('"isPublic":true'),
    ),
  );
});

test('EnterprisePptTemplateService exposes fallback info for historical overlong prompts and rejects new overlong values', () => {
  const database = createInMemoryDatabase();
  const repository = new EnterprisePptTemplateRepository(database);
  repository.updateDefaultPrompt(
    '你是一位拥有10年以上科技行业经验的顶级PPT设计师和解决方案专家，擅长将复杂的技术概念转化为清晰、专业、具有说服力的演示内容。请根据我提供的主题和核心内容，生成一份高质量的科技行业PPT',
  );

  const service = new EnterprisePptTemplateService({
    config: createTestConfig({
      docmeeBaseUrl: 'https://docmee.example',
      docmeeApiKey: 'docmee-key',
    }),
    repository,
    client: null,
  });

  const state = service.getPromptState();
  assert.equal(state.isFallbackApplied, true);
  assert.equal(state.effectivePrompt, '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT');
  assert.match(state.fallbackReason || '', /50 字限制/);

  assert.throws(
    () => {
      service.updateDefaultPrompt(
        '你是一位拥有10年以上科技行业经验的顶级PPT设计师和解决方案专家，擅长将复杂的技术概念转化为清晰、专业、具有说服力的演示内容。请根据我提供的主题和核心内容，生成一份高质量的科技行业PPT',
      );
    },
    /不能超过 50 个字符/,
  );
});
