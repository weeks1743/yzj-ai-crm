import { basename, extname } from 'node:path';
import type {
  AppConfig,
  EnterprisePptTemplateItem,
  EnterprisePptTemplateListResponse,
  EnterprisePptTemplatePromptResponse,
  EnterprisePptTemplateUploadResponse,
} from './contracts.js';
import { DocmeeTemplateClient } from './docmee-template-client.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from './errors.js';
import { EnterprisePptTemplateRepository } from './enterprise-ppt-template-repository.js';

const DOCMEE_TOKEN_TTL_HOURS = 1;
const DEFAULT_ENTERPRISE_PPT_PROMPT =
  '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT';
const DOCMEE_PROMPT_MAX_LENGTH = 50;

function resolvePromptState(prompt: string | null | undefined): EnterprisePptTemplatePromptResponse {
  const defaultPrompt = prompt?.trim() || DEFAULT_ENTERPRISE_PPT_PROMPT;
  if ([...defaultPrompt].length <= DOCMEE_PROMPT_MAX_LENGTH) {
    return {
      defaultPrompt,
      effectivePrompt: defaultPrompt,
      promptMaxLength: DOCMEE_PROMPT_MAX_LENGTH,
      isFallbackApplied: false,
      fallbackReason: null,
    };
  }

  return {
    defaultPrompt,
    effectivePrompt: DEFAULT_ENTERPRISE_PPT_PROMPT,
    promptMaxLength: DOCMEE_PROMPT_MAX_LENGTH,
    isFallbackApplied: true,
    fallbackReason: `当前保存的提示词超过 Docmee 官方 ${DOCMEE_PROMPT_MAX_LENGTH} 字限制，运行时已回退系统默认短提示词。`,
  };
}

export class EnterprisePptTemplateService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: EnterprisePptTemplateRepository;
      client: DocmeeTemplateClient | null;
    },
  ) {}

  listTemplates(): EnterprisePptTemplateListResponse {
    const items = this.options.repository.list();
    const promptState = this.getPromptState();
    return {
      items,
      activeTemplate: items.find((item) => item.isActive) ?? null,
      ...promptState,
    };
  }

  getActiveTemplate(): EnterprisePptTemplateItem | null {
    return this.options.repository.getActive();
  }

  getDefaultPrompt(): string {
    return this.options.repository.getDefaultPrompt() ?? DEFAULT_ENTERPRISE_PPT_PROMPT;
  }

  getEffectivePrompt(): string {
    return this.getPromptState().effectivePrompt;
  }

  getPromptState(): EnterprisePptTemplatePromptResponse {
    return resolvePromptState(this.options.repository.getDefaultPrompt() ?? DEFAULT_ENTERPRISE_PPT_PROMPT);
  }

  updateDefaultPrompt(prompt: string): EnterprisePptTemplatePromptResponse {
    const resolvedPrompt = prompt.trim();
    if (!resolvedPrompt) {
      throw new BadRequestError('企业 PPT 缺省提示词不能为空');
    }

    if ([...resolvedPrompt].length > DOCMEE_PROMPT_MAX_LENGTH) {
      throw new BadRequestError(`企业 PPT 缺省提示词不能超过 ${DOCMEE_PROMPT_MAX_LENGTH} 个字符`);
    }

    return resolvePromptState(this.options.repository.updateDefaultPrompt(resolvedPrompt));
  }

  async uploadTemplate(input: {
    fileName: string;
    file: Buffer;
    name?: string;
  }): Promise<EnterprisePptTemplateUploadResponse> {
    this.assertValidPptxFile(input.fileName, input.file);
    const client = this.requireClient();
    const token = await this.createScopedToken('upload');
    const uploaded = await client.uploadTemplate({
      token,
      fileName: input.fileName,
      file: input.file,
    });

    const templateName = this.resolveTemplateName(input.fileName, input.name);
    await client.updateUserTemplate({
      templateId: uploaded.templateId,
      isPublic: false,
    });
    await client.updateTemplate({
      templateId: uploaded.templateId,
      name: templateName,
    });

    return {
      item: this.options.repository.save({
        templateId: uploaded.templateId,
        name: templateName,
        sourceFileName: input.fileName,
      }),
    };
  }

  async renameTemplate(templateId: string, name: string): Promise<{ item: EnterprisePptTemplateItem }> {
    const client = this.requireClient();
    const current = this.options.repository.getById(templateId);
    if (!current) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    const resolvedName = this.resolveTemplateName(current.sourceFileName, name);
    await client.updateUserTemplate({
      templateId,
      isPublic: current.isActive,
    });
    await client.updateTemplate({
      templateId,
      name: resolvedName,
    });

    return {
      item: this.options.repository.rename(templateId, resolvedName),
    };
  }

  async activateTemplate(templateId: string): Promise<{ item: EnterprisePptTemplateItem }> {
    const client = this.requireClient();
    const current = this.options.repository.getById(templateId);
    if (!current) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    await client.updateUserTemplate({
      templateId,
      isPublic: true,
    });

    return {
      item: this.options.repository.activate(templateId),
    };
  }

  async downloadTemplate(templateId: string): Promise<{
    item: EnterprisePptTemplateItem;
    fileName: string;
    file: Buffer;
  }> {
    const item = this.options.repository.getById(templateId);
    if (!item) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    const client = this.requireClient();
    const token = await this.createScopedToken('download');
    const downloaded = await client.downloadTemplateBinary({
      token,
      templateId,
    });

    return {
      item,
      fileName: item.sourceFileName || `${templateId}.pptx`,
      file: downloaded.file,
    };
  }

  async deleteTemplate(templateId: string): Promise<{ deletedTemplateId: string }> {
    const item = this.options.repository.getById(templateId);
    if (!item) {
      throw new NotFoundError(`企业 PPT 模板不存在: ${templateId}`);
    }

    const client = this.requireClient();
    const token = await this.createScopedToken('delete');
    await client.deleteTemplate({
      token,
      templateId,
    });
    this.options.repository.delete(templateId);

    return {
      deletedTemplateId: templateId,
    };
  }

  private requireClient(): DocmeeTemplateClient {
    if (!this.options.config.docmee.apiKey?.trim() || !this.options.client) {
      throw new ServiceUnavailableError('DOCMEE_API_KEY 未配置，无法管理企业 PPT 模板');
    }

    return this.options.client;
  }

  private async createScopedToken(purpose: string): Promise<string> {
    const client = this.requireClient();
    const payload = await client.createApiToken({
      uid: `ppt-${purpose}-${Date.now().toString(36).slice(-8)}`,
      limit: 3,
      timeOfHours: DOCMEE_TOKEN_TTL_HOURS,
    });

    return payload.token;
  }

  private resolveTemplateName(sourceFileName: string, candidate?: string): string {
    const resolved = candidate?.trim() || basename(sourceFileName, extname(sourceFileName)).trim();
    if (!resolved) {
      throw new BadRequestError('模板名称不能为空');
    }

    return resolved;
  }

  private assertValidPptxFile(fileName: string, file: Buffer): void {
    if (!fileName.trim().toLowerCase().endsWith('.pptx')) {
      throw new BadRequestError('仅支持上传 .pptx 模板文件');
    }

    if (file.byteLength <= 0) {
      throw new BadRequestError('上传的模板文件不能为空');
    }
  }
}
