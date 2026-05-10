/**
 * 服务端内存 Session Store
 * 管理报告生成会话的生命周期（创建 → 生成中 → 完成/出错 → 过期清理）
 */

export type SessionStatus = "pending" | "generating" | "complete" | "error";
export type PipelineStage = "understand" | "data_prep" | "code_gen" | null;

export interface SessionError {
  code: "PIPELINE_ERROR" | "TIMEOUT" | "AI_SERVICE_ERROR";
  message: string;
}

export interface SessionRecord {
  sessionId: string;
  status: SessionStatus;
  stage: PipelineStage;
  progress: number;
  markdown: string;
  query: string;
  code: string | null;
  error: SessionError | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function generateSessionId(): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `rpt_${random}`;
}

class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  create(input: { markdown: string; query?: string; ttlMinutes?: number }): SessionRecord {
    const sessionId = generateSessionId();
    const now = Date.now();
    const ttlMs = (input.ttlMinutes ?? 60) * 60 * 1000;

    const record: SessionRecord = {
      sessionId,
      status: "pending",
      stage: null,
      progress: 0,
      markdown: input.markdown,
      query: input.query || "",
      code: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttlMs,
    };

    this.sessions.set(sessionId, record);
    return record;
  }

  get(sessionId: string): SessionRecord | null {
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return record;
  }

  updateStatus(
    sessionId: string,
    patch: { status?: SessionStatus; stage?: PipelineStage; progress?: number }
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    if (patch.status !== undefined) record.status = patch.status;
    if (patch.stage !== undefined) record.stage = patch.stage;
    if (patch.progress !== undefined) record.progress = patch.progress;
    record.updatedAt = Date.now();
  }

  setComplete(sessionId: string, code: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.status = "complete";
    record.stage = null;
    record.progress = 100;
    record.code = code;
    record.updatedAt = Date.now();
  }

  setError(sessionId: string, error: SessionError): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.status = "error";
    record.error = error;
    record.updatedAt = Date.now();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, record] of this.sessions) {
        if (now > record.expiresAt) {
          this.sessions.delete(id);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}

// Singleton instance shared across API routes in the same process
const globalStore = globalThis as unknown as { __sessionStore?: SessionStore };
if (!globalStore.__sessionStore) {
  globalStore.__sessionStore = new SessionStore();
}

export const sessionStore: SessionStore = globalStore.__sessionStore;
