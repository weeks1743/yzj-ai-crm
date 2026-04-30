import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Busboy from 'busboy';
import type {
  ApiErrorResponse,
  AppConfig,
  AgentChatRequest,
  AgentMetaQuestionOptionsRequest,
  AgentRecordSearchPageRequest,
  ArtifactSearchRequest,
  CompanyResearchArtifactRequest,
  EnterprisePptTemplatePromptResponse,
  EnterprisePptTemplateUploadResponse,
  ExternalSkillJobRequest,
  ExternalSkillPresentationSessionCloseRequest,
  ExternalSkillPresentationSessionHeartbeatRequest,
  ExternalSkillPresentationSessionOpenRequest,
  ImageGenerationRequest,
  ShadowObjectKey,
  ShadowPreviewDeleteInput,
  ShadowPreviewGetInput,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
} from './contracts.js';
import { ApprovalFileService } from './approval-file-service.js';
import type { AgentObservabilityService } from './agent-observability-service.js';
import { AgentService } from './agent-service.js';
import { AppError, BadRequestError, ServiceUnavailableError } from './errors.js';
import { ArtifactPresentationService } from './artifact-presentation-service.js';
import { ArtifactService } from './artifact-service.js';
import { EnterprisePptTemplateService } from './enterprise-ppt-template-service.js';
import { ExternalSkillService } from './external-skill-service.js';
import { OrgSyncService, getRunIdFromConflict } from './org-sync-service.js';
import type { OrgSyncRepository } from './org-sync-repository.js';
import { getTenantAppSettings, getYzjAuthSettings } from './settings-service.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';
import { buildMetaQuestionOptionsResponse, buildRecordSearchPageResponse } from './crm-agent-pack.js';

interface CreateAdminApiServerOptions {
  config: AppConfig;
  orgSyncService: OrgSyncService;
  orgSyncRepository?: Pick<OrgSyncRepository, 'findEmployees'>;
  shadowMetadataService: ShadowMetadataService;
  approvalFileService: ApprovalFileService;
  externalSkillService: ExternalSkillService;
  enterprisePptTemplateService: EnterprisePptTemplateService;
  artifactService?: ArtifactService;
  artifactPresentationService?: ArtifactPresentationService;
  agentService?: AgentService;
  agentObservabilityService?: AgentObservabilityService;
}

const SHADOW_OBJECT_KEYS = new Set<ShadowObjectKey>([
  'customer',
  'contact',
  'opportunity',
  'followup',
]);

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

function writeError(response: ServerResponse, error: unknown): void {
  if (error instanceof AppError) {
    const payload: ApiErrorResponse = {
      code: error.code,
      message: error.message,
    };

    const runId = getRunIdFromConflict(error);
    if (runId) {
      payload.runId = runId;
    }

    writeJson(response, error.statusCode, payload);
    return;
  }

  console.error('[admin-api] unhandled request error', error);
  writeJson(response, 500, {
    code: 'INTERNAL_SERVER_ERROR',
    message: '服务内部错误',
  } satisfies ApiErrorResponse);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new BadRequestError('请求体必须是合法 JSON', { cause: error });
  }
}

async function readMultipartBody(request: IncomingMessage): Promise<{
  fields: Record<string, string>;
  files: Array<{
    fieldName: string;
    fileName: string;
    mimeType: string;
    content: Buffer;
  }>;
}> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new BadRequestError('请求必须是 multipart/form-data');
  }

  return new Promise((resolvePromise, reject) => {
    const fields: Record<string, string> = {};
    const files: Array<{
      fieldName: string;
      fileName: string;
      mimeType: string;
      content: Buffer;
    }> = [];
    const busboy = Busboy({
      headers: request.headers,
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (fieldName, fileStream, info) => {
      const chunks: Buffer[] = [];
      fileStream.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      fileStream.on('end', () => {
        files.push({
          fieldName,
          fileName: normalizeMultipartFileName(info.filename),
          mimeType: info.mimeType,
          content: Buffer.concat(chunks),
        });
      });
      fileStream.on('error', (error) => {
        reject(new BadRequestError('上传文件读取失败', { cause: error }));
      });
    });

    busboy.on('error', (error) => {
      reject(new BadRequestError('multipart 请求解析失败', { cause: error }));
    });

    busboy.on('finish', () => {
      resolvePromise({ fields, files });
    });

    request.pipe(busboy);
  });
}

function normalizeMultipartFileName(fileName: string): string {
  if (!/[\u00C0-\u00FF]/.test(fileName)) {
    return fileName;
  }

  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
  return /[^\u0000-\u007F]/.test(decoded) ? decoded : fileName;
}

