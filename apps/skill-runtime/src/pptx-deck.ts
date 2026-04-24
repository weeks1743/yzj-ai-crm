import { extname } from 'node:path';
import { BadRequestError } from './errors.js';

export const PPTX_TEMPLATE_EXTENSIONS = new Set(['.pptx', '.potx']);

export type PptxMode = 'fresh_deck' | 'template_following';

export type DeckSlideType =
  | 'cover'
  | 'agenda_or_summary'
  | 'company_overview'
  | 'timeline'
  | 'two_column_claim'
  | 'evidence_table'
  | 'kpi_strip'
  | 'risk_summary'
  | 'closing';

export interface DeckMeta {
  title: string;
  subtitle: string;
  audience: string;
  purpose: string;
  language: string;
}

export interface DeckPalette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  border: string;
  dark: string;
}

export interface DeckTypography {
  display: string;
  heading: string;
  body: string;
  monospace: string;
}

export interface DeckSpacing {
  safeMarginX: number;
  safeMarginY: number;
  sectionGap: number;
  cardGap: number;
}

export interface DeckTheme {
  palette: DeckPalette;
  typography: DeckTypography;
  spacing: DeckSpacing;
  pageRatio: '16:9';
}

export interface DeckSlide {
  type: DeckSlideType;
  goal: string;
  headline: string;
  supportingPoints: string[];
  evidence: string[];
  visualKind: string;
  sourceNote: string;
}

export interface DeckSpec {
  meta: DeckMeta;
  theme: DeckTheme;
  slides: DeckSlide[];
}

export interface DeckPlanResult {
  deckSpec: DeckSpec;
  notes: string[];
}

export interface SlideDensityThreshold {
  maxCharacters: number;
  maxSupportingPoints: number;
  maxEvidence: number;
  maxTextShapes: number;
}

const ALLOWED_SLIDE_TYPES: readonly DeckSlideType[] = [
  'cover',
  'agenda_or_summary',
  'company_overview',
  'timeline',
  'two_column_claim',
  'evidence_table',
  'kpi_strip',
  'risk_summary',
  'closing',
];

const SLIDE_TYPE_ALIASES: Record<string, DeckSlideType> = {
  summary: 'agenda_or_summary',
  agenda: 'agenda_or_summary',
  executive_summary: 'agenda_or_summary',
  overview: 'company_overview',
  company_summary: 'company_overview',
  kpi: 'kpi_strip',
  metrics: 'kpi_strip',
  risk: 'risk_summary',
  risk_grid: 'risk_summary',
  risk_matrix: 'risk_summary',
};

export const BUSINESS_LAYOUT_METRICS = {
  pageRatio: '16:9' as const,
  slideWidthInches: 13.333,
  slideHeightInches: 7.5,
  safeMarginX: 0.72,
  safeMarginY: 0.5,
  sectionGap: 0.24,
  cardGap: 0.18,
  minBodyFontPt: 18,
  minLabelFontPt: 14,
  footerFontPt: 11,
};

const DEFAULT_PALETTE: DeckPalette = {
  background: 'F6F1E8',
  surface: 'FFFDFC',
  surfaceAlt: 'EEE7DB',
  text: '22313F',
  muted: '66717D',
  accent: 'C5683A',
  accentSoft: 'E8C6B3',
  success: '2F6B5F',
  warning: 'A66B3F',
  border: 'D9D0C2',
  dark: '1F324A',
};

