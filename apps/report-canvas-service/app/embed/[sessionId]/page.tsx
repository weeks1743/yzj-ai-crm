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

interface EmbedPageProps {
  params: Promise<{ sessionId: string }>;
}

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

export default function EmbedPage({ params }: EmbedPageProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    params.then((p) => setSessionId(p.sessionId));
  }, [params]);

  // Poll for status and fetch result when complete
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const res = await fetch(`/api/report/status/${sessionId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("会话不存在或已过期");
          setStatus("error");
        }
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
        const resultRes = await fetch(`/api/report/result/${sessionId}`);
        if (resultRes.ok) {
          const resultData: ResultResponse = await resultRes.json();
          setCode(resultData.code);
          // Keep source-project postMessage compatibility; yzj-ai-crm opens reports in a new page.
          if (window.parent !== window) {
            window.parent.postMessage(
              { type: "report-ready", sessionId },
              "*"
            );
          }
        }
      }
    } catch {
      // Network error, will retry on next poll
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (status === "complete" || status === "error") return;

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
  }, [sessionId, status, pollStatus]);

  // Error state
  if (status === "error") {
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
            {error || "未知错误"}
          </p>
        </div>
      </div>
    );
  }

  // Loading/generating state
  if (!code) {
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
          报告生成中...
        </h2>
        {stage && (
          <p style={{ color: "#6366f1", fontSize: "14px", marginBottom: "8px" }}>
            {stageLabels[stage] || stage}
          </p>
        )}
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
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Complete - render the report
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
            showOpenInCodeSandbox={false}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
