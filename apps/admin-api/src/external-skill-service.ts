import type {
  AppConfig,
  ExternalSkillAssetMaterializationConfig,
  ExternalSkillCatalogItem,
  ExternalSkillDebugConfig,
  ExternalSkillJobArtifact,
  ExternalSkillJobRequest,
  ExternalSkillJobResponse,
  FetchLike,
  ImageGenerationQuality,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageGenerationSize,
  SkillRuntimeModelName,
} from './contracts.js';
import {
  BadRequestError,
  ExternalSkillProviderError,
  NotFoundError,
  ServiceUnavailableError,
} from './errors.js';
import {
  SkillRuntimeClient,
  type SkillRuntimeCatalogEntry,
  type SkillRuntimeJobResponse,
  type SkillRuntimeModelDescriptor,
} from './skill-runtime-client.js';

const IMAGE_PROVIDER_CODE = 'linkapi_images_provider';
const SKILL_RUNTIME_PROVIDER_CODE = 'skill-runtime';
const IMAGE_DEFAULT_MIME_TYPE = 'image/png';

const DEFAULT_SKILL_RUNTIME_MODEL: SkillRuntimeModelName = 'deepseek-v4-flash';
const FALLBACK_SKILL_RUNTIME_MODELS: SkillRuntimeModelName[] = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
];

const COMPANY_RESEARCH_ASSET_MATERIALIZATION: ExternalSkillAssetMaterializationConfig = {
  enabled: true,
  artifactKind: 'company_research',
  label: '公司研究资料',
  description: '生成后沉淀为可复用公司研究资料，可被拜访准备和问答检索复用。',
};

const RECORDING_ANALYSIS_ASSET_MATERIALIZATION: ExternalSkillAssetMaterializationConfig = {
  enabled: true,
  artifactKind: 'analysis_material',
  label: '录音分析资料',
  description: '基于录音资料包生成的分析结果会沉淀为可复用分析资料。',
};

const VISIT_PREP_ASSET_MATERIALIZATION: ExternalSkillAssetMaterializationConfig = {
  enabled: false,
  label: '本轮对话结果',
  description: '客户拜访准备仅返回本轮对话 Markdown，不沉淀为资料资产，也不进入向量检索。',
};

const NON_MATERIALIZED_ASSET_STRATEGY: ExternalSkillAssetMaterializationConfig = {
  enabled: false,
  label: '不沉淀资料资产',
  description: '该能力的输出不写入资料资产库。',
};

const ALLOWED_SIZES = new Set<ImageGenerationSize>([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
]);
const ALLOWED_QUALITIES = new Set<ImageGenerationQuality>(['auto', 'low', 'medium', 'high']);

