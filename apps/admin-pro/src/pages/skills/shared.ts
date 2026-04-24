import type {
  ExternalSkillCatalogItem,
  SceneAssemblyDependency,
  SceneAssemblyResolvedView,
  ShadowDictionaryBindingView,
  ShadowObjectDetailView,
  ShadowObjectKey,
  ShadowObjectSummaryView,
  ShadowSkillOperation,
  ShadowSkillView,
} from '@shared';
import { externalSkillRows, sceneAssemblyDrafts } from '@shared';
import { requestJson } from '@/utils/request';

export const shadowObjectOrder: ShadowObjectKey[] = [
  'customer',
  'contact',
  'opportunity',
  'followup',
];

export const shadowObjectLabels: Record<ShadowObjectKey, string> = {
  customer: '客户',
  contact: '联系人',
  opportunity: '商机',
  followup: '商机跟进记录',
};

export const shadowOperationLabels: Record<ShadowSkillOperation, string> = {
  search: '查询',
  get: '详情读取',
  create: '新建',
  update: '更新',
  delete: '删除',
};

export function sortShadowObjects<T extends { objectKey: ShadowObjectKey }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      shadowObjectOrder.indexOf(left.objectKey) - shadowObjectOrder.indexOf(right.objectKey),
  );
}

export async function fetchShadowObjects(): Promise<ShadowObjectSummaryView[]> {
  const objects = await requestJson<ShadowObjectSummaryView[]>('/api/shadow/objects');
  return sortShadowObjects(objects);
}

export async function fetchShadowObjectDetail(objectKey: ShadowObjectKey): Promise<ShadowObjectDetailView> {
  return requestJson<ShadowObjectDetailView>(`/api/shadow/objects/${objectKey}`);
}

export async function fetchShadowObjectSkills(objectKey: ShadowObjectKey): Promise<ShadowSkillView[]> {
  const skills = await requestJson<ShadowSkillView[]>(`/api/shadow/objects/${objectKey}/skills`);
  return [...skills].sort(
    (left, right) =>
      shadowOperationOrder.indexOf(left.operation) - shadowOperationOrder.indexOf(right.operation),
  );
}

export async function fetchShadowObjectDictionaries(
  objectKey: ShadowObjectKey,
): Promise<ShadowDictionaryBindingView[]> {
  return requestJson<ShadowDictionaryBindingView[]>(`/api/shadow/objects/${objectKey}/dictionaries`);
}

export async function refreshShadowObject(objectKey: ShadowObjectKey): Promise<ShadowObjectDetailView> {
  return requestJson<ShadowObjectDetailView>(`/api/shadow/objects/${objectKey}/refresh`, {
    method: 'POST',
  });
}

export function getActivationStatusLabel(status: ShadowObjectSummaryView['activationStatus']): string {
  switch (status) {
    case 'active':
      return '已激活';
    case 'pending':
      return '待接入';
    case 'not_configured':
      return '未配置';
  }
}

export function getActivationStatusColor(status: ShadowObjectSummaryView['activationStatus']) {
  switch (status) {
    case 'active':
      return 'success';
    case 'pending':
      return 'warning';
    case 'not_configured':
      return 'default';
  }
}

export function getRefreshStatusLabel(status: ShadowObjectSummaryView['refreshStatus']): string {
  switch (status) {
    case 'ready':
      return '已就绪';
    case 'failed':
      return '异常';
    case 'not_started':
      return '未刷新';
  }
}

export function getRefreshStatusColor(status: ShadowObjectSummaryView['refreshStatus']) {
  switch (status) {
    case 'ready':
      return 'processing';
    case 'failed':
      return 'error';
    case 'not_started':
      return 'default';
  }
}

