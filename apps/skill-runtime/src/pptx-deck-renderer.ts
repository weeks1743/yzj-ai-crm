import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeckSlide, DeckSpec } from './pptx-deck.js';
import { BUSINESS_LAYOUT_METRICS, getSlideDensityThreshold } from './pptx-deck.js';
import { createPptxGenJsInstance } from './pptxgenjs-runtime.js';

const SLIDE_WIDTH = BUSINESS_LAYOUT_METRICS.slideWidthInches;
const SLIDE_HEIGHT = BUSINESS_LAYOUT_METRICS.slideHeightInches;

type SlideLike = any;
type TableRowLike = any[];

interface Canvas {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isChineseDeck(deckSpec: DeckSpec): boolean {
  return /^zh\b/i.test((deckSpec.meta.language || '').trim());
}

function getSectionLabel(deckSpec: DeckSpec, type: DeckSlide['type']): string {
  if (!isChineseDeck(deckSpec)) {
    return type.replace(/_/g, ' ').toUpperCase();
  }

  const labels: Record<DeckSlide['type'], string> = {
    cover: '封面',
    agenda_or_summary: '投资摘要',
    company_overview: '公司概况',
    timeline: '成长路径',
    two_column_claim: '关键论点',
    evidence_table: '证据与数据',
    kpi_strip: '经营表现',
    risk_summary: '风险与观察点',
    closing: '结论',
  };

  return labels[type];
}

function buildRiskFollowUp(item: string): string {
  const normalized = item.replace(/[。；;]+$/g, '').trim();
  if (!normalized) {
    return '持续跟踪相关风险变化';
  }

  return `持续跟踪：${normalized}`;
}

function getCanvas(deckSpec: DeckSpec): Canvas {
  const { safeMarginX, safeMarginY } = deckSpec.theme.spacing;
  return {
    left: safeMarginX,
    top: safeMarginY,
    width: SLIDE_WIDTH - safeMarginX * 2,
    height: SLIDE_HEIGHT - safeMarginY * 2,
  };
}

function addFooter(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide, canvas: Canvas): void {
  slide.addText(deckSpec.meta.title, {
    x: canvas.left,
    y: SLIDE_HEIGHT - 0.42,
    w: 4.2,
    h: 0.2,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.footerFontPt,
    color: deckSpec.theme.palette.muted,
    margin: 0,
  });
  slide.addText(slideSpec.sourceNote, {
    x: canvas.left + 4.4,
    y: SLIDE_HEIGHT - 0.42,
    w: canvas.width - 4.4,
    h: 0.2,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.footerFontPt,
    color: deckSpec.theme.palette.muted,
    margin: 0,
    align: 'right',
  });
}

function addHeader(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide, canvas: Canvas): void {
  slide.background = {
    color: deckSpec.theme.palette.background,
  };
  slide.addShape('roundRect', {
    x: canvas.left,
    y: canvas.top,
    w: 0.42,
    h: 0.18,
    fill: { color: deckSpec.theme.palette.accent },
    line: { color: deckSpec.theme.palette.accent },
  });
  slide.addText(getSectionLabel(deckSpec, slideSpec.type), {
    x: canvas.left + 0.54,
    y: canvas.top - 0.03,
    w: 2.6,
    h: 0.22,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    color: deckSpec.theme.palette.muted,
    bold: true,
    margin: 0,
  });
  slide.addText(slideSpec.headline, {
    x: canvas.left,
    y: canvas.top + 0.32,
    w: canvas.width - 1.2,
    h: 0.62,
    fontFace: deckSpec.theme.typography.heading,
    fontSize: 28,
    bold: true,
    color: deckSpec.theme.palette.text,
    margin: 0,
    breakLine: false,
  });
  slide.addText(slideSpec.goal, {
    x: canvas.left,
    y: canvas.top + 0.98,
    w: canvas.width - 1.6,
    h: 0.36,
    fontFace: deckSpec.theme.typography.body,
    fontSize: 15,
    color: deckSpec.theme.palette.muted,
    margin: 0,
  });
}

function addPointCards(
  slide: SlideLike,
  deckSpec: DeckSpec,
  items: string[],
  options: {
    x: number;
    y: number;
    w: number;
    h: number;
    columns?: number;
    fillColor?: string;
  },
): void {
  if (items.length === 0) {
    return;
  }

  const columns = options.columns ?? 1;
  const rows = Math.ceil(items.length / columns);
  const cardGap = deckSpec.theme.spacing.cardGap;
  const cardWidth = (options.w - cardGap * (columns - 1)) / columns;
  const cardHeight = (options.h - cardGap * (rows - 1)) / rows;

  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = options.x + column * (cardWidth + cardGap);
    const y = options.y + row * (cardHeight + cardGap);

    slide.addShape('roundRect', {
      x,
      y,
      w: cardWidth,
      h: cardHeight,
      rectRadius: 0.08,
      fill: { color: options.fillColor || deckSpec.theme.palette.surface },
      line: { color: deckSpec.theme.palette.border, width: 1 },
    });
    slide.addText(item, {
      x: x + 0.18,
      y: y + 0.16,
      w: cardWidth - 0.36,
      h: cardHeight - 0.32,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
      color: deckSpec.theme.palette.text,
      margin: 0,
      valign: 'mid',
    });
  });
}

