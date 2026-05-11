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
            skillName: 'yunzhijia-visit-prep',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DEEPSEEK_API_KEY'],
            missingDependencies: [],
            summary: 'visit prep summary',
          },
          {
            skillName: 'report-generation',
            status: 'available',
            supportsInvoke: true,
            requiredDependencies: ['env:DASHSCOPE_API_KEY', 'env:REPORT_CANVAS_SERVICE_BASE_URL'],
            missingDependencies: [],
            summary: 'report summary',
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
  const visitPrepSkill = skills.find((item) => item.skillCode === 'ext.yunzhijia_visit_prep');
  const reportSkill = skills.find((item) => item.skillCode === 'ext.report_generation');

  assert.ok(companySkill);
  assert.equal(companySkill.status, '运行中');
  assert.equal(companySkill.implementationType, 'skill');
  assert.equal(companySkill.supportsInvoke, true);
  assert.equal(companySkill.runtimeSkillName, 'company-research');
  assert.equal(companySkill.debugMode, 'skill_job');
  assert.equal(companySkill.debugConfig?.defaultModel, 'deepseek-v4-flash');
  assert.equal(companySkill.assetMaterialization?.enabled, true);
  assert.equal(companySkill.assetMaterialization?.artifactKind, 'company_research');

  assert.ok(needsTodoSkill);
  assert.equal(needsTodoSkill.status, '告警中');
  assert.deepEqual(needsTodoSkill.missingDependencies, ['env:DEEPSEEK_API_KEY']);
  assert.match(needsTodoSkill.summary, /缺少依赖/);
  assert.equal(needsTodoSkill.assetMaterialization?.enabled, true);
  assert.equal(needsTodoSkill.assetMaterialization?.artifactKind, 'analysis_material');

  assert.ok(visitPrepSkill);
  assert.equal(visitPrepSkill.status, '运行中');
  assert.equal(visitPrepSkill.implementationType, 'skill');
  assert.equal(visitPrepSkill.supportsInvoke, true);
  assert.equal(visitPrepSkill.runtimeSkillName, 'yunzhijia-visit-prep');
  assert.equal(visitPrepSkill.debugMode, 'skill_job');
  assert.equal(visitPrepSkill.debugConfig?.artifactKind, 'markdown');
  assert.equal(visitPrepSkill.assetMaterialization?.enabled, true);
  assert.equal(visitPrepSkill.assetMaterialization?.artifactKind, 'analysis_material');
  assert.equal(service.getSkillAssetMaterialization('ext.yunzhijia_visit_prep')?.enabled, true);
  assert.equal(service.getSkillAssetMaterialization('ext.yunzhijia_visit_prep')?.artifactKind, 'analysis_material');

  assert.ok(reportSkill);
  assert.equal(reportSkill.status, '运行中');
  assert.equal(reportSkill.implementationType, 'skill');
  assert.equal(reportSkill.runtimeSkillName, 'report-generation');
  assert.equal(reportSkill.debugConfig?.artifactKind, 'report');
  assert.equal(reportSkill.debugConfig?.defaultModel, null);
  assert.deepEqual(reportSkill.debugConfig?.supportedModels, []);
  assert.equal(reportSkill.model, null);
  assert.equal(skills.some((item) => item.skillCode === 'ext.super_ppt'), false);
  assert.equal(skills.some((item) => item.skillCode === 'ext.audio_transcribe'), false);
});

test('ExternalSkillService forwards runtime jobs and rewrites artifact download paths', async () => {
  let receivedBody: Record<string, unknown> | undefined;
  const service = new ExternalSkillService({
    config: createTestConfig(),
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/jobs') && init?.method === 'POST') {
        receivedBody = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          jobId: 'job-001',
          skillName: 'customer-value-positioning',
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
          skillName: 'customer-value-positioning',
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
              fileName: 'customer-value-positioning.md',
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
        return new Response('# customer value positioning', {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown',
            'Content-Disposition': 'attachment; filename="customer-value-positioning.md"',
          },
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as FetchLike,
  });

  const created = await service.createSkillJob('ext.customer_value_positioning_pm', {
    requestText: '整理客户价值定位',
  });
  assert.equal(created.skillCode, 'ext.customer_value_positioning_pm');
  assert.equal(created.runtimeSkillName, 'customer-value-positioning');

  const job = await service.getSkillJob('job-001');
  assert.equal(job.status, 'succeeded');
  assert.equal(job.artifacts[0]?.downloadPath, '/api/external-skills/jobs/job-001/artifacts/artifact-001');

  const artifact = await service.getSkillJobArtifact('job-001', 'artifact-001');
  assert.equal(artifact.artifact.fileName, 'customer-value-positioning.md');
  assert.equal(artifact.content.toString('utf8'), '# customer value positioning');
  assert.deepEqual(receivedBody, {
    skillName: 'customer-value-positioning',
    requestText: '整理客户价值定位',
  });
});

test('ExternalSkillService lists runtime jobs for downstream recording repair', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig(),
    fetchImpl: (async (input) => {
      const url = String(input);
      assert.match(url, /\/api\/jobs\?/);
      assert.match(url, /skillName=customer-value-positioning/);
      assert.match(url, /status=succeeded/);
      assert.match(url, /query=%E8%B4%9D%E6%96%AF%E7%BE%8E/);
      return jsonResponse({
        page: 1,
        pageSize: 25,
        total: 1,
        jobs: [
          {
            jobId: 'job-value-001',
            skillName: 'customer-value-positioning',
            model: 'deepseek-v4-flash',
            status: 'succeeded',
            finalText: '# 客户价值定位',
            events: [],
            artifacts: [],
            error: null,
            createdAt: '2026-05-08T10:00:00.000Z',
            updatedAt: '2026-05-08T10:01:00.000Z',
          },
        ],
      });
    }) as FetchLike,
  });

  const result = await service.listSkillJobs({
    skillCode: 'ext.customer_value_positioning_pm',
    status: 'succeeded',
    query: '贝斯美',
    pageSize: 25,
  });

  assert.equal(result.total, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0]?.skillCode, 'ext.customer_value_positioning_pm');
  assert.equal(result.jobs[0]?.runtimeSkillName, 'customer-value-positioning');
});

test('ExternalSkillService rejects removed super-ppt skill code', async () => {
  const service = new ExternalSkillService({
    config: createTestConfig(),
  });

  await assert.rejects(
    () => service.createSkillJob('ext.super_ppt', {
      requestText: '请基于附件生成研究汇报',
      attachments: ['/tmp/input.md'],
    }),
    /不存在该能力/,
  );
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