export function getExecutionPhaseLabel(phase: ShadowSkillView['executionBinding']['phase']): string {
  switch (phase) {
    case 'preview_only':
      return '仅预演';
    case 'live_read_enabled':
      return '真实读取';
    case 'live_write_enabled':
      return '真实写入';
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function getSceneAssemblyStatusColor(status: SceneAssemblyResolvedView['status']) {
  switch (status) {
    case '待组装':
      return 'processing';
    case '依赖缺口':
      return 'error';
    case '能力风险':
      return 'warning';
  }
}

export async function fetchResolvedSceneAssemblyViews(): Promise<{
  objects: ShadowObjectSummaryView[];
  skillsByObject: Partial<Record<ShadowObjectKey, ShadowSkillView[]>>;
  views: SceneAssemblyResolvedView[];
}> {
  const objects = await fetchShadowObjects();
  const entries = await Promise.all(
    objects.map(async (objectItem) => ({
      objectKey: objectItem.objectKey,
      skills: await fetchShadowObjectSkills(objectItem.objectKey),
    })),
  );
  const skillsByObject = Object.fromEntries(
    entries.map((item) => [item.objectKey, item.skills]),
  ) as Partial<Record<ShadowObjectKey, ShadowSkillView[]>>;

  return {
    objects,
    skillsByObject,
    views: resolveSceneAssemblyViews({
      objects,
      skillsByObject,
    }),
  };
}

export function resolveSceneAssemblyViews(params: {
  skillsByObject: Partial<Record<ShadowObjectKey, ShadowSkillView[]>>;
  objects: ShadowObjectSummaryView[];
  externalSkills?: ExternalSkillCatalogItem[];
}): SceneAssemblyResolvedView[] {
  const objectsByKey = new Map(params.objects.map((item) => [item.objectKey, item]));
  const externalByCode = new Map(
    (params.externalSkills ?? externalSkillRows).map((item) => [item.skillCode, item]),
  );

  return sceneAssemblyDrafts.map((draft) => {
    const recordSkillDependencies: SceneAssemblyDependency[] = draft.recordSkillDependencies.map(
      (dependency) => {
        const object = objectsByKey.get(dependency.objectKey);
        const skill = (params.skillsByObject[dependency.objectKey] ?? []).find(
          (item) => item.skillName === dependency.skillName,
        );

        if (skill) {
          return {
            code: dependency.skillName,
            label: `${shadowObjectLabels[dependency.objectKey]}${shadowOperationLabels[dependency.operation]}`,
            layer: 'record_skill',
            status: 'available',
            objectKey: dependency.objectKey,
            operation: dependency.operation,
            summary: skill.description,
          };
        }

        return {
          code: dependency.skillName,
          label: `${shadowObjectLabels[dependency.objectKey]}${shadowOperationLabels[dependency.operation]}`,
          layer: 'record_skill',
          status: 'gap',
          objectKey: dependency.objectKey,
          operation: dependency.operation,
          reason:
            !object
              ? '对象未注册'
              : object.activationStatus !== 'active'
                ? `对象当前为${getActivationStatusLabel(object.activationStatus)}`
                : object.refreshStatus !== 'ready'
                  ? `对象刷新状态为${getRefreshStatusLabel(object.refreshStatus)}`
                  : '当前未生成对应技能',
        };
      },
    );

    const externalSkillDependencies: SceneAssemblyDependency[] = draft.externalSkillDependencies.map(
      (dependency) => {
        const skill = externalByCode.get(dependency.skillCode);

        if (!skill) {
          return {
            code: dependency.skillCode,
            label: dependency.label,
            layer: 'external_skill',
            status: 'risk',
            reason: '外部技能目录中不存在该能力',
          };
        }

        return {
          code: dependency.skillCode,
          label: dependency.label,
          layer: 'external_skill',
          status: skill.status === '运行中' ? 'available' : 'risk',
          route: skill.route,
          owner: skill.owner,
          summary: skill.summary,
          reason: skill.status === '运行中' ? undefined : '外部技能当前为告警中',
        };
      },
    );

    const gaps = [
      ...recordSkillDependencies.filter((item) => item.status === 'gap').map((item) => item.code),
      ...externalSkillDependencies.filter((item) => item.status === 'risk').map((item) => item.code),
    ];

    const hasRecordSkillGap = recordSkillDependencies.some((item) => item.status === 'gap');
    const hasExternalRisk = externalSkillDependencies.some((item) => item.status === 'risk');

    return {
      key: draft.key,
      label: draft.label,
      businessGoal: draft.businessGoal,
      entityAnchor: draft.entityAnchor,
      summary: draft.summary,
      status: hasRecordSkillGap ? '依赖缺口' : hasExternalRisk ? '能力风险' : '待组装',
      recordSkillDependencies,
      externalSkillDependencies,
      gaps,
      boundaries: draft.boundaries,
    };
  });
}

const shadowOperationOrder: ShadowSkillOperation[] = ['search', 'get', 'create', 'update', 'delete'];
