import type {
  AppConfig,
  EnterprisePptTemplateItem,
  ExternalSkillCatalogItem,
  ExternalSkillDebugConfig,
  ExternalSkillJobArtifact,
  ExternalSkillJobRequest,
  ExternalSkillJobResponse,
  ExternalSkillPresentationSessionCloseRequest,
  ExternalSkillPresentationSessionHeartbeatRequest,
  ExternalSkillPresentationSessionOpenRequest,
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
  enterprisePptTemplateResolver?: {
    getActiveTemplate(): EnterprisePptTemplateItem | null;
    getDefaultPrompt(): string;
    getEffectivePrompt?(): string;
  };
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
  requiresModel?: boolean;
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
    }
  | {
      id: string;
      label: string;
      skillCode: 'ext.audio_transcribe';
      trigger: string;
      route?: string;
      dependencies: string[];
      owner: string;
      sla: string;
      summary: string;
      provider: string;
      debugMode: 'none';
      supportsInvoke: false;
      implementationType: 'placeholder';
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
    trigger: '拜访录音 / 会议纪要理解',
    route: '/chat/conversation-understanding',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责将拜访录音或纪要整理成可复用的会话理解资产，供后续需求和问题分析复用。',
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
    trigger: '需求澄清 / 待办拆解',
    route: '/chat/needs-todo-analysis',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责把会话理解结果转成需求清单与执行待办，是拜访后闭环的中间分析节点。',
    requestPlaceholder:
      '例如：基于一次客户拜访纪要，拆出客户需求、我方待办和责任归属。',
  },
  {
    id: 'ext-005',
    label: '问题陈述',
    skillCode: 'ext.problem_statement_pm',
    runtimeSkillName: 'problem-statement',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY'],
    artifactKind: 'markdown',
    trigger: '问题定义 / PRD 前置澄清',
    route: '/chat/problem-statement',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责把需求、约束和影响范围整理成统一问题陈述，供方案推进和内部评审使用。',
    requestPlaceholder:
      '例如：将“客户资料录入效率低”整理成用户视角的问题陈述和约束背景。',
  },
  {
    id: 'ext-006',
    label: '客户价值定位',
    skillCode: 'ext.customer_value_positioning_pm',
    runtimeSkillName: 'customer-value-positioning',
    provider: SKILL_RUNTIME_PROVIDER_CODE,
    requiredDependencies: ['env:DEEPSEEK_API_KEY'],
    artifactKind: 'markdown',
    trigger: '价值主张梳理 / 方案推进',
    route: '/chat/value-positioning',
    owner: '销售分析能力组',
    sla: 'P95 < 20 秒',
    summary: '负责把客户问题映射到金蝶价值表达，是从分析结论走向推进话术的外部供给能力。',
    requestPlaceholder:
      '例如：基于客户问题陈述，输出金蝶可交付的价值主张、推进话术和下一步建议。',
  },
  {
    id: 'ext-008',
    label: 'super-ppt',
    skillCode: 'ext.super_ppt',
    runtimeSkillName: 'super-ppt',
    provider: 'docmee-v2',
    requiredDependencies: ['env:DOCMEE_API_KEY'],
    artifactKind: 'presentation',
    requiresModel: false,
    trigger: 'Markdown 报告 / 企业研究 PPT 生成',
    route: '/skills/external-skills/super-ppt/editor',
    owner: '导出能力组',
    sla: 'P95 < 60 秒',
    summary: '通过 Docmee V2 API 将 markdown 企业研究报告生成可继续编辑的 PPT，并支持后台直接进入编辑器。',
    requestPlaceholder:
      '例如：请基于附件生成适合管理层审阅的企业研究汇报 PPT。',
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
    sla: 'P95 < 30 秒',
    summary: '已接入真实图片生成 provider，当前支持文生图与后台即时预览。',
    provider: IMAGE_PROVIDER_CODE,
    model: 'gpt-image-2',
    debugMode: 'image_generate',
    supportsInvoke: true,
    implementationType: 'http_request',
  },
  ...RUNTIME_SKILL_DEFINITIONS,
  {
    id: 'ext-007',
    label: '录音转写',
    skillCode: 'ext.audio_transcribe',
    trigger: '音频文件导入',
    route: '/chat/post-visit-loop',
    dependencies: ['语音服务 Provider', '对象存储'],
    owner: '语音能力组',
    sla: 'P95 < 5 分钟',
    summary: '作为拜访后闭环的音频入口供给，负责将录音先转成可供后续理解与分析消费的文本资产。',
    provider: 'tongyi_agent_provider',
    debugMode: 'none',
    supportsInvoke: false,
    implementationType: 'placeholder',
  },
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
    if (definition.requiresModel === false) {
      return {
        defaultModel: null,
        supportedModels: [],
        supportsAttachments: true,
        supportsWorkingDirectory: true,
        requestPlaceholder: definition.requestPlaceholder,
        artifactKind: definition.artifactKind,
      };
    }

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
      provider: IMAGE_PROVIDER_CODE,
      model: this.options.config.external.image.model,
      owner: '平台集成组',
      sla: 'P95 < 30 秒',
      summary: imageConfigured
        ? '已接入真实图片生成 provider，当前支持文生图与后台即时预览。'
        : '图片技能已注册，但本地 .env 尚未配置图片 API Key，当前只能展示目录与报错提示。',
    };
  }

  private buildPlaceholderSkill(definition: Extract<StaticExternalSkillDefinition, { implementationType: 'placeholder' }>): ExternalSkillCatalogItem {
    return {
      id: definition.id,
      label: definition.label,
      skillCode: definition.skillCode,
      type: '外部技能',
      trigger: definition.trigger,
      route: definition.route,
      dependencies: definition.dependencies,
      status: '占位中',
      implementationType: 'placeholder',
      supportsInvoke: false,
      debugMode: 'none',
      provider: definition.provider,
      model: null,
      owner: definition.owner,
      sla: definition.sla,
      summary: definition.summary,
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
    const displayModel = definition.requiresModel === false
      ? null
      : (debugConfig.defaultModel ?? DEFAULT_SKILL_RUNTIME_MODEL);

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

      return this.buildPlaceholderSkill(definition as Extract<StaticExternalSkillDefinition, { implementationType: 'placeholder' }>);
    });
  }

  async createSkillJob(skillCode: string, input: ExternalSkillJobRequest): Promise<ExternalSkillJobResponse> {
    const runtimeSkill = this.getRuntimeSkillDefinition(skillCode);
    const runtimeJob = await this.skillRuntimeClient.createJob(runtimeSkill.runtimeSkillName, {
      ...input,
      ...(skillCode === 'ext.super_ppt'
        ? {
            templateId: this.options.enterprisePptTemplateResolver?.getActiveTemplate()?.templateId,
            presentationPrompt:
              this.options.enterprisePptTemplateResolver?.getEffectivePrompt?.()
              ?? this.options.enterprisePptTemplateResolver?.getDefaultPrompt(),
          }
        : {}),
    });
    return this.transformRuntimeJob(runtimeJob);
  }

  async getSkillJob(jobId: string): Promise<ExternalSkillJobResponse> {
    return this.transformRuntimeJob(await this.skillRuntimeClient.getJob(jobId));
  }

  createPresentationSession(
    jobId: string,
    options?: {
      forceRefresh?: boolean;
    },
  ) {
    return this.skillRuntimeClient.createPresentationSession(jobId, options);
  }

  openPresentationSession(jobId: string, input: ExternalSkillPresentationSessionOpenRequest) {
    return this.skillRuntimeClient.openPresentationSession(jobId, input);
  }

  heartbeatPresentationSession(jobId: string, input: ExternalSkillPresentationSessionHeartbeatRequest) {
    return this.skillRuntimeClient.heartbeatPresentationSession(jobId, input);
  }

  closePresentationSession(jobId: string, input: ExternalSkillPresentationSessionCloseRequest) {
    return this.skillRuntimeClient.closePresentationSession(jobId, input);
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
