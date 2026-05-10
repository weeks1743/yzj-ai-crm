import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";
import { startPipelineAsync } from "@/lib/pipeline-adapter";
import { getReportAiConfigError } from "@/lib/env";

export const maxDuration = 10; // This endpoint returns quickly; pipeline runs async

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { markdown, query, ttlMinutes } = body as {
      markdown?: string;
      query?: string;
      ttlMinutes?: number;
    };

    // Validate input
    if (!markdown || typeof markdown !== "string" || markdown.trim().length === 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "markdown 字段为必填项且不能为空" } },
        { status: 400 }
      );
    }

    if (markdown.length > 200_000) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "markdown 内容不能超过 200KB" } },
        { status: 400 }
      );
    }

    const configError = getReportAiConfigError();
    if (configError) {
      return NextResponse.json(
        { error: { code: "CONFIG_ERROR", message: configError } },
        { status: 503 }
      );
    }

    const ttl = ttlMinutes && ttlMinutes > 0 ? Math.min(ttlMinutes, 1440) : 60;

    // Create session
    const session = sessionStore.create({
      markdown,
      query,
      ttlMinutes: ttl,
    });

    // Start pipeline async (fire-and-forget)
    startPipelineAsync(session.sessionId, { markdown, query });

    // Return immediately with session info
    const baseUrl = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const protocol = req.headers.get("x-forwarded-proto") || "http";

    return NextResponse.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        embedUrl: `${protocol}://${baseUrl}/embed/${session.sessionId}`,
        statusUrl: `/api/report/status/${session.sessionId}`,
        resultUrl: `/api/report/result/${session.sessionId}`,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[report/generate] Error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 }
    );
  }
}
