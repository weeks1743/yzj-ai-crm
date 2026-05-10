"use client";

import { useState, useEffect, useRef } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";
import { Code2, Eye, ExternalLink, Loader2 } from "lucide-react";
import { CanvasStreamState } from "@/lib/types";

// ErrorBoundary 包裹器：捕获报告组件运行时错误，展示友好提示而非红屏
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: '#fef2f2', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '20px',
              }}>⚠</div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#991b1b' }}>
                报告渲染出错
              </h2>
            </div>
            <p style={{ color: '#b91c1c', fontSize: '14px', lineHeight: 1.6, margin: '0 0 12px 0' }}>
              生成的报告组件在渲染时遇到问题，请尝试重新生成。
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

const PLACEHOLDER_CODE = `export default function Placeholder() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">AI 报告画板</h2>
        <p className="text-gray-500">在左侧输入分析需求，报告将在此处实时呈现</p>
      </div>
    </div>
  );
}`;

interface CanvasProps {
  streamState: CanvasStreamState;
}

export default function Canvas({ streamState }: CanvasProps) {
  const { mode, streamingCode, finalCode } = streamState;
  const displayCode = finalCode || PLACEHOLDER_CODE;
  const hasGeneratedCode = mode === "complete" && !!finalCode;
  const [showCode, setShowCode] = useState(false);
  const codeEndRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (mode === "streaming" && codeEndRef.current) {
      codeEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingCode, mode]);

  // Auto-switch to preview after streaming completes (with small delay)
  useEffect(() => {
    if (mode === "complete" && finalCode) {
      setShowCode(false);
      const timer = setTimeout(() => setShowPreview(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowPreview(false);
    }
  }, [mode, finalCode]);

  const handleOpenInNewTab = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Generated Report Code</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #334155; font-family: 'JetBrains Mono', 'Fira Code', monospace; }
    .toolbar { padding: 12px 20px; background: #ffffff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
    .toolbar h1 { font-size: 14px; font-weight: 600; color: #1e293b; }
    .toolbar button { background: #6366f1; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .toolbar button:hover { background: #4f46e5; }
    pre { margin: 0; padding: 20px; overflow: auto; height: calc(100vh - 49px); font-size: 13px; line-height: 1.6; }
    .line-number { color: #94a3b8; user-select: none; display: inline-block; width: 40px; text-align: right; margin-right: 16px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Source Code - AI Generated Report</h1>
    <button onclick="copyCode()">Copy Code</button>
  </div>
  <pre id="code"></pre>
  <script>
    const code = ${JSON.stringify(displayCode)};
    document.getElementById('code').textContent = code;
    function copyCode() {
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.toolbar button');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Code', 2000);
      });
    }
    const lines = code.split('\\n');
    const numbered = lines.map((line, i) =>
      '<span class="line-number">' + (i+1) + '</span>' + escapeHtml(line)
    ).join('\\n');
    document.getElementById('code').innerHTML = numbered;
    function escapeHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  </script>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  // Streaming mode: show source code with blinking cursor
  if (mode === "streaming") {
    return (
      <div className="flex flex-col h-full">
        {/* Streaming toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="text-indigo-500 animate-spin" />
            <span className="text-xs text-indigo-600 font-medium">
              生成中... ({streamingCode.length} 字符)
            </span>
          </div>
        </div>
        {/* Streaming code display */}
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">
            {streamingCode}
            <span className="streaming-cursor">|</span>
          </pre>
          <div ref={codeEndRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {hasGeneratedCode && (
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !showCode
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700"
              }`}
            >
              <Eye size={13} />
              预览
            </button>
            <button
              onClick={() => setShowCode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showCode
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700"
              }`}
            >
              <Code2 size={13} />
              源代码
            </button>
          </div>
          <button
            onClick={handleOpenInNewTab}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title="在新页面打开源代码"
          >
            <ExternalLink size={13} />
            新窗口
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {showCode && hasGeneratedCode ? (
          <div className="h-full overflow-auto bg-gray-50 p-4">
            <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">
              {displayCode}
            </pre>
          </div>
        ) : showPreview || hasGeneratedCode ? (
          <SandpackProvider
            key={`report-${finalCode?.length || 0}-${finalCode?.slice(0, 40) || ""}`}
            template="react"
            files={{
              "/App.js": ERROR_BOUNDARY_WRAPPER,
              "/Report.js": displayCode,
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
        ) : (
          <SandpackProvider
            key="placeholder"
            template="react"
            files={{
              "/App.js": PLACEHOLDER_CODE,
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
        )}
      </div>
    </div>
  );
}