const DEFAULT_DENSITY_THRESHOLDS: Record<DeckSlideType, SlideDensityThreshold> = {
  cover: {
    maxCharacters: 180,
    maxSupportingPoints: 2,
    maxEvidence: 1,
    maxTextShapes: 10,
  },
  agenda_or_summary: {
    maxCharacters: 300,
    maxSupportingPoints: 4,
    maxEvidence: 2,
    maxTextShapes: 20,
  },
  company_overview: {
    maxCharacters: 360,
    maxSupportingPoints: 4,
    maxEvidence: 4,
    maxTextShapes: 14,
  },
  timeline: {
    maxCharacters: 320,
    maxSupportingPoints: 4,
    maxEvidence: 4,
    maxTextShapes: 20,
  },
  two_column_claim: {
    maxCharacters: 340,
    maxSupportingPoints: 4,
    maxEvidence: 3,
    maxTextShapes: 12,
  },
  evidence_table: {
    maxCharacters: 400,
    maxSupportingPoints: 5,
    maxEvidence: 5,
    maxTextShapes: 12,
  },
  kpi_strip: {
    maxCharacters: 240,
    maxSupportingPoints: 4,
    maxEvidence: 3,
    maxTextShapes: 18,
  },
  risk_summary: {
    maxCharacters: 340,
    maxSupportingPoints: 4,
    maxEvidence: 4,
    maxTextShapes: 18,
  },
  closing: {
    maxCharacters: 220,
    maxSupportingPoints: 3,
    maxEvidence: 1,
    maxTextShapes: 10,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BadRequestError(`${label} 必须是对象`);
  }

  return value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function detectPrimaryLanguage(text: string): string {
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
}

function stripMarkdown(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>#-]+/g, ' ')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1'),
  );
}

function splitIntoSentences(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/(?<=[。！？.!?;；])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function condenseText(value: string, maxLength: number): string {
  const clean = stripMarkdown(value);
  if (clean.length <= maxLength) {
    return clean;
  }

  const sentences = splitIntoSentences(clean);
  if (sentences.length > 1) {
    const candidate = sentences[0]!;
    if (candidate.length <= maxLength) {
      return candidate;
    }
  }

  return `${clean.slice(0, Math.max(8, maxLength - 1)).trim()}…`;
}

function normalizeArrayField(
  input: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  const rawValues = Array.isArray(input) ? input : typeof input === 'string' ? [input] : [];
  const results: string[] = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const cleanValue = normalizeWhitespace(rawValue);
    if (!cleanValue) {
      continue;
    }

    const fragments = splitIntoSentences(cleanValue);
    if (fragments.length === 0) {
      fragments.push(cleanValue);
    }

    for (const fragment of fragments) {
      const condensed = condenseText(fragment, maxItemLength);
      if (condensed) {
        results.push(condensed);
      }
    }
  }

  return results.slice(0, maxItems);
}

function normalizeObjectArrayField(
  input: unknown,
  maxItems: number,
  maxItemLength: number,
  format: (record: Record<string, unknown>) => string,
): string[] {
  const rawValues = Array.isArray(input) ? input : [];
  const results: string[] = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue === 'string') {
      const normalized = normalizeArrayField(rawValue, 1, maxItemLength);
      if (normalized[0]) {
        results.push(normalized[0]);
      }
      continue;
    }

    if (!isRecord(rawValue)) {
      continue;
    }

    const formatted = condenseText(normalizeWhitespace(format(rawValue)), maxItemLength);
    if (formatted) {
      results.push(formatted);
    }
  }

  return results.slice(0, maxItems);
}

function normalizeMetricField(
  input: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  return normalizeObjectArrayField(input, maxItems, maxItemLength, (record) => {
    const label = readOptionalString(record, 'label') || readOptionalString(record, 'name') || readOptionalString(record, 'title');
    const value = readOptionalString(record, 'value');
    const detail = readOptionalString(record, 'detail') || readOptionalString(record, 'note') || readOptionalString(record, 'body');
    const headline = label && value ? `${label}：${value}` : label || value;
    return detail && detail !== headline ? `${headline || detail}；${detail}` : headline || detail;
  });
}

function normalizeCardField(
  input: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  return normalizeObjectArrayField(input, maxItems, maxItemLength, (record) => {
    const header = readOptionalString(record, 'header') || readOptionalString(record, 'title') || readOptionalString(record, 'label');
    const body = readOptionalString(record, 'body') || readOptionalString(record, 'detail') || readOptionalString(record, 'note');
    return header && body ? `${header}：${body}` : header || body;
  });
}

function readOptionalString(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? normalizeWhitespace(value) || fallback : fallback;
}

