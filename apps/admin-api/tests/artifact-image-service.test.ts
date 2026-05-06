import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactImageRepository } from '../src/artifact-image-repository.js';
import { ArtifactImageService } from '../src/artifact-image-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type { AppConfig, ArtifactDetailResponse } from '../src/contracts.js';

function buildConfig(tempDir: string): AppConfig {
  const config = createTestConfig({
    imageApiKey: 'image-api-key',
  });
  return {
    ...config,
    meta: {
      ...config.meta,
      envFilePath: join(tempDir, '.env'),
    },
  };
}

function buildArtifactDetail(): ArtifactDetailResponse {
  return {
    artifact: {
      artifactId: 'artifact-001',
      versionId: 'version-001',
      version: 1,
      title: '上海松井机械有限公司 公司研究',
      sourceToolCode: 'ext.company_research_pm',
      vectorStatus: 'indexed',
      anchors: [
        {
          type: 'company',
          id: '上海松井机械有限公司',
          name: '上海松井机械有限公司',
          role: 'primary',
        },
      ],
      chunkCount: 4,
      createdAt: '2026-04-28T00:00:00.000Z',
      updatedAt: '2026-04-28T00:00:00.000Z',
    },
    markdown: '# 上海松井机械有限公司 公司研究\n\n## 公司概览\n测试内容',
  };
}

test('ArtifactImageService stores image binary on local filesystem and metadata in database', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-artifact-image-'));
  const database = createInMemoryDatabase();
  const detail = buildArtifactDetail();
  let generateCalls = 0;
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => detail,
    } as any,
    externalSkillService: {
      generateImage: async (input: any) => {
        generateCalls += 1;
        return {
          skillCode: 'ext.image_generate',
          model: 'gpt-image-2',
          provider: 'linkapi_images_provider',
          size: input.size,
          quality: input.quality,
          previewDataUrl: `data:image/png;base64,${Buffer.from(`fake-image-${generateCalls}`).toString('base64')}`,
          mimeType: 'image/png',
          latencyMs: 123,
          generatedAt: '2026-04-28T09:00:00.000Z',
        };
      },
    } as any,
  });

  try {
    const generated = await service.generateImage('artifact-001', {
      prompt: '生成一张公司研究配图',
      size: '1536x1024',
      quality: 'auto',
    });

    assert.equal(generated.status, 'succeeded');
    assert.equal(generated.prompt, '生成一张公司研究配图');
    assert.equal(generated.mimeType, 'image/png');
    assert.equal(generated.byteSize, Buffer.byteLength('fake-image-1'));
    assert.match(generated.previewUrl ?? '', /^\/api\/artifact-images\/.+\/file/);
    assert.match(generated.downloadPath ?? '', /download=1/);

    const imageFile = await service.getImageFile(generated.generationId!);
    assert.equal(imageFile.fileName, generated.fileName);
    assert.equal(imageFile.mimeType, 'image/png');
    assert.equal(imageFile.content.toString('utf8'), 'fake-image-1');

    const filePath = join(
      tempDir,
      'tmp/artifact-images/21024647/artifact-001',
      generated.fileName!,
    );
    assert.equal(readFileSync(filePath, 'utf8'), 'fake-image-1');

    const loaded = await service.getImage('artifact-001');
    assert.equal(loaded.status, 'succeeded');
    assert.equal(loaded.prompt, '生成一张公司研究配图');
    assert.equal(loaded.generationId, generated.generationId);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ArtifactImageService marks stale queued image generations as failed on status read', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-artifact-image-'));
  const database = createInMemoryDatabase();
  const detail = buildArtifactDetail();
  const config: AppConfig = {
    ...buildConfig(tempDir),
    external: {
      ...buildConfig(tempDir).external,
      image: {
        ...buildConfig(tempDir).external.image,
        timeoutMs: 1,
      },
    },
  };
  const repository = new ArtifactImageRepository(database);
  const service = new ArtifactImageService({
    config,
    repository,
    artifactService: {
      getArtifact: async () => detail,
    } as any,
    externalSkillService: {
      generateImage: async () => {
        throw new Error('should not generate during status read');
      },
    } as any,
  });

  try {
    await repository.reserve({
      eid: config.yzj.eid,
      appId: config.yzj.appId,
      artifactId: detail.artifact.artifactId,
      versionId: detail.artifact.versionId,
      title: detail.artifact.title,
      prompt: '生成一张公司研究配图',
      size: '1536x1024',
      quality: 'auto',
    });
    await database.query(
      `
        UPDATE ${database.table('artifact_image_generations')}
        SET updated_at = $1
        WHERE version_id = $2
      `,
      ['2026-04-28T00:00:00.000Z', detail.artifact.versionId],
    );

    const loaded = await service.getImage('artifact-001');

    assert.equal(loaded.status, 'failed');
    assert.equal(loaded.errorMessage, '图片生成任务超时或已中断，请重新生成');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
