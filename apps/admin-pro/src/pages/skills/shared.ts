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
import { externalSkillRows, sceneAssemblyDrafts, scenePlanPlaybooks } from '@shared';
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

export const salesStageOrder = [
  '拜访前准备',
  '拜访后收口',
  '拜访后第一步',
  '需求澄清',
  '方案澄清',
  '方案推进',
] as const;

export const salesPhaseOrder = [
  '拜访前准备',
  '拜访后收口',
  '拜访后分析',
  '方案推进',
] as const;

export const salesStageMeta: Record<string, {
  indexLabel: string;
  focus: string;
  helper: string;
  color: string;
}> = {
  拜访前准备: {
    indexLabel: '阶段 1',
    focus: '先看清客户、关系人和商机背景，再决定怎么拜访。',
    helper: '重点输出客户画像、关键关系人与拜访切入点。',
    color: 'blue',
  },
  拜访后收口: {
    indexLabel: '阶段 2',
    focus: '围绕录音或纪要，把客户、商机、跟进记录和分析动作串成闭环。',
    helper: '重点处理客户锚定、商机补齐和跟进记录沉淀。',
    color: 'cyan',
  },
  拜访后第一步: {
    indexLabel: '阶段 3',
    focus: '先把会话事实、承诺事项和风险信号读清楚。',
    helper: '重点沉淀可复用的会话理解结果。',
    color: 'geekblue',
  },
  需求澄清: {
    indexLabel: '阶段 4',
    focus: '把会话内容拆成客户需求、客户侧待办和我方待办。',
    helper: '重点回答谁要做什么、什么时候做。',
    color: 'gold',
  },
  方案澄清: {
    indexLabel: '阶段 5',
    focus: '把散落问题统一成问题定义，并进一步收束成客户价值表达。',
    helper: '重点统一背景、约束、影响范围、优先级以及价值表达口径。',
    color: 'orange',
  },
  方案推进: {
    indexLabel: '阶段 6',
    focus: '基于客户诉求与价值定位，匹配公司内部方案和案例，推动下一轮动作。',
    helper: '重点形成候选方案、案例引用和推进建议。',
    color: 'green',
  },
};

export const salesPhaseMeta: Record<string, {
  indexLabel: string;
  focus: string;
  helper: string;
  color: string;
  stageNames: string[];
}> = {
  拜访前准备: {
    indexLabel: '阶段 1',
    focus: '先看清客户、关系人和商机背景，再决定怎么拜访。',
    helper: '对应客户分析等拜访前场景。',
    color: 'blue',
    stageNames: ['拜访前准备'],
  },
  拜访后收口: {
    indexLabel: '阶段 2',
    focus: '围绕录音或纪要，把客户、商机、跟进记录和分析动作先收进一个闭环。',
    helper: '对应拜访后闭环这类复合场景。',
    color: 'cyan',
    stageNames: ['拜访后收口'],
  },
  拜访后分析: {
    indexLabel: '阶段 3',
    focus: '本质都是拜访后的分析加工：先理解会话，再拆需求，统一问题定义，并形成价值表达。',
    helper: '合并承载拜访会话理解、需求待办分析、问题陈述、客户价值定位四个分析场景。',
    color: 'geekblue',
    stageNames: ['拜访后第一步', '需求澄清', '方案澄清'],
  },
  方案推进: {
    indexLabel: '阶段 4',
    focus: '围绕客户诉求和价值定位去匹配公司内部方案和案例，推动下一轮方案动作。',
    helper: '对应方案匹配这类普通方案推进技能。',
    color: 'green',
    stageNames: ['方案推进'],
  },
};

export function getSalesPhaseByStage(stageName: string): string {
  return Object.entries(salesPhaseMeta).find(([, meta]) => meta.stageNames.includes(stageName))?.[0] ?? stageName;
}

export function getOrderedSalesPhases(stageNames: string[]): string[] {
  const uniquePhaseNames = Array.from(new Set(stageNames.map((stageName) => getSalesPhaseByStage(stageName))));
  return uniquePhaseNames.sort((left, right) => {
    const leftIndex = salesPhaseOrder.indexOf(left as (typeof salesPhaseOrder)[number]);
    const rightIndex = salesPhaseOrder.indexOf(right as (typeof salesPhaseOrder)[number]);

    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }

    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  });
}

export function getSalesPhaseColor(phaseName: string): string {
  return salesPhaseMeta[phaseName]?.color ?? 'default';
}

export function getOrderedSalesStages(stageNames: string[]): string[] {
  const uniqueStageNames = Array.from(new Set(stageNames));
  return uniqueStageNames.sort((left, right) => {
    const leftIndex = salesStageOrder.indexOf(left as (typeof salesStageOrder)[number]);
    const rightIndex = salesStageOrder.indexOf(right as (typeof salesStageOrder)[number]);

    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }

    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  });
}

export function sortSceneAssemblyViewsBySalesStage<T extends { salesStage: string }>(items: T[]): T[] {
  const orderedStageNames = getOrderedSalesStages(items.map((item) => item.salesStage));
  return [...items].sort(
    (left, right) =>
      orderedStageNames.indexOf(left.salesStage) - orderedStageNames.indexOf(right.salesStage),
  );
}

export function getSalesStageColor(stageName: string): string {
  return salesStageMeta[stageName]?.color ?? 'default';
}

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
      category: draft.category,
      salesStage: draft.salesStage,
      businessGoal: draft.businessGoal,
      entityAnchor: draft.entityAnchor,
      summary: draft.summary,
      triggerEntries: draft.triggerEntries,
      upstreamAssets: draft.upstreamAssets,
      outputs: draft.outputs,
      orchestrationChain: draft.orchestrationChain,
      playbook: scenePlanPlaybooks[draft.key],
      status: hasRecordSkillGap ? '依赖缺口' : hasExternalRisk ? '能力风险' : '待组装',
      recordSkillDependencies,
      externalSkillDependencies,
      gaps,
      boundaries: draft.boundaries,
    };
  });
}

const shadowOperationOrder: ShadowSkillOperation[] = ['search', 'get', 'create', 'update', 'delete'];
