import assert from 'node:assert/strict';
import test from 'node:test';
import { maskValue } from '../src/mask.js';

test('maskValue hides most of long secrets', () => {
  assert.equal(maskValue('snrUvkz6VUaeNSvvDeS5'), 'snr***eS5');
});

test('maskValue keeps shape for short values', () => {
  assert.equal(maskValue('5010'), '5***0');
  assert.equal(maskValue(''), '未配置');
});
