import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { createDependencySnapshot, createTempDir, writeSkillFixture } from './test-helpers.js';
import { loadSkillsFromDirectories } from '../src/skill-loader.js';
import { SkillCatalogService } from '../src/skill-catalog-service.js';

test('skill catalog computes available, blocked, and unsupported_yet states', () => {
  const tempDir = createTempDir('skill-catalog-');
  try {
    for (const skillName of ['company-research', 'pptx', 'docx']) {
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
      'command:markitdown': false,
    });
    const catalog = new SkillCatalogService(loadedSkills, dependencySnapshot).listSkills();

    assert.equal(catalog.find((item) => item.skillName === 'company-research')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'pptx')?.status, 'blocked');
    assert.equal(catalog.find((item) => item.skillName === 'docx')?.status, 'unsupported_yet');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
