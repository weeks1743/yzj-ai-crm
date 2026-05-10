"use client";

import { useState, useEffect, useCallback } from "react";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import HistorySidebar from "@/components/HistorySidebar";
import { Conversation, CanvasStreamState } from "@/lib/types";
import {
  loadConversations,
  saveConversation,
  deleteConversation as removeConversation,
  loadMessages,
  saveMessages,
} from "@/lib/storage";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<CanvasStreamState>({
    mode: "idle",
    streamingCode: "",
    finalCode: null,
  });

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadConversations();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0].id);
      // Load saved report for first conversation
      if (stored[0].generatedCode) {
        setStreamState({
          mode: "complete",
          streamingCode: "",
          finalCode: stored[0].generatedCode,
        });
      }
    } else {
      // Create first conversation
      const first: Conversation = {
        id: generateId(),
        title: "新对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedCode: null,
        reportTitle: null,
      };
      setConversations([first]);
      setActiveId(first.id);
      saveConversation(first);
    }
  }, []);

  const handleNewConversation = useCallback(() => {
    const conv: Conversation = {
      id: generateId(),
      title: "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generatedCode: null,
      reportTitle: null,
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setStreamState({ mode: "idle", streamingCode: "", finalCode: null });
    saveConversation(conv);
  }, []);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      const conv = conversations.find((c) => c.id === id);
      if (conv?.generatedCode) {
        setStreamState({
          mode: "complete",
          streamingCode: "",
          finalCode: conv.generatedCode,
        });
      } else {
        setStreamState({ mode: "idle", streamingCode: "", finalCode: null });
      }
    },
    [conversations]
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      removeConversation(id);
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        if (id === activeId) {
          if (filtered.length > 0) {
            setActiveId(filtered[0].id);
            if (filtered[0].generatedCode) {
              setStreamState({
                mode: "complete",
                streamingCode: "",
                finalCode: filtered[0].generatedCode,
              });
            } else {
              setStreamState({
                mode: "idle",
                streamingCode: "",
                finalCode: null,
              });
            }
          } else {
            // Create new conversation if all deleted
            const conv: Conversation = {
              id: generateId(),
              title: "新对话",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              generatedCode: null,
              reportTitle: null,
            };
            setActiveId(conv.id);
            setStreamState({
              mode: "idle",
              streamingCode: "",
              finalCode: null,
            });
            saveConversation(conv);
            return [conv];
          }
        }
        return filtered;
      });
    },
    [activeId]
  );

  // Called by Chat when streaming code arrives (reasoning part with code_stream id)
  const handleCodeStreaming = useCallback((code: string) => {
    setStreamState({
      mode: "streaming",
      streamingCode: code,
      finalCode: null,
    });
  }, []);

  // Called by Chat when final code is ready (tool-output-available)
  const handleCodeComplete = useCallback(
    (code: string) => {
      setStreamState({
        mode: "complete",
        streamingCode: "",
        finalCode: code,
      });
      // Save to conversation
      if (activeId) {
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === activeId
              ? { ...c, generatedCode: code, updatedAt: Date.now() }
              : c
          );
          // Persist
          const conv = updated.find((c) => c.id === activeId);
          if (conv) saveConversation(conv);
          return updated;
        });
      }
    },
    [activeId]
  );

  // Called by Chat when messages change (for persistence)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessagesChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (messages: any[]) => {
      if (!activeId) return;
      saveMessages(activeId, messages);
    },
    [activeId]
  );

  // Called by Chat when title should be updated (after first user message)
  const handleTitleUpdate = useCallback(
    (title: string) => {
      if (!activeId) return;
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, title, updatedAt: Date.now() } : c
        );
        const conv = updated.find((c) => c.id === activeId);
        if (conv) saveConversation(conv);
        return updated;
      });
    },
    [activeId]
  );

  const activeConversation = conversations.find((c) => c.id === activeId);
  const initialMessages = activeId ? loadMessages(activeId) : [];

  return (
    <div className="flex h-screen w-full">
      {/* Left: History Sidebar */}
      <div className="w-[240px] min-w-[200px] flex-shrink-0">
        <HistorySidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
        />
      </div>

      {/* Middle: Chat */}
      <div className="w-[400px] min-w-[360px] border-r border-gray-200 flex-shrink-0">
        <Chat
          key={activeId || "default"}
          conversationId={activeId || "default"}
          initialMessages={initialMessages}
          conversationTitle={activeConversation?.title || "新对话"}
          existingCode={streamState.finalCode}
          onCodeStreaming={handleCodeStreaming}
          onCodeComplete={handleCodeComplete}
          onMessagesChange={handleMessagesChange}
          onTitleUpdate={handleTitleUpdate}
        />
      </div>

      {/* Right: Canvas */}
      <div className="flex-1 bg-gray-50">
        <Canvas streamState={streamState} />
      </div>
    </div>
  );
}
