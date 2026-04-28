export interface ArtifactMarkdownChunk {
  chunkIndex: number;
  heading?: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

const TARGET_CHUNK_SIZE = 1000;
const MAX_CHUNK_SIZE = 1200;
const OVERLAP_SIZE = 150;

interface MarkdownSection {
  heading?: string;
  text: string;
  startOffset: number;
}

export function chunkMarkdown(markdown: string): ArtifactMarkdownChunk[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const sections = splitMarkdownSections(normalized);
  const chunks: ArtifactMarkdownChunk[] = [];

  for (const section of sections) {
    const text = section.text.trim();
    if (!text) {
      continue;
    }

    if (text.length <= MAX_CHUNK_SIZE) {
      chunks.push({
        chunkIndex: chunks.length,
        heading: section.heading,
        text,
        startOffset: section.startOffset,
        endOffset: section.startOffset + text.length,
      });
      continue;
    }

    let cursor = 0;
    while (cursor < text.length) {
      const end = Math.min(cursor + TARGET_CHUNK_SIZE, text.length);
      const sliceEnd = findReadableBreak(text, end, cursor);
      const chunkText = text.slice(cursor, sliceEnd).trim();
      if (chunkText) {
        chunks.push({
          chunkIndex: chunks.length,
          heading: section.heading,
          text: chunkText,
          startOffset: section.startOffset + cursor,
          endOffset: section.startOffset + sliceEnd,
        });
      }

      if (sliceEnd >= text.length) {
        break;
      }

      cursor = Math.max(sliceEnd - OVERLAP_SIZE, cursor + 1);
    }
  }

  return chunks;
}

function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  const headings = Array.from(markdown.matchAll(headingRegex));

  if (!headings.length) {
    return [{ text: markdown, startOffset: 0 }];
  }

  const sections: MarkdownSection[] = [];
  const firstHeadingIndex = headings[0]?.index ?? 0;
  if (firstHeadingIndex > 0) {
    sections.push({
      text: markdown.slice(0, firstHeadingIndex),
      startOffset: 0,
    });
  }

  headings.forEach((match, index) => {
    const startOffset = match.index ?? 0;
    const endOffset = headings[index + 1]?.index ?? markdown.length;
    sections.push({
      heading: match[1]?.trim(),
      text: markdown.slice(startOffset, endOffset),
      startOffset,
    });
  });

  return sections;
}

function findReadableBreak(text: string, preferredEnd: number, start: number): number {
  if (preferredEnd >= text.length) {
    return text.length;
  }

  const searchStart = Math.max(start + 400, preferredEnd - 180);
  const window = text.slice(searchStart, preferredEnd + 120);
  const relativeBreak = Math.max(
    window.lastIndexOf('\n## '),
    window.lastIndexOf('\n- '),
    window.lastIndexOf('。'),
    window.lastIndexOf('；'),
    window.lastIndexOf('\n'),
  );

  if (relativeBreak > 0) {
    return searchStart + relativeBreak + 1;
  }

  return preferredEnd;
}