function resolveTypography(language: string): DeckTypography {
  if (language.toLowerCase().startsWith('zh')) {
    return {
      display: 'PingFang SC',
      heading: 'PingFang SC',
      body: 'PingFang SC',
      monospace: 'Consolas',
    };
  }

  return {
    display: 'Georgia',
    heading: 'Georgia',
    body: 'Calibri',
    monospace: 'Consolas',
  };
}

function resolveDefaultTheme(language: string): DeckTheme {
  return {
    palette: DEFAULT_PALETTE,
    typography: resolveTypography(language),
    spacing: {
      safeMarginX: BUSINESS_LAYOUT_METRICS.safeMarginX,
      safeMarginY: BUSINESS_LAYOUT_METRICS.safeMarginY,
      sectionGap: BUSINESS_LAYOUT_METRICS.sectionGap,
      cardGap: BUSINESS_LAYOUT_METRICS.cardGap,
    },
    pageRatio: BUSINESS_LAYOUT_METRICS.pageRatio,
  };
}

function coerceSlideType(input: unknown, fallback: DeckSlideType): DeckSlideType {
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (ALLOWED_SLIDE_TYPES.includes(normalized as DeckSlideType)) {
      return normalized as DeckSlideType;
    }

    if (normalized in SLIDE_TYPE_ALIASES) {
      return SLIDE_TYPE_ALIASES[normalized]!;
    }
  }

  return fallback;
}

function guessSlideType(index: number, record: Record<string, unknown>): DeckSlideType {
  const combinedText = [
    readOptionalString(record, 'headline'),
    readOptionalString(record, 'goal'),
    readOptionalString(record, 'visualKind'),
    ...normalizeArrayField(record.supportingPoints, 6, 120),
    ...normalizeArrayField(record.evidence, 6, 120),
  ].join(' ');

  if (index === 0) {
    return 'cover';
  }

  if (/总结|摘要|议程|summary|agenda/i.test(combinedText)) {
    return 'agenda_or_summary';
  }

  if (/时间|历程|timeline|里程碑/i.test(combinedText)) {
    return 'timeline';
  }

  if (/风险|risk|应对|mitigation/i.test(combinedText)) {
    return 'risk_summary';
  }

  if (/\d/.test(combinedText) && normalizeArrayField(record.supportingPoints, 6, 80).length <= 4) {
    return 'kpi_strip';
  }

  if (/表|证据|matrix|evidence|对比/i.test(combinedText)) {
    return 'evidence_table';
  }

  return index % 2 === 0 ? 'company_overview' : 'two_column_claim';
}

function defaultVisualKind(type: DeckSlideType): string {
  switch (type) {
    case 'cover':
      return 'hero_panel';
    case 'agenda_or_summary':
      return 'summary_cards';
    case 'company_overview':
      return 'overview_panels';
    case 'timeline':
      return 'timeline';
    case 'two_column_claim':
      return 'two_column';
    case 'evidence_table':
      return 'evidence_table';
    case 'kpi_strip':
      return 'kpi_cards';
    case 'risk_summary':
      return 'risk_matrix';
    case 'closing':
      return 'closing_takeaways';
  }
}

function isChineseLanguage(language: string | undefined): boolean {
  return /^zh\b/i.test((language || '').trim());
}

function createCoverSlide(meta: DeckMeta): DeckSlide {
  const isChinese = isChineseLanguage(meta.language);
  return {
    type: 'cover',
    goal: isChinese ? '建立汇报语境并给出核心判断。' : 'Set the business context and establish the presentation frame.',
    headline: meta.title,
    supportingPoints: isChinese
      ? [meta.subtitle, `适用对象：${meta.audience}`].filter(Boolean).slice(0, 2)
      : [meta.subtitle, `${meta.audience} | ${meta.purpose}`].filter(Boolean).slice(0, 2),
    evidence: [],
    visualKind: defaultVisualKind('cover'),
    sourceNote: isChinese ? '资料来源：用户提供材料整理' : 'Source synthesis from provided materials',
  };
}

