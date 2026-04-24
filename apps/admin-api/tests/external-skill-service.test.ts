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

test('ExternalSkillService lists image skill as alert when api key is missing', () => {
  const service = new ExternalSkillService({
    config: createTestConfig({
      imageApiKey: null,
    }),
  });

  const skills = service.listSkills();
  const imageSkill = skills.find((item) => item.skillCode === 'ext.image_generate');

  assert.ok(imageSkill);
  assert.equal(imageSkill.status, '告警中');
  assert.equal(imageSkill.implementationType, 'http_request');
  assert.equal(imageSkill.supportsInvoke, true);
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
