import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactPresentationRepository } from '../src/artifact-presentation-repository.js';
import { ArtifactPresentationService } from '../src/artifact-presentation-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type {
  ArtifactDetailResponse,
  ExternalSkillJobResponse,
} from '../src/contracts.js';

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

function buildJob(status: ExternalSkillJobResponse['status']): ExternalSkillJobResponse {
  return {
    jobId: 'job-super-ppt-001',
    skillCode: 'ext.super_ppt',
    runtimeSkillName: 'super-ppt',
    model: null,
    status,
    finalText: null,
    events: [],
    artifacts: status === 'succeeded'
      ? [
          {
            artifactId: 'ppt-artifact-001',
            jobId: 'job-super-ppt-001',
            fileName: 'company-research.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            byteSize: 1024,
            createdAt: '2026-04-28T00:00:01.000Z',
            downloadPath: '/api/external-skills/jobs/job-super-ppt-001/artifacts/ppt-artifact-001',
          },
        ]
      : [],
    error: null,
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:01.000Z',
  };
}

test('ArtifactPresentationService reuses existing PPT generation for one markdown version', async () => {
  const database = createInMemoryDatabase();
  let createCalls = 0;
  const service = new ArtifactPresentationService({
    config: createTestConfig(),
    repository: new ArtifactPresentationRepository(database),
    artifactService: {
      getArtifact: async () => buildArtifactDetail(),
    } as any,
    externalSkillService: {
      createSkillJob: async () => {
        createCalls += 1;
        return buildJob('queued');
      },
      getSkillJob: async () => buildJob('succeeded'),
    } as any,
  });

  const first = await service.ensurePresentation('artifact-001');
  const second = await service.ensurePresentation('artifact-001');

  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.equal(second.pptArtifact?.artifactId, 'ppt-artifact-001');
  assert.equal(createCalls, 1);
});

test('ArtifactPresentationService allows retry after failed PPT generation', async () => {
  const database = createInMemoryDatabase();
  let createCalls = 0;
  const service = new ArtifactPresentationService({
    config: createTestConfig(),
    repository: new ArtifactPresentationRepository(database),
    artifactService: {
      getArtifact: async () => buildArtifactDetail(),
    } as any,
    externalSkillService: {
      createSkillJob: async () => {
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error('DOCMEE_API_KEY 未配置');
        }
        return buildJob('queued');
      },
      getSkillJob: async () => buildJob('succeeded'),
    } as any,
  });

  const failed = await service.ensurePresentation('artifact-001');
  const retried = await service.ensurePresentation('artifact-001');

  assert.equal(failed.status, 'failed');
  assert.match(failed.errorMessage ?? '', /DOCMEE_API_KEY/);
  assert.equal(retried.status, 'succeeded');
  assert.equal(createCalls, 2);
});
