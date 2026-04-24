import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import type { DeckSlideType, DeckSpec } from './pptx-deck.js';
import { BUSINESS_LAYOUT_METRICS, getSlideDensityThreshold } from './pptx-deck.js';
import { BadRequestError } from './errors.js';
import { runLocalCommand, runLocalCommandBuffer } from './local-command.js';

export interface PptxSlideQualityReport {
  slideNumber: number;
  type: DeckSlideType | 'unknown';
  characterCount: number;
  textShapeCount: number;
  placeholderHits: string[];
  excerpt: string;
  failures: string[];
  warnings: string[];
}

export interface PptxQualityReport {
  passed: boolean;
  pptxPath: string;
  byteSize: number;
  pageRatio: string | null;
  slideCount: number;
  expectedSlideCount: number | null;
  failures: string[];
  warnings: string[];
  outputHygiene: {
    outputDir: string;
    unexpectedEntries: string[];
  };
  slides: PptxSlideQualityReport[];
}

const PLACEHOLDER_PATTERNS = [
  /\bSlide Number\b/gi,
  /\bClick to add\b/gi,
  /\bLorem ipsum\b/gi,
  /\bTODO\b/gi,
  /\bTBD\b/gi,
  /\bplaceholder\b/gi,
];

const ENGLISH_TEMPLATE_PATTERNS = [
  /\bAGENDA OR SUMMARY\b/g,
  /\bCOMPANY OVERVIEW\b/g,
  /\bTIMELINE\b/g,
  /\bTWO COLUMN CLAIM\b/g,
  /\bKPI STRIP\b/g,
  /\bRISK SUMMARY\b/g,
  /\bExecutive Takeaway\b/g,
  /\bOverview\b/g,
  /\bRisks\b/g,
  /\bMitigations\b/g,
  /Source synthesis from provided materials/g,
  /Executive structure generated from source material/g,
  /Closing synthesis from deck narrative/g,
  /Deliver a decision ready business summary/g,
];

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&#x2019;/g, '\'')
    .replace(/&#x201C;/g, '"')
    .replace(/&#x201D;/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listZipEntries(pptxPath: string): string[] {
  const { stdout } = runLocalCommand('unzip', ['-Z1', pptxPath]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

function readZipText(pptxPath: string, entryName: string): string {
  const { stdout } = runLocalCommandBuffer('unzip', ['-p', pptxPath, entryName]);
  return stdout.toString('utf8');
}

function readPresentationRatio(pptxPath: string): string | null {
  const presentationXml = readZipText(pptxPath, 'ppt/presentation.xml');
  const match = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  if (!match) {
    return null;
  }

  const cx = Number.parseInt(match[1]!, 10);
  const cy = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cy === 0) {
    return null;
  }

  const ratio = cx / cy;
  if (Math.abs(ratio - 16 / 9) < 0.04) {
    return '16:9';
  }
  if (Math.abs(ratio - 4 / 3) < 0.04) {
    return '4:3';
  }
  return ratio.toFixed(3);
}

function extractTextRuns(slideXml: string): string[] {
  return Array.from(slideXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlEntities(match[1] || ''))
    .filter(Boolean);
}

function collectPlaceholderHits(slideXml: string): string[] {
  const hits: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matched = slideXml.match(pattern);
    if (matched) {
      hits.push(...matched.map((item) => item.trim()));
    }
  }

  return Array.from(new Set(hits));
}

function collectEnglishTemplateHits(texts: string[]): string[] {
  const joined = texts.join('\n');
  const hits: string[] = [];
  for (const pattern of ENGLISH_TEMPLATE_PATTERNS) {
    const matched = joined.match(pattern);
    if (matched) {
      hits.push(...matched.map((item) => item.trim()));
    }
  }

  return Array.from(new Set(hits));
}

function shouldEnforceChineseCopy(input: { deckSpec?: DeckSpec }, slideTexts: string[]): boolean {
  const language = input.deckSpec?.meta.language || '';
  if (/^zh\b/i.test(language.trim())) {
    return true;
  }

  return slideTexts.some((text) => /[\u4e00-\u9fff]/.test(text));
}

function evaluateSlide(
  slideXml: string,
  slideNumber: number,
  type: DeckSlideType | 'unknown',
  options: {
    enforceChineseCopy: boolean;
  },
): PptxSlideQualityReport {
  const texts = extractTextRuns(slideXml);
  const placeholderHits = collectPlaceholderHits(slideXml);
  const englishTemplateHits = collectEnglishTemplateHits(texts);
  const characterCount = texts.join('').length;
  const textShapeCount = Array.from(slideXml.matchAll(/<p:sp\b/g)).length;
  const threshold = type === 'unknown' ? null : getSlideDensityThreshold(type);
  const failures: string[] = [];
  const warnings: string[] = [];

  if (placeholderHits.length > 0) {
    failures.push(`slide ${slideNumber} contains placeholder/debug text: ${placeholderHits.join(', ')}`);
  }

  if (options.enforceChineseCopy && englishTemplateHits.length > 0) {
    failures.push(`slide ${slideNumber} contains English template chrome: ${englishTemplateHits.join(', ')}`);
  }

  if (threshold && characterCount > threshold.maxCharacters) {
    failures.push(
      `slide ${slideNumber} is too dense (${characterCount} chars > ${threshold.maxCharacters})`,
    );
  }

  if (threshold && textShapeCount > threshold.maxTextShapes) {
    failures.push(
      `slide ${slideNumber} uses too many text shapes (${textShapeCount} > ${threshold.maxTextShapes})`,
    );
  }

  if (type === 'cover' && characterCount > 200) {
    failures.push(`slide ${slideNumber} cover is overloaded with text`);
  }

  if (type === 'closing' && texts.length > 6) {
    warnings.push(`slide ${slideNumber} closing has a lot of text runs`);
  }

  return {
    slideNumber,
    type,
    characterCount,
    textShapeCount,
    placeholderHits,
    excerpt: texts.slice(0, 4).join(' | '),
    failures,
    warnings,
  };
}

function checkOutputHygiene(outputDir: string, finalPptxName: string): {
  outputDir: string;
  unexpectedEntries: string[];
} {
  const allowedExtensions = new Set(['.pptx', '.pdf', '.jpg', '.jpeg']);
  const unexpectedEntries: string[] = [];

  if (!existsSync(outputDir)) {
    unexpectedEntries.push('output directory missing');
    return {
      outputDir,
      unexpectedEntries,
    };
  }

  for (const entry of readdirSync(outputDir)) {
    const extension = extname(entry).toLowerCase();
    if (entry === finalPptxName || allowedExtensions.has(extension)) {
      continue;
    }
    unexpectedEntries.push(entry);
  }

  return {
    outputDir,
    unexpectedEntries,
  };
}

export function checkPptxQuality(input: {
  pptxPath: string;
  deckSpec?: DeckSpec;
}): PptxQualityReport {
  const stat = statSync(input.pptxPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new BadRequestError(`PPTX 文件不存在: ${input.pptxPath}`);
  }

  if (stat.size === 0) {
    throw new BadRequestError(`PPTX 文件为空: ${input.pptxPath}`);
  }

  const entries = listZipEntries(input.pptxPath);
  const slideEntries = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const rawSlides: Array<{
    slideXml: string;
    slideType: DeckSlideType | 'unknown';
    slideTexts: string[];
    slideNumber: number;
  }> = slideEntries.map((entryName, index) => {
    const slideXml = readZipText(input.pptxPath, entryName);
    const slideType = input.deckSpec?.slides[index]?.type ?? 'unknown';
    return {
      slideXml,
      slideType,
      slideTexts: extractTextRuns(slideXml),
      slideNumber: index + 1,
    };
  });
  const enforceChineseCopy = shouldEnforceChineseCopy(
    input,
    rawSlides.flatMap((slide) => slide.slideTexts),
  );
  const slideReports = rawSlides.map((slide) =>
    evaluateSlide(slide.slideXml, slide.slideNumber, slide.slideType, {
      enforceChineseCopy,
    }),
  );
  const pageRatio = readPresentationRatio(input.pptxPath);
  const failures: string[] = [];
  const warnings: string[] = [];

  if (pageRatio !== BUSINESS_LAYOUT_METRICS.pageRatio) {
    failures.push(`presentation ratio must be ${BUSINESS_LAYOUT_METRICS.pageRatio}, received ${pageRatio ?? 'unknown'}`);
  }

  if (input.deckSpec && slideReports.length !== input.deckSpec.slides.length) {
    failures.push(`slide count mismatch: rendered ${slideReports.length}, planned ${input.deckSpec.slides.length}`);
  }

  if (slideEntries.length === 0) {
    failures.push('pptx contains no slides');
  }

  for (const slideReport of slideReports) {
    failures.push(...slideReport.failures);
    warnings.push(...slideReport.warnings);
  }

  const outputHygiene = checkOutputHygiene(dirname(input.pptxPath), basename(input.pptxPath));
  if (outputHygiene.unexpectedEntries.length > 0) {
    warnings.push(`output directory contains extra entries: ${outputHygiene.unexpectedEntries.join(', ')}`);
  }

  return {
    passed: failures.length === 0,
    pptxPath: input.pptxPath,
    byteSize: stat.size,
    pageRatio,
    slideCount: slideReports.length,
    expectedSlideCount: input.deckSpec?.slides.length ?? null,
    failures,
    warnings,
    outputHygiene,
    slides: slideReports,
  };
}