interface ExternalSkillServiceOptions {
  config: AppConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface ImageGenerationPayload {
  data?: Array<{
    b64_json?: string;
    mime_type?: string;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
}

interface RuntimeBackedSkillDefinition {
  id: string;
  label: string;
  skillCode: string;
  runtimeSkillName: string;
  provider: string;
  requiredDependencies: string[];
  artifactKind: ExternalSkillDebugConfig['artifactKind'];
  assetMaterialization: ExternalSkillAssetMaterializationConfig;
  trigger: string;
  route?: string;
  owner: string;
  sla: string;
  summary: string;
  requestPlaceholder: string;
}

type StaticExternalSkillDefinition =
  | {
      id: string;
      label: string;
      skillCode: 'ext.image_generate';
      trigger: string;
      dependencies: string[];
      owner: string;
      sla: string;
      summary: string;
      provider: string;
      model: string;
      debugMode: 'image_generate';
      supportsInvoke: true;
      implementationType: 'http_request';
      assetMaterialization?: ExternalSkillAssetMaterializationConfig;
    }
  | RuntimeBackedSkillDefinition;

const RUNTIME_SKILL_DEFINITIONS: RuntimeBackedSkillDefinition[] = [
  {
    id: 'ext-002',
    label: '公司研究供给',
    skillCode: 'ext.company_research_pm',
    runtimeSkillName: 'company-research',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY', 'env:ARK_API_KEY'],
    artifactKind: 'markdown',
    assetMaterialization: COMPANY_RESEARCH_ASSET_MATERIALIZATION,
    trigger: '客户分析 / 公司研究',
    route: '/chat/customer-analysis',
    owner: '研究能力组',
    sla: 'P95 < 10 秒',
    summary: '作为客户分析场景的外部供给能力，补充客户公司的公开背景、风险与机会来源。',
    requestPlaceholder:
      '例如：研究绍兴贝斯美化工股份有限公司，输出业务定位、成长驱动、核心风险和来源引用。',
  },
  {
    id: 'ext-003',
    label: '拜访会话理解',
    skillCode: 'ext.visit_conversation_understanding',
    runtimeSkillName: 'visit-conversation-understanding',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY'],
    artifactKind: 'markdown',
    assetMaterialization: RECORDING_ANALYSIS_ASSET_MATERIALIZATION,
    trigger: '拜访录音 / 会议纪要理解',
    route: '/chat/conversation-understanding',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责将拜访录音或纪要整理成可复用的会话理解资产，供后续需求分析和价值定位复用。',
    requestPlaceholder:
      '例如：基于一段客户拜访纪要，输出摘要、关键事实、承诺事项和风险信号。',
  },
  {
    id: 'ext-004',
    label: '客户需求工作待办分析',
    skillCode: 'ext.customer_needs_todo_analysis',
    runtimeSkillName: 'customer-needs-todo-analysis',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY'],
    artifactKind: 'markdown',
    assetMaterialization: RECORDING_ANALYSIS_ASSET_MATERIALIZATION,
    trigger: '需求澄清 / 待办拆解',
    route: '/chat/needs-todo-analysis',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责把会话理解结果转成需求清单与执行待办，是拜访后闭环的中间分析节点。',
    requestPlaceholder:
      '例如：基于一次客户拜访纪要，拆出客户需求、我方待办和责任归属。',
  },
  {
    id: 'ext-006',
    label: '客户价值定位',
    skillCode: 'ext.customer_value_positioning_pm',
    runtimeSkillName: 'customer-value-positioning',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY'],
    artifactKind: 'markdown',
    assetMaterialization: RECORDING_ANALYSIS_ASSET_MATERIALIZATION,
    trigger: '价值主张梳理 / 方案推进',
    route: '/chat/value-positioning',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责把客户需求与业务目标映射到金蝶价值表达，是从分析结论走向推进话术的外部供给能力。',
    requestPlaceholder:
      '例如：基于客户需求工作待办分析，输出金蝶可交付的价值主张、推进话术和下一步建议。',
  },
  {
    id: 'ext-009',
    label: '客户拜访准备助手',
    skillCode: 'ext.yunzhijia_visit_prep',
    runtimeSkillName: 'yunzhijia-visit-prep',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY', '有效公司研究 md'],
    artifactKind: 'markdown',
    assetMaterialization: VISIT_PREP_ASSET_MATERIALIZATION,
    trigger: '拜访准备 / 客户拜访 / 讲解提纲 / 客户演示准备',
    route: '/chat',
    owner: '云之家销售赋能组',
    sla: 'P95 < 20 秒',
    summary: '基于已沉淀的公司研究资料和客户初步需求，生成云之家销售拜访讲解提纲、话术要点与竞品应对。',
    requestPlaceholder:
      '例如：基于公司研究 md，为绍兴贝斯美化工股份有限公司准备拜访材料，客户关注统一门户和流程审批。',
  },
];

const STATIC_EXTERNAL_SKILLS: StaticExternalSkillDefinition[] = [
  {
    id: 'ext-001',
    label: '图片生成',
    skillCode: 'ext.image_generate',
    trigger: 'Prompt / 品牌海报 / 场景配图',
    dependencies: ['LinkAPI Images API', 'b64_json 预览归一化'],
    owner: '平台集成组',
    sla: '超时 150 秒',
    summary: '已接入真实图片生成 provider，当前支持文生图与后台即时预览。',
    provider: IMAGE_PROVIDER_CODE,
    model: 'gpt-image-2',
    debugMode: 'image_generate',
    supportsInvoke: true,
    implementationType: 'http_request',
    assetMaterialization: NON_MATERIALIZED_ASSET_STRATEGY,
  },
  ...RUNTIME_SKILL_DEFINITIONS,
];

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBase64Image(base64OrDataUrl: string, mimeType: string): string {
  if (base64OrDataUrl.startsWith('data:')) {
    return base64OrDataUrl;
  }

  return `data:${mimeType};base64,${base64OrDataUrl}`;
}

function isRuntimeBackedSkill(value: StaticExternalSkillDefinition): value is RuntimeBackedSkillDefinition {
  return 'runtimeSkillName' in value;
}

function formatMissingDependencies(missingDependencies: string[]): string {
  return missingDependencies.join('、');
}

export class ExternalSkillService {
  private readonly fetchImpl: FetchLike;
  private readonly skillRuntimeClient: SkillRuntimeClient;
  private readonly runtimeSkillByCode = new Map(
    RUNTIME_SKILL_DEFINITIONS.map((item) => [item.skillCode, item]),
  );
  private readonly runtimeSkillByName = new Map(
    RUNTIME_SKILL_DEFINITIONS.map((item) => [item.runtimeSkillName, item]),
  );

  constructor(private readonly options: ExternalSkillServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.skillRuntimeClient = new SkillRuntimeClient({
      baseUrl: options.config.external.skillRuntime.baseUrl,
      fetchImpl: this.fetchImpl,
    });
  }

  private buildSkillDebugConfig(
    definition: RuntimeBackedSkillDefinition,
    models: SkillRuntimeModelDescriptor[],
  ): ExternalSkillDebugConfig {
    const supportedModels = models.length > 0
      ? models.map((item) => item.name)
      : FALLBACK_SKILL_RUNTIME_MODELS;
    const defaultModel = models.find((item) => item.isDefault)?.name ?? supportedModels[0] ?? DEFAULT_SKILL_RUNTIME_MODEL;

    return {
      defaultModel,
      supportedModels,
      supportsAttachments: true,
      supportsWorkingDirectory: true,
      requestPlaceholder: definition.requestPlaceholder,
      artifactKind: definition.artifactKind,
    };
  }

  private buildImageSkill(): ExternalSkillCatalogItem {
    const imageConfigured = Boolean(this.options.config.external.image.apiKey);
    return {
      id: 'ext-001',
      label: '图片生成',
      skillCode: 'ext.image_generate',
      type: '外部技能',
      trigger: 'Prompt / 品牌海报 / 场景配图',
      dependencies: ['LinkAPI Images API', 'b64_json 预览归一化'],
      status: imageConfigured ? '运行中' : '告警中',
      implementationType: 'http_request',
      supportsInvoke: true,
      debugMode: 'image_generate',
      debugConfig: {
        artifactKind: 'image',
      },
      assetMaterialization: NON_MATERIALIZED_ASSET_STRATEGY,
      provider: IMAGE_PROVIDER_CODE,
      model: this.options.config.external.image.model,
      owner: '平台集成组',
      sla: '超时 150 秒',
      summary: imageConfigured
        ? '已接入真实图片生成 provider，当前支持文生图与后台即时预览。'
        : '图片技能已注册，但本地 .env 尚未配置图片 API Key，当前只能展示目录与报错提示。',
    };
  }

  private buildRuntimeBackedSkill(
    definition: RuntimeBackedSkillDefinition,
    runtimeCatalog: Map<string, SkillRuntimeCatalogEntry>,
    models: SkillRuntimeModelDescriptor[],
    runtimeError: Error | null,
  ): ExternalSkillCatalogItem {
    const runtimeEntry = runtimeCatalog.get(definition.runtimeSkillName);
    const debugConfig = this.buildSkillDebugConfig(definition, models);
    const displayModel = debugConfig.defaultModel ?? DEFAULT_SKILL_RUNTIME_MODEL;

    if (runtimeError) {
      return {
        id: definition.id,
        label: definition.label,
        skillCode: definition.skillCode,
        type: '外部技能',
        trigger: definition.trigger,
        route: definition.route,
        dependencies: definition.requiredDependencies,
        status: '告警中',
        implementationType: 'skill',
        supportsInvoke: true,
        runtimeSkillName: definition.runtimeSkillName,
        debugMode: 'skill_job',
        debugConfig,
        assetMaterialization: definition.assetMaterialization,
        provider: definition.provider,
        model: displayModel,
        owner: definition.owner,
        sla: definition.sla,
        summary: `已注册到 skill-runtime，但当前服务不可达：${runtimeError.message}`,
      };
    }

    if (!runtimeEntry) {
      return {
        id: definition.id,
        label: definition.label,
        skillCode: definition.skillCode,
        type: '外部技能',
        trigger: definition.trigger,
        route: definition.route,
        dependencies: definition.requiredDependencies,
        status: '告警中',
        implementationType: 'skill',
        supportsInvoke: true,
        runtimeSkillName: definition.runtimeSkillName,
        debugMode: 'skill_job',
        debugConfig,
        assetMaterialization: definition.assetMaterialization,
        provider: definition.provider,
        model: displayModel,
        owner: definition.owner,
        sla: definition.sla,
        summary: '外部技能已登记，但当前 skill-runtime catalog 中未发现对应 skill。',
      };
    }

    const status = runtimeEntry.status === 'available' ? '运行中' : '告警中';
    const summary = runtimeEntry.status === 'blocked' && runtimeEntry.missingDependencies.length > 0
      ? `已接入 skill-runtime，但当前缺少依赖：${formatMissingDependencies(runtimeEntry.missingDependencies)}`
      : runtimeEntry.status === 'unsupported_yet'
        ? 'skill-runtime 已发现该能力，但当前尚未开放执行。'
        : definition.summary;

    return {
      id: definition.id,
      label: definition.label,
      skillCode: definition.skillCode,
      type: '外部技能',
      trigger: definition.trigger,
      route: definition.route,
      dependencies: runtimeEntry.requiredDependencies.length > 0
        ? runtimeEntry.requiredDependencies
        : definition.requiredDependencies,
      status,
      implementationType: 'skill',
      supportsInvoke: true,
      runtimeSkillName: definition.runtimeSkillName,
      debugMode: 'skill_job',
      debugConfig,
      assetMaterialization: definition.assetMaterialization,
      provider: definition.provider,
      model: displayModel,
      missingDependencies: runtimeEntry.missingDependencies,
      owner: definition.owner,
      sla: definition.sla,
      summary,
    };
  }

  private transformRuntimeJob(runtimeJob: SkillRuntimeJobResponse): ExternalSkillJobResponse {
    const mappedSkill = this.runtimeSkillByName.get(runtimeJob.skillName);
    if (!mappedSkill) {
      throw new ExternalSkillProviderError(`skill-runtime 返回了未映射的 skill: ${runtimeJob.skillName}`, 502);
    }

    return {
      jobId: runtimeJob.jobId,
      skillCode: mappedSkill.skillCode,
      runtimeSkillName: runtimeJob.skillName,
      model: runtimeJob.model,
      status: runtimeJob.status,
      finalText: runtimeJob.finalText,
      events: runtimeJob.events.map((event) => ({
        ...event,
        type: event.type as ExternalSkillJobResponse['events'][number]['type'],
      })),
      artifacts: runtimeJob.artifacts.map((artifact) => ({
        ...artifact,
        downloadPath: `/api/external-skills/jobs/${encodeURIComponent(runtimeJob.jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`,
      })),
      error: runtimeJob.error,
      createdAt: runtimeJob.createdAt,
      updatedAt: runtimeJob.updatedAt,
    };
  }

  private getRuntimeSkillDefinition(skillCode: string): RuntimeBackedSkillDefinition {
    const skillDefinition = this.runtimeSkillByCode.get(skillCode);
    if (!skillDefinition) {
      throw new NotFoundError(`外部技能目录中不存在该能力，或该能力不是 skill 类型: ${skillCode}`);
    }

    return skillDefinition;
  }

  getSkillAssetMaterialization(skillCode: string): ExternalSkillAssetMaterializationConfig | null {
    const skillDefinition = STATIC_EXTERNAL_SKILLS.find((item) => item.skillCode === skillCode);
    return skillDefinition?.assetMaterialization ?? null;
  }

  async listSkills(): Promise<ExternalSkillCatalogItem[]> {
    let runtimeCatalog = new Map<string, SkillRuntimeCatalogEntry>();
    let runtimeModels: SkillRuntimeModelDescriptor[] = [];
    let runtimeError: Error | null = null;

    try {
      const [catalogEntries, modelEntries] = await Promise.all([
        this.skillRuntimeClient.listSkills(),
        this.skillRuntimeClient.listModels(),
      ]);
      runtimeCatalog = new Map(catalogEntries.map((item) => [item.skillName, item]));
      runtimeModels = modelEntries;
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error));
    }

    return STATIC_EXTERNAL_SKILLS.map((definition) => {
      if (definition.skillCode === 'ext.image_generate') {
        return this.buildImageSkill();
      }

      if (isRuntimeBackedSkill(definition)) {
        return this.buildRuntimeBackedSkill(definition, runtimeCatalog, runtimeModels, runtimeError);
      }

      throw new Error(`Unsupported external skill definition: ${definition.skillCode}`);
    });
  }

