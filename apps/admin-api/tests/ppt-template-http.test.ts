import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { FetchLike } from '../src/contracts.js';
import { createAdminApiServer } from '../src/app.js';
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

test('HTTP ppt-template endpoints support upload, activate, download, and delete', async () => {
  const database = createInMemoryDatabase();
  const repository = new EnterprisePptTemplateRepository(database);
  const client = new DocmeeTemplateClient({
    baseUrl: 'https://docmee.example',
    apiKey: 'docmee-key',
    fetchImpl: (async (input) => {
      const url = String(input);

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
            id: 'tpl-http-001',
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
            id: 'tpl-http-001',
            fileUrl: 'https://files.example/tpl-http-001.pptx',
          },
        });
      }

      if (url === 'https://files.example/tpl-http-001.pptx') {
        return new Response(Buffer.from('pptx-http-binary'), {
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
  const enterprisePptTemplateService = new EnterprisePptTemplateService({
    config: createTestConfig({
      docmeeBaseUrl: 'https://docmee.example',
      docmeeApiKey: 'docmee-key',
    }),
    repository,
    client,
  });
  const server = createAdminApiServer({
    config: createTestConfig({
      docmeeBaseUrl: 'https://docmee.example',
      docmeeApiKey: 'docmee-key',
    }),
    orgSyncService: {
      getSettings: () => ({}),
      startManualSync: () => ({}),
    } as never,
    shadowMetadataService: {
      listObjects: () => [],
    } as never,
    approvalFileService: {
      uploadFile: async () => ({}),
    } as never,
    externalSkillService: {
      listSkills: async () => [],
      generateImage: async () => ({}),
      createSkillJob: async () => ({}),
      getSkillJob: async () => ({}),
      getSkillJobArtifact: async () => ({ artifact: { mimeType: 'text/plain', fileName: 'x', byteSize: 1 }, content: Buffer.from('x') }),
      createPresentationSession: async () => ({}),
    } as never,
    enterprisePptTemplateService,
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const formData = new FormData();
    formData.set(
      'file',
      new Blob([Buffer.from('pptx-http-binary')], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
      '金蝶ppt模板.pptx',
    );

    const uploadResponse = await fetch(`${baseUrl}/api/settings/ppt-templates/upload`, {
      method: 'POST',
      body: formData,
    });
    assert.equal(uploadResponse.status, 201);
    const uploadPayload = await uploadResponse.json() as { item: { templateId: string; sourceFileName: string } };
    assert.equal(uploadPayload.item.templateId, 'tpl-http-001');
    assert.equal(uploadPayload.item.sourceFileName, '金蝶ppt模板.pptx');

    const listResponse = await fetch(`${baseUrl}/api/settings/ppt-templates`);
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      items: Array<{ templateId: string }>;
      activeTemplate: null;
      defaultPrompt: string;
      effectivePrompt: string;
      isFallbackApplied: boolean;
    };
    assert.equal(listPayload.items.length, 1);
    assert.equal(listPayload.activeTemplate, null);
    assert.equal(listPayload.defaultPrompt, '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT');
    assert.equal(listPayload.effectivePrompt, '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT');
    assert.equal(listPayload.isFallbackApplied, false);

    const promptResponse = await fetch(`${baseUrl}/api/settings/ppt-templates/default-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '请基于完整材料生成专业科技行业汇报PPT',
      }),
    });
    assert.equal(promptResponse.status, 200);
    const promptPayload = await promptResponse.json() as {
      defaultPrompt: string;
      effectivePrompt: string;
      isFallbackApplied: boolean;
    };
    assert.equal(promptPayload.defaultPrompt, '请基于完整材料生成专业科技行业汇报PPT');
    assert.equal(promptPayload.effectivePrompt, '请基于完整材料生成专业科技行业汇报PPT');
    assert.equal(promptPayload.isFallbackApplied, false);

    const activateResponse = await fetch(`${baseUrl}/api/settings/ppt-templates/tpl-http-001/activate`, {
      method: 'POST',
    });
    assert.equal(activateResponse.status, 200);
    const activatePayload = await activateResponse.json() as { item: { isActive: boolean } };
    assert.equal(activatePayload.item.isActive, true);

    const downloadResponse = await fetch(`${baseUrl}/api/settings/ppt-templates/tpl-http-001/download`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(await downloadResponse.text(), 'pptx-http-binary');

    const deleteResponse = await fetch(`${baseUrl}/api/settings/ppt-templates/tpl-http-001/delete`, {
      method: 'POST',
    });
    assert.equal(deleteResponse.status, 200);

    const finalListResponse = await fetch(`${baseUrl}/api/settings/ppt-templates`);
    const finalListPayload = await finalListResponse.json() as {
      items: unknown[];
      activeTemplate: null;
      defaultPrompt: string;
      effectivePrompt: string;
    };
    assert.equal(finalListPayload.items.length, 0);
    assert.equal(finalListPayload.activeTemplate, null);
    assert.equal(finalListPayload.defaultPrompt, '请基于完整材料生成专业科技行业汇报PPT');
    assert.equal(finalListPayload.effectivePrompt, '请基于完整材料生成专业科技行业汇报PPT');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
