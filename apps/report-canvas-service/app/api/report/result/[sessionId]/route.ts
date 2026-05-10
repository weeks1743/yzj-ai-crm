import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = sessionStore.get(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "会话不存在或已过期" } },
      { status: 404 }
    );
  }

  if (session.status === "error") {
    return NextResponse.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        error: session.error,
      },
      { status: 409 }
    );
  }

  if (session.status !== "complete") {
    // Not yet complete, return current status (202)
    return NextResponse.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        stage: session.stage,
        progress: session.progress,
      },
      { status: 202 }
    );
  }

  // Complete - return full result
  const baseUrl = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const protocol = req.headers.get("x-forwarded-proto") || "http";

  return NextResponse.json({
    sessionId: session.sessionId,
    status: "complete",
    code: session.code,
    embedUrl: `${protocol}://${baseUrl}/embed/${session.sessionId}`,
    metadata: {
      codeLength: session.code?.length || 0,
      generatedAt: new Date(session.updatedAt).toISOString(),
      pipelineDurationMs: session.updatedAt - session.createdAt,
    },
  });
}
