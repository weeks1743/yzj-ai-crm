import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { RecordingTaskRecord } from '../src/recording-task-repository.js';
import { RecordingTaskService } from '../src/recording-task-service.js';
import { createTestConfig } from './test-helpers.js';

test('materializeTask only writes temporary consumable markdown before formal followup archive', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const record: RecordingTaskRecord = {
    taskId: 'recording-task-001',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-001',
    providerDataId: 'EV5',
    fixtureTaskId: 'EV5',
    status: 'succeeded',
    file: {
      fileName: 'visit.m4a',
      mimeType: 'audio/mp4',
      size: 123,
      md5: 'md5-recording-001',
    },
    anchors: { customer: '星海精工', opportunity: 'MES 试点' },
    servicePayload: {},
    artifactId: null,
    materialPath: null,
    materialSource: null,
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let attachCalled = false;
  const repository = {
    getTask: async () => record,
    updateFromService: async (input: any) => {
      Object.assign(record, {
        status: input.status,
        providerDataId: input.providerDataId,
        fixtureTaskId: input.fixtureTaskId,
        anchors: input.anchors ?? record.anchors,
        servicePayload: input.servicePayload,
        materialPath: input.materialPath ?? record.materialPath,
        materialSource: input.materialSource ?? record.materialSource,
        errorMessage: input.errorMessage ?? null,
      });
      return record;
    },
    attachArtifact: async (input: any) => {
      attachCalled = true;
      record.artifactId = input.artifactId;
      record.materialPath = input.materialPath;
      record.materialSource = input.materialSource;
      return record;
    },
  };
  const service = new RecordingTaskService({
    config,
    repository: repository as any,
    client: {
      getTask: async () => ({
        taskId: 'audio-task-001',
        provider: 'tongyi-tingwu',
        status: 'succeeded',
        providerDataId: 'EV5',
        fixtureTaskId: 'EV5',
        file: record.file,
        anchors: record.anchors,
        stages: [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
      materialize: async () => ({
        taskId: 'audio-task-001',
        provider: 'tongyi-tingwu',
        status: 'succeeded',
        providerDataId: 'EV5',
        fixtureTaskId: 'EV5',
        file: record.file,
        anchors: record.anchors,
        stages: [],
        material: {
          available: true,
          path: '/tmp/recording-material.md',
          source: 'generated',
          markdown: '# 录音资料包\n\n## 会话摘要\n客户关注预算与审批。',
          excludedProcessFiles: [
            'transcription.json',
            'translations.json',
            'textPolish.json',
          ],
        },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    } as any,
    artifactService: {
      createRecordingMaterialArtifact: async (input: any) => {
        throw new Error(`should not persist temporary material: ${input.title}`);
      },
    } as any,
  });

  const response = await service.materializeTask(record.taskId);

  assert.equal(response.material.artifactId, undefined);
  assert.equal(response.material.available, true);
  assert.equal(response.material.path, '/tmp/recording-material.md');
  assert.equal(response.archive?.status, 'unarchived');
  assert.equal(record.artifactId, null);
  assert.equal(attachCalled, false);
  assert.doesNotMatch(
    response.material.markdown,
    /transcription\.json|translations\.json|textPolish\.json/,
  );
});

test('archiveTask saves recording_material only after followup commit with formal anchors', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const record: RecordingTaskRecord = {
    taskId: 'recording-task-archive',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-archive',
    providerDataId: 'DATA-ARCHIVE',
    fixtureTaskId: null,
    status: 'succeeded',
    file: {
      fileName: '贝斯美拜访.mp3',
      mimeType: 'audio/mpeg',
      size: 456,
      md5: 'md5-archive',
    },
    anchors: {},
    servicePayload: {},
    artifactId: null,
    materialPath: '/tmp/tongyi/md5-archive/recording-material.md',
    materialSource: 'generated',
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let artifactInput: any = null;
  const service = new RecordingTaskService({
    config,
    repository: {
      getTask: async () => record,
      updateFromService: async (input: any) => {
        Object.assign(record, {
          status: input.status,
          providerDataId: input.providerDataId ?? record.providerDataId,
          fixtureTaskId: input.fixtureTaskId ?? record.fixtureTaskId,
          anchors: input.anchors ?? record.anchors,
          servicePayload: input.servicePayload,
          materialPath: input.materialPath ?? record.materialPath,
          materialSource: input.materialSource ?? record.materialSource,
          errorMessage: input.errorMessage ?? null,
        });
        return record;
      },
      attachArtifact: async (input: any) => {
        record.artifactId = input.artifactId;
        record.materialPath = input.materialPath;
        record.materialSource = input.materialSource;
        record.servicePayload = input.servicePayload;
        return record;
      },
    } as any,
    client: {
      getTask: async () => ({
        taskId: 'audio-task-archive',
        provider: 'tongyi-tingwu',
        status: 'succeeded',
        providerDataId: 'DATA-ARCHIVE',
        fixtureTaskId: null,
        file: record.file,
        anchors: record.anchors,
        stages: [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
      materialize: async (input: any) => ({
        taskId: 'audio-task-archive',
        provider: 'tongyi-tingwu',
        status: 'succeeded',
        providerDataId: 'DATA-ARCHIVE',
        fixtureTaskId: null,
        file: record.file,
        anchors: input.anchors,
        stages: [],
        material: {
          available: true,
          path: '/tmp/tongyi/md5-archive/recording-material.md',
          source: 'generated',
          markdown: '# 录音资料包\n\n## 会话摘要\n客户确认预算窗口和试点范围。',
          excludedProcessFiles: ['transcription.json', 'translations.json', 'textPolish.json'],
        },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    } as any,
    artifactService: {
      createRecordingMaterialArtifact: async (input: any) => {
        artifactInput = input;
        return {
          artifact: {
            artifactId: 'artifact-recording-archive',
            versionId: 'version-recording-archive',
            version: 1,
            kind: 'recording_material',
            title: input.title,
            sourceToolCode: input.sourceToolCode,
            vectorStatus: 'pending_config',
            anchors: input.anchors,
            chunkCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
    } as any,
  });

  const response = await service.archiveTask({
    taskId: record.taskId,
    customerId: 'customer-bsm-001',
    opportunityId: 'opportunity-bsm-001',
    followupId: 'followup-bsm-001',
  });

  assert.equal(response.material?.artifactId, 'artifact-recording-archive');
  assert.equal(response.archive?.status, 'archived');
  assert.equal(response.archive?.followupId, 'followup-bsm-001');
  assert.equal(response.archive?.customerId, 'customer-bsm-001');
  assert.equal(response.archive?.opportunityId, 'opportunity-bsm-001');
  assert.equal(artifactInput.sourceToolCode, 'tongyi.audio.recording_material');
  assert.equal(artifactInput.recordingTaskId, record.taskId);
  assert.deepEqual(
    artifactInput.anchors.map((item: any) => `${item.type}:${item.id}:${item.bindingStatus ?? ''}`),
    [
      'source_file:md5-archive:',
      'customer:customer-bsm-001:bound',
      'opportunity:opportunity-bsm-001:bound',
      'followup:followup-bsm-001:bound',
    ],
  );
  assert.doesNotMatch(artifactInput.markdown, /transcription\.json|translations\.json|textPolish\.json/);
});

test('requestArchiveTask stores pending archive when recording is not complete', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const record: RecordingTaskRecord = {
    taskId: 'recording-task-pending-archive',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-pending-archive',
    providerDataId: 'DATA-PENDING',
    fixtureTaskId: null,
    status: 'running',
    file: {
      fileName: '贝斯美拜访.mp3',
      mimeType: 'audio/mpeg',
      size: 456,
      md5: 'md5-pending-archive',
    },
    anchors: {},
    servicePayload: {},
    artifactId: null,
    materialPath: null,
    materialSource: null,
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const service = new RecordingTaskService({
    config,
    repository: {
      getTask: async () => record,
      updateFromService: async (input: any) => {
        Object.assign(record, {
          status: input.status,
          providerDataId: input.providerDataId ?? record.providerDataId,
          fixtureTaskId: input.fixtureTaskId ?? record.fixtureTaskId,
          anchors: input.anchors ?? record.anchors,
          servicePayload: input.servicePayload,
          materialPath: input.materialPath ?? record.materialPath,
          materialSource: input.materialSource ?? record.materialSource,
          errorMessage: input.errorMessage ?? null,
        });
        return record;
      },
    } as any,
    client: {
      getTask: async () => ({
        taskId: record.serviceTaskId,
        provider: 'tongyi-tingwu',
        status: 'running',
        providerDataId: record.providerDataId,
        fixtureTaskId: null,
        file: record.file,
        anchors: record.anchors,
        stages: [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    } as any,
    artifactService: {
      createRecordingMaterialArtifact: async () => {
        throw new Error('should not archive before task succeeds');
      },
    } as any,
  });

  const response = await service.requestArchiveTask({
    taskId: record.taskId,
    customerId: 'customer-bsm-001',
    opportunityId: 'opportunity-bsm-001',
    followupId: 'followup-bsm-001',
    createdBy: 'operator-001',
  });

  assert.equal(response.archive?.status, 'pending');
  assert.equal(response.archive?.customerId, 'customer-bsm-001');
  assert.equal(response.archive?.opportunityId, 'opportunity-bsm-001');
  assert.equal(response.archive?.followupId, 'followup-bsm-001');
  assert.deepEqual(record.anchors, {
    customer: 'customer-bsm-001',
    opportunity: 'opportunity-bsm-001',
    followup: 'followup-bsm-001',
  });
  assert.deepEqual((record.servicePayload.pendingArchive as any).customerId, 'customer-bsm-001');
});

test('requestArchiveTask repairs downstream analysis for already archived recording association', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-archived-repair-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注采购、合同和费用报销断点。', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-archived-repair',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-archived-repair',
      providerDataId: 'DATA-ARCHIVED-REPAIR',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 456,
        md5: 'md5-archived-repair',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {
        archivedArtifactId: 'artifact-recording-formal',
        archivedFollowupId: 'followup-bsm-001',
      },
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const skillRequests: Array<{ skillCode: string; input: any }> = [];
    const analysisInputs: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async (input: any) => {
          record.materialPath = input.materialPath ?? record.materialPath;
          record.materialSource = input.materialSource ?? record.materialSource;
          record.servicePayload = input.servicePayload ?? record.servicePayload;
          return record;
        },
        attachArtifact: async () => {
          throw new Error('already archived recording should not rewrite recording artifact');
        },
      } as any,
      client: {
        getTask: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
        materialize: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: `artifact-${input.skillCode}` } };
        },
      } as any,
      externalSkillService: {
        listSkillJobs: async (input: any) => {
          if (input.status === 'succeeded' && input.query === record.file.fileName) {
            return {
              page: 1,
              pageSize: 25,
              total: 1,
              jobs: [
                {
                  jobId: 'job-old-problem-001',
                  skillCode: 'ext.problem_statement_pm',
                  runtimeSkillName: 'problem-statement',
                  model: 'deepseek-v4-flash',
                  status: 'succeeded',
                  finalText: '# 问题陈述\n\n旧分析已完成，客户关注采购、合同和费用报销断点。',
                  events: [],
                  artifacts: [],
                  error: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            };
          }
          return { page: 1, pageSize: 25, total: 0, jobs: [] };
        },
        createSkillJob: async (skillCode: string, input: any) => {
          skillRequests.push({ skillCode, input });
          return {
            jobId: `job-rerun-${skillCode}`,
            skillCode,
            runtimeSkillName: 'problem-statement',
            model: 'deepseek-v4-flash',
            status: 'succeeded',
            finalText: '# 问题陈述\n\n客户需要解决采购、合同和费用报销流程断点。',
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      } as any,
    });

    const response = await service.requestArchiveTask({
      taskId: record.taskId,
      customerId: record.anchors.customer!,
      opportunityId: record.anchors.opportunity!,
      followupId: record.anchors.followup!,
      createdBy: 'operator-001',
    });

    assert.equal(response.archive?.status, 'archived');
    assert.equal(skillRequests.length, 1);
    assert.equal(skillRequests[0].skillCode, 'ext.problem_statement_pm');
    assert.match(skillRequests[0].input.requestText, /正式客户、商机和跟进记录锚点/);
    assert.equal(analysisInputs.length, 1);
    assert.equal(analysisInputs[0].skillCode, 'ext.problem_statement_pm');
    assert.deepEqual(
      analysisInputs[0].anchors.map((item: any) => `${item.type}:${item.id}:${item.bindingStatus ?? ''}`),
      [
        'source_file:md5-archived-repair:',
        'customer:customer-bsm-001:bound',
        'opportunity:opportunity-bsm-001:bound',
        'followup:followup-bsm-001:bound',
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uploadTask falls back to completed md5 cache when audio service sync is unavailable', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const content = Buffer.from('same mp3 bytes');
  const md5 = '1db4760d0720e8749f4199c5c4ceb332';
  const cachedRecord: RecordingTaskRecord = {
    taskId: 'recording-task-cached',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-cached',
    providerDataId: 'cached-data-id',
    fixtureTaskId: null,
    status: 'succeeded',
    file: {
      fileName: 'visit.mp3',
      mimeType: 'audio/mpeg',
      size: content.byteLength,
      md5,
    },
    anchors: { customer: '星海精工' },
    servicePayload: {},
    artifactId: 'artifact-recording-cached',
    materialPath: '/tmp/recording-material.md',
    materialSource: 'generated',
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let lookupHash = '';
  let serviceUploadCalled = false;
  const service = new RecordingTaskService({
    config,
    repository: {
      findByFileHash: async (input: any) => {
        lookupHash = input.md5;
        return cachedRecord;
      },
    } as any,
    client: {
      uploadTask: async () => {
        serviceUploadCalled = true;
        throw new Error('audio service unavailable');
      },
      getTask: async () => {
        throw new Error('should not refresh completed cached artifact');
      },
    } as any,
    artifactService: {} as any,
  });

  const response = await service.uploadTask({
    fileName: 'visit-again.mp3',
    mimeType: 'audio/mpeg',
    content,
  });

  assert.equal(lookupHash, md5);
  assert.equal(serviceUploadCalled, false);
  assert.equal(response.taskId, cachedRecord.taskId);
  assert.equal(response.material?.artifactId, 'artifact-recording-cached');
});

test('uploadTask reuses completed md5 cache without creating a new provider task', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const content = Buffer.from('same mp3 bytes');
  const md5 = '1db4760d0720e8749f4199c5c4ceb332';
  const cachedRecord: RecordingTaskRecord = {
    taskId: 'recording-task-cached',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-old',
    providerDataId: 'pqngDD3wjSwf',
    fixtureTaskId: null,
    status: 'succeeded',
    file: {
      fileName: 'visit.mp3',
      mimeType: 'audio/mpeg',
      size: content.byteLength,
      md5,
    },
    anchors: {},
    servicePayload: {},
    artifactId: 'artifact-old',
    materialPath: '/tmp/old/recording-material.md',
    materialSource: 'generated',
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let replacementInput: any = null;
  let serviceUploadCalled = false;
  const service = new RecordingTaskService({
    config,
    repository: {
      findByFileHash: async () => cachedRecord,
      replaceFromService: async (input: any) => {
        replacementInput = input;
        Object.assign(cachedRecord, {
          serviceTaskId: input.serviceTaskId,
          providerDataId: input.providerDataId ?? null,
          fixtureTaskId: input.fixtureTaskId ?? null,
          status: input.status,
          file: input.file,
          anchors: input.anchors,
          servicePayload: input.servicePayload,
          artifactId: null,
          materialPath: input.materialPath ?? null,
          materialSource: input.materialSource ?? null,
          errorMessage: input.errorMessage ?? null,
        });
        return cachedRecord;
      },
    } as any,
    client: {
      uploadTask: async () => {
        serviceUploadCalled = true;
        throw new Error('should not create a new provider task for completed md5 cache');
      },
      getTask: async () => {
        throw new Error('should not refresh completed cached artifact');
      },
    } as any,
    artifactService: {} as any,
  });

  const response = await service.uploadTask({
    fileName: '贝斯美拜访.mp3',
    mimeType: 'audio/mpeg',
    content,
  });

  assert.equal(replacementInput, null);
  assert.equal(serviceUploadCalled, false);
  assert.equal(response.providerDataId, 'pqngDD3wjSwf');
  assert.equal(response.fixtureTaskId ?? null, null);
  assert.equal(response.material?.artifactId, 'artifact-old');
});

test('uploadTask restarts failed md5 cache instead of returning stale dependency error', async () => {
  const config = createTestConfig({ embeddingApiKey: null });
  const content = Buffer.from('same mp3 bytes');
  const md5 = '1db4760d0720e8749f4199c5c4ceb332';
  const failedRecord: RecordingTaskRecord = {
    taskId: 'recording-task-failed',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-old-failed',
    providerDataId: null,
    fixtureTaskId: null,
    status: 'failed',
    file: {
      fileName: 'visit.mp3',
      mimeType: 'audio/mpeg',
      size: content.byteLength,
      md5,
    },
    anchors: {},
    servicePayload: {
      errorMessage: '缺少 dashscope 依赖，请先安装 requirements.txt',
    },
    artifactId: null,
    materialPath: null,
    materialSource: null,
    errorMessage: '缺少 dashscope 依赖，请先安装 requirements.txt',
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let providerUploadCalled = false;
  let replacementInput: any = null;
  const service = new RecordingTaskService({
    config,
    repository: {
      findByFileHash: async () => failedRecord,
      replaceFromService: async (input: any) => {
        replacementInput = input;
        Object.assign(failedRecord, {
          serviceTaskId: input.serviceTaskId,
          status: input.status,
          file: input.file,
          anchors: input.anchors,
          servicePayload: input.servicePayload,
          errorMessage: input.errorMessage ?? null,
          materialPath: input.materialPath ?? null,
          materialSource: input.materialSource ?? null,
        });
        return failedRecord;
      },
    } as any,
    client: {
      uploadTask: async () => {
        providerUploadCalled = true;
        return {
          taskId: 'audio-task-retry',
          provider: 'tongyi-tingwu',
          status: 'running',
          file: {
            fileName: 'visit-retry.mp3',
            mimeType: 'audio/mpeg',
            size: content.byteLength,
            md5,
          },
          anchors: {},
          stages: [],
          material: { available: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    } as any,
    artifactService: {} as any,
  });

  const response = await service.uploadTask({
    fileName: 'visit-retry.mp3',
    mimeType: 'audio/mpeg',
    content,
  });

  assert.equal(providerUploadCalled, true);
  assert.equal(replacementInput.serviceTaskId, 'audio-task-retry');
  assert.equal(response.taskId, failedRecord.taskId);
  assert.equal(response.serviceTaskId, 'audio-task-retry');
  assert.equal(response.status, 'running');
  assert.equal(response.errorMessage, null);
});

test('getMeetingViewerUrl redirects completed task to provider or fixture viewer id', async () => {
  const config = createTestConfig({
    embeddingApiKey: null,
    tongyiAudioServiceBaseUrl: 'http://127.0.0.1:3018/',
  });
  const record: RecordingTaskRecord = {
    taskId: 'recording-task-viewer',
    eid: config.yzj.eid,
    appId: config.yzj.lightCloud.appId,
    serviceTaskId: 'audio-task-viewer',
    providerDataId: 'pqngDD3wjSwf',
    fixtureTaskId: 'EV5TddyrE5zM',
    status: 'succeeded',
    file: {
      fileName: 'visit.mp3',
      mimeType: 'audio/mpeg',
      size: 123,
      md5: 'md5-viewer',
    },
    anchors: {},
    servicePayload: {},
    artifactId: null,
    materialPath: null,
    materialSource: null,
    errorMessage: null,
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const service = new RecordingTaskService({
    config,
    repository: {
      getTask: async () => record,
    } as any,
    client: {
      getTask: async () => {
        throw new Error('audio service offline during viewer url lookup');
      },
    } as any,
    artifactService: {} as any,
  });

  const url = await service.getMeetingViewerUrl(record.taskId);

  assert.equal(url, 'http://127.0.0.1:3018/meeting-viewer/?task=EV5TddyrE5zM');
});

test('createSkillJob sends structured Tongyi analysis JSON before recording markdown', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-material-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注预算。', 'utf8');
    const assetsDir = join(tempDir, 'assets');
    mkdirSync(assetsDir);
    const mindMapPath = join(assetsDir, 'mindMapSummary.json');
    const summarizationPath = join(assetsDir, 'summarization.json');
    const meetingAssistancePath = join(assetsDir, 'meetingAssistance.json');
    const autoChaptersPath = join(assetsDir, 'autoChapters.json');
    writeFileSync(mindMapPath, '{"mindMapSummary":[{"title":"预算审批"}]}', 'utf8');
    writeFileSync(summarizationPath, '{"paragraphSummary":"客户关注预算和试点推进。"}', 'utf8');
    writeFileSync(meetingAssistancePath, '{"keywords":["预算","试点"]}', 'utf8');
    writeFileSync(autoChaptersPath, '[{"headline":"确认试点范围"}]', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-skill',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-skill',
      providerDataId: 'DATA-SKILL',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: 'visit.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-skill',
      },
      anchors: { customer: '星海精工', opportunity: 'MES 试点' },
      servicePayload: {},
      artifactId: 'artifact-recording',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let receivedSkillCode = '';
    let receivedInput: any = null;
    let materializeInput: any = null;
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async (input: any) => {
          Object.assign(record, {
            status: input.status,
            providerDataId: input.providerDataId ?? record.providerDataId,
            fixtureTaskId: input.fixtureTaskId ?? record.fixtureTaskId,
            anchors: input.anchors ?? record.anchors,
            servicePayload: input.servicePayload,
            materialPath: input.materialPath ?? record.materialPath,
            materialSource: input.materialSource ?? record.materialSource,
            errorMessage: input.errorMessage ?? null,
          });
          return record;
        },
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during skill job lookup');
        },
        materialize: async (input: any) => {
          materializeInput = input;
          return {
            taskId: 'audio-task-skill',
            provider: 'tongyi-tingwu',
            status: 'succeeded',
            providerDataId: 'DATA-SKILL',
            fixtureTaskId: null,
            file: record.file,
            anchors: record.anchors,
            stages: [],
            material: {
              available: true,
              path: materialPath,
              source: 'generated',
              markdown: '# 录音资料包\n\n## 会话摘要\n客户关注预算和试点推进。',
            },
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
        },
      } as any,
      artifactService: {} as any,
      externalSkillService: {
        createSkillJob: async (skillCode: string, input: any) => {
          receivedSkillCode = skillCode;
          receivedInput = input;
          return {
            jobId: 'job-recording-skill',
            skillCode,
            runtimeSkillName: 'customer-needs-todo-analysis',
            model: 'deepseek-v4-flash',
            status: 'queued',
            finalText: null,
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      } as any,
    });

    const response = await service.createSkillJob(record.taskId, {
      skillCode: 'ext.customer_needs_todo_analysis',
    });

    assert.equal(response.jobId, 'job-recording-skill');
    assert.equal(materializeInput.preferredSource, 'generated');
    assert.equal(receivedSkillCode, 'ext.customer_needs_todo_analysis');
    assert.deepEqual(receivedInput.attachments, [
      mindMapPath,
      summarizationPath,
      meetingAssistancePath,
      autoChaptersPath,
      materialPath,
    ]);
    assert.match(receivedInput.requestText, /客户需求工作待办分析/);
    assert.match(receivedInput.requestText, /通义结构化分析 JSON/);
    assert.match(receivedInput.requestText, /mindMapSummary\.json/);
    assert.match(receivedInput.requestText, /不要读取 transcription\.json/);
    assert.equal(receivedInput.attachments.some((item: string) => item.includes('transcription.json')), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getSkillJob upserts one formal analysis_material when archived recording job succeeds', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-analysis-material-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注预算。', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-analysis',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-analysis',
      providerDataId: 'DATA-ANALYSIS',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-analysis',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const analysisInputs: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during skill job poll');
        },
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return {
            artifact: {
              artifactId: 'artifact-analysis-current',
              versionId: 'version-analysis-current',
              version: 1,
              kind: 'analysis_material',
              title: input.title,
              sourceToolCode: input.sourceToolCode,
              vectorStatus: 'pending_config',
              anchors: input.anchors,
              chunkCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        },
      } as any,
      externalSkillService: {
        getSkillJob: async (jobId: string) => ({
          jobId,
          skillCode: 'ext.problem_statement_pm',
          runtimeSkillName: 'problem-statement',
          model: 'deepseek-v4-flash',
          status: 'succeeded',
          finalText: null,
          events: [],
          artifacts: [{
            artifactId: 'runtime-md-001',
            jobId,
            fileName: 'problem-statement.md',
            mimeType: 'text/markdown',
            byteSize: 32,
            createdAt: new Date().toISOString(),
            downloadPath: `/api/external-skills/jobs/${jobId}/artifacts/runtime-md-001`,
          }],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getSkillJobArtifact: async () => ({
          artifact: {
            artifactId: 'runtime-md-001',
            jobId: 'job-analysis-001',
            fileName: 'problem-statement.md',
            mimeType: 'text/markdown',
            byteSize: 32,
            createdAt: new Date().toISOString(),
            downloadPath: '#',
          },
          content: Buffer.from('# 问题陈述\n\n客户需要压缩审批周期。'),
        }),
      } as any,
    });

    const first = await service.getSkillJob(record.taskId, 'ext.problem_statement_pm', 'job-analysis-001');
    const second = await service.getSkillJob(record.taskId, 'ext.problem_statement_pm', 'job-analysis-001');

    assert.equal(first.status, 'succeeded');
    assert.equal(second.status, 'succeeded');
    assert.equal(analysisInputs.length, 2);
    assert.equal(analysisInputs[1].skillCode, 'ext.problem_statement_pm');
    assert.equal(analysisInputs[1].sourceToolCode, 'ext.problem_statement_pm');
    assert.equal(analysisInputs[1].title, '贝斯美拜访 - 问题陈述');
    assert.deepEqual(
      analysisInputs[1].anchors.map((item: any) => `${item.type}:${item.id}:${item.bindingStatus ?? ''}`),
      [
        'source_file:md5-analysis:',
        'customer:customer-bsm-001:bound',
        'opportunity:opportunity-bsm-001:bound',
        'followup:followup-bsm-001:bound',
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('archiveCompletedSkillJobs persists succeeded downstream jobs after recording archive', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-completed-job-archive-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注采购和报销流程。', 'utf8');
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf8');
    mkdirSync(join(tempDir, '.local'), { recursive: true });
    const runtimeDbPath = join(tempDir, '.local', 'skill-runtime.sqlite');
    const runtimeDb = new DatabaseSync(runtimeDbPath);
    runtimeDb.exec(`
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        model TEXT NOT NULL,
        request_text TEXT NOT NULL,
        attachments_json TEXT NOT NULL,
        working_directory TEXT,
        status TEXT NOT NULL,
        final_text TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
    `);
    runtimeDb.prepare(`
      INSERT INTO jobs (
        job_id, skill_name, model, request_text, attachments_json, working_directory,
        status, final_text, error_json, created_at, updated_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(
      'job-needs-001',
      'customer-needs-todo-analysis',
      'deepseek-v4-flash',
      '输入材料是附件中的通义结构化录音分析文件和录音资料包，来源录音文件：贝斯美拜访.mp3。建议关联上下文：客户：customer-bsm-001；商机：opportunity-bsm-001；跟进记录：followup-bsm-001。',
      '[]',
      'succeeded',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    runtimeDb.close();

    const config = createTestConfig({ embeddingApiKey: null, envFilePath: envPath });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-archive-completed',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-archive-completed',
      providerDataId: 'DATA-ARCHIVE',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-archive-completed',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const analysisInputs: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during completed job archive');
        },
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: 'artifact-analysis-needs' } };
        },
      } as any,
      externalSkillService: {
        getSkillJob: async (jobId: string) => ({
          jobId,
          skillCode: 'ext.customer_needs_todo_analysis',
          runtimeSkillName: 'customer-needs-todo-analysis',
          model: 'deepseek-v4-flash',
          status: 'succeeded',
          finalText: '# 客户需求工作待办分析\n\n客户需要打通采购、合同和报销流程。',
          events: [],
          artifacts: [],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as any,
    });

    const count = await service.archiveCompletedSkillJobs(record.taskId);

    assert.equal(count, 1);
    assert.equal(analysisInputs.length, 1);
    assert.equal(analysisInputs[0].skillCode, 'ext.customer_needs_todo_analysis');
    assert.equal(analysisInputs[0].sourceJobId, 'job-needs-001');
    assert.equal(analysisInputs[0].title, '贝斯美拜访 - 客户需求工作待办分析');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rerunCompletedSkillJobs waits for rerun and persists formal problem statement', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-problem-rerun-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注采购和报销流程。', 'utf8');
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf8');
    mkdirSync(join(tempDir, '.local'), { recursive: true });
    const runtimeDbPath = join(tempDir, '.local', 'skill-runtime.sqlite');
    const runtimeDb = new DatabaseSync(runtimeDbPath);
    runtimeDb.exec(`
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        model TEXT NOT NULL,
        request_text TEXT NOT NULL,
        attachments_json TEXT NOT NULL,
        working_directory TEXT,
        status TEXT NOT NULL,
        final_text TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
    `);
    runtimeDb.prepare(`
      INSERT INTO jobs (
        job_id, skill_name, model, request_text, attachments_json, working_directory,
        status, final_text, error_json, created_at, updated_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(
      'job-problem-old',
      'problem-statement',
      'deepseek-v4-flash',
      '输入材料是附件中的通义结构化录音分析文件和录音资料包，来源录音文件：贝斯美拜访.mp3。建议关联上下文：客户：customer-bsm-001；商机：opportunity-bsm-001；跟进记录：followup-bsm-001。',
      '[]',
      'succeeded',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    runtimeDb.close();

    const config = createTestConfig({ embeddingApiKey: null, envFilePath: envPath });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-problem-rerun',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-problem-rerun',
      providerDataId: 'DATA-PROBLEM',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-problem-rerun',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const skillRequests: Array<{ skillCode: string; input: any }> = [];
    const analysisInputs: any[] = [];
    let getCreatedJobCount = 0;
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during problem statement rerun');
        },
        materialize: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: 'artifact-problem-formal' } };
        },
      } as any,
      externalSkillService: {
        getSkillJob: async (jobId: string) => {
          if (jobId === 'job-problem-old') {
            return {
              jobId,
              skillCode: 'ext.problem_statement_pm',
              runtimeSkillName: 'problem-statement',
              model: 'deepseek-v4-flash',
              status: 'succeeded',
              finalText: '# 问题陈述\n\n> 上下文状态：待绑定上下文\n\n录音未关联正式客户/商机。',
              events: [],
              artifacts: [],
              error: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }
          getCreatedJobCount += 1;
          return {
            jobId,
            skillCode: 'ext.problem_statement_pm',
            runtimeSkillName: 'problem-statement',
            model: 'deepseek-v4-flash',
            status: getCreatedJobCount === 1 ? 'running' : 'succeeded',
            finalText: getCreatedJobCount === 1
              ? null
              : '# 问题陈述\n\n客户需要打通采购、合同和报销流程。',
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
        createSkillJob: async (skillCode: string, input: any) => {
          skillRequests.push({ skillCode, input });
          return {
            jobId: 'job-problem-rerun',
            skillCode,
            runtimeSkillName: 'problem-statement',
            model: 'deepseek-v4-flash',
            status: 'running',
            finalText: null,
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      } as any,
    });

    const count = await service.rerunCompletedSkillJobs(record.taskId);

    assert.equal(count, 1);
    assert.deepEqual(skillRequests.map((item) => item.skillCode), ['ext.problem_statement_pm']);
    assert.match(skillRequests[0].input.requestText, /正式客户、商机和跟进记录锚点/);
    assert.equal(analysisInputs.length, 1);
    assert.equal(analysisInputs[0].skillCode, 'ext.problem_statement_pm');
    assert.equal(analysisInputs[0].sourceJobId, 'job-problem-rerun');
    assert.equal(analysisInputs[0].title, '贝斯美拜访 - 问题陈述');
    assert.doesNotMatch(analysisInputs[0].markdown, /待绑定上下文|未关联正式客户\/商机/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ensureCoreAnalysisMaterials reruns visit understanding, needs analysis, and problem statement for archived recording', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-core-analysis-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n## 会话摘要\n客户关注 ERP 对接、采购合同报销和多语言。', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-core-analysis',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-core-analysis',
      providerDataId: 'DATA-CORE-ANALYSIS',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-core-analysis',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const skillRequests: Array<{ skillCode: string; input: any }> = [];
    const analysisInputs: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during core analysis repair');
        },
        materialize: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: `artifact-${input.skillCode}` } };
        },
      } as any,
      externalSkillService: {
        createSkillJob: async (skillCode: string, input: any) => {
          skillRequests.push({ skillCode, input });
          return {
            jobId: `job-${skillCode}`,
            skillCode,
            runtimeSkillName: skillCode === 'ext.visit_conversation_understanding'
              ? 'visit-conversation-understanding'
              : skillCode === 'ext.problem_statement_pm'
                ? 'problem-statement'
                : 'customer-needs-todo-analysis',
            model: 'deepseek-v4-flash',
            status: 'succeeded',
            finalText: skillCode === 'ext.visit_conversation_understanding'
              ? '# 拜访会话理解\n\n客户重点关注 ERP 对接和多语言。'
              : skillCode === 'ext.problem_statement_pm'
                ? '# 问题陈述\n\n客户需要解决采购、合同和费用报销流程断点。'
                : '# 客户需求工作待办分析\n\n## 一、客户核心需求\n\n### 需求 1：ERP 对接\n- 背景：客户需要采购、合同、费用报销流程与 ERP 自动对接。',
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      } as any,
    });

    const count = await service.ensureCoreAnalysisMaterials(record.taskId);

    assert.equal(count, 3);
    assert.deepEqual(skillRequests.map((item) => item.skillCode), [
      'ext.visit_conversation_understanding',
      'ext.customer_needs_todo_analysis',
      'ext.problem_statement_pm',
    ]);
    assert.equal(analysisInputs.length, 3);
    assert.deepEqual(analysisInputs.map((item) => item.skillCode), [
      'ext.visit_conversation_understanding',
      'ext.customer_needs_todo_analysis',
      'ext.problem_statement_pm',
    ]);
    assert.match(skillRequests[0].input.requestText, /正式客户、商机和跟进记录锚点/);
    assert.deepEqual(
      analysisInputs[1].anchors.map((item: any) => `${item.type}:${item.id}:${item.bindingStatus ?? ''}`),
      [
        'source_file:md5-core-analysis:',
        'customer:customer-bsm-001:bound',
        'opportunity:opportunity-bsm-001:bound',
        'followup:followup-bsm-001:bound',
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getTask completes pending archive and reruns existing downstream analysis with formal anchors', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-pending-auto-archive-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注采购和报销流程。', 'utf8');
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf8');
    mkdirSync(join(tempDir, '.local'), { recursive: true });
    const runtimeDbPath = join(tempDir, '.local', 'skill-runtime.sqlite');
    const runtimeDb = new DatabaseSync(runtimeDbPath);
    runtimeDb.exec(`
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        model TEXT NOT NULL,
        request_text TEXT NOT NULL,
        attachments_json TEXT NOT NULL,
        working_directory TEXT,
        status TEXT NOT NULL,
        final_text TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
    `);
    runtimeDb.prepare(`
      INSERT INTO jobs (
        job_id, skill_name, model, request_text, attachments_json, working_directory,
        status, final_text, error_json, created_at, updated_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(
      'job-old-needs-001',
      'customer-needs-todo-analysis',
      'deepseek-v4-flash',
      '来源录音文件：贝斯美拜访.mp3。当前录音未绑定客户/商机。',
      '[]',
      'succeeded',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    runtimeDb.close();

    const config = createTestConfig({ embeddingApiKey: null, envFilePath: envPath });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-pending-auto',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-pending-auto',
      providerDataId: 'DATA-PENDING-AUTO',
      fixtureTaskId: null,
      status: 'running',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-pending-auto',
      },
      anchors: {},
      servicePayload: {
        pendingArchive: {
          customerId: 'customer-bsm-001',
          opportunityId: 'opportunity-bsm-001',
          followupId: 'followup-bsm-001',
          createdBy: 'operator-001',
          requestedAt: new Date().toISOString(),
        },
      },
      artifactId: null,
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const recordingInputs: any[] = [];
    const analysisInputs: any[] = [];
    const skillRequests: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async (input: any) => {
          Object.assign(record, {
            status: input.status,
            providerDataId: input.providerDataId ?? record.providerDataId,
            fixtureTaskId: input.fixtureTaskId ?? record.fixtureTaskId,
            anchors: input.anchors ? { ...record.anchors, ...input.anchors } : record.anchors,
            servicePayload: input.servicePayload,
            materialPath: input.materialPath ?? record.materialPath,
            materialSource: input.materialSource ?? record.materialSource,
            errorMessage: input.errorMessage ?? null,
          });
          return record;
        },
        attachArtifact: async (input: any) => {
          record.artifactId = input.artifactId;
          record.materialPath = input.materialPath ?? record.materialPath;
          record.materialSource = input.materialSource ?? record.materialSource;
          record.servicePayload = input.servicePayload;
          return record;
        },
      } as any,
      client: {
        getTask: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
        materialize: async (input: any) => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: input.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: '# 录音资料包\n\n## 会话摘要\n客户确认采购和报销流程需要打通。',
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      } as any,
      artifactService: {
        createRecordingMaterialArtifact: async (input: any) => {
          recordingInputs.push(input);
          return {
            artifact: {
              artifactId: 'artifact-recording-pending-auto',
              versionId: 'version-recording-pending-auto',
              version: 1,
              kind: 'recording_material',
              title: input.title,
              sourceToolCode: input.sourceToolCode,
              vectorStatus: 'pending_config',
              anchors: input.anchors,
              chunkCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        },
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: 'artifact-analysis-rerun' } };
        },
      } as any,
      externalSkillService: {
        getSkillJob: async (jobId: string) => ({
          jobId,
          skillCode: 'ext.customer_needs_todo_analysis',
          runtimeSkillName: 'customer-needs-todo-analysis',
          model: 'deepseek-v4-flash',
          status: 'succeeded',
          finalText: '# 客户需求工作待办分析\n\n客户需要采购、合同和费用报销流程。',
          events: [],
          artifacts: [],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        createSkillJob: async (skillCode: string, input: any) => {
          skillRequests.push({ skillCode, input });
          return {
            jobId: 'job-new-needs-001',
            skillCode,
            runtimeSkillName: 'customer-needs-todo-analysis',
            model: 'deepseek-v4-flash',
            status: 'succeeded',
            finalText: '# 客户需求工作待办分析\n\n客户需要采购、合同和费用报销流程。',
            events: [],
            artifacts: [],
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      } as any,
    });

    const response = await service.getTask(record.taskId);

    assert.equal(response.archive?.status, 'archived');
    assert.equal(response.archive?.artifactId, 'artifact-recording-pending-auto');
    assert.equal(record.servicePayload.pendingArchive, undefined);
    assert.equal(recordingInputs.length, 1);
    assert.equal(skillRequests.length, 1);
    assert.match(skillRequests[0].input.requestText, /不得输出“未关联客户\/商机”“未关联商机”“录音未绑定”/);
    assert.equal(analysisInputs.length, 1);
    assert.deepEqual(
      analysisInputs[0].anchors.map((item: any) => `${item.type}:${item.id}:${item.bindingStatus ?? ''}`),
      [
        'source_file:md5-pending-auto:',
        'customer:customer-bsm-001:bound',
        'opportunity:opportunity-bsm-001:bound',
        'followup:followup-bsm-001:bound',
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('formal analysis material blocks stale unbound context markdown', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-stale-analysis-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(materialPath, '# 录音资料包\n\n客户关注预算。', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-stale-analysis',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-stale-analysis',
      providerDataId: 'DATA-STALE',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-stale-analysis',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let createAnalysisCalled = false;
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during stale guard');
        },
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async () => {
          createAnalysisCalled = true;
          throw new Error('should not persist stale markdown');
        },
      } as any,
      externalSkillService: {
        getSkillJob: async (jobId: string) => ({
          jobId,
          skillCode: 'ext.customer_value_positioning_pm',
          runtimeSkillName: 'customer-value-positioning',
          model: 'deepseek-v4-flash',
          status: 'succeeded',
          finalText: '# 客户价值定位：贝斯美（未关联商机）\n\n当前录音未绑定客户/商机。',
          events: [],
          artifacts: [],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as any,
    });

    await assert.rejects(
      () => service.getSkillJob(record.taskId, 'ext.customer_value_positioning_pm', 'job-stale-001'),
      /旧上下文文案/,
    );
    assert.equal(createAnalysisCalled, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('archiveCompletedSkillJobs recovers markdown artifacts when runtime job index is missing', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-artifact-recovery-'));
  try {
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf8');
    const artifactRoot = join(tempDir, '.local', 'skill-runtime-artifacts');
    const jobId = 'job-recovered-needs-001';
    mkdirSync(join(artifactRoot, jobId), { recursive: true });
    mkdirSync(join(artifactRoot, '_jobs', jobId, 'inputs'), { recursive: true });
    writeFileSync(
      join(artifactRoot, jobId, `customer-needs-todo-analysis-${jobId}.md`),
      '# 客户需求工作待办分析\n\n客户需要打通采购、合同和报销流程。',
      'utf8',
    );
    writeFileSync(
      join(artifactRoot, '_jobs', jobId, 'inputs', 'recording-material.md'),
      '# 录音资料包\n\n来源文件：贝斯美拜访.mp3。\n录音任务：recording-task-artifact-recovery。\n客户需要采购、合同和报销流程。',
      'utf8',
    );

    const config = createTestConfig({ embeddingApiKey: null, envFilePath: envPath });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-artifact-recovery',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-artifact-recovery',
      providerDataId: 'DATA-ARTIFACT-RECOVERY',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: '贝斯美拜访.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-artifact-recovery',
      },
      anchors: {
        customer: 'customer-bsm-001',
        opportunity: 'opportunity-bsm-001',
        followup: 'followup-bsm-001',
      },
      servicePayload: {},
      artifactId: 'artifact-recording-formal',
      materialPath: null,
      materialSource: null,
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const analysisInputs: any[] = [];
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during artifact recovery');
        },
      } as any,
      artifactService: {
        createAnalysisMaterialArtifact: async (input: any) => {
          analysisInputs.push(input);
          return { artifact: { artifactId: 'artifact-analysis-recovered' } };
        },
      } as any,
    });

    const count = await service.archiveCompletedSkillJobs(record.taskId);

    assert.equal(count, 1);
    assert.equal(analysisInputs.length, 1);
    assert.equal(analysisInputs[0].skillCode, 'ext.customer_needs_todo_analysis');
    assert.equal(analysisInputs[0].sourceJobId, jobId);
    assert.match(analysisInputs[0].markdown, /采购、合同和报销流程/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createSkillJob rejects empty generated material without structured analysis files', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-empty-material-'));
  try {
    const materialPath = join(tempDir, 'recording-material.md');
    writeFileSync(
      materialPath,
      [
        '# 录音资料包',
        '',
        '## 会话摘要',
        '- 暂无可用会话摘要。',
        '',
        '## 关键主题',
        '- 暂无可用主题。',
        '',
        '## 关键词',
        '暂无可用关键词。',
        '',
        '## 自动章节',
        '暂无可用章节。',
      ].join('\n'),
      'utf8',
    );
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-empty-material',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-empty-material',
      providerDataId: 'DATA-EMPTY',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: 'visit.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-empty-material',
      },
      anchors: {},
      servicePayload: {},
      artifactId: null,
      materialPath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
        updateFromService: async () => record,
      } as any,
      client: {
        getTask: async () => record as any,
        materialize: async () => ({
          taskId: record.serviceTaskId,
          provider: 'tongyi-tingwu',
          status: 'succeeded',
          providerDataId: record.providerDataId,
          fixtureTaskId: null,
          file: record.file,
          anchors: record.anchors,
          stages: [],
          material: {
            available: true,
            path: materialPath,
            source: 'generated',
            markdown: readFileSync(materialPath, 'utf8'),
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      } as any,
      artifactService: {} as any,
      externalSkillService: {
        createSkillJob: async () => {
          throw new Error('should not call external skill service');
        },
      } as any,
    });

    await assert.rejects(
      () => service.createSkillJob(record.taskId, { skillCode: 'ext.customer_needs_todo_analysis' }),
      /缺少可供下游技能消费的通义结构化分析文件/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createSkillJob rejects non-whitelisted skill and process-file material path', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'recording-process-file-'));
  try {
    const processFilePath = join(tempDir, 'transcription.json');
    writeFileSync(processFilePath, '{}', 'utf8');
    const config = createTestConfig({ embeddingApiKey: null });
    const record: RecordingTaskRecord = {
      taskId: 'recording-task-process-file',
      eid: config.yzj.eid,
      appId: config.yzj.lightCloud.appId,
      serviceTaskId: 'audio-task-process-file',
      providerDataId: 'DATA-PROCESS',
      fixtureTaskId: null,
      status: 'succeeded',
      file: {
        fileName: 'visit.mp3',
        mimeType: 'audio/mpeg',
        size: 123,
        md5: 'md5-process-file',
      },
      anchors: {},
      servicePayload: {},
      artifactId: null,
      materialPath: processFilePath,
      materialSource: 'generated',
      errorMessage: null,
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const service = new RecordingTaskService({
      config,
      repository: {
        getTask: async () => record,
      } as any,
      client: {
        getTask: async () => {
          throw new Error('audio service offline during skill job lookup');
        },
      } as any,
      artifactService: {} as any,
      externalSkillService: {
        createSkillJob: async () => {
          throw new Error('should not call external skill service');
        },
      } as any,
    });

    await assert.rejects(
      () => service.createSkillJob(record.taskId, { skillCode: 'ext.company_research_pm' }),
      /只允许继续调用/,
    );
    await assert.rejects(
      () => service.createSkillJob(record.taskId, { skillCode: 'ext.problem_statement_pm' }),
      /只能消费通义结构化分析 JSON/,
    );

    const directoryMaterialPath = join(tempDir, 'recording-material.md');
    mkdirSync(directoryMaterialPath);
    record.materialPath = directoryMaterialPath;
    await assert.rejects(
      () => service.createSkillJob(record.taskId, { skillCode: 'ext.problem_statement_pm' }),
      /路径不是文件/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
