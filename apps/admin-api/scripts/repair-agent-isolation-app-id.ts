import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { QdrantClient } from '@qdrant/js-client-rest';
import { loadAppConfig } from '../src/config.js';
import type { ArtifactAnchor, ArtifactKind } from '../src/contracts.js';
import { getErrorMessage } from '../src/errors.js';
import { resolveAgentIsolationTenant, resolveLegacyAgentAppIds } from '../src/tenant-isolation.js';

type RepairableArtifactKind = Extract<ArtifactKind, 'company_research' | 'recording_material' | 'analysis_material'>;

const REPAIRABLE_KINDS: RepairableArtifactKind[] = [
  'company_research',
  'recording_material',
  'analysis_material',
];

interface ArtifactDocLike {
  _id?: unknown;
  artifactId: string;
  eid: string;
  appId: string;
  kind: RepairableArtifactKind;
  title: string;
  sourceToolCode: string;
  anchors: ArtifactAnchor[];
  anchorIdentity: string;
  currentVersionId: string;
  latestVersion: number;
  vectorStatus?: string;
  chunkCount?: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  contentHash?: string;
}

interface VersionDocLike {
  _id?: unknown;
  versionId: string;
  artifactId: string;
  eid: string;
  appId: string;
  version: number;
  title: string;
  markdown?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  contentHash: string;
  createdAt?: Date | string;
}

export interface MongoArtifactRepairPlanInput {
  canonicalAppId: string;
  legacyAppIds: string[];
  legacyArtifacts: ArtifactDocLike[];
  canonicalArtifacts: ArtifactDocLike[];
  versions: VersionDocLike[];
}

export type MongoArtifactRepairAction =
  | {
      type: 'move';
      legacyAppId: string;
      artifactId: string;
      versionIds: string[];
    }
  | {
      type: 'merge';
      legacyAppId: string;
      artifactId: string;
      canonicalArtifactId: string;
      duplicateVersionIds: string[];
      movedVersions: Array<{ versionId: string; version: number }>;
      currentVersionId: string;
      latestVersion: number;
      selectedSource: 'canonical' | 'legacy';
    };

export interface MongoArtifactRepairPlan {
  actions: MongoArtifactRepairAction[];
  dirtyArtifactCount: number;
  moveCount: number;
  mergeCount: number;
  duplicateVersionCount: number;
}

export interface AgentIsolationRepairSummary {
  apply: boolean;
  canonical: { eid: string; appId: string };
  legacyAppIds: string[];
  mongo: MongoArtifactRepairPlan & {
    backupPath?: string;
  };
  qdrant: {
    attempted: boolean;
    updatedVersionCount: number;
    errorMessage?: string;
  };
}

