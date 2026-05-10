"use client";

import { Loader2, CheckCircle2, Terminal, BarChart3 } from "lucide-react";

interface ToolStatusProps {
  toolName: string;
  state: string;
}

const TOOL_CONFIG: Record<string, { icon: typeof Terminal; label: string; doneLabel: string }> = {
  executePython: {
    icon: Terminal,
    label: "云沙箱执行 Python 数据分析",
    doneLabel: "数据处理完成",
  },
  renderReport: {
    icon: BarChart3,
    label: "生成可视化报告",
    doneLabel: "报告已渲染至右侧画板",
  },
};

export default function ToolStatus({ toolName, state }: ToolStatusProps) {
  const config = TOOL_CONFIG[toolName] || {
    icon: Loader2,
    label: toolName,
    doneLabel: "完成",
  };
  const Icon = config.icon;

  if (state === "output-available") {
    return (
      <div className="flex items-center gap-2 text-emerald-600 text-xs mt-2 py-1 px-2 bg-emerald-50 rounded border border-emerald-100">
        <CheckCircle2 size={14} />
        <span>{config.doneLabel}</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-2 text-red-600 text-xs mt-2 py-1 px-2 bg-red-50 rounded border border-red-100">
        <Icon size={14} />
        <span>{config.label} - 执行失败</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-indigo-600 text-xs mt-2 py-1 px-2 bg-indigo-50 rounded border border-indigo-100">
      <Loader2 size={14} className="animate-spin" />
      <span>{config.label}...</span>
    </div>
  );
}
