import assert from 'node:assert/strict';
import test from 'node:test';
import type { FetchLike } from '../src/contracts.js';
import { AppError } from '../src/errors.js';
import { ExternalSkillService } from '../src/external-skill-service.js';
import { createTestConfig } from './test-helpers.js';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

test('ExternalSkillService lists image skill as alert when api key is missing', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: null,
    }),
    fetchImpl: (async (input) => {
      const url = String(input);
      if (url.endsWith('/api/skills')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/api/models')) {
        return jsonResponse([
          { name: 'deepseek-v4-flash', label: 'deepseek-v4-flash', isDefault: true },
          { name: 'deepseek-v4-pro', label: 'deepseek-v4-pro', isDefault: false },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const skills = await service.listSkills();
  const imageSkill = skills.find((item) => item.skillCode === 'ext.image_generate');

  assert.ok(imageSkill);
  assert.equal(imageSkill.status, '告警中');
  assert.equal(imageSkill.implementationType, 'http_request');
  assert.equal(imageSkill.supportsInvoke, true);
  assert.equal(imageSkill.debugMode, 'image_generate');
});

test('ExternalSkillService merges runtime skills into external skill catalog', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async (input) => {
      const url = String(input);
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
            skillName: 'customer-needs-todo-analysis',
            status: 'blocked',
            supportsInvoke: false,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: ['env:DEEPSEEK_API_KEY'],
            summary: 'needs todo summary',
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
      if (url.endsWith('/api/models')) {
        return jsonResponse([
          { name: 'deepseek-v4-flash', label: 'deepseek-v4-flash', isDefault: true },
          { name: 'deepseek-v4-pro', label: 'deepseek-v4-pro', isDefault: false },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const skills = await service.listSkills();
  const companySkill = skills.find((item) => item.skillCode === 'ext.company_research_pm');
  const needsTodoSkill = skills.find((item) => item.skillCode === 'ext.customer_needs_todo_analysis');
  const superPptSkill = skills.find((item) => item.skillCode === 'ext.super_ppt');

  assert.ok(companySkill);
  assert.equal(companySkill.status, '运行中');
  assert.equal(companySkill.implementationType, 'skill');
  assert.equal(companySkill.supportsInvoke, true);
  assert.equal(companySkill.runtimeSkillName, 'company-research');
  assert.equal(companySkill.debugMode, 'skill_job');
  assert.equal(companySkill.debugConfig?.defaultModel, 'deepseek-v4-flash');

  assert.ok(needsTodoSkill);
  assert.equal(needsTodoSkill.status, '告警中');
  assert.deepEqual(needsTodoSkill.missingDependencies, ['env:DEEPSEEK_API_KEY']);
  assert.match(needsTodoSkill.summary, /缺少依赖/);

  assert.ok(superPptSkill);
  assert.equal(superPptSkill.status, '运行中');
  assert.equal(superPptSkill.provider, 'docmee-v2');
  assert.equal(superPptSkill.model, null);
  assert.equal(superPptSkill.debugConfig?.artifactKind, 'presentation');
  assert.deepEqual(superPptSkill.debugConfig?.supportedModels, []);
});

test('ExternalSkillService forwards runtime jobs and rewrites artifact download paths', async () => {
  let receivedTemplateId: string | undefined;
  const service = new ExternalSkillService({
    config: createTestConfig(),
    enterprisePptTemplateResolver: {
      getActiveTemplate: () => ({
        templateId: 'tpl-enterprise-001',
        name: '金蝶企业模板',
        sourceFileName: 'kingdee.pptx',
        isActive: true,
        createdAt: '2026-04-25T09:00:00.000Z',
        updatedAt: '2026-04-25T09:00:00.000Z',
      }),
      getDefaultPrompt: () => '企业默认 super-ppt 提示词',
    },
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { templateId?: string };
        receivedTemplateId = body.templateId;
        return jsonResponse({
          jobId: 'job-001',
          skillName: 'problem-statement',
          model: 'deepseek-v4-flash',
          status: 'queued',
          finalText: null,
          events: [],
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
          model: 'deepseek-v4-flash',
          status: 'succeeded',
          finalText: 'done',
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
        return new Response('# problem statement', {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown',
            'Content-Disposition': 'attachment; filename="problem-statement.md"',
          },
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const created = await service.createSkillJob('ext.problem_statement_pm', {
    requestText: '整理问题陈述',
  });
  assert.equal(created.skillCode, 'ext.problem_statement_pm');
  assert.equal(created.runtimeSkillName, 'problem-statement');

  const job = await service.getSkillJob('job-001');
  assert.equal(job.status, 'succeeded');
  assert.equal(job.artifacts[0]?.downloadPath, '/api/external-skills/jobs/job-001/artifacts/artifact-001');

  const artifact = await service.getSkillJobArtifact('job-001', 'artifact-001');
  assert.equal(artifact.artifact.fileName, 'problem-statement.md');
  assert.equal(artifact.content.toString('utf8'), '# problem statement');
  assert.equal(receivedTemplateId, undefined);
});

test('ExternalSkillService injects active enterprise template for ext.super_ppt jobs', async () => {
  let receivedTemplateId: string | undefined;
  let receivedPresentationPrompt: string | undefined;
  const service = new ExternalSkillService({
    config: createTestConfig(),
    enterprisePptTemplateResolver: {
      getActiveTemplate: () => ({
        templateId: 'tpl-enterprise-001',
        name: '金蝶企业模板',
        sourceFileName: 'kingdee.pptx',
        isActive: true,
        createdAt: '2026-04-25T09:00:00.000Z',
        updatedAt: '2026-04-25T09:00:00.000Z',
      }),
      getDefaultPrompt: () => '你是一位拥有10年以上科技行业经验的顶级PPT设计师和解决方案专家，擅长将复杂的技术概念转化为清晰、专业、具有说服力的演示内容。请根据我提供的主题和核心内容，生成一份高质量的科技行业PPT',
      getEffectivePrompt: () => '请基于完整材料生成专业科技行业管理层汇报PPT',
    },
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as {
          templateId?: string;
          presentationPrompt?: string;
        };
        receivedTemplateId = body.templateId;
        receivedPresentationPrompt = body.presentationPrompt;
        return jsonResponse({
          jobId: 'job-super-ppt-001',
          skillName: 'super-ppt',
          model: null,
          status: 'queued',
          finalText: null,
          events: [],
          artifacts: [],
          error: null,
          createdAt: '2026-04-25T10:00:00.000Z',
          updatedAt: '2026-04-25T10:00:00.000Z',
        }, 202);
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const created = await service.createSkillJob('ext.super_ppt', {
    requestText: '请基于附件生成研究汇报',
    attachments: ['/tmp/input.md'],
  });

  assert.equal(created.skillCode, 'ext.super_ppt');
  assert.equal(created.runtimeSkillName, 'super-ppt');
  assert.equal(receivedTemplateId, 'tpl-enterprise-001');
  assert.equal(receivedPresentationPrompt, '请基于完整材料生成专业科技行业管理层汇报PPT');
});

test('ExternalSkillService forwards presentation session creation', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig(),
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs/job-001/presentation-session') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-001',
          pptId: 'ppt-001',
          token: 'sk-session-001',
          subject: '绍兴贝斯美化工企业研究',
          animation: true,
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
          clientId: 'legacy-job-001',
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const session = await service.createPresentationSession('job-001');
  assert.equal(session.pptId, 'ppt-001');
  assert.equal(session.token, 'sk-session-001');
});

test('ExternalSkillService forwards forced presentation session refresh', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig(),
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs/job-001/presentation-session?refresh=1') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-001',
          pptId: 'ppt-001',
          token: 'sk-session-002',
          subject: '绍兴贝斯美化工企业研究',
          animation: true,
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
          clientId: 'legacy-job-001',
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const session = await service.createPresentationSession('job-001', {
    forceRefresh: true,
  });
  assert.equal(session.pptId, 'ppt-001');
  assert.equal(session.token, 'sk-session-002');
});

test('ExternalSkillService forwards open/heartbeat/close presentation session operations', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig(),
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs/job-001/presentation-session/open') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-001',
          pptId: 'ppt-001',
          token: 'sk-session-003',
          subject: '绍兴贝斯美化工企业研究',
          animation: false,
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
          clientId: 'client-a',
        });
      }
      if (url.endsWith('/api/jobs/job-001/presentation-session/heartbeat') && init?.method === 'POST') {
        return jsonResponse({
          status: 'ok',
          jobId: 'job-001',
          clientId: 'client-a',
          expiresAt: '2026-04-25T12:00:00.000Z',
          leaseExpireAt: '2026-04-25T11:31:30.000Z',
        });
      }
      if (url.endsWith('/api/jobs/job-001/presentation-session/close') && init?.method === 'POST') {
        return jsonResponse({
          status: 'closed',
          jobId: 'job-001',
          clientId: 'client-a',
          released: true,
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const opened = await service.openPresentationSession('job-001', {
    clientId: 'client-a',
    clientLabel: 'Chrome · client-a',
  });
  assert.equal(opened.statusCode, 200);
  assert.equal((opened.payload as { token: string }).token, 'sk-session-003');

  const heartbeat = await service.heartbeatPresentationSession('job-001', {
    clientId: 'client-a',
    clientLabel: 'Chrome · client-a',
  });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal((heartbeat.payload as { clientId: string }).clientId, 'client-a');

  const closed = await service.closePresentationSession('job-001', {
    clientId: 'client-a',
  });
  assert.equal(closed.statusCode, 200);
  assert.equal((closed.payload as { released: boolean }).released, true);
});

test('ExternalSkillService rejects image generation when api key is missing', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: null,
    }),
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张蓝色科技风封面图',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /EXT_IMAGE_API_KEY/);
      return true;
    },
  );
});

test('ExternalSkillService normalizes b64_json into previewDataUrl', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () =>
      jsonResponse({
        data: [
          {
            b64_json: 'ZmFrZS1pbWFnZS1iYXNlNjQ=',
            mime_type: 'image/png',
          },
        ],
      })) as FetchLike,
    now: () => new Date('2026-04-24T09:00:00.000Z'),
  });

  const payload = await service.generateImage({
    prompt: '生成一张橙色商务科技海报',
    size: '1536x1024',
    quality: 'high',
  });

  assert.equal(payload.skillCode, 'ext.image_generate');
  assert.equal(payload.model, 'gpt-image-2');
  assert.equal(payload.provider, 'linkapi_images_provider');
  assert.equal(payload.size, '1536x1024');
  assert.equal(payload.quality, 'high');
  assert.equal(payload.generatedAt, '2026-04-24T09:00:00.000Z');
  assert.match(payload.previewDataUrl, /^data:image\/png;base64,/);
});

test('ExternalSkillService surfaces upstream 401 errors as readable provider failures', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () =>
      jsonResponse(
        {
          error: {
            message: 'Invalid API key',
          },
        },
        401,
      )) as FetchLike,
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张蓝色商务插画',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Invalid API key/);
      return true;
    },
  );
});

test('ExternalSkillService surfaces upstream 500 errors as readable provider failures', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () =>
      jsonResponse(
        {
          message: 'upstream failed',
        },
        500,
      )) as FetchLike,
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张销售战报封面',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /upstream failed/);
      return true;
    },
  );
});

test('ExternalSkillService rejects empty image payloads', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () => jsonResponse({ data: [] })) as FetchLike,
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张销售活动主视觉',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /b64_json/);
      return true;
    },
  );
});

test('ExternalSkillService rejects non-json payloads', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () =>
      new Response('service unavailable', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain',
        },
      })) as FetchLike,
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张招商发布会海报',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /非 JSON/);
      return true;
    },
  );
});

test('ExternalSkillService maps provider timeouts to 504 errors', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: 'image-api-key',
    }),
    fetchImpl: (async () => {
      const error = new Error('request timeout');
      error.name = 'TimeoutError';
      throw error;
    }) as FetchLike,
  });

  await assert.rejects(
    service.generateImage({
      prompt: '生成一张季度复盘视觉图',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /超时/);
      return true;
    },
  );
});
