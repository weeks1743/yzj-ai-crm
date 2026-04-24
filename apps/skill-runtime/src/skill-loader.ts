import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { LoadedSkill, SkillProfile } from './contracts.js';
import { parseFrontmatter, parseStringList } from './frontmatter.js';

function walkFiles(baseDir: string, currentDir = baseDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(baseDir, entryPath));
      continue;
    }

    results.push(relative(baseDir, entryPath));
  }

  return results.sort();
}

function deriveSummary(description: string, content: string): string {
  const candidate = description.trim();
  if (candidate.length > 0) {
    return candidate;
  }

  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  return firstLine || 'No summary available.';
}

function buildProfile(
  skillName: string,
  skillDir: string,
  frontmatter: Record<string, unknown>,
  markdownContent: string,
): SkillProfile {
  const supportFiles = walkFiles(skillDir).filter((file) => file !== 'SKILL.md');
  const examples = supportFiles.filter((file) => file.startsWith('examples/'));

  return {
    skillName,
    displayName: typeof frontmatter.name === 'string' ? frontmatter.name : skillName,
    description:
      typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : deriveSummary('', markdownContent),
    whenToUse:
      typeof frontmatter.when_to_use === 'string'
        ? frontmatter.when_to_use.trim()
        : undefined,
    arguments: parseStringList(frontmatter.arguments),
    allowedTools: parseStringList(frontmatter['allowed-tools']),
    baseDir: skillDir,
    supportFiles,
    examples,
    hasTemplate: supportFiles.includes('template.md'),
  };
}

export function loadSkillsFromDirectories(skillDirs: string[]): LoadedSkill[] {
  const loadedSkills: LoadedSkill[] = [];

  for (const skillBaseDir of skillDirs) {
    const entries = readdirSync(skillBaseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const skillDir = resolve(skillBaseDir, entry.name);
      const skillFilePath = join(skillDir, 'SKILL.md');
      try {
        if (!statSync(skillFilePath).isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      const rawContent = readFileSync(skillFilePath, 'utf8');
      const { frontmatter, content } = parseFrontmatter(rawContent);
      const profile = buildProfile(entry.name, skillDir, frontmatter, content);
      const promptContent = `Base directory for this skill: ${skillDir}\n\n${content}`;

      loadedSkills.push({
        skillName: entry.name,
        skillFilePath,
        rawContent,
        promptContent,
        frontmatter,
        profile,
      });
    }
  }

  loadedSkills.sort((left, right) => left.skillName.localeCompare(right.skillName));
  return loadedSkills;
}
