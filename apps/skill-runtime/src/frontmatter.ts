import { parseDocument } from 'yaml';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      frontmatter: {},
      content: markdown,
    };
  }

  let frontmatter: Record<string, unknown> = {};
  try {
    const document = parseDocument(match[1] ?? '');
    const parsed = document.toJSON();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    frontmatter = {};
  }

  return {
    frontmatter,
    content: markdown.slice(match[0].length),
  };
}

export function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}
