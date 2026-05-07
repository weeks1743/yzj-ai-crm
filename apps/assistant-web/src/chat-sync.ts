import type { ConversationSession } from '@shared/types';

export interface ConversationSyncPolicy<TConversation extends ConversationSession = ConversationSession> {
  isPersistableConversation: (value: unknown) => value is TConversation;
  normalizeConversationSession: (conversation: TConversation) => TConversation;
  isDeprecatedConversation: (conversation: TConversation) => boolean;
  keepSingleBlankConversations: (conversations: TConversation[]) => TConversation[];
}

export interface PersistedMessageState<TMessage> {
  version: number;
  messages: Record<string, TMessage[]>;
}

export interface PersistedRecordingTaskState<TTask> {
  version: number;
  tasks: Record<string, TTask[]>;
}

export type RemoteMessagesResult<TMessage> =
  | { status: 'available'; messages: TMessage[] }
  | { status: 'unavailable' };

export function mergeAuthoritativeRemoteConversations<TConversation extends ConversationSession>(
  baseConversations: TConversation[],
  remoteConversations: unknown[],
  policy: ConversationSyncPolicy<TConversation>,
): TConversation[] {
  const fixedKeys = new Set(baseConversations.map((item) => item.key));
  const customConversations = sanitizeCustomConversations(remoteConversations, fixedKeys, policy);
  return [
    ...policy.keepSingleBlankConversations(customConversations),
    ...baseConversations,
  ];
}

export function mergeOfflineCachedConversations<TConversation extends ConversationSession>(
  baseConversations: TConversation[],
  cachedConversations: unknown[],
  policy: ConversationSyncPolicy<TConversation>,
): TConversation[] {
  const fixedKeys = new Set(baseConversations.map((item) => item.key));
  const customConversations = sanitizeCustomConversations(cachedConversations, fixedKeys, policy);
  return [
    ...policy.keepSingleBlankConversations(customConversations),
    ...baseConversations,
  ];
}

export function prunePersistedChatState<
  TMessage,
  TTask,
  TMessageStore extends PersistedMessageState<TMessage>,
  TRecordingTaskStore extends PersistedRecordingTaskState<TTask>,
>(input: {
  messageStore: TMessageStore;
  recordingTaskStore: TRecordingTaskStore;
  validConversationKeys: Iterable<string>;
}): {
  messageStore: TMessageStore;
  recordingTaskStore: TRecordingTaskStore;
} {
  const validKeys = new Set(input.validConversationKeys);
  return {
    messageStore: {
      ...input.messageStore,
      messages: filterRecordByKeys(input.messageStore.messages, validKeys),
    } as TMessageStore,
    recordingTaskStore: {
      ...input.recordingTaskStore,
      tasks: filterRecordByKeys(input.recordingTaskStore.tasks, validKeys),
    } as TRecordingTaskStore,
  };
}

export function chooseConversationMessages<TMessage>(
  remoteResult: RemoteMessagesResult<TMessage>,
  localMessages: TMessage[] | null,
): TMessage[] {
  if (remoteResult.status === 'available') {
    return remoteResult.messages;
  }
  return localMessages ?? [];
}

export function resolveSyncedActiveConversationKey(input: {
  validConversationKeys: Iterable<string>;
  currentActiveKey: string;
  storedActiveKey: string | null;
  fallbackKey: string;
}) {
  const validKeys = new Set(input.validConversationKeys);
  if (input.storedActiveKey && validKeys.has(input.storedActiveKey)) {
    return input.storedActiveKey;
  }
  if (validKeys.has(input.currentActiveKey)) {
    return input.currentActiveKey;
  }
  return input.fallbackKey;
}

function sanitizeCustomConversations<TConversation extends ConversationSession>(
  conversations: unknown[],
  fixedKeys: Set<string>,
  policy: ConversationSyncPolicy<TConversation>,
) {
  return conversations
    .filter(policy.isPersistableConversation)
    .map(policy.normalizeConversationSession)
    .filter((item) => !policy.isDeprecatedConversation(item))
    .filter((item) => !fixedKeys.has(item.key));
}

function filterRecordByKeys<TValue>(
  record: Record<string, TValue[]>,
  validKeys: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(record).filter(([conversationKey]) => validKeys.has(conversationKey)),
  ) as Record<string, TValue[]>;
}