function parseShadowObjectKey(value: string): ShadowObjectKey {
  if (SHADOW_OBJECT_KEYS.has(value as ShadowObjectKey)) {
    return value as ShadowObjectKey;
  }

  throw new BadRequestError(`未知影子对象: ${value}`);
}

function parseOptionalPositiveInteger(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function createAdminApiServer(options: CreateAdminApiServerOptions) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (method === 'OPTIONS') {
      writeJson(response, 204, {});
      return;
    }

    try {
      if (method === 'GET' && url.pathname === '/api/settings/tenant-app') {
        writeJson(response, 200, getTenantAppSettings(options.config));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/settings/yzj-auth') {
        writeJson(response, 200, getYzjAuthSettings(options.config));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/settings/org-sync') {
        writeJson(response, 200, options.orgSyncService.getSettings());
        return;
      }

      if (method === 'POST' && url.pathname === '/api/settings/org-sync/manual-sync') {
        writeJson(response, 202, options.orgSyncService.startManualSync());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/settings/ppt-templates') {
        writeJson(response, 200, options.enterprisePptTemplateService.listTemplates());
        return;
      }

      if (method === 'POST' && url.pathname === '/api/settings/ppt-templates/default-prompt') {
        const payload = await readJsonBody<{ prompt?: string }>(request);
        const result: EnterprisePptTemplatePromptResponse =
          options.enterprisePptTemplateService.updateDefaultPrompt(payload.prompt ?? '');
        writeJson(
          response,
          200,
          result,
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/api/settings/ppt-templates/upload') {
        const payload = await readMultipartBody(request);
        const file = payload.files.find((item) => item.fieldName === 'file') ?? payload.files[0];
        if (!file) {
          throw new BadRequestError('请上传 .pptx 模板文件');
        }

        const result = await options.enterprisePptTemplateService.uploadTemplate({
          fileName: file.fileName,
          file: file.content,
          name: payload.fields.name,
        });
        writeJson(response, 201, result satisfies EnterprisePptTemplateUploadResponse);
        return;
      }

      if (url.pathname.startsWith('/api/settings/ppt-templates/')) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 5) {
          const templateId = decodeURIComponent(parts[3] ?? '');
          const action = parts[4] ?? '';

          if (method === 'POST' && action === 'rename') {
            const payload = await readJsonBody<{ name?: string }>(request);
            writeJson(
              response,
              200,
              await options.enterprisePptTemplateService.renameTemplate(templateId, payload.name ?? ''),
            );
            return;
          }

          if (method === 'POST' && action === 'activate') {
            writeJson(response, 200, await options.enterprisePptTemplateService.activateTemplate(templateId));
            return;
          }

          if (method === 'GET' && action === 'download') {
            const payload = await options.enterprisePptTemplateService.downloadTemplate(templateId);
            response.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'Content-Length': String(payload.file.byteLength),
              'Content-Disposition': `attachment; filename="${encodeURIComponent(payload.fileName)}"`,
              'Access-Control-Allow-Origin': '*',
            });
            response.end(payload.file);
            return;
          }

          if (method === 'POST' && action === 'delete') {
            writeJson(response, 200, await options.enterprisePptTemplateService.deleteTemplate(templateId));
            return;
          }
        }
      }

      if (method === 'GET' && url.pathname === '/api/shadow/objects') {
        writeJson(response, 200, options.shadowMetadataService.listObjects());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/external-skills') {
        writeJson(response, 200, await options.externalSkillService.listSkills());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/runs') {
        if (!options.agentObservabilityService) {
          throw new ServiceUnavailableError('Agent 观测服务未启用');
        }
        writeJson(response, 200, options.agentObservabilityService.listRuns({
          page: parseOptionalPositiveInteger(url.searchParams.get('page')),
          pageSize: parseOptionalPositiveInteger(url.searchParams.get('pageSize')),
          status: url.searchParams.get('status') ?? undefined,
          sceneKey: url.searchParams.get('sceneKey') ?? undefined,
          conversationKey: url.searchParams.get('conversationKey') ?? undefined,
          traceId: url.searchParams.get('traceId') ?? undefined,
        }));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/confirmations') {
        if (!options.agentObservabilityService) {
          throw new ServiceUnavailableError('Agent 观测服务未启用');
        }
        writeJson(response, 200, options.agentObservabilityService.listConfirmations({
          page: parseOptionalPositiveInteger(url.searchParams.get('page')),
          pageSize: parseOptionalPositiveInteger(url.searchParams.get('pageSize')),
          status: url.searchParams.get('status') ?? undefined,
          runId: url.searchParams.get('runId') ?? undefined,
        }));
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/api/agent/runs/')) {
        if (!options.agentObservabilityService) {
          throw new ServiceUnavailableError('Agent 观测服务未启用');
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 4) {
          const runId = decodeURIComponent(parts[3] ?? '');
          writeJson(response, 200, options.agentObservabilityService.getRunDetail(runId));
          return;
        }
      }

      if (method === 'POST' && url.pathname === '/api/agent/chat') {
        if (!options.agentService) {
          throw new ServiceUnavailableError('Agent Runtime 服务未启用');
        }
        const payload = await readJsonBody<AgentChatRequest>(request);
        writeJson(response, 200, await options.agentService.chat(payload));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/agent/record-search-page') {
        const payload = await readJsonBody<AgentRecordSearchPageRequest>(request);
        const objectKey = parseShadowObjectKey(payload.objectKey);
        writeJson(
          response,
          200,
          await buildRecordSearchPageResponse({
            shadowMetadataService: options.shadowMetadataService,
            request: {
              ...payload,
              objectKey,
            },
          }),
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/api/agent/meta-question-options') {
        const payload = await readJsonBody<AgentMetaQuestionOptionsRequest>(request);
        writeJson(
          response,
          200,
          await buildMetaQuestionOptionsResponse({
            config: options.config,
            shadowMetadataService: options.shadowMetadataService,
            orgSyncRepository: options.orgSyncRepository,
            request: payload,
          }),
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/api/external-skills/image-generate') {
        const payload = await readJsonBody<ImageGenerationRequest>(request);
        writeJson(response, 200, await options.externalSkillService.generateImage(payload));
        return;
      }

      if (url.pathname.startsWith('/api/external-skills/')) {
        const parts = url.pathname.split('/').filter(Boolean);

        if (method === 'POST' && parts.length === 4 && parts[3] === 'jobs') {
          const skillCode = decodeURIComponent(parts[2] ?? '');
          const payload = await readJsonBody<ExternalSkillJobRequest>(request);
          writeJson(response, 202, await options.externalSkillService.createSkillJob(skillCode, payload));
          return;
        }

        if (method === 'GET' && parts.length === 4 && parts[2] === 'jobs') {
          const jobId = decodeURIComponent(parts[3] ?? '');
          writeJson(response, 200, await options.externalSkillService.getSkillJob(jobId));
          return;
        }

        if (method === 'POST' && parts.length === 5 && parts[2] === 'jobs' && parts[4] === 'presentation-session') {
          const jobId = decodeURIComponent(parts[3] ?? '');
          writeJson(
            response,
            200,
            await options.externalSkillService.createPresentationSession(jobId, {
              forceRefresh: ['1', 'true'].includes(url.searchParams.get('refresh') || ''),
            }),
          );
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[2] === 'jobs' && parts[4] === 'presentation-session') {
          const jobId = decodeURIComponent(parts[3] ?? '');
          const action = decodeURIComponent(parts[5] ?? '');
          if (action === 'open') {
            const payload = await readJsonBody<ExternalSkillPresentationSessionOpenRequest>(request);
            const result = await options.externalSkillService.openPresentationSession(jobId, payload);
            writeJson(response, result.statusCode, result.payload);
            return;
          }
          if (action === 'heartbeat') {
            const payload = await readJsonBody<ExternalSkillPresentationSessionHeartbeatRequest>(request);
            const result = await options.externalSkillService.heartbeatPresentationSession(jobId, payload);
            writeJson(response, result.statusCode, result.payload);
            return;
          }
          if (action === 'close') {
            const payload = await readJsonBody<ExternalSkillPresentationSessionCloseRequest>(request);
            const result = await options.externalSkillService.closePresentationSession(jobId, payload);
            writeJson(response, result.statusCode, result.payload);
            return;
          }
        }

        if (method === 'GET' && parts.length === 6 && parts[2] === 'jobs' && parts[4] === 'artifacts') {
          const jobId = decodeURIComponent(parts[3] ?? '');
          const artifactId = decodeURIComponent(parts[5] ?? '');
          const { artifact, content } = await options.externalSkillService.getSkillJobArtifact(jobId, artifactId);
          response.writeHead(200, {
            'Content-Type': artifact.mimeType,
            'Content-Length': String(content.byteLength),
            'Content-Disposition': `attachment; filename="${encodeURIComponent(artifact.fileName)}"`,
            'Access-Control-Allow-Origin': '*',
          });
          response.end(content);
          return;
        }
      }

      if (method === 'POST' && url.pathname === '/api/artifacts/company-research') {
        if (!options.artifactService) {
          throw new ServiceUnavailableError('Artifact 服务未启用');
        }
        const payload = await readJsonBody<CompanyResearchArtifactRequest>(request);
        writeJson(response, 201, await options.artifactService.createCompanyResearchArtifact(payload));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/artifacts/search') {
        if (!options.artifactService) {
          throw new ServiceUnavailableError('Artifact 服务未启用');
        }
        const payload = await readJsonBody<ArtifactSearchRequest>(request);
        writeJson(response, 200, await options.artifactService.search(payload));
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
        if (!options.artifactService) {
          throw new ServiceUnavailableError('Artifact 服务未启用');
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 4 && parts[3] === 'presentation') {
          if (!options.artifactPresentationService) {
            throw new ServiceUnavailableError('Artifact PPT 生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.artifactPresentationService.getPresentation(artifactId));
          return;
        }

        if (parts.length === 3) {
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.artifactService.getArtifact(artifactId));
          return;
        }
      }

      if (method === 'POST' && url.pathname.startsWith('/api/artifacts/')) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 4 && parts[3] === 'presentation') {
          if (!options.artifactPresentationService) {
            throw new ServiceUnavailableError('Artifact PPT 生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 202, await options.artifactPresentationService.ensurePresentation(artifactId));
          return;
        }
      }

      if (method === 'POST' && url.pathname === '/api/approval/files/upload') {
        const payload = await readJsonBody<{ filePath?: string; bizKey?: string }>(request);
        if (!payload.filePath?.trim()) {
          throw new BadRequestError('上传文件必须提供 filePath');
        }

        writeJson(
          response,
          200,
          await options.approvalFileService.uploadFile({
            filePath: payload.filePath,
            bizKey: payload.bizKey,
          }),
        );
        return;
      }

      if (url.pathname.startsWith('/api/shadow/objects/')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const objectKey = parseShadowObjectKey(parts[3] ?? '');

        if (method === 'GET' && parts.length === 4) {
          writeJson(response, 200, options.shadowMetadataService.getObject(objectKey));
          return;
        }

        if (method === 'POST' && parts.length === 5 && parts[4] === 'refresh') {
          writeJson(response, 200, await options.shadowMetadataService.refreshObject(objectKey));
          return;
        }

        if (method === 'GET' && parts.length === 5 && parts[4] === 'skills') {
          writeJson(response, 200, options.shadowMetadataService.listSkills(objectKey));
          return;
        }

        if (method === 'GET' && parts.length === 5 && parts[4] === 'dictionaries') {
          writeJson(response, 200, options.shadowMetadataService.listDictionaries(objectKey));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'preview' && parts[5] === 'search') {
          const payload = await readJsonBody<ShadowPreviewSearchInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.previewSearch(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'preview' && parts[5] === 'get') {
          const payload = await readJsonBody<ShadowPreviewGetInput>(request);
          writeJson(response, 200, options.shadowMetadataService.previewGet(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'preview' && parts[5] === 'upsert') {
          const payload = await readJsonBody<ShadowPreviewUpsertInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.previewUpsert(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'preview' && parts[5] === 'delete') {
          const payload = await readJsonBody<ShadowPreviewDeleteInput>(request);
          writeJson(response, 200, options.shadowMetadataService.previewDelete(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'execute' && parts[5] === 'search') {
          const payload = await readJsonBody<ShadowPreviewSearchInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.executeSearch(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'execute' && parts[5] === 'get') {
          const payload = await readJsonBody<ShadowPreviewGetInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.executeGet(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'execute' && parts[5] === 'upsert') {
          const payload = await readJsonBody<ShadowPreviewUpsertInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.executeUpsert(objectKey, payload));
          return;
        }

        if (method === 'POST' && parts.length === 6 && parts[4] === 'execute' && parts[5] === 'delete') {
          const payload = await readJsonBody<ShadowPreviewDeleteInput>(request);
          writeJson(response, 200, await options.shadowMetadataService.executeDelete(objectKey, payload));
          return;
        }
      }

      if (method === 'GET' && url.pathname === '/api/health') {
        writeJson(response, 200, {
          status: 'ok',
          service: '@yzj-ai-crm/admin-api',
          port: options.config.server.port,
        });
        return;
      }

      writeJson(response, 404, {
        code: 'NOT_FOUND',
        message: '接口不存在',
      } satisfies ApiErrorResponse);
    } catch (error) {
      writeError(response, error);
    }
  });
}
