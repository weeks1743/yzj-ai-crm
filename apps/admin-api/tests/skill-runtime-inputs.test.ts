import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  resolveSkillRuntimeInputsRoot,
  writeSkillRuntimeInputFile,
} from '../src/skill-runtime-inputs.js';
import { createTestConfig } from './test-helpers.js';

test('writeSkillRuntimeInputFile writes under shared skill-runtime inputs root', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yzj-skill-runtime-inputs-'));
  try {
    const config = createTestConfig({ envFilePath: join(tempDir, '.env') });
    const filePath = writeSkillRuntimeInputFile({
      config,
      segments: ['artifact-report-inputs'],
      fileName: 'version-001-hash.md',
      content: '# 报告输入',
    });

    assert.equal(
      filePath,
      join(tempDir, '.local/skill-runtime-inputs/artifact-report-inputs/version-001-hash.md'),
    );
    assert.equal(readFileSync(filePath, 'utf8'), '# 报告输入');
    assert.equal(resolveSkillRuntimeInputsRoot(config), join(tempDir, '.local/skill-runtime-inputs'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('writeSkillRuntimeInputFile sanitizes visit prep path segments and filenames', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yzj-skill-runtime-inputs-'));
  try {
    const config = createTestConfig({ envFilePath: join(tempDir, '.env') });
    const filePath = writeSkillRuntimeInputFile({
      config,
      segments: ['agent-runtime-attachments', 'trace-agent/001'],
      fileName: '客户:贝斯美/company?.md',
      content: '拜访准备输入',
    });

    assert.equal(
      filePath,
      join(tempDir, '.local/skill-runtime-inputs/agent-runtime-attachments/trace-agent-001/客户-贝斯美-company-.md'),
    );
    assert.equal(readFileSync(filePath, 'utf8'), '拜访准备输入');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
