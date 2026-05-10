"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { Send, Paperclip, X } from "lucide-react";
import ToolStatus from "./ToolStatus";
import ThinkingSteps from "./ThinkingSteps";

interface AttachedFile {
  name: string;
  content: string;
}

interface ChatProps {
  conversationId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialMessages: any[];
  conversationTitle: string;
  existingCode: string | null;
  onCodeStreaming: (code: string) => void;
  onCodeComplete: (code: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessagesChange: (messages: any[]) => void;
  onTitleUpdate: (title: string) => void;
}

export default function Chat({
  initialMessages,
  conversationTitle,
  existingCode,
  onCodeStreaming,
  onCodeComplete,
  onMessagesChange,
  onTitleUpdate,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleUpdatedRef = useRef(conversationTitle !== "新对话");

  const { messages, sendMessage, status } = useChat({
    ...(initialMessages.length > 0 ? { messages: initialMessages } : {}),
    onFinish({ message }) {
      if (message.parts) {
        for (const part of message.parts) {
          if (
            "output" in part &&
            "state" in part &&
            part.state === "output-available"
          ) {
            const output = part.output as { code?: string };
            if (output?.code) {
              onCodeComplete(output.code);
            }
          }
        }
      }
    },
  });

  // Detect streaming code_stream reasoning parts and forward to parent
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    // Find code_stream reasoning parts
    const codeStreamParts = lastMsg.parts.filter(
      (p: { type: string; id?: string }) =>
        p.type === "reasoning" && "id" in p && (p.id as string)?.includes("code_stream")
    );

    if (codeStreamParts.length > 0) {
      // Accumulate all code stream text
      const codeText = codeStreamParts
        .map((p: { text?: string }) => p.text || "")
        .join("");
      if (codeText.length > 0) {
        onCodeStreaming(codeText);
      }
    }
  }, [messages, onCodeStreaming]);

  // Save messages when they change (debounced via status)
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      onMessagesChange(messages);
    }
  }, [status, messages, onMessagesChange]);

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let textContent = input.trim();
    if (attachedFiles.length > 0) {
      const filesSection = attachedFiles
        .map((f) => `--- 文件「${f.name}」---\n${f.content}`)
        .join("\n\n");
      textContent = textContent
        ? `${textContent}\n\n以下是上传的附件内容：\n\n${filesSection}`
        : `请基于以下上传的文件内容进行分析并生成报告：\n\n${filesSection}`;
    }
    if (!textContent.trim() || isLoading) return;

    // Update title from first user message
    if (!titleUpdatedRef.current) {
      const title =
        textContent.length > 15
          ? textContent.slice(0, 15) + "..."
          : textContent;
      onTitleUpdate(title);
      titleUpdatedRef.current = true;
    }

    sendMessage({ text: textContent }, { body: { existingCode: existingCode || undefined } });
    setInput("");
    setAttachedFiles([]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validExts = [".md", ".markdown", ".txt", ".csv", ".json"];
    const newFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isValid = validExts.some((ext) =>
        file.name.toLowerCase().endsWith(ext)
      );
      if (!isValid) {
        alert(`文件「${file.name}」格式不支持，请上传 .md / .txt / .csv / .json 文件`);
        continue;
      }
      newFiles.push(file);
    }

    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setAttachedFiles((prev) => [...prev, { name: file.name, content }]);
      };
      reader.readAsText(file);
    });

    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-lg font-semibold text-gray-900">AI 分析助手</h1>
        <p className="text-xs text-gray-500">
          输入分析需求或上传文件，AI 将在右侧画板生成交互式报告
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-8">
            <p className="text-sm">试试输入：</p>
            <p className="text-sm mt-2 text-indigo-600">
              &quot;分析苹果公司2025 Q1财务表现，生成高管汇报&quot;
            </p>
            <p className="text-sm mt-1 text-indigo-500/70">
              &quot;分析比亚迪最新季度销量数据&quot;
            </p>
            <p className="text-xs mt-4 text-gray-400">
              支持上传多个 .md / .txt / .csv / .json 文件作为分析素材
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                message.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {message.parts.map((part: { type: string; text?: string; state?: string; toolCallId?: string; toolName?: string; id?: string }, i: number) => {
                if (part.type === "text") {
                  return (
                    <p key={i} className="text-sm whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === "reasoning") {
                  // Skip code_stream parts - they go to Canvas
                  if (part.id?.includes("code_stream")) {
                    return null;
                  }
                  return null; // other reasoning parts rendered below
                }
                if ("state" in part && "toolCallId" in part) {
                  let toolName = "unknown";
                  if ("toolName" in part) {
                    toolName = part.toolName as string;
                  } else if (part.type.startsWith("tool-")) {
                    toolName = part.type.replace("tool-", "");
                  }
                  return (
                    <ToolStatus
                      key={i}
                      toolName={toolName}
                      state={part.state as string}
                    />
                  );
                }
                return null;
              })}
              {/* Thinking steps: collect non-code_stream reasoning parts */}
              {(() => {
                const reasoningParts = message.parts.filter(
                  (p: { type: string; id?: string }) =>
                    p.type === "reasoning" && !p.id?.includes("code_stream")
                ) as Array<{
                  type: "reasoning";
                  text: string;
                  state?: "streaming" | "done";
                }>;
                if (reasoningParts.length === 0) return null;
                return <ThinkingSteps parts={reasoningParts} />;
              })()}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Attached files indicator */}
      {attachedFiles.length > 0 && (
        <div className="px-4 pb-2 space-y-1 max-h-32 overflow-y-auto">
          {attachedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5 text-sm"
            >
              <Paperclip size={12} className="text-indigo-500 flex-shrink-0" />
              <span className="text-gray-600 truncate flex-1 text-xs">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="text-gray-400 hover:text-red-500 flex-shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.csv,.json"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-indigo-600 rounded-lg px-3 py-2 transition-colors border border-gray-200"
            title="上传文件（支持多选）"
          >
            <Paperclip size={16} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              attachedFiles.length > 0
                ? "添加说明（可选），按回车发送..."
                : "输入分析需求..."
            }
            className="flex-1 bg-gray-50 text-gray-900 rounded-lg px-4 py-2 text-sm border border-gray-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
          />
          <button
            type="submit"
            disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
