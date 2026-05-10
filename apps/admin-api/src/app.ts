import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Busboy from 'busboy';
import type {
  ApiErrorResponse,
  AppConfig,
  AgentChatRequest,
  AgentConversationUpsertRequest,
  AgentPersonalSettingsUpdateRequest,
  AgentMetaQuestionOptionsRequest,
  AgentRecordSearchPageRequest,
  ArtifactSearchRequest,
  ArtifactImageGenerationRequest,
  CompanyResearchArtifactRequest,
  ExternalSkillJobRequest,
  ImageGenerationRequest,
  MarkdownImageGenerationRequest,
  RecordingTaskCreateRequest,
  RecordingTaskMaterializeRequest,
  ShadowObjectKey,
  ShadowPreviewDeleteInput,
  ShadowPreviewGetInput,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
  YzjAuthIdentityResponse,
  YzjAuthResolveTicketRequest,
} from './contracts.js';
import { ApprovalFileService } from './approval-file-service.js';
import type { AgentConversationService } from './agent-conversation-service.js';
import type { AgentObservabilityService } from './agent-observability-service.js';
import type { AgentPersonalSettingsService } from './agent-personal-settings-service.js';
import { AgentService } from './agent-service.js';
import { ArtifactImageService } from './artifact-image-service.js';
import { AppError, BadRequestError, ServiceUnavailableError } from './errors.js';
import { ArtifactReportService } from './artifact-report-service.js';
import { ArtifactService } from './artifact-service.js';
import { ExternalSkillService } from './external-skill-service.js';
import { OrgSyncService, getRunIdFromConflict } from './org-sync-service.js';
import type { OrgSyncRepository } from './org-sync-repository.js';
import { getTenantAppSettings, getYzjAuthSettings } from './settings-service.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';
import { buildMetaQuestionOptionsResponse, buildRecordSearchPageResponse } from './crm-agent-pack.js';
import type { RecordingTaskService } from './recording-task-service.js';
import type { YzjClient } from './yzj-client.js';
import { resolveAgentIsolationTenant } from './tenant-isolation.js';

interface CreateAdminApiServerOptions {
  config: AppConfig;
  yzjClient?: YzjClient;
  orgSyncService: OrgSyncService;
  orgSyncRepository?: Pick<OrgSyncRepository, 'findEmployees'>;
  shadowMetadataService: ShadowMetadataService;
  approvalFileService: ApprovalFileService;
  externalSkillService: ExternalSkillService;
  artifactService?: ArtifactService;
  artifactReportService?: ArtifactReportService;
  artifactImageService?: ArtifactImageService;
  recordingTaskService?: RecordingTaskService;
  agentService?: AgentService;
  agentConversationService?: AgentConversationService;
  agentPersonalSettingsService?: AgentPersonalSettingsService;
  agentObservabilityService?: AgentObservabilityService;
}

const SHADOW_OBJECT_KEYS = new Set<ShadowObjectKey>([
  'customer',
  'contact',
  'opportunity',
  'followup',
]);

const LOCAL_FIXED_OPERATOR_OPEN_ID = '69e75eb5e4b0e65b61c014da';

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

function resolveRequestOrigin(request: IncomingMessage): string {
  const protocol = String(request.headers['x-forwarded-proto'] ?? 'http').split(',')[0]?.trim() || 'http';
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0]?.trim();
  return host ? `${protocol}://${host}` : 'http://127.0.0.1:3001';
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

function parseJsonField<T>(value: string | undefined, fallbackValue: T): T {
  if (!value?.trim()) {
    return fallbackValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new BadRequestError('multipart JSON 字段解析失败', { cause: error });
  }
}

function buildLocalFixedIdentity(config: AppConfig): YzjAuthIdentityResponse {
  const tenant = resolveAgentIsolationTenant(config);
  return {
    source: 'local_fixed',
    eid: tenant.eid,
    displayEid: tenant.eid,
    appId: tenant.appId,
    operatorOpenId: LOCAL_FIXED_OPERATOR_OPEN_ID,
    userId: null,
    userName: '陈伟棠',
    networkId: null,
    deviceId: null,
  };
}

