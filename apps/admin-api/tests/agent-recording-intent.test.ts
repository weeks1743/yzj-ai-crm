import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskPlan, inferFallbackIntent } from '../src/agent-utils.js';

test('audio upload fallback intent routes to recording material instead of unsupported audio', () => {
  const intent = inferFallbackIntent({
    query: '帮我处理这段拜访录音',
    attachments: [
      {
        name: 'visit.m4a',
        type: 'audio/mp4',
        url: '#attachment',
        size: 1024,
      },
    ],
  });
  const plan = buildTaskPlan(intent);

  assert.equal(plan.kind, 'recording_material');
  assert.notEqual(plan.kind, 'audio_not_supported');
  assert.equal(plan.steps.some((item) => item.toolRefs.includes('artifact.recording_material.prepare')), true);
});
