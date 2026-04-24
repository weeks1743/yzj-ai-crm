import { relative, resolve } from 'node:path';
import { ForbiddenError } from './errors.js';

export function normalizeAbsolutePath(pathValue: string): string {
  return resolve(pathValue);
}

export function isPathWithin(basePath: string, targetPath: string): boolean {
  const relativePath = relative(basePath, targetPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !relativePath.includes(`/..`) && !relativePath.includes(`\\..`))
  );
}

export function assertPathWithinRoots(
  targetPath: string,
  roots: string[],
  label: string,
): string {
  const normalized = normalizeAbsolutePath(targetPath);
  if (roots.some((root) => isPathWithin(root, normalized))) {
    return normalized;
  }

  throw new ForbiddenError(`${label} 不在允许访问的目录范围内`, {
    targetPath: normalized,
    roots,
  });
}

export function resolveUserSuppliedPath(
  inputPath: string,
  workspaceDir: string,
  readableRoots: string[],
  label: string,
): string {
  const candidate = inputPath.startsWith('/')
    ? normalizeAbsolutePath(inputPath)
    : resolve(workspaceDir, inputPath);
  return assertPathWithinRoots(candidate, readableRoots, label);
}
