"use client";

import { useState, useEffect, useCallback } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";

// ErrorBoundary wrapper (same as Canvas.tsx)
const ERROR_BOUNDARY_WRAPPER = `import React from 'react';
import Report from './Report';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #fef2f2, #fff1f2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            background: '#fff',
            borderRadius: '16px',
            border: '1px solid #fecaca',
            padding: '2rem',
            boxShadow: '0 4px 24px rgba(239,68,68,0.08)',
          }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#991b1b' }}>
              报告渲染出错
            </h2>
            <p style={{ color: '#b91c1c', fontSize: '14px', lineHeight: 1.6, margin: '12px 0' }}>
              生成的报告组件在渲染时遇到问题。
            </p>
            <div style={{
              background: '#fef2f2', borderRadius: '8px', padding: '12px',
              fontSize: '12px', color: '#dc2626', fontFamily: 'monospace',
              wordBreak: 'break-all', lineHeight: 1.5,
            }}>
              {this.state.error?.message || '未知渲染错误'}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Report />
    </ErrorBoundary>
  );
}
`;

type Status = "pending" | "generating" | "complete" | "error";

interface StatusResponse {
  sessionId: string;
  status: Status;
  stage?: string;
  progress?: number;
  error?: { code: string; message: string };
}

interface ResultResponse {
  code: string;
}

export interface InitialReportState {
  sessionId: string;
  status: Status;
  stage: string | null;
  progress: number;
  code: string | null;
  error: string | null;
}

export interface PersistentReportState {
  artifactId: string;
  codeUrl: string;
  code: string | null;
  error: string | null;
}

async function readResponseMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    const message = record.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

function createAbortMessage(errorValue: unknown, timeoutMessage: string, fallbackMessage: string): string | null {
  if ((errorValue as Error).name !== "AbortError") {
    return fallbackMessage;
  }

  return timeoutMessage;
}

function ReportRenderer({ code }: { code: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <ReportLoadingView status="complete" />;
  }

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <SandpackProvider
        template="react"
        files={{
          "/App.js": ERROR_BOUNDARY_WRAPPER,
          "/Report.js": code,
        }}
        customSetup={{
          dependencies: {
            recharts: "latest",
            "lucide-react": "latest",
            "react-is": "latest",
          },
        }}
        options={{
          externalResources: ["https://cdn.tailwindcss.com"],
        }}
        theme="light"
      >
        <SandpackLayout style={{ height: "100%", border: "none" }}>
          <SandpackPreview
            style={{ height: "100%" }}
            showNavigator={false}
            showRefreshButton={false}
            showRestartButton={false}
            showOpenInCodeSandbox={false}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}

function useCanonicalReportHost() {
  useEffect(() => {
    if (window.location.hostname !== "127.0.0.1") {
      return;
    }

    const target = new URL(window.location.href);
    target.hostname = "localhost";
    window.location.replace(target.toString());
  }, []);
}

function ReportErrorView({ message }: { message: string }) {
  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#fef2f2",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        maxWidth: "400px",
        textAlign: "center",
        padding: "2rem",
      }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>&#9888;</div>
        <h2 style={{ color: "#991b1b", fontSize: "18px", marginBottom: "8px" }}>
          报告生成失败
        </h2>
        <p style={{ color: "#b91c1c", fontSize: "14px" }}>
          {message}
        </p>
      </div>
    </div>
  );
}

