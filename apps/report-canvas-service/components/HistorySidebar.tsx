"use client";

import { Plus, BarChart3, MessageSquare, X } from "lucide-react";
import { Conversation } from "@/lib/types";

interface HistorySidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function HistorySidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: HistorySidebarProps) {
  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header + New button */}
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          新建对话
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-2 space-y-1">
        {conversations.length === 0 && (
          <div className="text-center text-gray-400 mt-8 px-4">
            <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs">暂无对话记录</p>
          </div>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`group relative flex flex-col gap-1 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? "bg-indigo-50 border-l-2 border-indigo-500"
                  : "hover:bg-gray-100 border-l-2 border-transparent"
              }`}
            >
              {/* Title row */}
              <div className="flex items-center gap-2 min-w-0">
                {conv.generatedCode ? (
                  <BarChart3
                    size={14}
                    className="text-indigo-500 flex-shrink-0"
                  />
                ) : (
                  <MessageSquare
                    size={14}
                    className="text-gray-400 flex-shrink-0"
                  />
                )}
                <span
                  className={`text-sm truncate ${
                    isActive ? "text-gray-900 font-medium" : "text-gray-600"
                  }`}
                >
                  {conv.title}
                </span>
              </div>

              {/* Date row */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 pl-[22px]">
                  {formatRelativeTime(conv.updatedAt)}
                </span>
                {/* Delete button - visible on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
