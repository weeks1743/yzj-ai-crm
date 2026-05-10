import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppConfig } from './contracts.js';

const SKILL_RUNTIME_INPUTS_DIR = '.local/skill-runtime-inputs';

export function resolveSkillRuntimeInputsRoot(config: AppConfig): string {
  return resolve(dirname(config.meta.envFilePath), SKILL_RUNTIME_INPUTS_DIR);
}

export function writeSkillRuntimeInputFile(input: {
  config: AppConfig;
  segments: string[];
  fileName: string;
  content: string;
}): string {
  const directory = resolve(
    resolveSkillRuntimeInputsRoot(input.config),
    ...input.segments.map(sanitizePathSegment),
  );
  mkdirSync(directory, { recursive: true });

  const filePath = join(directory, sanitizeFileName(input.fileName));
  writeFileSync(filePath, input.content, 'utf8');
  return filePath;
}

export function sanitizeSkillRuntimeInputFileName(value: string): string {
  return sanitizeFileName(value);
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function sanitizeFileName(value: string): string {
  const normalized = value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || 'input.md';
}