function createAgendaSlide(bodySlides: DeckSlide[], meta: DeckMeta): DeckSlide {
  const isChinese = isChineseLanguage(meta.language);
  return {
    type: 'agenda_or_summary',
    goal: isChinese ? '用一页给出管理层可快速浏览的主线。' : 'Frame the discussion in a concise executive narrative.',
    headline: isChinese ? '本次汇报重点' : 'Executive summary',
    supportingPoints: bodySlides.slice(0, 4).map((slide) => slide.headline),
    evidence: bodySlides.slice(0, 3).map((slide) => slide.goal),
    visualKind: defaultVisualKind('agenda_or_summary'),
    sourceNote: isChinese ? '资料来源：提供材料的结构化提炼' : 'Executive structure generated from source material',
  };
}

function createClosingSlide(meta: DeckMeta, bodySlides: DeckSlide[]): DeckSlide {
  const isChinese = isChineseLanguage(meta.language);
  return {
    type: 'closing',
    goal: isChinese ? '收束为可执行的结论与跟踪重点。' : 'Close with the decision-ready takeaway.',
    headline: meta.purpose || (isChinese ? '结论与下一步' : 'Closing and next steps'),
    supportingPoints: bodySlides.slice(-3).map((slide) => slide.headline),
    evidence: bodySlides.slice(-1).flatMap((slide) => slide.evidence.slice(0, 1)),
    visualKind: defaultVisualKind('closing'),
    sourceNote: isChinese ? '资料来源：整份演示文稿归纳' : 'Closing synthesis from deck narrative',
  };
}

function buildSlideFromRecord(
  value: unknown,
  index: number,
): DeckSlide {
  const record = ensureRecord(value, `slides[${index}]`);
  const fallbackType = guessSlideType(index, record);
  const type = coerceSlideType(record.type, fallbackType);
  const threshold = DEFAULT_DENSITY_THRESHOLDS[type];
  const headline = condenseText(
    readOptionalString(record, 'headline') || readOptionalString(record, 'goal') || `Slide ${index + 1}`,
    type === 'cover' ? 44 : 34,
  );
  const goal = condenseText(
    readOptionalString(record, 'goal') || headline,
    120,
  );
  const genericPoints = normalizeArrayField(
    record.points ?? record.items ?? record.bullets,
    threshold.maxSupportingPoints + 2,
    type === 'cover' ? 90 : 88,
  );
  let supportingPoints = normalizeArrayField(
    record.supportingPoints,
    threshold.maxSupportingPoints + 2,
    type === 'cover' ? 90 : 88,
  );
  let evidence = normalizeArrayField(
    record.evidence,
    threshold.maxEvidence + 2,
    84,
  );

  if (supportingPoints.length === 0 && genericPoints.length > 0) {
    supportingPoints = genericPoints;
  }

  if (type === 'company_overview') {
    if (supportingPoints.length === 0) {
      supportingPoints = normalizeArrayField(
        record.left,
        threshold.maxSupportingPoints + 2,
        88,
      );
    }
    if (evidence.length === 0) {
      evidence = normalizeArrayField(
        record.right ?? record.highlights ?? record.facts,
        threshold.maxEvidence + 2,
        84,
      );
    }
  }

  if (type === 'two_column_claim') {
    if (supportingPoints.length === 0) {
      supportingPoints = normalizeArrayField(
        record.left,
        threshold.maxSupportingPoints + 2,
        88,
      );
    }
    if (evidence.length === 0) {
      evidence = normalizeArrayField(
        record.right,
        threshold.maxEvidence + 2,
        84,
      );
    }
    if (supportingPoints.length === 0 && evidence.length === 0) {
      const metrics = normalizeMetricField(
        record.metrics ?? record.kpis,
        threshold.maxSupportingPoints + threshold.maxEvidence + 2,
        84,
      );
      supportingPoints = metrics.slice(0, threshold.maxSupportingPoints);
      evidence = metrics.slice(threshold.maxSupportingPoints, threshold.maxSupportingPoints + threshold.maxEvidence);
    }
  }

  if (type === 'kpi_strip') {
    const metrics = normalizeMetricField(
      record.metrics ?? record.kpis,
      threshold.maxSupportingPoints + threshold.maxEvidence + 2,
      72,
    );
    if (supportingPoints.length === 0 && metrics.length > 0) {
      supportingPoints = metrics.slice(0, threshold.maxSupportingPoints);
      evidence = metrics.slice(threshold.maxSupportingPoints, threshold.maxSupportingPoints + threshold.maxEvidence);
    }
  }

  if (type === 'risk_summary') {
    if (supportingPoints.length === 0) {
      supportingPoints = normalizeCardField(
        record.cards ?? record.risks,
        threshold.maxSupportingPoints + 2,
        88,
      );
    }
    if (evidence.length === 0) {
      evidence = normalizeArrayField(
        record.watchItems ?? record.followUps ?? record.mitigations ?? record.actions ?? record.right,
        threshold.maxEvidence + 2,
        84,
      );
    }
  }

  return {
    type,
    goal,
    headline,
    supportingPoints,
    evidence,
    visualKind: readOptionalString(record, 'visualKind') || defaultVisualKind(type),
    sourceNote: condenseText(readOptionalString(record, 'sourceNote') || '资料来源：用户提供材料整理', 120),
  };
}

