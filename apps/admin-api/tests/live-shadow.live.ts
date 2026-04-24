import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { ApprovalFileClient } from '../src/approval-file-client.js';
import { ApprovalFileService } from '../src/approval-file-service.js';
import { ApprovalClient } from '../src/approval-client.js';
import type { ShadowObjectKey } from '../src/contracts.js';
import { openDatabase } from '../src/database.js';
import { DictionaryResolver } from '../src/dictionary-resolver.js';
import { loadAppConfig } from '../src/config.js';
import { LightCloudClient } from '../src/lightcloud-client.js';
import { ShadowMetadataRepository } from '../src/shadow-metadata-repository.js';
import { ShadowMetadataService } from '../src/shadow-metadata-service.js';

const FIXTURE_PATH_CANDIDATES = [
  resolve(process.cwd(), '.local/shadow-live-fixtures.json'),
  resolve(process.cwd(), '../../.local/shadow-live-fixtures.json'),
];

interface AttachmentFixtureValue {
  fileId: string;
  fileName: string;
  fileSize: string;
  fileType: string;
  fileExt: string;
}

interface AttachmentFixture {
  filePath?: string;
  attachmentValue?: AttachmentFixtureValue;
}

interface OpportunityLiveFixture {
  operatorOpenId: string;
  linkedCustomerFormInstId: string;
  linkedContactFormInstId?: string;
  attachment?: AttachmentFixture;
  createParams?: Record<string, unknown>;
  updateParams?: Record<string, unknown>;
}

interface FollowupLiveFixture {
  operatorOpenId: string;
  linkedCustomerFormInstId?: string;
  linkedOpportunityFormInstId?: string;
  externalRelations?: {
    Bd_4?: string;
  };
  attachment?: AttachmentFixture;
  createParams?: Record<string, unknown>;
  updateParams?: Record<string, unknown>;
}

interface ShadowLiveFixtureFile {
  opportunity?: OpportunityLiveFixture;
  followup?: FollowupLiveFixture;
}

function loadFixture(): ShadowLiveFixtureFile {
  const fixturePath = FIXTURE_PATH_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!fixturePath) {
    throw new Error(
      [
        `缺少 live 联调基线文件: ${FIXTURE_PATH_CANDIDATES.join(' 或 ')}`,
        '请创建 .local/shadow-live-fixtures.json，并至少提供 opportunity / followup 的 operatorOpenId 与关联基线记录。',
      ].join('\n'),
    );
  }

  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ShadowLiveFixtureFile;
}

async function createLiveRuntime() {
  const config = loadAppConfig();
  const database = openDatabase(':memory:');
  const approvalClient = new ApprovalClient({
    baseUrl: config.yzj.baseUrl,
  });
  const lightCloudClient = new LightCloudClient({
    baseUrl: config.yzj.baseUrl,
  });
  const approvalFileService = new ApprovalFileService({
    config,
    client: new ApprovalFileClient({
      baseUrl: config.yzj.baseUrl,
    }),
  });
  const service = new ShadowMetadataService({
    config,
    repository: new ShadowMetadataRepository(database),
    approvalClient,
    lightCloudClient,
    dictionaryResolver: new DictionaryResolver({
      source: config.shadow.dictionarySource,
      jsonPath: config.shadow.dictionaryJsonPath,
      approvalClient,
      fieldBoundWorkbookPath: resolve(
        dirname(config.meta.envFilePath),
        'yzj-api/省市区数据信息.xlsx',
      ),
    }),
  });

  return {
    service,
    approvalFileService,
  };
}

async function resolveAttachmentValue(
  attachment: AttachmentFixture | undefined,
  approvalFileService: ApprovalFileService,
): Promise<AttachmentFixtureValue | undefined> {
  if (!attachment) {
    return undefined;
  }

  if (attachment.attachmentValue) {
    return attachment.attachmentValue;
  }

  if (attachment.filePath) {
    const uploaded = await approvalFileService.uploadFile({
      filePath: attachment.filePath,
    });
    return uploaded.attachmentValue;
  }

  return undefined;
}

function assertPreviewReady(
  objectKey: ShadowObjectKey,
  preview: {
    readyToSend: boolean;
    missingRequiredParams: string[];
    missingRuntimeInputs: string[];
    validationErrors: string[];
    blockedReadonlyParams: string[];
  },
) {
  assert.equal(
    preview.readyToSend,
    true,
    `${objectKey} preview 未就绪: ${JSON.stringify(
      {
        missingRequiredParams: preview.missingRequiredParams,
        missingRuntimeInputs: preview.missingRuntimeInputs,
        validationErrors: preview.validationErrors,
        blockedReadonlyParams: preview.blockedReadonlyParams,
      },
      null,
      2,
    )}`,
  );
}