function addNumberedRows(
  slide: SlideLike,
  deckSpec: DeckSpec,
  items: string[],
  options: {
    x: number;
    y: number;
    w: number;
    rowHeight: number;
    gap?: number;
  },
): void {
  const gap = options.gap ?? 0.22;
  items.forEach((item, index) => {
    const y = options.y + index * (options.rowHeight + gap);
    slide.addShape('ellipse', {
      x: options.x,
      y,
      w: 0.72,
      h: 0.72,
      fill: { color: deckSpec.theme.palette.dark },
      line: { color: deckSpec.theme.palette.dark },
    });
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: options.x,
      y: y + 0.11,
      w: 0.72,
      h: 0.2,
      fontFace: deckSpec.theme.typography.body,
      fontSize: 15,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
      margin: 0,
    });
    slide.addText(item, {
      x: options.x + 0.9,
      y: y + 0.04,
      w: options.w - 0.9,
      h: options.rowHeight - 0.06,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
      color: deckSpec.theme.palette.text,
      margin: 0,
      valign: 'mid',
    });
  });
}

function buildBulletText(items: string[], options?: { numbered?: boolean }): string {
  return items
    .map((item, index) => {
      const prefix = options?.numbered ? `${index + 1}. ` : '- ';
      return `${prefix}${item}`;
    })
    .join('\n\n');
}

function renderCover(slide: SlideLike, deckSpec: DeckSpec): void {
  const canvas = getCanvas(deckSpec);
  const accent = deckSpec.theme.palette.accent;
  const isChinese = isChineseDeck(deckSpec);
  const audienceLabel = isChinese ? deckSpec.meta.audience : deckSpec.meta.audience.toUpperCase();
  slide.background = { color: deckSpec.theme.palette.dark };
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
    fill: { color: deckSpec.theme.palette.dark },
    line: { color: deckSpec.theme.palette.dark },
  });
  slide.addShape('rect', {
    x: SLIDE_WIDTH - 4.2,
    y: 0,
    w: 4.2,
    h: SLIDE_HEIGHT,
    fill: { color: accent, transparency: 78 },
    line: { color: accent, transparency: 100 },
  });
  slide.addShape('roundRect', {
    x: canvas.left,
    y: canvas.top + 0.1,
    w: 2.1,
    h: 0.34,
    fill: { color: accent, transparency: 6 },
    line: { color: accent, transparency: 100 },
  });
  slide.addText(audienceLabel, {
    x: canvas.left + 0.18,
    y: canvas.top + 0.14,
    w: 1.8,
    h: 0.18,
    fontFace: deckSpec.theme.typography.body,
    fontSize: 12,
    bold: true,
    color: 'FFFFFF',
    margin: 0,
  });
  slide.addText(deckSpec.meta.title, {
    x: canvas.left,
    y: 1.5,
    w: 7.4,
    h: 1.2,
    fontFace: deckSpec.theme.typography.display,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF',
    margin: 0,
  });
  slide.addText(deckSpec.meta.subtitle, {
    x: canvas.left,
    y: 2.88,
    w: 6.6,
    h: 0.8,
    fontFace: deckSpec.theme.typography.body,
    fontSize: 18,
    color: 'F2EDE6',
    margin: 0,
  });
  if (deckSpec.meta.purpose?.trim()) {
    slide.addShape('roundRect', {
      x: canvas.left,
      y: 5.42,
      w: 5.2,
      h: 0.78,
      fill: { color: 'FFFFFF', transparency: 88 },
      line: { color: 'FFFFFF', transparency: 100 },
    });
    slide.addText(deckSpec.meta.purpose, {
      x: canvas.left + 0.2,
      y: 5.63,
      w: 4.8,
      h: 0.24,
      fontFace: deckSpec.theme.typography.body,
      fontSize: 14,
      color: 'FFFFFF',
      margin: 0,
    });
  }
}

