import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export async function GET(
  _req: Request,
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

  return NextResponse.json({
    sessionId: session.sessionId,
    status: session.status,
    stage: session.stage,
    progress: session.progress,
    error: session.error,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}
