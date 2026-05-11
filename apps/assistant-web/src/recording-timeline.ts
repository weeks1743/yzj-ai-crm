export interface RecordingTimelineMessage {
  id: string | number;
}

export interface RecordingTimelineTask {
  taskId: string;
  timelineAnchorMessageId?: string | null;
}

export type RecordingTimelineEntry<
  Message extends RecordingTimelineMessage,
  Task extends RecordingTimelineTask,
> =
  | {
      kind: 'messages';
      key: string;
      messages: Message[];
    }
  | {
      kind: 'recording-task';
      key: string;
      task: Task;
    };

export function getLatestTimelineMessageId<Message extends RecordingTimelineMessage>(
  messages: Message[],
): string | null {
  const latest = messages[messages.length - 1];
  return latest ? String(latest.id) : null;
}

export function buildRecordingTimeline<
  Message extends RecordingTimelineMessage,
  Task extends RecordingTimelineTask,
>(
  messages: Message[],
  tasks: Task[],
): Array<RecordingTimelineEntry<Message, Task>> {
  const messageIds = new Set(messages.map((message) => String(message.id)));
  const entries: Array<RecordingTimelineEntry<Message, Task>> = [];
  const anchoredTasks = new Map<string, Task[]>();
  const unanchoredTasks: Task[] = [];

  for (const task of tasks) {
    const anchorId = task.timelineAnchorMessageId?.trim();
    if (anchorId && messageIds.has(anchorId)) {
      const existing = anchoredTasks.get(anchorId) ?? [];
      existing.push(task);
      anchoredTasks.set(anchorId, existing);
      continue;
    }
    unanchoredTasks.push(task);
  }

  let messageGroup: Message[] = [];
  const flushMessages = () => {
    if (!messageGroup.length) {
      return;
    }
    entries.push({
      kind: 'messages',
      key: `messages:${String(messageGroup[0]!.id)}:${String(messageGroup[messageGroup.length - 1]!.id)}`,
      messages: messageGroup,
    });
    messageGroup = [];
  };

  for (const message of messages) {
    messageGroup.push(message);
    const tasksAfterMessage = anchoredTasks.get(String(message.id));
    if (!tasksAfterMessage?.length) {
      continue;
    }
    flushMessages();
    for (const task of tasksAfterMessage) {
      entries.push({
        kind: 'recording-task',
        key: `recording:${task.taskId}`,
        task,
      });
    }
  }
  flushMessages();

  for (const task of unanchoredTasks) {
    entries.push({
      kind: 'recording-task',
      key: `recording:${task.taskId}`,
      task,
    });
  }

  return entries;
}
