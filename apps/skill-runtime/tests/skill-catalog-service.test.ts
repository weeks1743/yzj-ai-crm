import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { createDependencySnapshot, createTempDir, writeSkillFixture } from './test-helpers.js';
import { loadSkillsFromDirectories } from '../src/skill-loader.js';
import { SkillCatalogService } from '../src/skill-catalog-service.js';

test('skill catalog computes available, blocked, and unsupported_yet states', () => {
  const tempDir = createTempDir('skill-catalog-');
  try {
    for (const skillName of ['company-research', 'visit-conversation-understanding', 'customer-needs-todo-analysis', 'yunzhijia-visit-prep', 'report-generation', 'discovery-interview-prep']) {
      writeSkillFixture(
        tempDir,
        skillName,
        `---
name: ${skillName}
description: ${skillName} description
---

# ${skillName}
`,
      );
    }

    const loadedSkills = loadSkillsFromDirectories([tempDir]);
    const dependencySnapshot = createDependencySnapshot({
      'env:DEEPSEEK_API_KEY': true,
    });
    const catalog = new SkillCatalogService(loadedSkills, dependencySnapshot).listSkills();

    assert.equal(catalog.find((item) => item.skillName === 'company-research')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'visit-conversation-understanding')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'customer-needs-todo-analysis')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'yunzhijia-visit-prep')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'report-generation')?.status, 'available');
    assert.deepEqual(catalog.find((item) => item.skillName === 'report-generation')?.profile.allowedTools, []);
    assert.equal(catalog.find((item) => item.skillName === 'discovery-interview-prep')?.status, 'unsupported_yet');
    assert.equal(catalog.some((item) => item.skillName === 'super-ppt'), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
