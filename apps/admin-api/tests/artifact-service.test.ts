import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkMarkdown } from '../src/artifact-chunker.js';
import { ArtifactService } from '../src/artifact-service.js';
import type { ArtifactVectorStatus } from '../src/contracts.js';
import { createTestConfig } from './test-helpers.js';

test('chunkMarkdown prefers markdown headings and keeps chunk indexes stable', () => {
  const chunks = chunkMarkdown(`# 公司概览
这是一段概览。

## 风险
${'风险描述。'.repeat(220)}

## 机会
机会描述。`);

  assert.ok(chunks.length >= 2);
  assert.deepEqual(
    chunks.map((item) => item.chunkIndex),
    chunks.map((_, index) => index),
  );
  assert.ok(chunks.some((item) => item.heading === '风险'));
});

test('createCompanyResearchArtifact saves markdown when embedding key is missing', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const artifact = {
    artifactId: 'artifact-001',
    versionId: 'version-001',
    version: 1,
    title: '星海精工股份 公司研究',
    sourceToolCode: 'ext.company_research',
    vectorStatus: 'pending_embedding' as ArtifactVectorStatus,
    anchors: [{ type: 'company' as const, id: '星海精工股份', role: 'primary' as const }],
    chunkCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const saved = {
    artifact,
    markdown: '# 星海精工股份\n\n公司正在推进产线升级。',
    eid: config.yzj.eid,
    appId: config.yzj.appId,
  };
  const repository = {
    saveCompanyResearchArtifact: async () => saved,
    updateVectorStatus: async (
      _artifactId: string,
      _versionId: string,
      vectorStatus: ArtifactVectorStatus,
      chunkCount: number,
    ) => ({
      ...artifact,
      vectorStatus,
      chunkCount,
    }),
  };
  const service = new ArtifactService({
    config,
    repository: repository as any,
    embeddingService: {
      isConfigured: () => false,
      embedTexts: async () => {
        throw new Error('should not embed without key');
      },
    } as any,
    vectorService: {
      buildFilter: () => ({ must: [] }),
      upsertChunks: async () => {
        throw new Error('should not upsert without embedding');
      },
      search: async () => [],
    } as any,
  });

  const result = await service.createCompanyResearchArtifact({
    title: artifact.title,
    markdown: saved.markdown,
    sourceToolCode: artifact.sourceToolCode,
    anchors: artifact.anchors,
  });

  assert.equal(result.artifact.vectorStatus, 'pending_config');
  assert.equal(result.artifact.chunkCount, 1);
});

test('createCompanyResearchArtifact upserts qdrant payload with tenant and anchors', async () => {
  const config = createTestConfig({ embeddingApiKey: 'test-key', embeddingDimensions: 3 });
  const artifact = {
    artifactId: 'artifact-002',
    versionId: 'version-002',
    version: 1,
    title: '远澜生物科技 公司研究',
    sourceToolCode: 'ext.company_research',
    vectorStatus: 'pending_embedding' as ArtifactVectorStatus,
    anchors: [{ type: 'company' as const, id: '远澜生物科技', role: 'primary' as const }],
    chunkCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let upsertInput: any = null;
  const service = new ArtifactService({
    config,
    repository: {
      saveCompanyResearchArtifact: async () => ({
        artifact,
        markdown: '# 远澜生物科技\n\n关注信息化预算。',
        eid: config.yzj.eid,
        appId: config.yzj.appId,
      }),
      updateVectorStatus: async (
        _artifactId: string,
        _versionId: string,
        vectorStatus: ArtifactVectorStatus,
        chunkCount: number,
      ) => ({
        ...artifact,
        vectorStatus,
        chunkCount,
      }),
    } as any,
    embeddingService: {
      isConfigured: () => true,
      embedTexts: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    } as any,
    vectorService: {
      buildFilter: () => ({ must: [] }),
      upsertChunks: async (input: any) => {
        upsertInput = input;
      },
      search: async () => [],
    } as any,
  });

  const result = await service.createCompanyResearchArtifact({
    title: artifact.title,
    markdown: '# 远澜生物科技\n\n关注信息化预算。',
    sourceToolCode: artifact.sourceToolCode,
    anchors: artifact.anchors,
  });

  assert.equal(result.artifact.vectorStatus, 'indexed');
  assert.equal(upsertInput.eid, config.yzj.eid);
  assert.equal(upsertInput.appId, config.yzj.appId);
  assert.deepEqual(upsertInput.anchors, artifact.anchors);
  assert.equal(upsertInput.chunks.length, 1);
});
