import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_LAYOUT_METRICS,
  getSlideDensityThreshold,
  inferPptxMode,
  parseDeckSpec,
  planDeck,
} from '../src/pptx-deck.js';

test('inferPptxMode distinguishes fresh deck and template following attachments', () => {
  assert.equal(inferPptxMode(['/tmp/source.md']), 'fresh_deck');
  assert.equal(inferPptxMode(['/tmp/source.md', '/tmp/template.pptx']), 'template_following');
  assert.equal(inferPptxMode(['/tmp/template.potx']), 'template_following');
});

test('planDeck inserts cover summary and closing while preserving 16:9 defaults', () => {
  const planned = planDeck({
    meta: {
      title: '绍兴贝斯美化工股份有限公司',
      subtitle: '企业研究演示版',
      audience: '投研与管理层',
      purpose: '快速理解业务、成长性与风险',
      language: 'zh-CN',
    },
    slides: [
      {
        type: 'company_overview',
        headline: '公司概况',
        supportingPoints: ['聚焦农药中间体与特色精细化学品', '出口导向，海外收入占比高'],
        evidence: ['产品覆盖吡啶、二甲戊灵等业务链条'],
      },
      {
        type: 'timeline',
        headline: '成长节点',
        supportingPoints: ['2011 上市', '2020 海外市场扩张', '2024 新项目推进'],
      },
      {
        type: 'risk_summary',
        headline: '核心风险',
        supportingPoints: ['原材料价格波动', '海外需求下行'],
        evidence: ['需要持续观察下游农化景气度'],
      },
    ],
  });

  assert.equal(planned.deckSpec.theme.pageRatio, '16:9');
  assert.equal(planned.deckSpec.theme.spacing.safeMarginX, BUSINESS_LAYOUT_METRICS.safeMarginX);
  assert.equal(planned.deckSpec.theme.spacing.safeMarginY, BUSINESS_LAYOUT_METRICS.safeMarginY);
  assert.equal(planned.deckSpec.slides[0]?.type, 'cover');
  assert.equal(planned.deckSpec.slides[1]?.type, 'agenda_or_summary');
  assert.equal(planned.deckSpec.slides.at(-1)?.type, 'closing');
  assert.ok(planned.notes.length >= 2);
});

test('parseDeckSpec enforces safe area floor and 16:9 page ratio', () => {
  assert.throws(
    () =>
      parseDeckSpec({
        meta: {
          title: 'Bad deck',
          subtitle: 'bad',
          audience: 'team',
          purpose: 'test',
          language: 'en-US',
        },
        theme: {
          pageRatio: '4:3',
          spacing: {
            safeMarginX: 0.1,
            safeMarginY: 0.1,
          },
        },
        slides: [
          {
            type: 'cover',
            headline: 'Bad deck',
            goal: 'bad',
          },
          {
            type: 'closing',
            headline: 'End',
            goal: 'end',
          },
          {
            type: 'company_overview',
            headline: 'Middle',
            goal: 'middle',
          },
          {
            type: 'risk_summary',
            headline: 'Risk',
            goal: 'risk',
          },
        ],
      }),
    /safeMarginX|16:9/,
  );
});

test('density thresholds stay above commercial readability floor', () => {
  const cover = getSlideDensityThreshold('cover');
  const table = getSlideDensityThreshold('evidence_table');

  assert.ok(cover.maxCharacters < table.maxCharacters);
  assert.equal(BUSINESS_LAYOUT_METRICS.minBodyFontPt, 18);
  assert.equal(BUSINESS_LAYOUT_METRICS.minLabelFontPt, 14);
  assert.equal(BUSINESS_LAYOUT_METRICS.footerFontPt, 11);
});

test('parseDeckSpec maps model-style alias fields into canonical slide content', () => {
  const deck = parseDeckSpec({
    meta: {
      title: 'Alias deck',
      subtitle: 'normalize',
      audience: 'team',
      purpose: 'test',
      language: 'zh-CN',
    },
    slides: [
      {
        type: 'cover',
        headline: 'Alias deck',
        goal: '封面',
      },
      {
        type: 'two_column_claim',
        headline: '经营表现',
        left: ['营收15.23亿元', '归母净利润2407万元'],
        right: ['国际收入占比75.89%', '贸易业务成为第一大收入源'],
      },
      {
        type: 'risk_grid',
        headline: '风险与观察点',
        cards: [
          { header: '治理合规', body: '实控人信披违规被罚，需持续观察内控改善' },
          { header: '产能兑现', body: '特种醇项目能否按期达产仍需跟踪' },
        ],
      },
      {
        type: 'closing',
        headline: '结论',
        supportingPoints: ['核心基本盘稳固', '未来看新材料兑现'],
      },
    ],
  });

  const claimSlide = deck.slides[1]!;
  assert.equal(claimSlide.type, 'two_column_claim');
  assert.deepEqual(claimSlide.supportingPoints, ['营收15.23亿元', '归母净利润2407万元']);
  assert.deepEqual(claimSlide.evidence, ['国际收入占比75.89%', '贸易业务成为第一大收入源']);

  const riskSlide = deck.slides[2]!;
  assert.equal(riskSlide.type, 'risk_summary');
  assert.ok(riskSlide.supportingPoints.some((item) => item.includes('治理合规')));
  assert.ok(riskSlide.supportingPoints.some((item) => item.includes('产能兑现')));
});

test('parseDeckSpec rejects empty business body slides instead of rendering blank pages', () => {
  assert.throws(
    () =>
      parseDeckSpec({
        meta: {
          title: 'Empty deck',
          subtitle: 'test',
          audience: 'team',
          purpose: 'test',
          language: 'zh-CN',
        },
        slides: [
          {
            type: 'cover',
            headline: 'Empty deck',
            goal: 'cover',
          },
          {
            type: 'two_column_claim',
            headline: '经营表现',
          },
          {
            type: 'risk_summary',
            headline: '风险',
            supportingPoints: ['海外波动', '产能兑现'],
          },
          {
            type: 'closing',
            headline: '结论',
            supportingPoints: ['要点一', '要点二'],
          },
        ],
      }),
    /two_column_claim/,
  );
});

test('parseDeckSpec keeps Chinese decks on the built-in typography system', () => {
  const deck = parseDeckSpec({
    meta: {
      title: '中文 deck',
      subtitle: '字体测试',
      audience: '管理层',
      purpose: '测试',
      language: 'zh-CN',
    },
    theme: {
      typography: {
        display: 'Georgia',
        heading: 'Georgia',
        body: 'Calibri',
      },
    },
    slides: [
      {
        type: 'cover',
        headline: '中文 deck',
        goal: 'cover',
      },
      {
        type: 'agenda_or_summary',
        headline: '摘要',
        supportingPoints: ['核心判断一', '核心判断二'],
      },
      {
        type: 'risk_summary',
        headline: '风险',
        supportingPoints: ['海外市场波动', '项目投产节奏'],
      },
      {
        type: 'closing',
        headline: '结论',
        supportingPoints: ['保持主业优势', '观察新材料兑现'],
      },
    ],
  });

  assert.equal(deck.theme.typography.display, 'PingFang SC');
  assert.equal(deck.theme.typography.heading, 'PingFang SC');
  assert.equal(deck.theme.typography.body, 'PingFang SC');
});