export function buildMongoArtifactRepairPlan(input: MongoArtifactRepairPlanInput): MongoArtifactRepairPlan {
  const canonicalByIdentity = new Map(
    input.canonicalArtifacts.map((artifact) => [buildArtifactIdentityKey(artifact), artifact]),
  );
  const versionsByArtifactId = groupBy(input.versions, (version) => version.artifactId);
  const actions: MongoArtifactRepairAction[] = [];

  for (const legacyArtifact of input.legacyArtifacts) {
    if (!input.legacyAppIds.includes(legacyArtifact.appId)) {
      continue;
    }

    const legacyVersions = versionsByArtifactId.get(legacyArtifact.artifactId) ?? [];
    const canonicalArtifact = canonicalByIdentity.get(buildArtifactIdentityKey(legacyArtifact));
    if (!canonicalArtifact) {
      actions.push({
        type: 'move',
        legacyAppId: legacyArtifact.appId,
        artifactId: legacyArtifact.artifactId,
        versionIds: legacyVersions.map((version) => version.versionId),
      });
      continue;
    }

    const canonicalVersions = versionsByArtifactId.get(canonicalArtifact.artifactId) ?? [];
    const canonicalVersionByHash = new Map(
      canonicalVersions
        .filter((version) => version.contentHash)
        .map((version) => [version.contentHash, version]),
    );
    let nextVersion = Math.max(
      canonicalArtifact.latestVersion || 0,
      ...canonicalVersions.map((version) => Number(version.version) || 0),
    ) + 1;
    const duplicateVersionIds: string[] = [];
    const movedVersions: Array<{ versionId: string; version: number }> = [];
    const legacyCurrentVersion = legacyVersions.find((version) => version.versionId === legacyArtifact.currentVersionId);
    let legacyCurrentReplacementId = legacyArtifact.currentVersionId;

    for (const version of legacyVersions.sort(compareVersionDocs)) {
      const duplicate = canonicalVersionByHash.get(version.contentHash);
      if (duplicate) {
        duplicateVersionIds.push(version.versionId);
        if (version.versionId === legacyArtifact.currentVersionId) {
          legacyCurrentReplacementId = duplicate.versionId;
        }
        continue;
      }

      movedVersions.push({ versionId: version.versionId, version: nextVersion });
      nextVersion += 1;
    }

    const selectedSource = isNewer(legacyArtifact.updatedAt, canonicalArtifact.updatedAt)
      ? 'legacy'
      : 'canonical';
    const currentVersionId = selectedSource === 'legacy'
      ? legacyCurrentReplacementId
      : canonicalArtifact.currentVersionId;
    const latestVersion = Math.max(canonicalArtifact.latestVersion || 0, nextVersion - 1);

    actions.push({
      type: 'merge',
      legacyAppId: legacyArtifact.appId,
      artifactId: legacyArtifact.artifactId,
      canonicalArtifactId: canonicalArtifact.artifactId,
      duplicateVersionIds,
      movedVersions,
      currentVersionId,
      latestVersion,
      selectedSource,
    });
  }

  return {
    actions,
    dirtyArtifactCount: actions.length,
    moveCount: actions.filter((action) => action.type === 'move').length,
    mergeCount: actions.filter((action) => action.type === 'merge').length,
    duplicateVersionCount: actions.reduce(
      (count, action) => count + (action.type === 'merge' ? action.duplicateVersionIds.length : 0),
      0,
    ),
  };
}