async function trySearch(
  service: ShadowMetadataService,
  objectKey: ShadowObjectKey,
  operatorOpenId: string,
  filters: Array<{ field: string; value: unknown; operator?: string }>,
  visibilityGaps: string[],
) {
  try {
    const result = await service.executeSearch(objectKey, {
      operatorOpenId,
      filters,
      pageNumber: 1,
      pageSize: 20,
    });
    if (result.totalElements === 0) {
      visibilityGaps.push(`${objectKey}: searchList 返回 0，疑似列表可见性缺口`);
    }
  } catch (error) {
    visibilityGaps.push(
      `${objectKey}: searchList 校验未通过或调用失败 -> ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function tryGetWithRetry(
  service: ShadowMetadataService,
  objectKey: ShadowObjectKey,
  operatorOpenId: string,
  formInstId: string,
): Promise<boolean> {
  const delays = [0, 1_500, 3_000];

  for (let index = 0; index < delays.length; index += 1) {
    const delay = delays[index];
    if (delay > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }

    try {
      const result = await service.executeGet(objectKey, {
        formInstId,
        operatorOpenId,
      });
      if (result.record.formInstId === formInstId) {
        return true;
      }
    } catch (error) {
      if (index === delays.length - 1) {
        throw error;
      }
    }
  }

  return false;
}

test('live shadow create-first CRUD for opportunity and followup', { timeout: 600_000 }, async () => {
  const fixture = loadFixture();
  const opportunityFixture = fixture.opportunity;
  const followupFixture = fixture.followup;

  assert.ok(opportunityFixture, 'fixture.opportunity 必须配置');
  assert.ok(followupFixture, 'fixture.followup 必须配置');
  assert.ok(opportunityFixture?.linkedCustomerFormInstId, 'fixture.opportunity.linkedCustomerFormInstId 必须配置');

  const { service, approvalFileService } = await createLiveRuntime();
  const visibilityGaps: string[] = [];
  const blockingIssues: string[] = [];
  const cleanupQueue: Array<{ objectKey: ShadowObjectKey; operatorOpenId: string; formInstId: string }> = [];
  let createdOpportunityFormInstId = '';
  let createdFollowupFormInstId = '';

  try {
    await service.refreshObject('opportunity');
    await service.refreshObject('followup');

    const suffix = `${Date.now()}`;
    const opportunityName = `影子联调商机-${suffix}`;
    const opportunityAttachment = await resolveAttachmentValue(
      opportunityFixture?.attachment,
      approvalFileService,
    );
    const opportunityCreateParams: Record<string, unknown> = {
      opportunity_name: opportunityName,
      linked_customer_form_inst_id: opportunityFixture?.linkedCustomerFormInstId,
      ...(opportunityFixture?.linkedContactFormInstId
        ? { linked_contact_form_inst_id: opportunityFixture.linkedContactFormInstId }
        : {}),
      ...(opportunityAttachment ? { At_0: [opportunityAttachment] } : {}),
      ...(opportunityFixture?.createParams ?? {}),
    };

    const opportunityCreatePreview = await service.previewUpsert('opportunity', {
      mode: 'create',
      operatorOpenId: opportunityFixture!.operatorOpenId,
      params: opportunityCreateParams,
    });
    assertPreviewReady('opportunity', opportunityCreatePreview);

    const opportunityCreateResult = await service.executeUpsert('opportunity', {
      mode: 'create',
      operatorOpenId: opportunityFixture!.operatorOpenId,
      params: opportunityCreateParams,
    });
    createdOpportunityFormInstId = opportunityCreateResult.formInstIds[0] ?? '';
    assert.ok(createdOpportunityFormInstId, '商机创建后未返回 formInstId');
    cleanupQueue.unshift({
      objectKey: 'opportunity',
      operatorOpenId: opportunityFixture!.operatorOpenId,
      formInstId: createdOpportunityFormInstId,
    });

    try {
      const opportunityGetReady = await tryGetWithRetry(
        service,
        'opportunity',
        opportunityFixture!.operatorOpenId,
        createdOpportunityFormInstId,
      );
      if (!opportunityGetReady) {
        blockingIssues.push(`opportunity:get returned no record for ${createdOpportunityFormInstId}`);
      }
    } catch (error) {
      blockingIssues.push(
        `opportunity:get failed for ${createdOpportunityFormInstId} -> ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const opportunityUpdateParams: Record<string, unknown> = {
      opportunity_name: `${opportunityName}-updated`,
      ...(opportunityFixture?.updateParams ?? {}),
    };
    const opportunityUpdatePreview = await service.previewUpsert('opportunity', {
      mode: 'update',
      formInstId: createdOpportunityFormInstId,
      operatorOpenId: opportunityFixture!.operatorOpenId,
      params: opportunityUpdateParams,
    });
    assertPreviewReady('opportunity', opportunityUpdatePreview);

    await service.executeUpsert('opportunity', {
      mode: 'update',
      formInstId: createdOpportunityFormInstId,
      operatorOpenId: opportunityFixture!.operatorOpenId,
      params: opportunityUpdateParams,
    });

    await trySearch(
      service,
      'opportunity',
      opportunityFixture!.operatorOpenId,
      [
        {
          field: 'Te_16',
          value: `${opportunityName}-updated`,
          operator: 'contain',
        },
      ],
      visibilityGaps,
    );

    const followupAttachment = await resolveAttachmentValue(
      followupFixture?.attachment,
      approvalFileService,
    );
    const linkedCustomerFormInstId =
      followupFixture?.linkedCustomerFormInstId ?? opportunityFixture?.linkedCustomerFormInstId;
    assert.ok(linkedCustomerFormInstId, 'followup 需要 linkedCustomerFormInstId');
    const linkedOpportunityFormInstId =
      createdOpportunityFormInstId || followupFixture?.linkedOpportunityFormInstId;
    assert.ok(linkedOpportunityFormInstId, 'followup 需要 linkedOpportunityFormInstId');

    const followupNote = `0.2.21 live followup ${suffix}`;
    const followupCreateParams: Record<string, unknown> = {
      Ta_0: followupNote,
      linked_customer_form_inst_id: linkedCustomerFormInstId,
      linked_opportunity_form_inst_id: linkedOpportunityFormInstId,
      ...(followupFixture?.externalRelations?.Bd_4 ? { Bd_4: followupFixture.externalRelations.Bd_4 } : {}),
      ...(followupAttachment ? { At_0: [followupAttachment] } : {}),
      ...(followupFixture?.createParams ?? {}),
    };

    const followupCreatePreview = await service.previewUpsert('followup', {
      mode: 'create',
      operatorOpenId: followupFixture!.operatorOpenId,
      params: followupCreateParams,
    });
    assertPreviewReady('followup', followupCreatePreview);

    const followupCreateResult = await service.executeUpsert('followup', {
      mode: 'create',
      operatorOpenId: followupFixture!.operatorOpenId,
      params: followupCreateParams,
    });
    createdFollowupFormInstId = followupCreateResult.formInstIds[0] ?? '';
    assert.ok(createdFollowupFormInstId, '跟进记录创建后未返回 formInstId');
    cleanupQueue.unshift({
      objectKey: 'followup',
      operatorOpenId: followupFixture!.operatorOpenId,
      formInstId: createdFollowupFormInstId,
    });

    try {
      const followupGetReady = await tryGetWithRetry(
        service,
        'followup',
        followupFixture!.operatorOpenId,
        createdFollowupFormInstId,
      );
      if (!followupGetReady) {
        blockingIssues.push(`followup:get returned no record for ${createdFollowupFormInstId}`);
      }
    } catch (error) {
      blockingIssues.push(
        `followup:get failed for ${createdFollowupFormInstId} -> ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const followupUpdateParams: Record<string, unknown> = {
      Ta_0: `${followupNote}-updated`,
      ...(followupFixture?.updateParams ?? {}),
    };
    const followupUpdatePreview = await service.previewUpsert('followup', {
      mode: 'update',
      formInstId: createdFollowupFormInstId,
      operatorOpenId: followupFixture!.operatorOpenId,
      params: followupUpdateParams,
    });
    assertPreviewReady('followup', followupUpdatePreview);

    await service.executeUpsert('followup', {
      mode: 'update',
      formInstId: createdFollowupFormInstId,
      operatorOpenId: followupFixture!.operatorOpenId,
      params: followupUpdateParams,
    });

    await trySearch(
      service,
      'followup',
      followupFixture!.operatorOpenId,
      [
        {
          field: 'Ta_0',
          value: `${followupNote}-updated`,
          operator: 'contain',
        },
      ],
      visibilityGaps,
    );

    await service.executeDelete('followup', {
      operatorOpenId: followupFixture!.operatorOpenId,
      formInstIds: [createdFollowupFormInstId],
    });
    cleanupQueue.shift();

    await service.executeDelete('opportunity', {
      operatorOpenId: opportunityFixture!.operatorOpenId,
      formInstIds: [createdOpportunityFormInstId],
    });
    cleanupQueue.shift();
  } finally {
    for (const item of cleanupQueue) {
      try {
        await service.executeDelete(item.objectKey, {
          operatorOpenId: item.operatorOpenId,
          formInstIds: [item.formInstId],
        });
      } catch (error) {
        console.error(
          `[live-shadow] cleanup failed for ${item.objectKey}:${item.formInstId} -> ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (visibilityGaps.length > 0) {
      console.log(`[live-shadow] search visibility gaps\n${visibilityGaps.map((item) => `- ${item}`).join('\n')}`);
    }
  }

  if (blockingIssues.length > 0) {
    assert.fail(`[live-shadow] blocking issues\n${blockingIssues.map((item) => `- ${item}`).join('\n')}`);
  }
});
