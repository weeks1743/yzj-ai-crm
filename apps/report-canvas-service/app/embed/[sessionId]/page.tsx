import { sessionStore } from "@/lib/session-store";
import ReportEmbedClient, { type InitialReportState } from "./ReportEmbedClient";

export const dynamic = "force-dynamic";

interface EmbedPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { sessionId } = await params;
  const session = sessionStore.get(sessionId);

  const initialState: InitialReportState = session
    ? {
        sessionId,
        status: session.status,
        stage: session.stage,
        progress: session.progress,
        code: null,
        error: session.error?.message ?? null,
      }
    : {
        sessionId,
        status: "error",
        stage: null,
        progress: 0,
        code: null,
        error: "会话不存在或已过期",
      };

  return <ReportEmbedClient initialState={initialState} />;
}
