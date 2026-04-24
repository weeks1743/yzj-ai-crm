import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ApiErrorResponse, CreateJobRequest } from './contracts.js';
import { AppError, BadRequestError } from './errors.js';
import { SkillRuntimeService } from './skill-runtime-service.js';

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
    writeJson(response, error.statusCode, {
      code: error.code,
      message: error.message,
      details: error.details,
    } satisfies ApiErrorResponse);
    return;
  }

  writeJson(response, 500, {
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : '服务内部错误',
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
    throw new BadRequestError('请求体必须是合法 JSON', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createSkillRuntimeServer(options: {
  service: SkillRuntimeService;
}) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (method === 'OPTIONS') {
      writeJson(response, 204, {});
      return;
    }

    try {
      if (method === 'GET' && url.pathname === '/api/health') {
        writeJson(response, 200, options.service.getHealth());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/models') {
        writeJson(response, 200, options.service.listModels());
        return;
      }

      if (method === 'GET' && url.pathname === '/api/skills') {
        writeJson(response, 200, options.service.listSkills());
        return;
      }

      if (method === 'POST' && url.pathname === '/api/jobs') {
        const payload = await readJsonBody<CreateJobRequest>(request);
        writeJson(response, 202, await options.service.createJob(payload));
        return;
      }

      if (url.pathname.startsWith('/api/jobs/')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const jobId = parts[2];
        if (!jobId) {
          throw new BadRequestError('缺少 jobId');
        }

        if (method === 'GET' && parts.length === 3) {
          writeJson(response, 200, options.service.getJob(jobId));
          return;
        }

        if (method === 'GET' && parts.length === 5 && parts[3] === 'artifacts') {
          const artifactId = parts[4];
          if (!artifactId) {
            throw new BadRequestError('缺少 artifactId');
          }

          const { artifact, content } = options.service.getArtifact(jobId, artifactId);
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

      writeJson(response, 404, {
        code: 'NOT_FOUND',
        message: '接口不存在',
      } satisfies ApiErrorResponse);
    } catch (error) {
      writeError(response, error);
    }
  });
}
