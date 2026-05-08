export const PENDING_RECORDING_TASK_STALE_MS = 10 * 60 * 1000;
export const RECORDING_UPLOAD_INCOMPLETE_MESSAGE = '录音上传未完成，请重新上传录音文件';

export interface RecordingTaskStateLike {
  taskId: string;
  status: string;
  stages: Array<{
    key: string;
    label: string;
    status: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
  errorMessage?: string | null;
  localStatusText?: string;
}

export function isPendingRecordingTaskId(taskId: string) {
  return taskId.startsWith('pending-');
}

export function buildFailedPendingRecordingTask<T extends RecordingTaskStateLike>(
  task: T,
  errorMessage = RECORDING_UPLOAD_INCOMPLETE_MESSAGE,
  now = new Date(),
): T {
  return {
    ...task,
    status: 'failed',
    errorMessage,
    updatedAt: now.toISOString(),
    localStatusText: '上传未完成',
    stages: task.stages.map((stage) => ({
      ...stage,
      status: stage.key === 'uploaded' ? 'failed' : 'pending',
    })),
  };
}

export function isStalePendingRecordingTask(
  task: RecordingTaskStateLike,
  nowMs = Date.now(),
  staleMs = PENDING_RECORDING_TASK_STALE_MS,
) {
  if (!isPendingRecordingTaskId(task.taskId) || task.status === 'failed') {
    return false;
  }
  const createdAtMs = Date.parse(task.createdAt || '');
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }
  return nowMs - createdAtMs >= staleMs;
}

export function normalizePersistedRecordingTask<T extends RecordingTaskStateLike>(
  task: T,
  nowMs = Date.now(),
): T {
  return isStalePendingRecordingTask(task, nowMs)
    ? buildFailedPendingRecordingTask(task, RECORDING_UPLOAD_INCOMPLETE_MESSAGE, new Date(nowMs))
    : task;
}
