import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { createDependencySnapshot, createTempDir, writeSkillFixture } from './test-helpers.js';
import { loadSkillsFromDirectories } from '../src/skill-loader.js';
import { SkillCatalogService } from '../src/skill-catalog-service.js';

test('skill catalog computes available, blocked, and unsupported_yet states', () => {
  const tempDir = createTempDir('skill-catalog-');
  try {
    for (const skillName of ['company-research', 'customer-journey-map', 'super-ppt', 'pptx', 'docx', 'discovery-interview-prep']) {
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
      'env:DOCMEE_API_KEY': false,
    });
    const catalog = new SkillCatalogService(loadedSkills, dependencySnapshot).listSkills();

    assert.equal(catalog.find((item) => item.skillName === 'company-research')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'customer-journey-map')?.status, 'available');
    assert.equal(catalog.find((item) => item.skillName === 'super-ppt')?.status, 'blocked');
    assert.equal(catalog.find((item) => item.skillName === 'pptx')?.status, 'blocked');
    assert.equal(catalog.find((item) => item.skillName === 'docx')?.status, 'unsupported_yet');
    assert.equal(catalog.find((item) => item.skillName === 'discovery-interview-prep')?.status, 'unsupported_yet');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
