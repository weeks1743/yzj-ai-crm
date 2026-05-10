import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

const CANONICAL_REPORT_HOST = "localhost";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function redirectToCanonicalHost(request: Request): Response | null {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const hostname = host.split(":")[0];
  if (hostname !== "127.0.0.1") {
    return null;
  }

  const canonicalHost = host.replace(/^127\.0\.0\.1(?=(:|$))/, CANONICAL_REPORT_HOST);
  const target = `${url.protocol}//${canonicalHost}${url.pathname}${url.search}`;
  const safeTarget = escapeHtml(target);
  return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${safeTarget}" />
  <title>正在打开报告</title>
  <script>window.location.replace(${JSON.stringify(target)});</script>
</head>
<body>
  <p>正在打开报告...</p>
  <p><a href="${safeTarget}">如果没有自动打开，请点击这里</a></p>
</body>
</html>`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      Refresh: `0;url=${target}`,
    },
  });
}

async function readPersistentReportCode(codeUrl: string): Promise<{ code: string | null; error: string | null }> {
  if (!codeUrl) {
    return { code: null, error: "缺少报告源码地址，请重新打开报告" };
  }

  try {
    const response = await fetch(codeUrl, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).message
        : null;
      return {
        code: null,
        error: typeof message === "string" && message.trim()
          ? message
          : `报告源码读取失败 (${response.status})`,
      };
    }

    const code = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).code
      : null;
    if (typeof code !== "string" || !code.trim()) {
      return { code: null, error: "报告源码为空，请重新生成报告" };
    }

    return { code, error: null };
  } catch {
    return { code: null, error: "报告源码读取失败，请稍后重试" };
  }
}

function renderErrorPage(message: string): string {
  const safeMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>报告打开失败</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fef2f2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #991b1b;
    }
    main {
      max-width: 420px;
      padding: 32px;
      text-align: center;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
    }
    p {
      margin: 0;
      font-size: 14px;
      line-height: 1.7;
      color: #b91c1c;
    }
  </style>
</head>
<body>
  <main>
    <h1>报告打开失败</h1>
    <p>${safeMessage}</p>
  </main>
</body>
</html>`;
}

export async function GET(request: Request) {
  const canonicalRedirect = redirectToCanonicalHost(request);
  if (canonicalRedirect) {
    return canonicalRedirect;
  }

  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId") || "unknown";
  const codeUrl = url.searchParams.get("codeUrl") || "";
  const result = await readPersistentReportCode(codeUrl);

  if (!result.code) {
    return new NextResponse(renderErrorPage(result.error || "报告源码读取失败，请稍后重试"), {
      status: 502,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  const session = sessionStore.create({
    markdown: `persisted-report:${artifactId}`,
    query: "打开持久化报告",
    ttlMinutes: 1440,
  });
  sessionStore.setComplete(session.sessionId, result.code);

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: `/embed/${encodeURIComponent(session.sessionId)}`,
    },
  });
}