function countSlideCharacters(slide: DeckSlide): number {
  return [
    slide.headline,
    slide.goal,
    ...slide.supportingPoints,
    ...slide.evidence,
    slide.sourceNote,
  ].join('').length;
}

function splitDenseSlide(slide: DeckSlide): DeckSlide[] {
  const threshold = getSlideDensityThreshold(slide.type);
  if (slide.type === 'cover' || slide.type === 'closing') {
    return [slide];
  }

  const characters = countSlideCharacters(slide);
  if (
    characters <= threshold.maxCharacters &&
    slide.supportingPoints.length <= threshold.maxSupportingPoints &&
    slide.evidence.length <= threshold.maxEvidence
  ) {
    return [slide];
  }

  const combined = [
    ...slide.supportingPoints.map((text) => ({ kind: 'support' as const, text })),
    ...slide.evidence.map((text) => ({ kind: 'evidence' as const, text })),
  ];
  const chunks: DeckSlide[] = [];
  let currentChunk = {
    supportingPoints: [] as string[],
    evidence: [] as string[],
  };

  for (const item of combined) {
    const nextCharacters = [
      slide.headline,
      slide.goal,
      ...currentChunk.supportingPoints,
      ...currentChunk.evidence,
      item.text,
      slide.sourceNote,
    ].join('').length;
    const nextSupportCount = currentChunk.supportingPoints.length + (item.kind === 'support' ? 1 : 0);
    const nextEvidenceCount = currentChunk.evidence.length + (item.kind === 'evidence' ? 1 : 0);

    const overflow = nextCharacters > threshold.maxCharacters
      || nextSupportCount > threshold.maxSupportingPoints
      || nextEvidenceCount > threshold.maxEvidence;

    if (overflow && (currentChunk.supportingPoints.length > 0 || currentChunk.evidence.length > 0)) {
      chunks.push({
        ...slide,
        headline: chunks.length === 0 ? slide.headline : `${slide.headline}（续）`,
        supportingPoints: currentChunk.supportingPoints,
        evidence: currentChunk.evidence,
      });
      currentChunk = {
        supportingPoints: [],
        evidence: [],
      };
    }

    if (item.kind === 'support') {
      currentChunk.supportingPoints.push(item.text);
    } else {
      currentChunk.evidence.push(item.text);
    }
  }

  if (currentChunk.supportingPoints.length > 0 || currentChunk.evidence.length > 0) {
    chunks.push({
      ...slide,
      headline: chunks.length === 0 ? slide.headline : `${slide.headline}（续）`,
      supportingPoints: currentChunk.supportingPoints,
      evidence: currentChunk.evidence,
    });
  }

  return chunks.length > 0 ? chunks : [slide];
}

function normalizeMeta(rawMeta: Record<string, unknown>, slides: DeckSlide[]): DeckMeta {
  const slideText = slides.flatMap((slide) => [slide.headline, slide.goal]).join(' ');
  const detectedLanguage = readOptionalString(rawMeta, 'language') || detectPrimaryLanguage(slideText);
  const title = condenseText(
    readOptionalString(rawMeta, 'title') || slides.find((slide) => slide.type !== 'cover')?.headline || 'Business Presentation',
    52,
  );

  return {
    title,
    subtitle: condenseText(readOptionalString(rawMeta, 'subtitle') || 'Executive briefing generated from source material', 80),
    audience: condenseText(readOptionalString(rawMeta, 'audience') || 'Management team', 48),
    purpose: condenseText(readOptionalString(rawMeta, 'purpose') || 'Deliver a decision-ready business summary', 56),
    language: detectedLanguage,
  };
}

