import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  ApiErrorResponse,
  AppConfig,
  ShadowObjectKey,
  ShadowPreviewDeleteInput,
  ShadowPreviewGetInput,
  ShadowPreviewSearchInput,
  ShadowPreviewUpsertInput,
} from './contracts.js';
import { ApprovalFileService } from './approval-file-service.js';
import { AppError, BadRequestError } from './errors.js';
import { OrgSyncService, getRunIdFromConflict } from './org-sync-service.js';
import { getTenantAppSettings, getYzjAuthSettings } from './settings-service.js';
import { ShadowMetadataService } from './shadow-metadata-service.js';

interface CreateAdminApiServerOptions {
  config: AppConfig;
  orgSyncService: OrgSyncService;
  shadowMetadataService: ShadowMetadataService;
  approvalFileService: ApprovalFileService;
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

function parseShadowObjectKey(value: string): ShadowObjectKey {
  if (SHADOW_OBJECT_KEYS.has(value as ShadowObjectKey)) {
    return value as ShadowObjectKey;
  }

  throw new BadRequestError(`未知影子对象: ${value}`);
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

      if (method === 'GET' && url.pathname === '/api/shadow/objects') {
        writeJson(response, 200, options.shadowMetadataService.listObjects());
        return;
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
