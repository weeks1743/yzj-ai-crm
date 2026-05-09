import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantMetaQuestionCard } from './agent-api-provider';
import {
  filterUpdateFieldQuestions,
  getMetaQuestionAnswerDisplay,
  getMetaQuestionCurrentDisplay,
  pickChangedMetaQuestionAnswers,
  shouldRenderMetaQuestionCard,
} from './meta-question-card-utils';

function createUpdateCard(): AssistantMetaQuestionCard {
  return {
    title: '选择要修改的信息',
    layout: 'update_field_picker',
    toolCode: 'record.customer.preview_update',
    submitLabel: '生成更新预览',
    currentValues: {
      customer_status: { label: '客户状态', value: '潜在客户' },
      industry: { label: '行业', value: '制造业' },
      owner_open_id: { label: '负责人', value: '陈伟堂' },
      field_7: { label: '字段七', value: '旧值' },
    },
    questions: [
      {
        questionId: 'q-status',
        paramKey: 'customer_status',
        label: '客户状态',
        type: 'single_select',
        required: false,
        currentValue: 'potential',
        options: [
          { label: '潜在客户', value: 'potential', key: 'potential' },
          { label: '成交', value: 'won', key: 'won' },
        ],
      },
      { questionId: 'q-industry', paramKey: 'industry', label: '行业', type: 'text', required: false, currentValue: '制造业' },
      { questionId: 'q-owner', paramKey: 'owner_open_id', label: '负责人', type: 'reference', required: false, currentValue: '陈伟堂' },
      { questionId: 'q-4', paramKey: 'field_4', label: '字段四', type: 'text', required: false },
      { questionId: 'q-5', paramKey: 'field_5', label: '字段五', type: 'text', required: true },
      { questionId: 'q-6', paramKey: 'field_6', label: '字段六', type: 'text', required: false },
      { questionId: 'q-7', paramKey: 'field_7', label: '字段七', type: 'text', required: false, currentValue: '旧值' },
      { questionId: 'q-remark', paramKey: 'Ta_1', label: '备注', type: 'text', required: false },
    ],
  };
}

test('update field picker search finds fields beyond the default visible set', () => {
  const card = createUpdateCard();
  const defaultResult = filterUpdateFieldQuestions({
    questions: card.questions,
    currentValues: card.currentValues,
  });
  const searchResult = filterUpdateFieldQuestions({
    questions: card.questions,
    currentValues: card.currentValues,
    searchText: '字段七',
  });

  assert.deepEqual(defaultResult.visibleQuestions.map((item) => item.paramKey), [
    'field_5',
    'customer_status',
    'industry',
    'owner_open_id',
    'field_7',
    'Ta_1',
  ]);
  assert.equal(defaultResult.hiddenCount, 2);
  assert.deepEqual(searchResult.visibleQuestions.map((item) => item.paramKey), ['field_7']);
});

test('update field picker loads more fields incrementally', () => {
  const card = createUpdateCard();
  const nextResult = filterUpdateFieldQuestions({
    questions: card.questions,
    currentValues: card.currentValues,
    visibleCount: 7,
  });

  assert.deepEqual(nextResult.visibleQuestions.map((item) => item.paramKey), [
    'field_5',
    'customer_status',
    'industry',
    'owner_open_id',
    'field_7',
    'Ta_1',
    'field_4',
  ]);
  assert.equal(nextResult.hiddenCount, 1);
});

test('update field picker search matches metadata labels such as remark', () => {
  const card = createUpdateCard();
  const searchResult = filterUpdateFieldQuestions({
    questions: card.questions,
    currentValues: card.currentValues,
    searchText: '备注',
  });

  assert.deepEqual(searchResult.visibleQuestions.map((item) => item.paramKey), ['Ta_1']);
});

test('update field picker submits only selected non-empty changed answers', () => {
  const card = createUpdateCard();
  const changed = pickChangedMetaQuestionAnswers({
    questionCard: card,
    selectedParamKeys: ['customer_status', 'industry', 'owner_open_id', 'field_7'],
    answers: {
      customer_status: 'won',
      industry: '制造业',
      owner_open_id: '',
      field_7: '新值',
      field_4: '未选择字段不提交',
    },
  });

  assert.deepEqual(changed, {
    customer_status: 'won',
    field_7: '新值',
  });
});

test('update field picker displays enum labels and readable current values', () => {
  const card = createUpdateCard();
  const status = card.questions[0]!;
  const owner = card.questions[2]!;

  assert.equal(getMetaQuestionAnswerDisplay({ question: status, value: 'won' }), '成交');
  assert.equal(getMetaQuestionCurrentDisplay(card, owner), '陈伟堂');
});

test('cancelled question card is not renderable', () => {
  const card = createUpdateCard();

  assert.equal(shouldRenderMetaQuestionCard({ status: 'pending', questionCard: card }), true);
  assert.equal(shouldRenderMetaQuestionCard({ status: 'cancelled', questionCard: card }), false);
});