export async function repairAgentIsolationAppId(input: {
  apply: boolean;
  envFilePath?: string;
  logger?: Pick<Console, 'log' | 'warn'>;
}): Promise<AgentIsolationRepairSummary> {
  const logger = input.logger ?? console;
  const config = loadAppConfig(input.envFilePath ? { envFilePath: input.envFilePath } : {});
  const canonical = resolveAgentIsolationTenant(config);
  const legacyAppIds = resolveLegacyAgentAppIds(config);

  const mongo = new MongoClient(config.storage.mongodbUri);
  await mongo.connect();
  try {
    const database = mongo.db(config.storage.mongodbDb);
    const artifacts = database.collection<ArtifactDocLike>('artifacts');
    const versions = database.collection<VersionDocLike>('artifact_versions');
    const legacyArtifacts = legacyAppIds.length
      ? await artifacts.find({
        eid: canonical.eid,
        appId: { $in: legacyAppIds },
        kind: { $in: REPAIRABLE_KINDS },
      }).sort({ updatedAt: -1 }).toArray()
      : [];
    const identityClauses = legacyArtifacts.map((artifact) => ({
      kind: artifact.kind,
      anchorIdentity: artifact.anchorIdentity,
    }));
    const canonicalArtifacts = identityClauses.length
      ? await artifacts.find({
        eid: canonical.eid,
        appId: canonical.appId,
        $or: identityClauses,
      }).toArray()
      : [];
    const artifactIds = [
      ...legacyArtifacts.map((artifact) => artifact.artifactId),
      ...canonicalArtifacts.map((artifact) => artifact.artifactId),
    ];
    const versionDocs = artifactIds.length
      ? await versions.find({ artifactId: { $in: artifactIds } }).toArray()
      : [];
    const plan = buildMongoArtifactRepairPlan({
      canonicalAppId: canonical.appId,
      legacyAppIds,
      legacyArtifacts,
      canonicalArtifacts,
      versions: versionDocs,
    });

    logger.log(`[repair] canonical isolation: ${canonical.eid}:${canonical.appId}`);
    logger.log(`[repair] legacy appIds: ${legacyAppIds.length ? legacyAppIds.join(', ') : '(none)'}`);
    logger.log(`[repair] dirty artifacts: ${plan.dirtyArtifactCount}, move=${plan.moveCount}, merge=${plan.mergeCount}`);

    let backupPath: string | undefined;
    if (input.apply && plan.actions.length) {
      backupPath = writeBackup(config.meta.envFilePath, {
        canonical,
        legacyAppIds,
        legacyArtifacts,
        canonicalArtifacts,
        versions: versionDocs,
        plan,
      });
      await applyMongoArtifactRepairPlan({
        artifacts,
        versions,
        canonicalAppId: canonical.appId,
        legacyArtifacts,
        canonicalArtifacts,
        versionDocs,
        actions: plan.actions,
      });
      logger.log(`[repair] Mongo repaired, backup=${backupPath}`);
    } else if (!input.apply) {
      logger.log('[repair] dry-run only; pass --apply to mutate local database');
    }

    const qdrant = await repairQdrantPayload({
      apply: input.apply,
      config,
      canonicalAppId: canonical.appId,
      legacyAppIds,
      versionIds: collectTouchedVersionIds(plan.actions),
      logger,
    });

    return {
      apply: input.apply,
      canonical,
      legacyAppIds,
      mongo: {
        ...plan,
        backupPath,
      },
      qdrant,
    };
  } finally {
    await mongo.close();
  }
}

