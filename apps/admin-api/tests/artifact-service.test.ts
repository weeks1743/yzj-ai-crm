import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkMarkdown } from '../src/artifact-chunker.js';
import { buildAnchorIdentity } from '../src/artifact-repository.js';
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

test('buildAnchorIdentity keeps recording and analysis artifacts stable by formal anchors', () => {
  const anchors = [
    { type: 'source_file' as const, id: 'md5-bsm', role: 'source' as const },
    { type: 'customer' as const, id: 'customer-bsm', role: 'primary' as const },
    { type: 'opportunity' as const, id: 'opportunity-bsm', role: 'related' as const },
    { type: 'followup' as const, id: 'followup-bsm', role: 'related' as const },
  ];

  assert.equal(
    buildAnchorIdentity(anchors, { kind: 'recording_material', sourceToolCode: 'tongyi.audio.recording_material' }),
    'recording_material:followup:followup-bsm:source_file:md5-bsm',
  );
  assert.equal(
    buildAnchorIdentity(anchors, {
      kind: 'analysis_material',
      sourceToolCode: 'ext.problem_statement_pm',
      metadata: { skillCode: 'ext.problem_statement_pm' },
    }),
    'analysis_material:followup:followup-bsm:skill:ext.problem_statement_pm',
  );
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

test('findLatestCompanyResearchArtifact returns latest valid markdown by company anchor', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  let lookupInput: any = null;
  const service = new ArtifactService({
    config,
    repository: {
      findLatestCompanyResearchArtifactByAnchor: async (input: any) => {
        lookupInput = input;
        return {
          artifact: {
            artifactId: 'artifact-songjing-001',
            versionId: 'version-songjing-002',
            version: 2,
            title: '上海松井机械有限公司 公司研究',
            sourceToolCode: 'ext.company_research_pm',
            vectorStatus: 'indexed',
            anchors: [{ type: 'company', id: '上海松井机械有限公司', role: 'primary' }],
            chunkCount: 3,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          markdown: '# 上海松井机械有限公司\n\n## 研究摘要\n已有有效研究。',
        };
      },
    } as any,
    embeddingService: {
      isConfigured: () => false,
      embedTexts: async () => {
        throw new Error('should not embed during lookup');
      },
    } as any,
    vectorService: {
      buildFilter: () => ({ must: [] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during lookup');
      },
      search: async () => [],
    } as any,
  });

  const result = await service.findLatestCompanyResearchArtifact({
    companyName: ' 上海松井机械有限公司 ',
  });

  assert.equal(lookupInput.eid, config.yzj.eid);
  assert.equal(lookupInput.appId, config.yzj.appId);
  assert.equal(lookupInput.companyName, '上海松井机械有限公司');
  assert.equal(result?.artifact.artifactId, 'artifact-songjing-001');
});

test('findLatestCompanyResearchArtifact ignores empty markdown result', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const service = new ArtifactService({
    config,
    repository: {
      findLatestCompanyResearchArtifactByAnchor: async () => ({
        artifact: {
          artifactId: 'artifact-empty-001',
          versionId: 'version-empty-001',
          version: 1,
          title: '空结果 公司研究',
          sourceToolCode: 'ext.company_research_pm',
          vectorStatus: 'indexed',
          anchors: [{ type: 'company', id: '空结果', role: 'primary' }],
          chunkCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        markdown: '   ',
      }),
    } as any,
    embeddingService: {
      isConfigured: () => false,
      embedTexts: async () => {
        throw new Error('should not embed during lookup');
      },
    } as any,
    vectorService: {
      buildFilter: () => ({ must: [] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during lookup');
      },
      search: async () => [],
    } as any,
  });

  const result = await service.findLatestCompanyResearchArtifact({
    companyName: '空结果',
  });

  assert.equal(result, null);
});

test('search keeps vector evidence when exact anchor search returns results', async () => {
  const config = createTestConfig({ embeddingApiKey: 'test-key', embeddingDimensions: 3 });
  let metadataFallbackCalled = false;
  const service = new ArtifactService({
    config,
    repository: {
      findCompanyResearchArtifactsByMetadata: async () => {
        metadataFallbackCalled = true;
        return [];
      },
    } as any,
    embeddingService: {
      isConfigured: () => true,
      embedTexts: async () => [[0.1, 0.2, 0.3]],
    } as any,
    vectorService: {
      buildFilter: () => ({ must: ['anchor-filter'] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during search');
      },
      search: async () => [{
        artifactId: 'artifact-vector-001',
        versionId: 'version-vector-001',
        title: '江苏友升汽车科技有限公司 公司研究',
        version: 1,
        sourceToolCode: 'ext.company_research_pm',
        anchorTypes: ['company'],
        anchorIds: ['江苏友升汽车科技有限公司'],
        snippet: '向量检索命中的公开资料片段。',
        score: 0.91,
      }],
    } as any,
  });

  const result = await service.search({
    query: '江苏友升有什么业务',
    anchors: [{ type: 'company', id: '江苏友升汽车科技有限公司', role: 'primary' }],
  });

  assert.equal(result.vectorStatus, 'searched');
  assert.equal(result.evidence[0]?.artifactId, 'artifact-vector-001');
  assert.equal(metadataFallbackCalled, false);
});

test('search falls back to metadata artifact when abbreviation anchor has no vector result', async () => {
  const config = createTestConfig({ embeddingApiKey: 'test-key', embeddingDimensions: 3 });
  let metadataInput: any = null;
  const service = new ArtifactService({
    config,
    repository: {
      findCompanyResearchArtifactsByMetadata: async (input: any) => {
        metadataInput = input;
        return [buildArtifactDetail('江苏友升汽车科技有限公司', '001')];
      },
    } as any,
    embeddingService: {
      isConfigured: () => true,
      embedTexts: async () => [[0.1, 0.2, 0.3]],
    } as any,
    vectorService: {
      buildFilter: () => ({ must: ['anchor-filter'] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during search');
      },
      search: async () => [],
    } as any,
  });

  const result = await service.search({
    query: '介绍江苏友升的业务',
    anchors: [{ type: 'company', id: '江苏友升', role: 'primary' }],
  });

  assert.equal(metadataInput.eid, config.yzj.eid);
  assert.equal(metadataInput.appId, config.yzj.appId);
  assert.deepEqual(metadataInput.terms, ['江苏友升']);
  assert.equal(result.vectorStatus, 'searched');
  assert.equal(result.evidence[0]?.title, '江苏友升汽车科技有限公司 公司研究');
  assert.equal(result.evidence[0]?.anchorIds[0], '江苏友升汽车科技有限公司');
  assert.match(result.evidence[0]?.snippet ?? '', /汽车零部件|轻量化/);
});

test('search returns metadata fallback when embedding is not configured', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const service = new ArtifactService({
    config,
    repository: {
      findCompanyResearchArtifactsByMetadata: async () => [buildArtifactDetail('江苏友升汽车科技有限公司', '002')],
    } as any,
    embeddingService: {
      isConfigured: () => false,
      embedTexts: async () => {
        throw new Error('should not embed without config');
      },
    } as any,
    vectorService: {
      buildFilter: () => ({ must: ['tenant-filter'] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during search');
      },
      search: async () => {
        throw new Error('should not vector search without embedding');
      },
    } as any,
  });

  const result = await service.search({
    query: '江苏友升有什么业务',
    anchors: [{ type: 'company', id: '江苏友升', role: 'primary' }],
  });

  assert.equal(result.vectorStatus, 'pending_config');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.title, '江苏友升汽车科技有限公司 公司研究');
});

test('search returns multiple metadata fallback artifacts for ambiguous abbreviation', async () => {
  const config = createTestConfig({ embeddingApiKey: 'test-key', embeddingDimensions: 3 });
  const service = new ArtifactService({
    config,
    repository: {
      findCompanyResearchArtifactsByMetadata: async () => [
        buildArtifactDetail('江苏友升汽车科技有限公司', '003'),
        buildArtifactDetail('江苏友升装备有限公司', '004'),
      ],
    } as any,
    embeddingService: {
      isConfigured: () => true,
      embedTexts: async () => [[0.1, 0.2, 0.3]],
    } as any,
    vectorService: {
      buildFilter: () => ({ must: ['anchor-filter'] }),
      upsertChunks: async () => {
        throw new Error('should not upsert during search');
      },
      search: async () => [],
    } as any,
  });

  const result = await service.search({
    query: '江苏友升有什么业务',
    anchors: [{ type: 'company', id: '江苏友升', role: 'primary' }],
  });

  assert.equal(result.evidence.length, 2);
  assert.deepEqual(
    result.evidence.map((item) => item.title),
    ['江苏友升汽车科技有限公司 公司研究', '江苏友升装备有限公司 公司研究'],
  );
});

function buildArtifactDetail(companyName: string, suffix: string) {
  return {
    artifact: {
      artifactId: `artifact-${suffix}`,
      versionId: `version-${suffix}`,
      version: 1,
      title: `${companyName} 公司研究`,
      sourceToolCode: 'ext.company_research_pm',
      vectorStatus: 'indexed' as ArtifactVectorStatus,
      anchors: [{ type: 'company' as const, id: companyName, name: companyName, role: 'primary' as const }],
      chunkCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    markdown: `# ${companyName}

## 公司概览
${companyName} 公开资料显示，其业务围绕汽车零部件、轻量化制造和客户配套展开。

## 业务定位
重点关注轻量化材料、制造协同和供应链响应能力。`,
  };
}