  async createSkillJob(skillCode: string, input: ExternalSkillJobRequest): Promise<ExternalSkillJobResponse> {
    const runtimeSkill = this.getRuntimeSkillDefinition(skillCode);
    const runtimeJob = await this.skillRuntimeClient.createJob(runtimeSkill.runtimeSkillName, {
      ...input,
    });
    return this.transformRuntimeJob(runtimeJob);
  }

  async getSkillJob(jobId: string): Promise<ExternalSkillJobResponse> {
    return this.transformRuntimeJob(await this.skillRuntimeClient.getJob(jobId));
  }

  async listSkillJobs(input: {
    skillCode?: string;
    status?: ExternalSkillJobResponse['status'];
    query?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ jobs: ExternalSkillJobResponse[]; page: number; pageSize: number; total: number }> {
    const runtimeSkill = input.skillCode?.trim()
      ? this.getRuntimeSkillDefinition(input.skillCode.trim())
      : null;
    const result = await this.skillRuntimeClient.listJobs({
      skillName: runtimeSkill?.runtimeSkillName,
      status: input.status,
      query: input.query,
      page: input.page,
      pageSize: input.pageSize,
    });
    const jobs = result.jobs
      .map((job) => this.transformRuntimeJob(job))
      .filter((job) => !input.skillCode?.trim() || job.skillCode === input.skillCode.trim());
    return {
      jobs,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  async getSkillJobArtifact(jobId: string, artifactId: string): Promise<{
    artifact: ExternalSkillJobArtifact;
    content: Buffer;
  }> {
    const job = await this.getSkillJob(jobId);
    const artifact = job.artifacts.find((item) => item.artifactId === artifactId);
    if (!artifact) {
      throw new NotFoundError(`未找到指定产物: ${artifactId}`);
    }

    const payload = await this.skillRuntimeClient.downloadArtifact(jobId, artifactId);
    return {
      artifact: {
        ...artifact,
        fileName: payload.fileName || artifact.fileName,
        mimeType: payload.mimeType || artifact.mimeType,
      },
      content: payload.content,
    };
  }

  async generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new BadRequestError('图片生成必须提供 prompt');
    }

    const size = (input.size ?? 'auto') as ImageGenerationSize;
    if (!ALLOWED_SIZES.has(size)) {
      throw new BadRequestError(`不支持的图片尺寸: ${size}`);
    }

    const quality = (input.quality ?? 'auto') as ImageGenerationQuality;
    if (!ALLOWED_QUALITIES.has(quality)) {
      throw new BadRequestError(`不支持的图片质量: ${quality}`);
    }

    const { baseUrl, apiKey, model, timeoutMs } = this.options.config.external.image;
    if (!apiKey) {
      throw new ServiceUnavailableError(
        '图片生成技能尚未配置 EXT_IMAGE_API_KEY，请先在本地 .env 中补齐后再试',
      );
    }

    const startedAt = Date.now();
    let response: Response;

    try {
      response = await this.fetchImpl(`${trimTrailingSlash(baseUrl)}/v1/images/generations`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          size,
          quality,
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new ExternalSkillProviderError('图片生成请求超时，请稍后重试', 504, {
          provider: IMAGE_PROVIDER_CODE,
        });
      }

      throw new ExternalSkillProviderError('图片生成请求失败，请检查 provider 配置或网络状态', 502, {
        provider: IMAGE_PROVIDER_CODE,
        cause: error,
      });
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new ExternalSkillProviderError('图片生成 provider 返回了非 JSON 响应', 502, {
        provider: IMAGE_PROVIDER_CODE,
        status: response.status,
        body: text.slice(0, 500),
      });
    }

    const payload = (await response.json()) as ImageGenerationPayload;

    if (!response.ok) {
      const errorMessage =
        payload.error?.message?.trim() ||
        payload.message?.trim() ||
        `图片生成 provider 返回异常状态 ${response.status}`;
      throw new ExternalSkillProviderError(`图片生成失败：${errorMessage}`, 502, {
        provider: IMAGE_PROVIDER_CODE,
        status: response.status,
      });
    }

    const firstImage = payload.data?.[0];
    const b64Value = firstImage?.b64_json?.trim();
    if (!b64Value) {
      throw new ExternalSkillProviderError('图片生成成功返回，但未携带可预览的 b64_json 数据', 502, {
        provider: IMAGE_PROVIDER_CODE,
      });
    }

    const mimeType = firstImage?.mime_type?.trim() || IMAGE_DEFAULT_MIME_TYPE;

    return {
      skillCode: 'ext.image_generate',
      model,
      provider: IMAGE_PROVIDER_CODE,
      size,
      quality,
      previewDataUrl: normalizeBase64Image(b64Value, mimeType),
      mimeType,
      latencyMs: Date.now() - startedAt,
      generatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
  }
}