function normalizeTheme(rawTheme: unknown, language: string): DeckTheme {
  const defaults = resolveDefaultTheme(language);
  if (!isRecord(rawTheme)) {
    return defaults;
  }

  const paletteRecord = isRecord(rawTheme.palette) ? rawTheme.palette : {};
  const typographyRecord = isRecord(rawTheme.typography) ? rawTheme.typography : {};
  const spacingRecord = isRecord(rawTheme.spacing) ? rawTheme.spacing : {};

  return {
    pageRatio: '16:9',
    palette: {
      ...defaults.palette,
      background: readOptionalString(paletteRecord, 'background', defaults.palette.background),
      surface: readOptionalString(paletteRecord, 'surface', defaults.palette.surface),
      surfaceAlt: readOptionalString(paletteRecord, 'surfaceAlt', defaults.palette.surfaceAlt),
      text: readOptionalString(paletteRecord, 'text', defaults.palette.text),
      muted: readOptionalString(paletteRecord, 'muted', defaults.palette.muted),
      accent: readOptionalString(paletteRecord, 'accent', defaults.palette.accent),
      accentSoft: readOptionalString(paletteRecord, 'accentSoft', defaults.palette.accentSoft),
      success: readOptionalString(paletteRecord, 'success', defaults.palette.success),
      warning: readOptionalString(paletteRecord, 'warning', defaults.palette.warning),
      border: readOptionalString(paletteRecord, 'border', defaults.palette.border),
      dark: readOptionalString(paletteRecord, 'dark', defaults.palette.dark),
    },
    typography: {
      ...defaults.typography,
      display: readOptionalString(typographyRecord, 'display', defaults.typography.display),
      heading: readOptionalString(typographyRecord, 'heading', defaults.typography.heading),
      body: readOptionalString(typographyRecord, 'body', defaults.typography.body),
      monospace: readOptionalString(typographyRecord, 'monospace', defaults.typography.monospace),
    },
    spacing: {
      safeMarginX: typeof spacingRecord.safeMarginX === 'number' ? spacingRecord.safeMarginX : defaults.spacing.safeMarginX,
      safeMarginY: typeof spacingRecord.safeMarginY === 'number' ? spacingRecord.safeMarginY : defaults.spacing.safeMarginY,
      sectionGap: typeof spacingRecord.sectionGap === 'number' ? spacingRecord.sectionGap : defaults.spacing.sectionGap,
      cardGap: typeof spacingRecord.cardGap === 'number' ? spacingRecord.cardGap : defaults.spacing.cardGap,
    },
  };
}

function withRequiredFrameSlides(slides: DeckSlide[], meta: DeckMeta): {
  slides: DeckSlide[];
  notes: string[];
} {
  const notes: string[] = [];
  const bodySlides = slides.filter((slide) => slide.type !== 'cover' && slide.type !== 'closing');
  const framedSlides: DeckSlide[] = [];

  if (slides[0]?.type !== 'cover') {
    framedSlides.push(createCoverSlide(meta));
    notes.push('Inserted standalone cover slide for fresh deck mode.');
  }

  framedSlides.push(...slides.filter((slide) => slide.type !== 'cover' && slide.type !== 'closing'));

  if (framedSlides[1]?.type !== 'agenda_or_summary') {
    framedSlides.splice(1, 0, createAgendaSlide(bodySlides, meta));
    notes.push('Inserted executive summary slide to strengthen narrative flow.');
  }

  const lastSlide = slides.at(-1);
  if (lastSlide?.type !== 'closing') {
    framedSlides.push(createClosingSlide(meta, bodySlides));
    notes.push('Inserted dedicated closing slide to avoid ending on a content page.');
  } else {
    framedSlides.push(lastSlide);
  }

  return {
    slides: framedSlides,
    notes,
  };
}

