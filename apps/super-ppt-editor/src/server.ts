import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadAppConfig } from './config.js';
import { renderEditorHtml } from './editor-template.js';

const config = loadAppConfig();

function writeText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': String(Buffer.byteLength(body)),
  });
  response.end(body);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createProxyHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) {
      continue;
    }
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'host' || normalizedKey === 'content-length' || normalizedKey === 'connection') {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

async function proxyAdminApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  search: string,
): Promise<void> {
  const targetUrl = `${trimTrailingSlash(config.adminApi.baseUrl)}${pathname}${search}`;
  const body = await readRequestBody(request);
  const upstream = await fetch(targetUrl, {
    method: request.method ?? 'GET',
    headers: createProxyHeaders(request),
    body: body.byteLength > 0 ? body : undefined,
  });
  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'transfer-encoding' || normalizedKey === 'connection') {
      return;
    }
    headers[key] = value;
  });
  response.writeHead(upstream.status, headers);
  response.end(upstreamBody);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', config.server.baseUrl);
  const pathname = url.pathname;

  try {
    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      const body = renderEditorHtml();
      writeText(response, 200, 'text/html; charset=utf-8', request.method === 'HEAD' ? '' : body);
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/health') {
      const body = JSON.stringify({
        status: 'ok',
        service: '@yzj-ai-crm/super-ppt-editor',
        port: config.server.port,
        adminApiBaseUrl: config.adminApi.baseUrl,
      });
      writeText(response, 200, 'application/json; charset=utf-8', request.method === 'HEAD' ? '' : body);
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/docmee/docmee-ui-sdk-iframe.min.js') {
      const sdk = await readFile(config.assets.docmeeSdkFilePath);
      writeText(
        response,
        200,
        'application/javascript; charset=utf-8',
        request.method === 'HEAD' ? '' : sdk,
      );
      return;
    }

    if (pathname.startsWith('/api/')) {
      await proxyAdminApi(request, response, pathname, url.search);
      return;
    }

    writeText(response, 404, 'text/plain; charset=utf-8', 'Not Found');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'super-ppt-editor 服务内部错误';
    writeText(response, 500, 'application/json; charset=utf-8', JSON.stringify({
      code: 'INTERNAL_SERVER_ERROR',
      message,
    }));
  }
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`[super-ppt-editor] received ${signal}, closing server...`);
  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.listen(config.server.port, () => {
  console.log(
    `[super-ppt-editor] listening on ${config.server.baseUrl} (proxy -> ${config.adminApi.baseUrl})`,
  );
});
