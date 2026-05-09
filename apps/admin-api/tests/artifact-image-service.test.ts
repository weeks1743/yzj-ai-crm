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
    markdown: [
      '# 上海松井机械有限公司 公司研究',
      '',
      '> **研究日期：** 2026年4月28日',
      '> **数据截至：** 2025年年报',
      '> **研究目的：** 了解公司业务结构',
      '',
      '---',
      '',
      '## 公司概览',
      '测试内容',
      '',
      '## 业务定位',
      '主营业务需要进入图片生成上下文。',
      '',
      '## 核心风险',
      '风险判断不能被摘要片段裁掉。',
      '',
      '## 来源引用',
      '- 官网：https://example.com/company',
    ].join('\n'),
  };
}

function extractPromptMarkdown(prompt: string): string {
  const startMarker = prompt.includes('资料原文（已去除元信息、来源引用和内部提醒，控制在3800字以内）：\n')
    ? '资料原文（已去除元信息、来源引用和内部提醒，控制在3800字以内）：\n'
    : '资料原文（已去除元信息和来源引用，控制在3800字以内）：\n';
  const start = prompt.indexOf(startMarker);
  const end = prompt.indexOf('\n\n画面要求：', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return prompt.slice(start + startMarker.length, end);
}

test('ArtifactImageService stores image binary on local filesystem and metadata in database', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-artifact-image-'));
  const database = createInMemoryDatabase();
  const detail = buildArtifactDetail();
  let generateCalls = 0;
  let capturedPrompt = '';
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => detail,
    } as any,
    externalSkillService: {
      generateImage: async (input: any) => {
        generateCalls += 1;
        capturedPrompt = input.prompt;
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
      size: '1536x1024',
      quality: 'auto',
    });

    assert.equal(generated.status, 'succeeded');
    assert.match(generated.prompt ?? '', /Markdown 正文/);
    assert.match(generated.prompt ?? '', /## 公司概览\n测试内容/);
    assert.match(generated.prompt ?? '', /## 业务定位\n主营业务需要进入图片生成上下文。/);
    assert.match(generated.prompt ?? '', /## 核心风险\n风险判断不能被摘要片段裁掉。/);
    const promptMarkdown = extractPromptMarkdown(generated.prompt ?? '');
    assert.doesNotMatch(promptMarkdown, /研究日期|数据截至|研究目的/);
    assert.doesNotMatch(promptMarkdown, /来源引用|example\.com/);
    assert.equal(capturedPrompt, generated.prompt);
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
    assert.equal(loaded.prompt, generated.prompt);
    assert.equal(loaded.generationId, generated.generationId);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ArtifactImageService trims image prompt markdown metadata, references, and length', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-artifact-image-'));
  const database = createInMemoryDatabase();
  const detail = {
    ...buildArtifactDetail(),
    markdown: [
      '# 上海松井机械有限公司 公司研究',
      '',
      '> **研究日期：** 2026年4月28日',
      '> **数据截至：** 2025年年报',
      '> **研究目的：** 了解公司业务结构',
      '',
      '---',
      '',
      '## 一、公司概览',
      '主营业务需要进入图片生成上下文。',
      '',
      '## 二、成长驱动',
      Array.from({ length: 90 }, (_, index) => `成长驱动${index + 1}：销售图需要聚焦业务价值、增长逻辑、行业洞察和推进策略。`).join('\n'),
      '',
      '## 六、来源引用',
      '| 序号 | 来源 | 链接 | 引用日期 |',
      '|---|---|---|---|',
      '| 1 | 官网 | https://example.com/company | 2026-04-28 |',
      '',
      '*本报告基于公开信息整理，仅供参考，不构成投资建议。*',
    ].join('\n'),
  };
  let capturedPrompt = '';
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => detail,
    } as any,
    externalSkillService: {
      generateImage: async (input: any) => {
        capturedPrompt = input.prompt;
        return {
          skillCode: 'ext.image_generate',
          model: 'gpt-image-2',
          provider: 'linkapi_images_provider',
          size: input.size,
          quality: input.quality,
          previewDataUrl: `data:image/png;base64,${Buffer.from('fake-image').toString('base64')}`,
          mimeType: 'image/png',
          latencyMs: 123,
          generatedAt: '2026-04-28T09:00:00.000Z',
        };
      },
    } as any,
  });

  try {
    await service.generateImage('artifact-001', {
      size: '1536x1024',
      quality: 'auto',
    });

    const promptMarkdown = extractPromptMarkdown(capturedPrompt);
    assert.ok(Array.from(promptMarkdown).length <= 3800);
    assert.match(promptMarkdown, /主营业务需要进入图片生成上下文。/);
    assert.doesNotMatch(promptMarkdown, /研究日期|数据截至|研究目的/);
    assert.doesNotMatch(promptMarkdown, /来源引用|example\.com|不构成投资建议/);
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
      appId: config.yzj.lightCloud.appId,
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

test('ArtifactImageService rejects image generation when artifact markdown is empty', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-artifact-image-'));
  const database = createInMemoryDatabase();
  const detail = {
    ...buildArtifactDetail(),
    markdown: '   ',
  };
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => detail,
    } as any,
    externalSkillService: {
      generateImage: async () => {
        throw new Error('should not call image provider without research markdown');
      },
    } as any,
  });

  try {
    await assert.rejects(
      service.generateImage('artifact-001', {
        size: '1536x1024',
        quality: 'auto',
      }),
      /Markdown 资料为空，无法生成图片/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ArtifactImageService generates image from runtime markdown without materializing asset', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-markdown-image-'));
  const database = createInMemoryDatabase();
  let capturedPrompt = '';
  let artifactServiceCalls = 0;
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => {
        artifactServiceCalls += 1;
        return buildArtifactDetail();
      },
    } as any,
    externalSkillService: {
      generateImage: async (input: any) => {
        capturedPrompt = input.prompt;
        return {
          skillCode: 'ext.image_generate',
          model: 'gpt-image-2',
          provider: 'linkapi_images_provider',
          size: input.size,
          quality: input.quality,
          previewDataUrl: `data:image/png;base64,${Buffer.from('runtime-markdown-image').toString('base64')}`,
          mimeType: 'image/png',
          latencyMs: 456,
          generatedAt: '2026-04-28T09:30:00.000Z',
        };
      },
    } as any,
  });

  try {
    const generated = await service.generateMarkdownImage({
      title: 'yunzhijia-visit-prep-job.md',
      markdown: [
        '# 绍兴贝斯美化工股份有限公司 拜访准备',
        '',
        '本报告基于贝斯美化工公开研究资料及云之家产品能力库生成，供销售拜访前内部参考。',
        '',
        '## 客户画像',
        '贝斯美是农药中间体和环保配套业务相关客户，图片需要保留这些业务洞察。',
        '',
        '## 方案匹配',
        '- 围绕统一门户、流程审批、移动协同展开价值讲解。',
        '',
        '⚠️ 本文档中标注"待销售确认"的内容，拜访前/拜访中请务必与客户核实确认。',
        '',
        '## 待销售确认',
        '- 具体组织架构待确认。',
      ].join('\n'),
      size: '1536x1024',
      quality: 'auto',
    });

    assert.equal(artifactServiceCalls, 0);
    assert.equal(generated.title, 'yunzhijia-visit-prep-job.md');
    assert.equal(generated.mimeType, 'image/png');
    assert.equal(generated.byteSize, Buffer.byteLength('runtime-markdown-image'));
    assert.match(generated.fileName, /^yunzhijia-visit-prep-job_md-[0-9a-f]{8}\.png$/);
    assert.equal(generated.downloadDataUrl, generated.previewDataUrl);

    const promptMarkdown = extractPromptMarkdown(capturedPrompt);
    assert.match(promptMarkdown, /## 客户画像/);
    assert.match(promptMarkdown, /图片需要保留这些业务洞察/);
    assert.match(promptMarkdown, /## 方案匹配/);
    assert.doesNotMatch(promptMarkdown, /本报告基于|产品能力库|内部参考/);
    assert.doesNotMatch(promptMarkdown, /待销售确认|待确认|核实确认/);
    assert.doesNotMatch(capturedPrompt, /待销售确认|待确认|核实确认|免责声明/);

    const stored = await database.query(`SELECT * FROM ${database.table('artifact_image_generations')}`);
    assert.equal(stored.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ArtifactImageService rejects runtime markdown image generation when markdown is empty', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-markdown-image-'));
  const database = createInMemoryDatabase();
  const service = new ArtifactImageService({
    config: buildConfig(tempDir),
    repository: new ArtifactImageRepository(database),
    artifactService: {
      getArtifact: async () => buildArtifactDetail(),
    } as any,
    externalSkillService: {
      generateImage: async () => {
        throw new Error('should not call image provider without markdown');
      },
    } as any,
  });

  try {
    await assert.rejects(
      service.generateMarkdownImage({
        title: 'empty.md',
        markdown: '   ',
      }),
      /Markdown 内容为空，无法生成图片/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