function normalizeSlides(rawSlides: unknown[]): DeckSlide[] {
  const slides = rawSlides.map((value, index) => buildSlideFromRecord(value, index));
  return slides.flatMap(splitDenseSlide);
}

function ensureDeckShape(slides: DeckSlide[]): void {
  if (slides.length < 4) {
    throw new BadRequestError('deck 至少需要 4 页，且必须具备 cover、summary、body、closing 结构');
  }

  if (slides.length > 12) {
    throw new BadRequestError('deck 页数过多，请先压缩内容或拆分为多个 deck');
  }
}

function validateDeckSpecShape(deckSpec: DeckSpec): DeckSpec {
  if (deckSpec.theme.pageRatio !== '16:9') {
    throw new BadRequestError('deckSpec.theme.pageRatio 必须为 16:9');
  }

  if (deckSpec.theme.spacing.safeMarginX < BUSINESS_LAYOUT_METRICS.safeMarginX) {
    throw new BadRequestError(`safeMarginX 不能小于 ${BUSINESS_LAYOUT_METRICS.safeMarginX}`);
  }

  if (deckSpec.theme.spacing.safeMarginY < BUSINESS_LAYOUT_METRICS.safeMarginY) {
    throw new BadRequestError(`safeMarginY 不能小于 ${BUSINESS_LAYOUT_METRICS.safeMarginY}`);
  }

  if (isChineseLanguage(deckSpec.meta.language)) {
    deckSpec.theme.typography = {
      ...deckSpec.theme.typography,
      ...resolveTypography(deckSpec.meta.language),
    };
  }

  ensureDeckShape(deckSpec.slides);
  for (const [index, slide] of deckSpec.slides.entries()) {
    const contentCount = slide.supportingPoints.length + slide.evidence.length;
    const label = `slides[${index}](${slide.type})`;

    if (slide.type === 'cover') {
      continue;
    }

    if (contentCount === 0) {
      throw new BadRequestError(`${label} 不能没有内容，否则会渲染为空页`);
    }

    if (slide.type === 'closing' && slide.supportingPoints.length === 0) {
      throw new BadRequestError(`${label} 至少需要 1 条结论`);
    }
  }
  return deckSpec;
}

export function inferPptxMode(attachments: string[]): PptxMode {
  return attachments.some((attachmentPath) => PPTX_TEMPLATE_EXTENSIONS.has(extname(attachmentPath).toLowerCase()))
    ? 'template_following'
    : 'fresh_deck';
}

export function getSlideDensityThreshold(type: DeckSlideType): SlideDensityThreshold {
  return DEFAULT_DENSITY_THRESHOLDS[type];
}

export function planDeck(rawValue: unknown): DeckPlanResult {
  const root = ensureRecord(rawValue, 'pptx_plan_deck 参数');
  if (!Array.isArray(root.slides) || root.slides.length === 0) {
    throw new BadRequestError('pptx_plan_deck 需要提供至少 1 个 slide brief');
  }

  const normalizedSlides = normalizeSlides(root.slides);
  const meta = normalizeMeta(isRecord(root.meta) ? root.meta : {}, normalizedSlides);
  const theme = normalizeTheme(root.theme, meta.language);
  const framed = withRequiredFrameSlides(normalizedSlides, meta);
  const deckSpec = validateDeckSpecShape({
    meta,
    theme,
    slides: framed.slides,
  });

  return {
    deckSpec,
    notes: framed.notes,
  };
}

export function parseDeckSpec(rawValue: unknown): DeckSpec {
  const root = ensureRecord(rawValue, 'deckSpec');
  if (!Array.isArray(root.slides) || root.slides.length === 0) {
    throw new BadRequestError('deckSpec.slides 不能为空');
  }

  const normalizedSlides = normalizeSlides(root.slides);
  const meta = normalizeMeta(isRecord(root.meta) ? root.meta : {}, normalizedSlides);
  const theme = normalizeTheme(root.theme, meta.language);
  return validateDeckSpecShape({
    meta,
    theme,
    slides: normalizedSlides,
  });
}
