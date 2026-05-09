import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveVisitPrepMarkdownImageTarget,
} from './visit-prep-markdown-image-utils';

test('visit prep markdown target is available from selected tool and message content', () => {
  const target = resolveVisitPrepMarkdownImageTarget({
    content: '# 贝斯美 拜访讲解准备\n\n## 客户画像',
    info: {
      key: 'message-001',
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '客户拜访准备已生成',
        references: [],
        agentTrace: {
          traceId: 'trace-agent-001',
          intentFrame: {} as any,
          taskPlan: {} as any,
          executionState: {} as any,
          toolCalls: [],
          selectedTool: {
            toolCode: 'external.yunzhijia_visit_prep',
            reason: 'visit prep',
            input: {},
            confidence: 1,
          },
        },
      },
    },
  });

  assert.equal(target?.key, 'visit-prep:trace-agent-001:content');
  assert.equal(target?.title, '客户拜访准备.md');
  assert.match(target?.markdown ?? '', /客户画像/);
  assert.equal(target?.attachment, undefined);
});

test('visit prep markdown target prefers runtime markdown attachment', () => {
  const target = resolveVisitPrepMarkdownImageTarget({
    content: '# 截断预览',
    info: {
      key: 'message-002',
      message: {
        attachments: [{
          name: 'yunzhijia-visit-prep-job-001.md',
          url: '/api/external-skills/jobs/job-001/artifacts/artifact-md',
          type: 'text/markdown',
        }],
      },
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '客户拜访准备已生成',
        references: [],
        agentTrace: {
          traceId: 'trace-agent-002',
          intentFrame: {} as any,
          taskPlan: {} as any,
          executionState: {} as any,
          toolCalls: [{
            id: 'call-001',
            runId: 'run-001',
            toolCode: 'ext.yunzhijia_visit_prep',
            status: 'succeeded',
            inputSummary: '',
            outputSummary: '',
            startedAt: '',
            finishedAt: '',
            errorMessage: null,
          }],
        },
      },
    },
  });

  assert.equal(target?.key, 'visit-prep:trace-agent-002:/api/external-skills/jobs/job-001/artifacts/artifact-md');
  assert.equal(target?.title, 'yunzhijia-visit-prep-job-001.md');
  assert.equal(target?.markdown, undefined);
  assert.equal(target?.attachment?.url, '/api/external-skills/jobs/job-001/artifacts/artifact-md');
});

test('ordinary assistant markdown does not get visit prep image target', () => {
  const target = resolveVisitPrepMarkdownImageTarget({
    content: '# 普通回答',
    info: {
      key: 'message-003',
      extraInfo: {
        feedback: 'default',
        sceneKey: 'chat',
        headline: '普通回答',
        references: [],
        agentTrace: {
          traceId: 'trace-agent-003',
          intentFrame: {} as any,
          taskPlan: {} as any,
          executionState: {} as any,
          toolCalls: [],
        },
      },
    },
  });

  assert.equal(target, null);
});
