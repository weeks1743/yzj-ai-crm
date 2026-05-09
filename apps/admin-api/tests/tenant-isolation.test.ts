import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentIsolationKey,
  resolveAgentIsolationTenant,
  resolveLegacyAgentAppIds,
} from '../src/tenant-isolation.js';
import { buildMongoArtifactRepairPlan } from '../scripts/repair-agent-isolation-app-id.js';
import { createTestConfig } from './test-helpers.js';

test('agent isolation always uses lightCloud.appId as canonical app namespace', () => {
  const config = createTestConfig();

  assert.deepEqual(
    resolveAgentIsolationTenant(config, { eid: '21024647' }),
    { eid: '21024647', appId: config.yzj.lightCloud.appId },
  );
  assert.equal(buildAgentIsolationKey(config), `${config.yzj.eid}:${config.yzj.lightCloud.appId}`);
  assert.deepEqual(resolveLegacyAgentAppIds(config), [config.yzj.appId]);
});

test('agent isolation has no legacy app when ai app already equals lightCloud app', () => {
  const config = createTestConfig();
  config.yzj.appId = config.yzj.lightCloud.appId;

  assert.deepEqual(resolveLegacyAgentAppIds(config), []);
});

test('repair plan moves legacy-only artifacts into canonical lightCloud namespace', () => {
  const plan = buildMongoArtifactRepairPlan({
    canonicalAppId: '501037649',
    legacyAppIds: ['501037729'],
    legacyArtifacts: [
      buildArtifactDoc('artifact-legacy', '501037729', 'company:绍兴贝斯美化工股份有限公司'),
    ],
    canonicalArtifacts: [],
    versions: [
      buildVersionDoc('version-legacy', 'artifact-legacy', '501037729', 'hash-legacy'),
    ],
  });

  assert.equal(plan.dirtyArtifactCount, 1);
  assert.equal(plan.moveCount, 1);
  assert.deepEqual(plan.actions[0], {
    type: 'move',
    legacyAppId: '501037729',
    artifactId: 'artifact-legacy',
    versionIds: ['version-legacy'],
  });
});

test('repair plan merges legacy duplicate into canonical artifact idempotently', () => {
  const plan = buildMongoArtifactRepairPlan({
    canonicalAppId: '501037649',
    legacyAppIds: ['501037729'],
    legacyArtifacts: [
      {
        ...buildArtifactDoc('artifact-legacy', '501037729', 'company:绍兴贝斯美化工股份有限公司'),
        currentVersionId: 'version-legacy-new',
        latestVersion: 2,
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    ],
    canonicalArtifacts: [
      {
        ...buildArtifactDoc('artifact-canonical', '501037649', 'company:绍兴贝斯美化工股份有限公司'),
        currentVersionId: 'version-canonical',
        latestVersion: 1,
        updatedAt: '2026-05-08T00:00:00.000Z',
      },
    ],
    versions: [
      buildVersionDoc('version-canonical', 'artifact-canonical', '501037649', 'hash-same'),
      buildVersionDoc('version-legacy-old', 'artifact-legacy', '501037729', 'hash-same'),
      { ...buildVersionDoc('version-legacy-new', 'artifact-legacy', '501037729', 'hash-new'), version: 2 },
    ],
  });

  assert.equal(plan.mergeCount, 1);
  assert.deepEqual(plan.actions[0], {
    type: 'merge',
    legacyAppId: '501037729',
    artifactId: 'artifact-legacy',
    canonicalArtifactId: 'artifact-canonical',
    duplicateVersionIds: ['version-legacy-old'],
    movedVersions: [{ versionId: 'version-legacy-new', version: 2 }],
    currentVersionId: 'version-legacy-new',
    latestVersion: 2,
    selectedSource: 'legacy',
  });
});

function buildArtifactDoc(artifactId: string, appId: string, anchorIdentity: string) {
  return {
    artifactId,
    eid: '21024647',
    appId,
    kind: 'company_research' as const,
    title: '绍兴贝斯美化工股份有限公司 公司研究',
    sourceToolCode: 'ext.company_research_pm',
    anchors: [
      {
        type: 'company' as const,
        id: '绍兴贝斯美化工股份有限公司',
        name: '绍兴贝斯美化工股份有限公司',
        role: 'primary' as const,
      },
    ],
    anchorIdentity,
    currentVersionId: 'version-legacy',
    latestVersion: 1,
    updatedAt: '2026-05-08T00:00:00.000Z',
  };
}

function buildVersionDoc(versionId: string, artifactId: string, appId: string, contentHash: string) {
  return {
    versionId,
    artifactId,
    eid: '21024647',
    appId,
    version: 1,
    title: '绍兴贝斯美化工股份有限公司 公司研究',
    contentHash,
  };
}
