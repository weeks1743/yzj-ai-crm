import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactReportRepository } from '../src/artifact-report-repository.js';
import { ArtifactReportService } from '../src/artifact-report-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type {
  ArtifactDetailResponse,
  ExternalSkillJobResponse,
} from '../src/contracts.js';

function buildArtifactDetail(input: Partial<ArtifactDetailResponse['artifact']> = {}): ArtifactDetailResponse {
  return {
    artifact: {
      artifactId: 'artifact-001',
      versionId: 'version-001',
      version: 1,
      kind: 'company_research',
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
      ...input,
    },
    markdown: '# 上海松井机械有限公司 公司研究\n\n## 公司概览\n测试内容',
  };
}

function buildJob(status: ExternalSkillJobResponse['status']): ExternalSkillJobResponse {
  return {
    jobId: 'job-report-001',
    skillCode: 'ext.report_generation',
    runtimeSkillName: 'report-generation',
    model: null,
    status,
    finalText: status === 'succeeded'
      ? '报告已生成：https://report.example/embed/rpt_001'
      : null,
    events: status === 'succeeded'
      ? [
          {
            id: 'event-report-ready-001',
            type: 'report_ready',
            message: '报告已生成，可在新页面打开',
            data: {
              sessionId: 'rpt_001',
              transientSessionId: 'rpt_001',
              subject: '上海松井机械有限公司 公司研究',
              openUrl: 'https://report.example/embed/rpt_001',
              transientOpenUrl: 'https://report.example/embed/rpt_001',
              artifactId: 'artifact-metadata-001',
              codeArtifactId: 'artifact-code-001',
              metadataArtifactId: 'artifact-metadata-001',
              generatedAt: '2026-04-28T00:00:01.000Z',
              codeLength: 4096,
            },
            createdAt: '2026-04-28T00:00:01.000Z',
          },
        ]
      : [],
    artifacts: [],
    error: null,
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:01.000Z',
  };
}

test('ArtifactReportService reuses existing report generation for one company research version', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yzj-artifact-report-'));
  try {
    const database = createInMemoryDatabase();
    const createdAttachments: string[][] = [];
    let createCalls = 0;
    const service = new ArtifactReportService({
      config: createTestConfig({ envFilePath: join(tempDir, '.env') }),
      repository: new ArtifactReportRepository(database),
      artifactService: {
        getArtifact: async () => buildArtifactDetail(),
      } as any,
      externalSkillService: {
        createSkillJob: async (_skillCode: string, input: { attachments?: string[] }) => {
          createCalls += 1;
          createdAttachments.push(input.attachments ?? []);
          return buildJob('queued');
        },
        getSkillJob: async () => buildJob('succeeded'),
        getSkillJobArtifact: async (_jobId: string, artifactId: string) => ({
          artifact: {
            artifactId,
            jobId: 'job-report-001',
            fileName: 'report.jsx',
            mimeType: 'text/plain',
            byteSize: 64,
            createdAt: '2026-04-28T00:00:01.000Z',
            downloadPath: '/api/jobs/job-report-001/artifacts/artifact-code-001',
          },
          content: Buffer.from('export default function Report() { return <div>persisted</div>; }', 'utf8'),
        }),
      } as any,
    });

    const first = await service.ensureReport('artifact-001');
    const second = await service.ensureReport('artifact-001');

    assert.equal(first.status, 'succeeded');
    assert.equal(second.status, 'succeeded');
    assert.equal(second.reportSessionId, 'rpt_001');
    assert.equal(second.openUrl, '/api/artifacts/artifact-001/report/open');
    assert.equal(second.codeArtifactId, 'artifact-code-001');
    assert.equal(second.metadataArtifactId, 'artifact-metadata-001');
    assert.equal(second.isPersistent, true);
    assert.equal(createdAttachments.length, 1);
    assert.equal(createdAttachments[0]?.length, 1);
    assert.match(
      createdAttachments[0]?.[0] ?? '',
      /\.local\/skill-runtime-inputs\/artifact-report-inputs\/version-001-[a-f0-9]{12}\.md$/,
    );
    assert.equal(readFileSync(createdAttachments[0]![0]!, 'utf8'), buildArtifactDetail().markdown);
    const code = await service.getReportCode('artifact-001');
    assert.match(code.code, /persisted/);
    assert.equal(code.report.openUrl, '/api/artifacts/artifact-001/report/open');
    assert.equal(createCalls, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('ArtifactReportService allows retry after failed report generation', async () => {
  const database = createInMemoryDatabase();
  let createCalls = 0;
  const service = new ArtifactReportService({
    config: createTestConfig(),
    repository: new ArtifactReportRepository(database),
    artifactService: {
      getArtifact: async () => buildArtifactDetail(),
    } as any,
    externalSkillService: {
      createSkillJob: async () => {
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error('报告生成服务当前不可达');
        }
        return buildJob('queued');
      },
      getSkillJob: async () => buildJob('succeeded'),
      getSkillJobArtifact: async () => {
        throw new Error('unexpected artifact read');
      },
    } as any,
  });

  const failed = await service.ensureReport('artifact-001');
  const retried = await service.ensureReport('artifact-001');

  assert.equal(failed.status, 'failed');
  assert.match(failed.errorMessage ?? '', /报告生成服务当前不可达/);
  assert.equal(retried.status, 'succeeded');
  assert.equal(createCalls, 2);
});

test('ArtifactReportService reports legacy transient-only reports as requiring regeneration', async () => {
  const database = createInMemoryDatabase();
  const repository = new ArtifactReportRepository(database);
  const service = new ArtifactReportService({
    config: createTestConfig(),
    repository,
    artifactService: {
      getArtifact: async () => buildArtifactDetail(),
    } as any,
    externalSkillService: {
      createSkillJob: async () => buildJob('queued'),
      getSkillJob: async () => buildJob('queued'),
      getSkillJobArtifact: async () => {
        throw new Error('unexpected artifact read');
      },
    } as any,
  });

  await repository.reserve({
    artifactId: 'artifact-001',
    versionId: 'version-001',
    title: '上海松井机械有限公司 公司研究',
  });
  await repository.updateStatus({
    versionId: 'version-001',
    status: 'succeeded',
    reportSessionId: 'rpt_legacy',
    openUrl: 'https://report.example/embed/rpt_legacy',
    metadata: {
      sessionId: 'rpt_legacy',
    },
  });

  const report = await service.getReport('artifact-001');
  assert.equal(report.status, 'succeeded');
  assert.equal(report.isPersistent, false);
  assert.match(report.errorMessage ?? '', /请重新生成报告/);
  await assert.rejects(
    () => service.getReportCode('artifact-001'),
    /请重新生成报告/,
  );
});

test('ArtifactReportService only accepts company research markdown artifacts', async () => {
  const database = createInMemoryDatabase();
  const service = new ArtifactReportService({
    config: createTestConfig(),
    repository: new ArtifactReportRepository(database),
    artifactService: {
      getArtifact: async () => buildArtifactDetail({
        kind: 'analysis_material',
      }),
    } as any,
    externalSkillService: {
      createSkillJob: async () => buildJob('queued'),
      getSkillJob: async () => buildJob('succeeded'),
    } as any,
  });

  await assert.rejects(
    () => service.ensureReport('artifact-001'),
    /当前仅支持基于公司研究 Markdown 生成报告/,
  );
});
