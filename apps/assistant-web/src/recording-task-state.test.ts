import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFailedPendingRecordingTask,
  isPendingRecordingTaskId,
  isStalePendingRecordingTask,
  normalizePersistedRecordingTask,
  RECORDING_UPLOAD_INCOMPLETE_MESSAGE,
  type RecordingTaskStateLike,
} from './recording-task-state';

const baseTask: RecordingTaskStateLike = {
  taskId: 'pending-贝斯美拜访.mp3-1776073116748',
  status: 'queued',
  createdAt: '2026-05-08T08:37:56.000Z',
  updatedAt: '2026-05-08T08:37:56.000Z',
  stages: [
    { key: 'uploaded', label: '已上传', status: 'running' },
    { key: 'summary', label: '生成摘要', status: 'pending' },
  ],
};

test('pending recording task ids are frontend-only upload placeholders', () => {
  assert.equal(isPendingRecordingTaskId(baseTask.taskId), true);
  assert.equal(isPendingRecordingTaskId('recording-task-12345678'), false);
});

test('failed pending recording task marks upload stage failed and keeps later stages pending', () => {
  const failed = buildFailedPendingRecordingTask(baseTask, '网络已断开', new Date('2026-05-08T08:39:08.000Z'));

  assert.equal(failed.status, 'failed');
  assert.equal(failed.localStatusText, '上传未完成');
  assert.equal(failed.errorMessage, '网络已断开');
  assert.equal(failed.updatedAt, '2026-05-08T08:39:08.000Z');
  assert.deepEqual(failed.stages.map((stage) => stage.status), ['failed', 'pending']);
});

test('stale persisted pending recording task is normalized to failed', () => {
  const nowMs = Date.parse('2026-05-08T08:50:00.000Z');

  assert.equal(isStalePendingRecordingTask(baseTask, nowMs), true);

  const normalized = normalizePersistedRecordingTask(baseTask, nowMs);
  assert.equal(normalized.status, 'failed');
  assert.equal(normalized.errorMessage, RECORDING_UPLOAD_INCOMPLETE_MESSAGE);
});

test('fresh pending recording task remains visible while upload is in flight', () => {
  const nowMs = Date.parse('2026-05-08T08:40:00.000Z');

  assert.equal(isStalePendingRecordingTask(baseTask, nowMs), false);
  assert.equal(normalizePersistedRecordingTask(baseTask, nowMs), baseTask);
});