function renderAgendaOrSummary(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  const proofItems = slideSpec.supportingPoints.slice(1).concat(slideSpec.evidence).slice(0, 3);
  addHeader(slide, deckSpec, slideSpec, canvas);
  slide.addShape('roundRect', {
    x: canvas.left,
    y: 1.7,
    w: 4.9,
    h: 3.95,
    fill: { color: deckSpec.theme.palette.surface },
    line: { color: deckSpec.theme.palette.border, width: 1 },
  });
  slide.addText(isChineseDeck(deckSpec) ? '主判断' : 'Executive takeaway', {
    x: canvas.left + 0.22,
    y: 1.94,
    w: 2.6,
    h: 0.22,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    bold: true,
    color: deckSpec.theme.palette.accent,
    margin: 0,
  });
  slide.addText(slideSpec.supportingPoints[0] || slideSpec.goal, {
    x: canvas.left + 0.22,
    y: 2.28,
    w: 4.3,
    h: 1.7,
    fontFace: deckSpec.theme.typography.heading,
    fontSize: 26,
    bold: true,
    color: deckSpec.theme.palette.text,
    margin: 0,
    valign: 'mid',
  });
  slide.addText(slideSpec.goal, {
    x: canvas.left + 0.22,
    y: 5.0,
    w: 4.3,
    h: 0.46,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
    color: deckSpec.theme.palette.muted,
    margin: 0,
  });
  addNumberedRows(slide, deckSpec, proofItems, {
    x: canvas.left + 5.25,
    y: 2.05,
    w: canvas.width - 5.25,
    rowHeight: 0.86,
    gap: 0.26,
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function renderCompanyOverview(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  addHeader(slide, deckSpec, slideSpec, canvas);
  const summary = slideSpec.supportingPoints[0] || slideSpec.goal;
  const detailBullets = slideSpec.supportingPoints.slice(1, 4);
  const evidenceBullets = slideSpec.evidence.slice(0, 4);

  slide.addShape('roundRect', {
    x: canvas.left,
    y: 1.7,
    w: 5.8,
    h: 4.85,
    fill: { color: deckSpec.theme.palette.surface },
    line: { color: deckSpec.theme.palette.border, width: 1 },
  });
  slide.addShape('roundRect', {
    x: canvas.left + 6.05,
    y: 1.7,
    w: canvas.width - 6.05,
    h: 4.85,
    fill: { color: deckSpec.theme.palette.surfaceAlt },
    line: { color: deckSpec.theme.palette.border, width: 1 },
  });
  slide.addText(isChineseDeck(deckSpec) ? '核心概览' : 'Overview', {
    x: canvas.left + 0.22,
    y: 1.95,
    w: 1.4,
    h: 0.22,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    bold: true,
    color: deckSpec.theme.palette.accent,
    margin: 0,
  });
  slide.addText(summary, {
    x: canvas.left + 0.22,
    y: 2.28,
    w: 5.2,
    h: 1.02,
    fontFace: deckSpec.theme.typography.heading,
    fontSize: 22,
    bold: true,
    color: deckSpec.theme.palette.text,
    margin: 0,
    valign: 'mid',
  });
  if (detailBullets.length > 0) {
    slide.addText(buildBulletText(detailBullets), {
      x: canvas.left + 0.22,
      y: 3.55,
      w: 5.12,
      h: 2.0,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
      color: deckSpec.theme.palette.text,
      margin: 0,
      breakLine: true,
    });
  }

  slide.addText(isChineseDeck(deckSpec) ? '关键支撑' : 'Key evidence', {
    x: canvas.left + 6.28,
    y: 1.95,
    w: 1.8,
    h: 0.22,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    bold: true,
    color: deckSpec.theme.palette.success,
    margin: 0,
  });
  if (evidenceBullets.length > 0) {
    slide.addText(buildBulletText(evidenceBullets), {
      x: canvas.left + 6.28,
      y: 2.28,
      w: canvas.width - 6.5,
      h: 3.9,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
      color: deckSpec.theme.palette.text,
      margin: 0,
      breakLine: true,
    });
  }
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function renderTimeline(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  addHeader(slide, deckSpec, slideSpec, canvas);
  const items = slideSpec.supportingPoints.concat(slideSpec.evidence).slice(0, 4);
  const trackY = 3.7;
  const startX = canvas.left + 0.6;
  const trackWidth = canvas.width - 1.2;
  slide.addShape('line', {
    x: startX,
    y: trackY,
    w: trackWidth,
    h: 0,
    line: { color: deckSpec.theme.palette.border, width: 2.5 },
  });

  items.forEach((item, index) => {
    const stepX = startX + (trackWidth / Math.max(1, items.length - 1)) * index;
    slide.addShape('ellipse', {
      x: stepX - 0.14,
      y: trackY - 0.14,
      w: 0.28,
      h: 0.28,
      fill: { color: deckSpec.theme.palette.accent },
      line: { color: deckSpec.theme.palette.accent },
    });
    slide.addShape('roundRect', {
      x: stepX - 1.05,
      y: index % 2 === 0 ? 2.1 : 4.05,
      w: 2.1,
      h: 1.05,
      fill: { color: deckSpec.theme.palette.surface },
      line: { color: deckSpec.theme.palette.border, width: 1 },
    });
    slide.addText(item, {
      x: stepX - 0.92,
      y: index % 2 === 0 ? 2.28 : 4.23,
      w: 1.84,
      h: 0.7,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
      color: deckSpec.theme.palette.text,
      margin: 0,
      align: 'center',
      valign: 'mid',
    });
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function renderTwoColumnClaim(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  addHeader(slide, deckSpec, slideSpec, canvas);
  slide.addShape('roundRect', {
    x: canvas.left,
    y: 1.72,
    w: 5.2,
    h: 4.75,
    fill: { color: deckSpec.theme.palette.dark },
    line: { color: deckSpec.theme.palette.dark },
  });
  slide.addText(slideSpec.supportingPoints[0] || slideSpec.goal, {
    x: canvas.left + 0.26,
    y: 2.1,
    w: 4.66,
    h: 1.0,
    fontFace: deckSpec.theme.typography.heading,
    fontSize: 24,
    bold: true,
    color: 'FFFFFF',
    margin: 0,
    valign: 'mid',
  });
  addPointCards(slide, deckSpec, slideSpec.supportingPoints.slice(1, 4), {
    x: canvas.left + 0.22,
    y: 3.35,
    w: 4.76,
    h: 2.6,
    fillColor: 'FFFFFF',
  });
  addPointCards(slide, deckSpec, slideSpec.evidence.slice(0, 4), {
    x: canvas.left + 5.45,
    y: 1.72,
    w: canvas.width - 5.45,
    h: 4.75,
    fillColor: deckSpec.theme.palette.surfaceAlt,
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function toTableRows(slideSpec: DeckSlide): TableRowLike[] {
  const rows: TableRowLike[] = [
    [
      {
        text: 'Focus',
        options: {
          bold: true,
          fill: { color: '1F324A' },
          color: 'FFFFFF',
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          margin: 0.08,
        },
      },
      {
        text: 'Evidence',
        options: {
          bold: true,
          fill: { color: '1F324A' },
          color: 'FFFFFF',
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          margin: 0.08,
        },
      },
    ],
  ];

  const maxRows = Math.max(slideSpec.supportingPoints.length, slideSpec.evidence.length, 3);
  for (let index = 0; index < maxRows; index += 1) {
    rows.push([
      {
        text: slideSpec.supportingPoints[index] || `Key point ${index + 1}`,
        options: {
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          fill: { color: index % 2 === 0 ? 'FFFDFC' : 'F4EEE4' },
          color: '22313F',
          margin: 0.08,
        },
      },
      {
        text: slideSpec.evidence[index] || slideSpec.sourceNote,
        options: {
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          fill: { color: index % 2 === 0 ? 'FFFDFC' : 'F4EEE4' },
          color: '22313F',
          margin: 0.08,
        },
      },
    ]);
  }

  return rows;
}

function renderEvidenceTable(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  addHeader(slide, deckSpec, slideSpec, canvas);
  slide.addTable(toTableRows(slideSpec), {
    x: canvas.left,
    y: 1.82,
    w: canvas.width,
    h: 3.95,
    border: { color: deckSpec.theme.palette.border, width: 1 },
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    colW: [4.2, canvas.width - 4.2],
    margin: 0.06,
    autoFit: false,
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function splitKpiValue(item: string): { label: string; value: string; detail: string } {
  const match = item.match(/(-?\d+(?:\.\d+)?(?:%|x|倍|亿元|亿|万|人|家)?)/);
  if (match) {
    const value = match[1];
    const label = item.replace(value, '').replace(/[:：-]\s*$/, '').trim() || 'Key metric';
    return {
      label,
      value,
      detail: item,
    };
  }

  const [label, detail] = item.split(/[:：]/);
  return {
    label: (label || 'Key metric').trim(),
    value: (detail || item).trim(),
    detail: item,
  };
}

function renderKpiStrip(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  addHeader(slide, deckSpec, slideSpec, canvas);
  const items = slideSpec.supportingPoints.concat(slideSpec.evidence).slice(0, 3);
  const cardGap = deckSpec.theme.spacing.cardGap;
  const cardWidth = (canvas.width - cardGap * 2) / 3;

  items.forEach((item, index) => {
    const metric = splitKpiValue(item);
    const x = canvas.left + index * (cardWidth + cardGap);
    slide.addShape('roundRect', {
      x,
      y: 1.85,
      w: cardWidth,
      h: 2.2,
      fill: { color: index === 1 ? deckSpec.theme.palette.dark : deckSpec.theme.palette.surface },
      line: { color: deckSpec.theme.palette.border, width: 1 },
    });
    slide.addText(metric.label, {
      x: x + 0.18,
      y: 2.08,
      w: cardWidth - 0.36,
      h: 0.22,
      fontFace: deckSpec.theme.typography.body,
      fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
      bold: true,
      color: index === 1 ? 'F6F1E8' : deckSpec.theme.palette.muted,
      margin: 0,
    });
    slide.addText(metric.value, {
      x: x + 0.18,
      y: 2.46,
      w: cardWidth - 0.36,
      h: 0.8,
      fontFace: deckSpec.theme.typography.heading,
      fontSize: 26,
      bold: true,
      color: index === 1 ? 'FFFFFF' : deckSpec.theme.palette.text,
      margin: 0,
      valign: 'mid',
    });
  });

  addPointCards(slide, deckSpec, slideSpec.supportingPoints.concat(slideSpec.evidence).slice(3, 6), {
    x: canvas.left,
    y: 4.35,
    w: canvas.width,
    h: 1.72,
    columns: 3,
    fillColor: deckSpec.theme.palette.surfaceAlt,
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function renderRiskSummary(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  const risks = slideSpec.supportingPoints.slice(0, 4);
  const watchItems = risks.map((item, index) => slideSpec.evidence[index] || buildRiskFollowUp(item));
  addHeader(slide, deckSpec, slideSpec, canvas);
  const rows: TableRowLike[] = [
    [
      {
        text: isChineseDeck(deckSpec) ? '风险主题' : 'Risk',
        options: {
          bold: true,
          fill: { color: deckSpec.theme.palette.dark },
          color: 'FFFFFF',
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          margin: 0.08,
        },
      },
      {
        text: isChineseDeck(deckSpec) ? '持续跟踪' : 'Watch item',
        options: {
          bold: true,
          fill: { color: deckSpec.theme.palette.dark },
          color: 'FFFFFF',
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          margin: 0.08,
        },
      },
    ],
  ];

  risks.forEach((item, index) => {
    rows.push([
      {
        text: item,
        options: {
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          fill: { color: index % 2 === 0 ? 'FFFDFC' : 'F2F5F8' },
          color: deckSpec.theme.palette.text,
          margin: 0.08,
        },
      },
      {
        text: watchItems[index] || buildRiskFollowUp(item),
        options: {
          fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
          fill: { color: index % 2 === 0 ? 'FFFDFC' : 'F2F5F8' },
          color: deckSpec.theme.palette.text,
          margin: 0.08,
        },
      },
    ]);
  });

  slide.addTable(rows, {
    x: canvas.left,
    y: 1.98,
    w: canvas.width,
    h: 4.35,
    border: { color: deckSpec.theme.palette.border, width: 1 },
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minLabelFontPt,
    colW: [4.35, canvas.width - 4.35],
    margin: 0.06,
    autoFit: false,
  });
  addFooter(slide, deckSpec, slideSpec, canvas);
}

function renderClosing(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const canvas = getCanvas(deckSpec);
  const points = slideSpec.supportingPoints.slice(0, 3);
  const columnGap = 0.5;
  const columnWidth = (canvas.width - columnGap * 2) / 3;
  slide.background = { color: deckSpec.theme.palette.dark };
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
    fill: { color: deckSpec.theme.palette.dark },
    line: { color: deckSpec.theme.palette.dark },
  });
  slide.addText(slideSpec.headline, {
    x: canvas.left,
    y: 1.32,
    w: 7.2,
    h: 1.0,
    fontFace: deckSpec.theme.typography.display,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF',
    margin: 0,
  });
  slide.addText(slideSpec.goal, {
    x: canvas.left,
    y: 2.52,
    w: 8.6,
    h: 0.6,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.minBodyFontPt,
    color: 'F2EDE6',
    margin: 0,
  });
  points.forEach((item, index) => {
    const x = canvas.left + index * (columnWidth + columnGap);
    slide.addShape('line', {
      x,
      y: 3.72,
      w: 0.86,
      h: 0,
      line: { color: deckSpec.theme.palette.accent, width: 2.5 },
    });
    slide.addText(item, {
      x,
      y: 3.92,
      w: columnWidth,
      h: 1.4,
      fontFace: deckSpec.theme.typography.body,
      fontSize: 22,
      color: 'FFFFFF',
      bold: true,
      margin: 0,
      valign: 'mid',
    });
  });
  slide.addText(slideSpec.sourceNote, {
    x: canvas.left,
    y: 6.82,
    w: canvas.width,
    h: 0.2,
    fontFace: deckSpec.theme.typography.body,
    fontSize: BUSINESS_LAYOUT_METRICS.footerFontPt,
    color: 'D7DDE3',
    margin: 0,
  });
}

function renderBodySlide(slide: SlideLike, deckSpec: DeckSpec, slideSpec: DeckSlide): void {
  const threshold = getSlideDensityThreshold(slideSpec.type);
  const safePoints = slideSpec.supportingPoints.slice(0, threshold.maxSupportingPoints);
  const safeEvidence = slideSpec.evidence.slice(0, threshold.maxEvidence);
  const normalizedSlide = {
    ...slideSpec,
    supportingPoints: safePoints,
    evidence: safeEvidence,
  };

  switch (normalizedSlide.type) {
    case 'agenda_or_summary':
      renderAgendaOrSummary(slide, deckSpec, normalizedSlide);
      return;
    case 'company_overview':
      renderCompanyOverview(slide, deckSpec, normalizedSlide);
      return;
    case 'timeline':
      renderTimeline(slide, deckSpec, normalizedSlide);
      return;
    case 'two_column_claim':
      renderTwoColumnClaim(slide, deckSpec, normalizedSlide);
      return;
    case 'evidence_table':
      renderEvidenceTable(slide, deckSpec, normalizedSlide);
      return;
    case 'kpi_strip':
      renderKpiStrip(slide, deckSpec, normalizedSlide);
      return;
    case 'risk_summary':
      renderRiskSummary(slide, deckSpec, normalizedSlide);
      return;
    case 'closing':
      renderClosing(slide, deckSpec, normalizedSlide);
      return;
    case 'cover':
      renderCover(slide, deckSpec);
      return;
  }
}

export async function renderDeckToPptx(input: {
  deckSpec: DeckSpec;
  outputPath: string;
}): Promise<{
  outputPath: string;
  slideCount: number;
}> {
  mkdirSync(dirname(input.outputPath), { recursive: true });

  const presentation = createPptxGenJsInstance();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.author = 'YZJ AI CRM Skill Runtime';
  presentation.company = 'YZJ';
  presentation.subject = input.deckSpec.meta.purpose;
  presentation.title = input.deckSpec.meta.title;

  for (const slideSpec of input.deckSpec.slides) {
    const slide = presentation.addSlide();
    if (slideSpec.type === 'cover') {
      renderCover(slide, input.deckSpec);
      continue;
    }

    renderBodySlide(slide, input.deckSpec, slideSpec);
  }

  await presentation.writeFile({
    fileName: input.outputPath,
    compression: true,
  });

  return {
    outputPath: input.outputPath,
    slideCount: input.deckSpec.slides.length,
  };
}
