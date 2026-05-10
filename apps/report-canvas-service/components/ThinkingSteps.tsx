"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, Brain } from "lucide-react";

interface ReasoningPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
}

interface ThinkingStepsProps {
  parts: ReasoningPart[];
}

interface ParsedStep {
  title: string;
  content: string;
  state: "streaming" | "done";
}

/**
 * 从 reasoning text 中解析阶段标题和内容
 * 格式约定：第一行为 "## 阶段标题"
 */
function parseStep(part: ReasoningPart): ParsedStep {
  const text = part.text || "";
  const lines = text.split("\n");
  let title = "思考中...";
  let contentStart = 0;

  // 提取 ## 标题
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) {
      title = line.replace("## ", "").trim();
      contentStart = i + 1;
      break;
    }
  }

  const content = lines
    .slice(contentStart)
    .join("\n")
    .trim();

  return {
    title,
    content,
    state: part.state || "done",
  };
}

export default function ThinkingSteps({ parts }: ThinkingStepsProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  if (parts.length === 0) return null;

  const steps = parts.map(parseStep);
  const completedCount = steps.filter((s) => s.state === "done").length;
  const isAllDone = completedCount === steps.length;

  // 当前正在 streaming 的步骤自动展开
  const activeIndex = steps.findIndex((s) => s.state === "streaming");

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const isStepExpanded = (index: number) => {
    if (index === activeIndex) return true; // streaming 步骤始终展开
    return expandedSteps.has(index);
  };

  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        <Brain size={13} className="text-indigo-500" />
        <span className="font-medium">
          显示思路
        </span>
        <span className="text-gray-400">
          ({completedCount}/{steps.length})
        </span>
        {!isAllDone && (
          <Loader2 size={11} className="animate-spin text-indigo-500 ml-1" />
        )}
        <span className="ml-auto">
          {collapsed ? (
            <ChevronRight size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
        </span>
      </button>

      {/* 步骤列表 */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {steps.map((step, index) => (
            <div key={index} className="border-l-2 border-gray-200 pl-3">
              {/* 步骤标题行 */}
              <button
                onClick={() => toggleStep(index)}
                className="w-full flex items-center gap-2 py-1 text-left group"
              >
                {step.state === "done" ? (
                  <CheckCircle2
                    size={12}
                    className="text-emerald-500 flex-shrink-0"
                  />
                ) : (
                  <Loader2
                    size={12}
                    className="animate-spin text-indigo-500 flex-shrink-0"
                  />
                )}
                <span
                  className={`text-xs font-medium ${
                    step.state === "streaming"
                      ? "text-indigo-600"
                      : "text-gray-600 group-hover:text-gray-800"
                  }`}
                >
                  {step.title}
                  {step.state === "streaming" && "..."}
                </span>
                <span className="ml-auto text-gray-400">
                  {isStepExpanded(index) ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </span>
              </button>

              {/* 步骤内容（展开时显示） */}
              {isStepExpanded(index) && step.content && (
                <div className="pb-2 pl-5">
                  <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                    {step.content}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
