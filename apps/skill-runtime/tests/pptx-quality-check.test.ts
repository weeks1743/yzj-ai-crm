import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderDeckToPptx } from '../src/pptx-deck-renderer.js';
import { createPptxGenJsInstance } from '../src/pptxgenjs-runtime.js';
import { checkPptxQuality } from '../src/pptx-quality-check.js';
import { createBasePptxFixture, createTempDir } from './test-helpers.js';

test('checkPptxQuality rejects non-16:9 decks', async () => {
  const tempRoot = createTempDir('skill-runtime-quality-4x3-');
  const pptxPath = join(tempRoot, 'legacy-template.pptx');
  try {
    createBasePptxFixture(pptxPath);
    const report = checkPptxQuality({ pptxPath });
    assert.equal(report.passed, false);
    assert.match(report.failures.join('\n'), /16:9/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('checkPptxQuality detects placeholder text', async () => {
  const tempRoot = createTempDir('skill-runtime-quality-placeholder-');
  const pptxPath = join(tempRoot, 'placeholder.pptx');
  try {
    mkdirSync(dirname(pptxPath), { recursive: true });
    const pptx = createPptxGenJsInstance();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    slide.addText('Slide Number', { x: 1, y: 1, w: 4, h: 0.6, fontSize: 20 });
    await pptx.writeFile({ fileName: pptxPath });

    const report = checkPptxQuality({ pptxPath });
    assert.equal(report.passed, false);
    assert.match(report.failures.join('\n'), /placeholder\/debug text/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('checkPptxQuality rejects English template chrome in Chinese decks', async () => {
  const tempRoot = createTempDir('skill-runtime-quality-english-chrome-');
  const pptxPath = join(tempRoot, 'english-chrome.pptx');
  try {
    mkdirSync(dirname(pptxPath), { recursive: true });
    const pptx = createPptxGenJsInstance();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    slide.addText('AGENDA OR SUMMARY', { x: 0.6, y: 0.6, w: 3.5, h: 0.4, fontSize: 18 });
    slide.addText('Executive Takeaway', { x: 0.6, y: 1.1, w: 3.5, h: 0.4, fontSize: 18 });
    slide.addText('研究摘要', { x: 0.6, y: 1.8, w: 4, h: 0.6, fontSize: 24 });
    await pptx.writeFile({ fileName: pptxPath });

    const report = checkPptxQuality({
      pptxPath,
      deckSpec: {
        meta: {
          title: '测试 deck',
          subtitle: '中文模板检查',
          audience: '管理层',
          purpose: '验证模板残留',
          language: 'zh-CN',
        },
        theme: {
          pageRatio: '16:9',
          palette: {
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
          },
          typography: {
            display: 'Microsoft YaHei',
            heading: 'Microsoft YaHei',
            body: 'Microsoft YaHei',
            monospace: 'Consolas',
          },
          spacing: {
            safeMarginX: 0.72,
            safeMarginY: 0.5,
            sectionGap: 0.24,
            cardGap: 0.18,
          },
        },
        slides: [
          {
            type: 'agenda_or_summary',
            goal: '摘要',
            headline: '研究摘要',
            supportingPoints: ['业务结构'],
            evidence: ['增长驱动'],
            visualKind: 'summary_cards',
            sourceNote: '资料来源：用户提供材料整理',
          },
        ],
      },
    });

    assert.equal(report.passed, false);
    assert.match(report.failures.join('\n'), /English template chrome/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('checkPptxQuality accepts rendered business deck', async () => {
  const tempRoot = createTempDir('skill-runtime-quality-good-');
  const pptxPath = join(tempRoot, 'final-deck.pptx');
  try {
    await renderDeckToPptx({
      outputPath: pptxPath,
      deckSpec: {
        meta: {
          title: '绍兴贝斯美化工股份有限公司',
          subtitle: '企业研究演示版',
          audience: '管理层',
          purpose: '理解业务、成长性与风险',
          language: 'zh-CN',
        },
        theme: {
          pageRatio: '16:9',
          palette: {
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
          },
          typography: {
            display: 'Microsoft YaHei',
            heading: 'Microsoft YaHei',
            body: 'Microsoft YaHei',
            monospace: 'Consolas',
          },
          spacing: {
            safeMarginX: 0.72,
            safeMarginY: 0.5,
            sectionGap: 0.24,
            cardGap: 0.18,
          },
        },
        slides: [
          {
            type: 'cover',
            goal: 'Set context',
            headline: '绍兴贝斯美化工股份有限公司',
            supportingPoints: ['企业研究演示版', '管理层 | 理解业务、成长性与风险'],
            evidence: [],
            visualKind: 'hero_panel',
            sourceNote: '资料来源：用户提供材料整理',
          },
          {
            type: 'agenda_or_summary',
            goal: '摘要',
            headline: '本次汇报重点',
            supportingPoints: ['业务结构', '成长驱动', '风险识别'],
            evidence: ['聚焦出口与新项目节奏'],
            visualKind: 'summary_cards',
            sourceNote: '资料来源：提供材料的结构化提炼',
          },
          {
            type: 'closing',
            goal: '结论',
            headline: '结论与下一步',
            supportingPoints: ['业务基础扎实', '成长取决于新项目释放', '需要持续跟踪景气度'],
            evidence: ['资料来源：整份演示文稿归纳'],
            visualKind: 'closing_takeaways',
            sourceNote: '资料来源：整份演示文稿归纳',
          },
          {
            type: 'company_overview',
            goal: '公司概况',
            headline: '公司概况',
            supportingPoints: ['精细化工主业明确', '海外业务比重较高'],
            evidence: ['产品链条较完整'],
            visualKind: 'overview_panels',
            sourceNote: '资料来源：用户提供材料整理',
          },
        ],
      },
    });

    const report = checkPptxQuality({
      pptxPath,
      deckSpec: {
        meta: {
          title: '绍兴贝斯美化工股份有限公司',
          subtitle: '企业研究演示版',
          audience: '管理层',
          purpose: '理解业务、成长性与风险',
          language: 'zh-CN',
        },
        theme: {
          pageRatio: '16:9',
          palette: {
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
          },
          typography: {
            display: 'Microsoft YaHei',
            heading: 'Microsoft YaHei',
            body: 'Microsoft YaHei',
            monospace: 'Consolas',
          },
          spacing: {
            safeMarginX: 0.72,
            safeMarginY: 0.5,
            sectionGap: 0.24,
            cardGap: 0.18,
          },
        },
        slides: [
          {
            type: 'cover',
            goal: 'Set context',
            headline: '绍兴贝斯美化工股份有限公司',
            supportingPoints: ['企业研究演示版', '管理层 | 理解业务、成长性与风险'],
            evidence: [],
            visualKind: 'hero_panel',
            sourceNote: '资料来源：用户提供材料整理',
          },
          {
            type: 'agenda_or_summary',
            goal: '摘要',
            headline: '本次汇报重点',
            supportingPoints: ['业务结构', '成长驱动', '风险识别'],
            evidence: ['聚焦出口与新项目节奏'],
            visualKind: 'summary_cards',
            sourceNote: '资料来源：提供材料的结构化提炼',
          },
          {
            type: 'closing',
            goal: '结论',
            headline: '结论与下一步',
            supportingPoints: ['业务基础扎实', '成长取决于新项目释放', '需要持续跟踪景气度'],
            evidence: ['资料来源：整份演示文稿归纳'],
            visualKind: 'closing_takeaways',
            sourceNote: '资料来源：整份演示文稿归纳',
          },
          {
            type: 'company_overview',
            goal: '公司概况',
            headline: '公司概况',
            supportingPoints: ['精细化工主业明确', '海外业务比重较高'],
            evidence: ['产品链条较完整'],
            visualKind: 'overview_panels',
            sourceNote: '资料来源：用户提供材料整理',
          },
        ],
      },
    });

    assert.equal(report.passed, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