async function applyMongoArtifactRepairPlan(input: {
  artifacts: {
    updateOne(filter: unknown, update: unknown): Promise<unknown>;
    deleteOne(filter: unknown): Promise<unknown>;
  };
  versions: {
    updateMany(filter: unknown, update: unknown): Promise<unknown>;
    updateOne(filter: unknown, update: unknown): Promise<unknown>;
    deleteMany(filter: unknown): Promise<unknown>;
    findOne(filter: unknown): Promise<VersionDocLike | null>;
  };
  canonicalAppId: string;
  legacyArtifacts: ArtifactDocLike[];
  canonicalArtifacts: ArtifactDocLike[];
  versionDocs: VersionDocLike[];
  actions: MongoArtifactRepairAction[];
}): Promise<void> {
  const legacyById = new Map(input.legacyArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  const canonicalById = new Map(input.canonicalArtifacts.map((artifact) => [artifact.artifactId, artifact]));

  for (const action of input.actions) {
    const legacyArtifact = legacyById.get(action.artifactId);
    if (!legacyArtifact) {
      continue;
    }

    if (action.type === 'move') {
      await input.artifacts.updateOne(
        { artifactId: action.artifactId },
        { $set: { appId: input.canonicalAppId } },
      );
      await input.versions.updateMany(
        { artifactId: action.artifactId },
        { $set: { appId: input.canonicalAppId } },
      );
      continue;
    }

    const canonicalArtifact = canonicalById.get(action.canonicalArtifactId);
    if (!canonicalArtifact) {
      continue;
    }
    if (action.duplicateVersionIds.length) {
      await input.versions.deleteMany({
        versionId: { $in: action.duplicateVersionIds },
      });
    }
    for (const version of action.movedVersions) {
      await input.versions.updateOne(
        { versionId: version.versionId },
        {
          $set: {
            artifactId: action.canonicalArtifactId,
            appId: input.canonicalAppId,
            version: version.version,
          },
        },
      );
    }

    const selectedArtifact = action.selectedSource === 'legacy' ? legacyArtifact : canonicalArtifact;
    const currentVersion = await input.versions.findOne({ versionId: action.currentVersionId });
    await input.artifacts.updateOne(
      { artifactId: action.canonicalArtifactId },
      {
        $set: {
          title: selectedArtifact.title,
          sourceToolCode: selectedArtifact.sourceToolCode,
          anchors: selectedArtifact.anchors,
          currentVersionId: action.currentVersionId,
          latestVersion: action.latestVersion,
          vectorStatus: selectedArtifact.vectorStatus ?? 'pending_embedding',
          chunkCount: selectedArtifact.chunkCount ?? 0,
          updatedAt: maxDateValue(legacyArtifact.updatedAt, canonicalArtifact.updatedAt) ?? new Date(),
          contentHash: currentVersion?.contentHash ?? selectedArtifact.contentHash,
        },
      },
    );
    await input.artifacts.deleteOne({ artifactId: action.artifactId });
  }
}

async function repairQdrantPayload(input: {
  apply: boolean;
  config: ReturnType<typeof loadAppConfig>;
  canonicalAppId: string;
  legacyAppIds: string[];
  versionIds: string[];
  logger: Pick<Console, 'warn'>;
}): Promise<AgentIsolationRepairSummary['qdrant']> {
  if (!input.apply || !input.versionIds.length || !input.legacyAppIds.length) {
    return { attempted: false, updatedVersionCount: 0 };
  }

  try {
    const client = new QdrantClient({
      url: input.config.qdrant.url,
      apiKey: input.config.qdrant.apiKey ?? undefined,
      checkCompatibility: false,
    });
    await client.setPayload(input.config.qdrant.collectionName, {
      wait: true,
      payload: { appId: input.canonicalAppId },
      filter: {
        must: [
          { key: 'appId', match: { any: input.legacyAppIds } },
          { key: 'versionId', match: { any: input.versionIds } },
        ],
      },
    } as any);
    return {
      attempted: true,
      updatedVersionCount: input.versionIds.length,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    input.logger.warn(`[repair] Qdrant payload repair failed: ${message}`);
    return {
      attempted: true,
      updatedVersionCount: 0,
      errorMessage: message,
    };
  }
}

function collectTouchedVersionIds(actions: MongoArtifactRepairAction[]): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    if (action.type === 'move') {
      action.versionIds.forEach((id) => ids.add(id));
    } else {
      action.movedVersions.forEach((version) => ids.add(version.versionId));
    }
  }
  return [...ids];
}

function writeBackup(envFilePath: string, payload: unknown): string {
  const rootDir = resolve(dirname(envFilePath));
  const backupDir = resolve(rootDir, '.local/repairs', timestampForPath());
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, 'agent-isolation-appid-backup.json');
  writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8');
  return backupPath;
}

function buildArtifactIdentityKey(artifact: Pick<ArtifactDocLike, 'kind' | 'anchorIdentity'>): string {
  return `${artifact.kind}:${artifact.anchorIdentity}`;
}

function compareVersionDocs(left: VersionDocLike, right: VersionDocLike): number {
  return (Number(left.version) || 0) - (Number(right.version) || 0)
    || String(left.versionId).localeCompare(String(right.versionId));
}

function isNewer(left: Date | string | undefined, right: Date | string | undefined): boolean {
  const leftTime = toTime(left);
  const rightTime = toTime(right);
  return leftTime > rightTime;
}

function maxDateValue(left: Date | string | undefined, right: Date | string | undefined): Date | string | undefined {
  return isNewer(left, right) ? left : right;
}

function toTime(value: Date | string | undefined): number {
  if (!value) {
    return 0;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function groupBy<T>(items: T[], readKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = readKey(item);
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  return grouped;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const envIndex = process.argv.findIndex((arg) => arg === '--env');
  const envFilePath = envIndex >= 0 ? process.argv[envIndex + 1] : undefined;
  const summary = await repairAgentIsolationAppId({ apply, envFilePath });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[repair] failed: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