function withDefaultTenantContext(
  config: AppConfig,
  request: AgentChatRequest,
): AgentChatRequest {
  const localIdentity = buildLocalFixedIdentity(config);
  const tenant = resolveAgentIsolationTenant(config, {
    eid: request.tenantContext?.eid ?? localIdentity.eid,
  });
  return {
    ...request,
    tenantContext: {
      eid: tenant.eid,
      appId: tenant.appId,
      operatorOpenId: request.tenantContext?.operatorOpenId?.trim() || localIdentity.operatorOpenId,
    },
  };
}

function resolveOperatorOpenId(config: AppConfig, value: string | null | undefined): string {
  return value?.trim() || buildLocalFixedIdentity(config).operatorOpenId;
}

async function resolveYzjTicketIdentity(
  options: CreateAdminApiServerOptions,
  ticket: string,
): Promise<YzjAuthIdentityResponse> {
  if (!options.yzjClient) {
    throw new ServiceUnavailableError('云之家身份解析服务未启用');
  }

  const accessToken = await options.yzjClient.getAppAccessToken({
    appId: options.config.yzj.appId,
    secret: options.config.yzj.appSecret,
  });
  const context = await options.yzjClient.resolveTicket({
    accessToken,
    appId: options.config.yzj.appId,
    ticket,
  });
  const eid = context.eid.trim();
  if (eid !== options.config.yzj.eid) {
    throw new BadRequestError(`当前工作圈 ${eid} 未接入 AI销售助手`);
  }
  const tenant = resolveAgentIsolationTenant(options.config, { eid });

  return {
    source: 'ticket',
    eid: tenant.eid,
    displayEid: eid,
    appId: tenant.appId,
    operatorOpenId: context.openid.trim(),
    userId: context.userid?.trim() || null,
    userName: context.username?.trim() || '云之家用户',
    networkId: context.networkid?.trim() || null,
    deviceId: context.deviceId?.trim() || null,
  };
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

      if (method === 'GET' && url.pathname === '/api/yzj/auth/local-identity') {
        writeJson(response, 200, buildLocalFixedIdentity(options.config));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/yzj/auth/resolve-ticket') {
        const payload = await readJsonBody<YzjAuthResolveTicketRequest>(request);
        const ticket = payload.ticket?.trim();
        if (!ticket) {
          writeJson(response, 200, buildLocalFixedIdentity(options.config));
          return;
        }
        writeJson(response, 200, await resolveYzjTicketIdentity(options, ticket));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/settings/recording-service') {
        if (!options.recordingTaskService) {
          throw new ServiceUnavailableError('录音处理服务未启用');
        }
        writeJson(response, 200, await options.recordingTaskService.getHealth());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/settings/org-sync') {
        writeJson(response, 200, await options.orgSyncService.getSettings());
        return;
      }

      if (method === 'POST' && url.pathname === '/api/settings/org-sync/manual-sync') {
        writeJson(response, 202, await options.orgSyncService.startManualSync());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/shadow/objects') {
        writeJson(response, 200, options.shadowMetadataService.listObjects());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/external-skills') {
        writeJson(response, 200, await options.externalSkillService.listSkills());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/conversations') {
        if (!options.agentConversationService) {
          throw new ServiceUnavailableError('Agent 会话服务未启用');
        }
        writeJson(
          response,
          200,
          await options.agentConversationService.listConversations(
            resolveOperatorOpenId(options.config, url.searchParams.get('operatorOpenId')),
          ),
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/api/agent/conversations') {
        if (!options.agentConversationService) {
          throw new ServiceUnavailableError('Agent 会话服务未启用');
        }
        const payload = await readJsonBody<AgentConversationUpsertRequest>(request);
        writeJson(response, 200, await options.agentConversationService.upsertConversation({
          ...payload,
          operatorOpenId: resolveOperatorOpenId(options.config, payload.operatorOpenId),
        }));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/personal-settings') {
        if (!options.agentPersonalSettingsService) {
          throw new ServiceUnavailableError('Agent 个人设置服务未启用');
        }
        writeJson(
          response,
          200,
          await options.agentPersonalSettingsService.getSettings(
            resolveOperatorOpenId(options.config, url.searchParams.get('operatorOpenId')),
          ),
        );
        return;
      }

      if (method === 'PUT' && url.pathname === '/api/agent/personal-settings') {
        if (!options.agentPersonalSettingsService) {
          throw new ServiceUnavailableError('Agent 个人设置服务未启用');
        }
        const payload = await readJsonBody<AgentPersonalSettingsUpdateRequest>(request);
        writeJson(response, 200, await options.agentPersonalSettingsService.updateSettings({
          ...payload,
          operatorOpenId: resolveOperatorOpenId(options.config, payload.operatorOpenId),
        }));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/runs') {
        if (!options.agentObservabilityService) {
          throw new ServiceUnavailableError('Agent 观测服务未启用');
        }
        writeJson(response, 200, await options.agentObservabilityService.listRuns({
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
        writeJson(response, 200, await options.agentObservabilityService.listConfirmations({
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
          writeJson(response, 200, await options.agentObservabilityService.getRunDetail(runId));
          return;
        }
      }

      if (method === 'POST' && url.pathname === '/api/agent/chat') {
        if (!options.agentService) {
          throw new ServiceUnavailableError('Agent Runtime 服务未启用');
        }
        const payload = await readJsonBody<AgentChatRequest>(request);
        writeJson(response, 200, await options.agentService.chat(
          withDefaultTenantContext(options.config, payload),
        ));
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
            request: {
              ...payload,
              tenantContext: {
                ...payload.tenantContext,
                operatorOpenId: resolveOperatorOpenId(
                  options.config,
                  payload.tenantContext?.operatorOpenId,
                ),
              },
            },
          }),
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/api/recording-audio-tasks') {
        if (!options.recordingTaskService) {
          throw new ServiceUnavailableError('录音处理服务未启用');
        }
        const contentType = request.headers['content-type'] ?? '';
        if (contentType.includes('multipart/form-data')) {
          const payload = await readMultipartBody(request);
          const file = payload.files.find((item) => item.fieldName === 'file') ?? payload.files[0];
          if (!file) {
            throw new BadRequestError('请上传录音文件');
          }
          writeJson(
            response,
            201,
            await options.recordingTaskService.uploadTask({
              eid: payload.fields.eid,
              appId: payload.fields.appId,
              fileName: file.fileName,
              mimeType: file.mimeType,
              content: file.content,
              anchors: parseJsonField(payload.fields.anchors, {}),
              createdBy: payload.fields.createdBy,
            }),
          );
          return;
        }

        const payload = await readJsonBody<RecordingTaskCreateRequest>(request);
        writeJson(response, 201, await options.recordingTaskService.createFixtureTask(payload));
        return;
      }

      if (url.pathname.startsWith('/api/recording-audio-tasks/')) {
        if (!options.recordingTaskService) {
          throw new ServiceUnavailableError('录音处理服务未启用');
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (method === 'GET' && parts.length === 4 && parts[3] === 'meeting-viewer') {
          const taskId = decodeURIComponent(parts[2] ?? '');
          const location = await options.recordingTaskService.getMeetingViewerUrl(taskId);
          response.writeHead(302, {
            Location: location,
            'Access-Control-Allow-Origin': '*',
          });
          response.end();
          return;
        }

        if (method === 'GET' && parts.length === 3) {
          const taskId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.recordingTaskService.getTask(taskId));
          return;
        }

        if (method === 'POST' && parts.length === 4 && parts[3] === 'materialize') {
          const taskId = decodeURIComponent(parts[2] ?? '');
          const payload = await readJsonBody<RecordingTaskMaterializeRequest>(request);
          writeJson(response, 200, await options.recordingTaskService.materializeTask(taskId, payload));
          return;
        }

        if (method === 'POST' && parts.length === 4 && parts[3] === 'skill-jobs') {
          const taskId = decodeURIComponent(parts[2] ?? '');
          const payload = await readJsonBody<{ skillCode?: string }>(request);
          writeJson(response, 202, await options.recordingTaskService.createSkillJob(taskId, payload));
          return;
        }

        if (method === 'GET' && parts.length === 6 && parts[3] === 'skill-jobs') {
          const taskId = decodeURIComponent(parts[2] ?? '');
          const skillCode = decodeURIComponent(parts[4] ?? '');
          const jobId = decodeURIComponent(parts[5] ?? '');
          writeJson(response, 200, await options.recordingTaskService.getSkillJob(taskId, skillCode, jobId));
          return;
        }

      }

      if (method === 'POST' && url.pathname === '/api/external-skills/image-generate') {
        const payload = await readJsonBody<ImageGenerationRequest>(request);
        writeJson(response, 200, await options.externalSkillService.generateImage(payload));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/markdown/image') {
        if (!options.artifactImageService) {
          throw new ServiceUnavailableError('Markdown 图片生成服务未启用');
        }
        const payload = await readJsonBody<MarkdownImageGenerationRequest>(request);
        writeJson(response, 200, await options.artifactImageService.generateMarkdownImage(payload));
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/api/artifact-images/')) {
        if (!options.artifactImageService) {
          throw new ServiceUnavailableError('Artifact 图片生成服务未启用');
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 4 && parts[3] === 'file') {
          const generationId = decodeURIComponent(parts[2] ?? '');
          const { fileName, mimeType, content } = await options.artifactImageService.getImageFile(generationId);
          const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
          response.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': String(content.byteLength),
            'Content-Disposition': `${disposition}; filename="${encodeURIComponent(fileName)}"`,
            'Access-Control-Allow-Origin': '*',
          });
          response.end(content);
          return;
        }
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
        if (parts.length === 5 && parts[3] === 'report' && parts[4] === 'open') {
          if (!options.artifactReportService) {
            throw new ServiceUnavailableError('Artifact 报告生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          await options.artifactReportService.getReportOpenUrl(artifactId);
          const adminOrigin = resolveRequestOrigin(request);
          const codeUrl = `${adminOrigin}/api/artifacts/${encodeURIComponent(artifactId)}/report/code`;
          const target = `${options.config.external.reportCanvasService.publicBaseUrl.replace(/\/+$/, '')}/persistent-report?artifactId=${encodeURIComponent(artifactId)}&codeUrl=${encodeURIComponent(codeUrl)}`;
          response.writeHead(302, {
            Location: target,
            'Access-Control-Allow-Origin': '*',
          });
          response.end();
          return;
        }

        if (parts.length === 5 && parts[3] === 'report' && parts[4] === 'code') {
          if (!options.artifactReportService) {
            throw new ServiceUnavailableError('Artifact 报告生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.artifactReportService.getReportCode(artifactId));
          return;
        }

        if (parts.length === 4 && parts[3] === 'image') {
          if (!options.artifactImageService) {
            throw new ServiceUnavailableError('Artifact 图片生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.artifactImageService.getImage(artifactId));
          return;
        }

        if (parts.length === 4 && parts[3] === 'report') {
          if (!options.artifactReportService) {
            throw new ServiceUnavailableError('Artifact 报告生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 200, await options.artifactReportService.getReport(artifactId));
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
        if (parts.length === 4 && parts[3] === 'image') {
          if (!options.artifactImageService) {
            throw new ServiceUnavailableError('Artifact 图片生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          const payload = await readJsonBody<ArtifactImageGenerationRequest>(request);
          writeJson(response, 202, await options.artifactImageService.generateImage(artifactId, payload));
          return;
        }

        if (parts.length === 4 && parts[3] === 'report') {
          if (!options.artifactReportService) {
            throw new ServiceUnavailableError('Artifact 报告生成服务未启用');
          }
          const artifactId = decodeURIComponent(parts[2] ?? '');
          writeJson(response, 202, await options.artifactReportService.ensureReport(artifactId));
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
