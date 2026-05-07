import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordingTimeline, getLatestTimelineMessageId } from './recording-timeline';

const message = (id: string, content = id) => ({ id, content });
const task = (taskId: string, timelineAnchorMessageId?: string | null) => ({
  taskId,
  timelineAnchorMessageId,
});

test('recording timeline places unanchored recordings before later chat messages', () => {
  const timeline = buildRecordingTimeline(
    [message('m1'), message('m2')],
    [task('recording-1')],
  );

  assert.deepEqual(timeline.map((item) => item.kind), ['recording-task', 'messages']);
  assert.equal(timeline[0]?.key, 'recording:recording-1');
});

test('recording timeline inserts recording after its anchor message', () => {
  const timeline = buildRecordingTimeline(
    [message('m1'), message('m2'), message('m3')],
    [task('recording-1', 'm1')],
  );

  assert.deepEqual(timeline.map((item) => item.kind), ['messages', 'recording-task', 'messages']);
  assert.deepEqual(timeline[0]?.kind === 'messages' ? timeline[0].messages.map((item) => item.id) : [], ['m1']);
  assert.deepEqual(timeline[2]?.kind === 'messages' ? timeline[2].messages.map((item) => item.id) : [], ['m2', 'm3']);
});

test('recording timeline treats missing anchor as unanchored', () => {
  const timeline = buildRecordingTimeline(
    [message('m1')],
    [task('recording-1', 'missing-message')],
  );

  assert.deepEqual(timeline.map((item) => item.kind), ['recording-task', 'messages']);
});

test('recording timeline supports multiple recording cards and followup messages', () => {
  const timeline = buildRecordingTimeline(
    [message('m1'), message('m2'), message('m3')],
    [task('recording-2', 'm2'), task('recording-1', 'm1')],
  );

  assert.deepEqual(timeline.map((item) => item.key), [
    'messages:m1:m1',
    'recording:recording-1',
    'messages:m2:m2',
    'recording:recording-2',
    'messages:m3:m3',
  ]);
});

test('latest timeline message id returns the last visible chat message id', () => {
  assert.equal(getLatestTimelineMessageId([message('m1'), message('m2')]), 'm2');
  assert.equal(getLatestTimelineMessageId([]), null);
});