function ReportLoadingView({
  status,
  stage,
  progress,
}: {
  status?: Status;
  stage?: string | null;
  progress?: number;
}) {
  const stageLabels: Record<string, string> = {
    understand: "理解需求 & 规划结构",
    data_prep: "准备数据",
    code_gen: "生成可视化报告",
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #f8fafc, #eef2ff)",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        width: "48px",
        height: "48px",
        border: "3px solid #e2e8f0",
        borderTopColor: "#6366f1",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
        marginBottom: "24px",
      }} />
      <h2 style={{ color: "#1e293b", fontSize: "18px", marginBottom: "8px" }}>
        {status === "complete" ? "正在打开报告..." : "报告生成中..."}
      </h2>
      {stage && (
        <p style={{ color: "#6366f1", fontSize: "14px", marginBottom: "8px" }}>
          {stageLabels[stage] || stage}
        </p>
      )}
      {typeof progress === "number" && (
        <>
          <div style={{
            width: "200px",
            height: "4px",
            background: "#e2e8f0",
            borderRadius: "2px",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${progress}%`,
              height: "100%",
              background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
              borderRadius: "2px",
              transition: "width 0.5s ease",
            }} />
          </div>
          <p style={{ color: "#94a3b8", fontSize: "12px", marginTop: "8px" }}>
            {progress}%
          </p>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function PersistentReportClient({ initialState }: { initialState: PersistentReportState }) {
  const [code, setCode] = useState<string | null>(initialState.code);
  const [error, setError] = useState<string | null>(initialState.error);

  useEffect(() => {
    if (code || error) return;
    if (!initialState.codeUrl) {
      setError("缺少报告源码地址，请重新打开报告");
      return;
    }

    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30000);

    async function loadCode() {
      try {
        const response = await fetch(initialState.codeUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setError(await readResponseMessage(response, `报告源码读取失败 (${response.status})`));
          return;
        }
        const payload = await response.json() as { code?: unknown };
        if (!active) return;
        if (typeof payload.code !== "string" || !payload.code.trim()) {
          setError("报告源码为空，请重新生成报告");
          return;
        }
        setCode(payload.code);
      } catch (errorValue) {
        if (!active) return;
        if ((errorValue as Error).name === "AbortError" && timedOut) {
          setError("报告源码读取超时，请稍后重试");
        } else if ((errorValue as Error).name !== "AbortError") {
          setError("报告源码读取失败，请稍后重试");
        }
      }
    }

    void loadCode();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [code, error, initialState.codeUrl]);

  if (error) {
    return <ReportErrorView message={error} />;
  }

  if (!code) {
    return <ReportLoadingView status="complete" />;
  }

  return <ReportRenderer code={code} />;
}

export default function ReportEmbedClient({ initialState }: { initialState: InitialReportState }) {
  useCanonicalReportHost();

  const [sessionId] = useState(initialState.sessionId);
  const [status, setStatus] = useState<Status>(initialState.status);
  const [stage, setStage] = useState<string | null>(initialState.stage);
  const [progress, setProgress] = useState(initialState.progress);
  const [code, setCode] = useState<string | null>(initialState.code);
  const [error, setError] = useState<string | null>(initialState.error);

  // Poll for status and fetch result when complete
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(`/api/report/status/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(await readResponseMessage(res, `报告状态读取失败 (${res.status})`));
        setStatus("error");
        return;
      }

      const data: StatusResponse = await res.json();
      setStatus(data.status);
      setStage(data.stage || null);
      setProgress(data.progress || 0);

      if (data.status === "error") {
        setError(data.error?.message || "生成失败");
        return;
      }

      if (data.status === "complete") {
        // Fetch the result
        const resultRes = await fetch(`/api/report/result/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!resultRes.ok) {
          setError(await readResponseMessage(resultRes, `报告结果读取失败 (${resultRes.status})`));
          setStatus("error");
          return;
        }

        const resultData: ResultResponse = await resultRes.json();
        if (!resultData.code?.trim()) {
          setError("报告结果为空，请重新生成报告");
          setStatus("error");
          return;
        }

        setCode(resultData.code);
      }
    } catch (errorValue) {
      const message = createAbortMessage(
        errorValue,
        "报告数据读取超时，请刷新页面重试",
        "报告数据读取失败，请检查服务是否正常后重试"
      );
      if (message) {
        setError(message);
        setStatus("error");
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      const timeout = window.setTimeout(() => {
        setError("报告地址解析超时，请重新打开报告");
        setStatus("error");
      }, 5000);
      return () => window.clearTimeout(timeout);
    }
    if (status === "error" || (status === "complete" && code)) return;

    // Initial fetch
    pollStatus();

    // Poll every 2 seconds
    const interval = setInterval(pollStatus, 2000);

    // Timeout after 10 minutes
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setError("报告生成超时，请重试");
      setStatus("error");
    }, 10 * 60 * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [code, sessionId, status, pollStatus]);

  useEffect(() => {
    if (!code || window.parent === window) return;
    // Keep source-project postMessage compatibility; yzj-ai-crm opens reports in a new page.
    window.parent.postMessage({ type: "report-ready", sessionId }, "*");
  }, [code, sessionId]);

  // Error state
  if (status === "error") {
    return <ReportErrorView message={error || "未知错误"} />;
  }

  // Loading/generating state
  if (!code) {
    return <ReportLoadingView status={status} stage={stage} progress={progress} />;
  }

  // Complete - render the report
  return <ReportRenderer code={code} />;
}
