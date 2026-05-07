import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationSession } from '@shared/types';
import {
  chooseConversationMessages,
  mergeAuthoritativeRemoteConversations,
  mergeOfflineCachedConversations,
  prunePersistedChatState,
  resolveSyncedActiveConversationKey,
  type ConversationSyncPolicy,
} from './chat-sync';

const baseConversation = conversation('home', 'AI 销售工作台', '固定会话');
const policy: ConversationSyncPolicy<ConversationSession> = {
  isPersistableConversation: (value: unknown): value is ConversationSession => {
    const candidate = value as Partial<ConversationSession> | null;
    return Boolean(
      candidate?.key
      && typeof candidate.key === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.route === 'string'
      && typeof candidate.group === 'string'
      && typeof candidate.lastMessage === 'string'
      && typeof candidate.updatedAt === 'string'
      && typeof candidate.scene === 'string',
    );
  },
  normalizeConversationSession: (item) => item,
  isDeprecatedConversation: (item) => item.group === '场景入口',
  keepSingleBlankConversations: (items) => items,
};

test('authoritative remote conversations drop stale local conversations when remote is empty', () => {
  const merged = mergeAuthoritativeRemoteConversations(
    [baseConversation],
    [],
    policy,
  );

  assert.deepEqual(merged.map((item) => item.key), ['home']);
});

test('authoritative remote conversations keep only remote custom conversations and base conversations', () => {
  const merged = mergeAuthoritativeRemoteConversations(
    [baseConversation],
    [
      conversation('remote-1', '贝斯美拜访'),
      conversation('old-scene', '旧技能入口', '场景入口'),
      { key: 'invalid' },
    ],
    policy,
  );

  assert.deepEqual(merged.map((item) => item.key), ['remote-1', 'home']);
});

test('offline cached conversations are used only by the offline fallback path', () => {
  const merged = mergeOfflineCachedConversations(
    [baseConversation],
    [conversation('local-1', '离线会话')],
    policy,
  );

  assert.deepEqual(merged.map((item) => item.key), ['local-1', 'home']);
});

test('prune persisted chat state removes messages and recording tasks for non-authoritative conversations', () => {
  const pruned = prunePersistedChatState({
    validConversationKeys: ['home', 'remote-1'],
    messageStore: {
      version: 4,
      messages: {
        home: ['home-message'],
        'remote-1': ['remote-message'],
        stale: ['stale-message'],
      },
    },
    recordingTaskStore: {
      version: 4,
      tasks: {
        'remote-1': ['recording-task-1'],
        stale: ['recording-task-stale'],
      },
    },
  });

  assert.deepEqual(Object.keys(pruned.messageStore.messages), ['home', 'remote-1']);
  assert.deepEqual(Object.keys(pruned.recordingTaskStore.tasks), ['remote-1']);
});

test('remote message success with empty runs does not fall back to stale local messages', () => {
  assert.deepEqual(
    chooseConversationMessages({ status: 'available', messages: [] }, ['stale-local-message']),
    [],
  );
  assert.deepEqual(
    chooseConversationMessages({ status: 'unavailable' }, ['offline-local-message']),
    ['offline-local-message'],
  );
});

test('active conversation falls back when the stored active conversation was removed by the server', () => {
  assert.equal(resolveSyncedActiveConversationKey({
    validConversationKeys: ['home', 'remote-1'],
    currentActiveKey: 'stale',
    storedActiveKey: 'stale',
    fallbackKey: 'home',
  }), 'home');

  assert.equal(resolveSyncedActiveConversationKey({
    validConversationKeys: ['home', 'remote-1'],
    currentActiveKey: 'home',
    storedActiveKey: 'remote-1',
    fallbackKey: 'home',
  }), 'remote-1');
});

function conversation(
  key: string,
  label: string,
  group = '最近会话',
): ConversationSession {
  return {
    key,
    label,
    route: '/chat',
    group,
    lastMessage: label,
    updatedAt: '刚刚',
    scene: 'chat',
  };
}
