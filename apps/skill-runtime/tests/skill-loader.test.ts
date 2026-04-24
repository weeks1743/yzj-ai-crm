import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { createTempDir, writeSkillFixture } from './test-helpers.js';
import { loadSkillsFromDirectories } from '../src/skill-loader.js';

test('loadSkillsFromDirectories parses frontmatter and support files', () => {
  const tempDir = createTempDir('skill-loader-');
  try {
    writeSkillFixture(
      tempDir,
      'demo-skill',
      `---
name: Demo Skill
description: Demo description
allowed-tools:
  - read_skill_file
arguments:
  - companyName
---

# Demo
`,
      {
        'template.md': '# Template',
        'examples/sample.md': '# Example',
      },
    );

    const [skill] = loadSkillsFromDirectories([tempDir]);
    assert.ok(skill);
    assert.equal(skill.profile.displayName, 'Demo Skill');
    assert.equal(skill.profile.description, 'Demo description');
    assert.deepEqual(skill.profile.allowedTools, ['read_skill_file']);
    assert.deepEqual(skill.profile.arguments, ['companyName']);
    assert.equal(skill.profile.hasTemplate, true);
    assert.deepEqual(skill.profile.examples, ['examples/sample.md']);
    assert.match(skill.promptContent, /^Base directory for this skill:/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
