import { Conversation } from "./types";

const CONVERSATIONS_KEY = "tesla-canvas:conversations";
const MESSAGES_KEY_PREFIX = "tesla-canvas:messages:";

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // quota exceeded - try to free space
    evictOldestMessages(conversations);
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch {
      // give up silently
    }
  }
}

export function saveConversation(conversation: Conversation) {
  const all = loadConversations();
  const idx = all.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) {
    all[idx] = conversation;
  } else {
    all.unshift(conversation);
  }
  saveConversations(all);
}

export function deleteConversation(id: string) {
  const all = loadConversations().filter((c) => c.id !== id);
  saveConversations(all);
  // also delete messages
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(MESSAGES_KEY_PREFIX + id);
    } catch {
      // ignore
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadMessages(conversationId: string): any[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MESSAGES_KEY_PREFIX + conversationId);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function saveMessages(conversationId: string, messages: any[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      MESSAGES_KEY_PREFIX + conversationId,
      JSON.stringify(messages)
    );
  } catch {
    // quota exceeded - evict oldest
    const conversations = loadConversations();
    evictOldestMessages(conversations);
    try {
      localStorage.setItem(
        MESSAGES_KEY_PREFIX + conversationId,
        JSON.stringify(messages)
      );
    } catch {
      // give up
    }
  }
}

function evictOldestMessages(conversations: Conversation[]) {
  // sort by updatedAt ascending, remove messages for the oldest 3
  const sorted = [...conversations].sort((a, b) => a.updatedAt - b.updatedAt);
  const toEvict = sorted.slice(0, 3);
  for (const c of toEvict) {
    try {
      localStorage.removeItem(MESSAGES_KEY_PREFIX + c.id);
    } catch {
      // ignore
    }
  }
}
