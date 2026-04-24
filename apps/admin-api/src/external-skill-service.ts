import type {
  AppConfig,
  ExternalSkillCatalogItem,
  FetchLike,
  ImageGenerationQuality,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageGenerationSize,
} from './contracts.js';
import {
  BadRequestError,
  ExternalSkillProviderError,
  ServiceUnavailableError,
} from './errors.js';

const IMAGE_PROVIDER_CODE = 'linkapi_images_provider';
const IMAGE_DEFAULT_MIME_TYPE = 'image/png';

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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBase64Image(base64OrDataUrl: string, mimeType: string): string {
  if (base64OrDataUrl.startsWith('data:')) {
    return base64OrDataUrl;
  }

  return `data:${mimeType};base64,${base64OrDataUrl}`;
}

export class ExternalSkillService {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ExternalSkillServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  listSkills(): ExternalSkillCatalogItem[] {
    const imageConfigured = Boolean(this.options.config.external.image.apiKey);

    return [
      {
        id: 'ext-001',
        label: '图片生成',
        skillCode: 'ext.image_generate',
        type: '外部技能',
        trigger: 'Prompt / 品牌海报 / 场景配图',
        dependencies: ['LinkAPI Images API', 'b64_json 预览归一化'],
        status: imageConfigured ? '运行中' : '告警中',
        implementationType: 'http_request',
        supportsInvoke: true,
        provider: IMAGE_PROVIDER_CODE,
        model: this.options.config.external.image.model,
        owner: '平台集成组',
        sla: 'P95 < 30 秒',
        summary: imageConfigured
          ? '已接入真实图片生成 provider，当前支持文生图与后台即时预览。'
          : '图片技能已注册，但本地 .env 尚未配置图片 API Key，当前只能展示目录与报错提示。',
      },
      {
        id: 'ext-002',
        label: '公司分析',
        skillCode: 'ext.company_research_pm',
        type: '外部技能',
        trigger: '公司名称 / 客户研究',
        route: '/chat/company-research',
        dependencies: ['研究服务 Provider', '来源解析', '快照沉淀'],
        status: '占位中',
        implementationType: 'placeholder',
        supportsInvoke: false,
        provider: 'mock_provider',
        model: null,
        owner: '研究能力组',
        sla: 'P95 < 10 秒',
        summary: '当前仍以占位能力展示，用于说明未来研究快照与场景依赖关系。',
      },
      {
        id: 'ext-003',
        label: '录音转写',
        skillCode: 'ext.audio_transcribe',
        type: '外部技能',
        trigger: '音频文件导入',
        route: '/chat/audio-import',
        dependencies: ['语音服务 Provider', '对象存储'],
        status: '占位中',
        implementationType: 'placeholder',
        supportsInvoke: false,
        provider: 'tongyi_agent_provider',
        model: null,
        owner: '语音能力组',
        sla: 'P95 < 5 分钟',
        summary: '当前页仅保留外部技能占位展示，不在本轮开放后台直接调用。',
      },
      {
        id: 'ext-004',
        label: 'PPT 生成',
        skillCode: 'ext.presentation_generate',
        type: '外部技能',
        trigger: '导出拜访材料',
        route: '/chat/visit-prepare',
        dependencies: ['文档渲染 Provider', '对象存储'],
        status: '占位中',
        implementationType: 'placeholder',
        supportsInvoke: false,
        provider: 'mock_provider',
        model: null,
        owner: '导出能力组',
        sla: 'P95 < 20 秒',
        summary: '作为准备拜访材料的扩展导出能力预留，本轮仍只做占位展示。',
      },
    ];
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
