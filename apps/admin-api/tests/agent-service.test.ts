import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { AgentService } from '../src/agent-service.js';
import { inferFallbackIntent } from '../src/agent-utils.js';
import { IntentFrameService } from '../src/intent-frame-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type { IntentFrame } from '../src/contracts.js';

function companyIntent(companyName: string, source: IntentFrame['source'] = 'llm'): IntentFrame {
  return {
    actionType: 'analyze',
    goal: '研究目标公司并沉淀 Artifact',
    targetType: 'company',
    targets: [{ type: 'company', id: companyName, name: companyName }],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.9,
    source,
  };
}

test('IntentFrameService parses DeepSeek JSON into normalized IntentFrame', async () => {
  const config = createTestConfig({ deepseekApiKey: 'test-key' });
  const service = new IntentFrameService({
    config,
    chatClient: {
      isConfigured: () => true,
      completeJson: async () => JSON.stringify(companyIntent('东港投资发展集团有限公司')),
    } as any,
  });

  const intent = await service.createIntentFrame({
    conversationKey: 'conv-001',
    sceneKey: 'chat',
    query: '研究这家公司 东港投资发展集团有限公司',
  });

  assert.equal(intent.source, 'llm');
  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targets[0]?.name, '东港投资发展集团有限公司');
});

test('IntentFrame fallback covers company research when LLM returns invalid JSON', async () => {
  const config = createTestConfig({ deepseekApiKey: 'test-key' });
  const service = new IntentFrameService({
    config,
    chatClient: {
      isConfigured: () => true,
      completeJson: async () => 'not-json',
    } as any,
  });

  const intent = await service.createIntentFrame({
    conversationKey: 'conv-001',
    sceneKey: 'chat',
    query: '研究东港投资发展集团有限公司',
  });

  assert.equal(intent.source, 'fallback');
  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targets[0]?.name, '东港投资发展集团有限公司');
});

test('IntentFrame normalization repairs LLM company research misclassification', async () => {
  const config = createTestConfig({ deepseekApiKey: 'test-key' });
  const service = new IntentFrameService({
    config,
    chatClient: {
      isConfigured: () => true,
      completeJson: async () => JSON.stringify({
        actionType: 'query',
        goal: '研究上海松井机械有限公司',
        targetType: 'company',
        targets: [],
        inputMaterials: ['上海松井机械有限公司'],
        constraints: [],
        missingSlots: [],
        confidence: 0.95,
      }),
    } as any,
  });

  const intent = await service.createIntentFrame({
    conversationKey: 'conv-001',
    sceneKey: 'chat',
    query: '研究这家公司：上海松井机械有限公司',
  });

  assert.equal(intent.source, 'llm');
  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targetType, 'company');
  assert.equal(intent.targets[0]?.name, '上海松井机械有限公司');
});

test('IntentFrame normalization repairs missing company target for analyze intent', async () => {
  const config = createTestConfig({ deepseekApiKey: 'test-key' });
  const service = new IntentFrameService({
    config,
    chatClient: {
      isConfigured: () => true,
      completeJson: async () => JSON.stringify({
        actionType: 'analyze',
        goal: '公司研究',
        targetType: 'company',
        targets: [],
        inputMaterials: [],
        constraints: [],
        missingSlots: [],
        confidence: 0.9,
      }),
    } as any,
  });

  const intent = await service.createIntentFrame({
    conversationKey: 'conv-001',
    sceneKey: 'chat',
    query: '研究这家公司 上海松井机械有限公司',
  });

  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targetType, 'company');
  assert.equal(intent.targets[0]?.name, '上海松井机械有限公司');
});

test('IntentFrame normalization strips analysis command from polluted company target', async () => {
  const config = createTestConfig({ deepseekApiKey: 'test-key' });
  const service = new IntentFrameService({
    config,
    chatClient: {
      isConfigured: () => true,
      completeJson: async () => JSON.stringify({
        actionType: 'analyze',
        goal: '分析目标公司',
        targetType: 'company',
        targets: [
          {
            type: 'company',
            id: '分析这家公司上海松井机械有限公司',
            name: '分析这家公司上海松井机械有限公司',
          },
        ],
        inputMaterials: [],
        constraints: [],
        missingSlots: [],
        confidence: 0.9,
      }),
    } as any,
  });

  const intent = await service.createIntentFrame({
    conversationKey: 'conv-001',
    sceneKey: 'chat',
    query: '分析这家公司 上海松井机械有限公司',
  });

  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targetType, 'company');
  assert.equal(intent.targets[0]?.id, '上海松井机械有限公司');
  assert.equal(intent.targets[0]?.name, '上海松井机械有限公司');
});

test('fallback intent uses focused company for artifact query', () => {
  const intent = inferFallbackIntent(
    {
      query: '这个客户最近有什么值得关注',
    },
    '东港投资发展集团有限公司',
  );

  assert.equal(intent.actionType, 'query');
  assert.equal(intent.targetType, 'artifact');
  assert.equal(intent.targets[0]?.name, '东港投资发展集团有限公司');
});

test('AgentService runs company research, persists run, and returns evidence card', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  const service = new AgentService({
    config,
    repository,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('东港投资发展集团有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => ({
        jobId: 'job-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: null,
        events: [],
        artifacts: [
          {
            artifactId: 'runtime-artifact-001',
            jobId: 'job-001',
            fileName: 'company-research.md',
            mimeType: 'text/markdown',
            byteSize: 120,
            createdAt: new Date().toISOString(),
            downloadPath: '/api/jobs/job-001/artifacts/runtime-artifact-001',
          },
        ],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJob: async () => ({
        jobId: 'job-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: null,
        events: [],
        artifacts: [
          {
            artifactId: 'runtime-artifact-001',
            jobId: 'job-001',
            fileName: 'company-research.md',
            mimeType: 'text/markdown',
            byteSize: 120,
            createdAt: new Date().toISOString(),
            downloadPath: '/api/jobs/job-001/artifacts/runtime-artifact-001',
          },
        ],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => ({
        artifact: {} as any,
        content: Buffer.from('# 东港投资发展集团有限公司\n\n## 研究摘要\n值得关注资金与产业投资动向。'),
      }),
    } as any,
    artifactService: {
      createCompanyResearchArtifact: async () => ({
        artifact: {
          artifactId: 'artifact-001',
          versionId: 'version-001',
          version: 1,
          title: '东港投资发展集团有限公司 公司研究',
          sourceToolCode: 'ext.company_research_pm',
          vectorStatus: 'indexed',
          anchors: [{ type: 'company', id: '东港投资发展集团有限公司' }],
          chunkCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-agent-001',
    sceneKey: 'chat',
    query: '研究这家公司 东港投资发展集团有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.taskPlan.kind, 'company_research');
  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.evidence?.[0]?.artifactId, 'artifact-001');

  const runs = database.prepare('SELECT * FROM agent_runs').all();
  const toolCalls = database.prepare('SELECT * FROM agent_tool_calls').all();
  assert.equal(runs.length, 1);
  assert.equal(toolCalls.length, 2);
});

test('AgentService keeps long-running company research as running instead of tool unavailable', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let artifactCreated = false;
  const runningJob = {
    jobId: 'job-running-001',
    skillCode: 'ext.company_research_pm',
    runtimeSkillName: 'company-research',
    model: 'deepseek-v4-flash',
    status: 'running',
    finalText: null,
    events: [],
    artifacts: [],
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as const;
  const service = new AgentService({
    config,
    repository,
    companyResearchMaxWaitMs: 0,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('上海松井机械有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => runningJob,
      getSkillJob: async () => runningJob,
      getSkillJobArtifact: async () => {
        throw new Error('should not download unfinished skill artifact');
      },
    } as any,
    artifactService: {
      createCompanyResearchArtifact: async () => {
        artifactCreated = true;
        throw new Error('should not persist artifact before skill completion');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-agent-running-001',
    sceneKey: 'chat',
    query: '研究这家公司 上海松井机械有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.executionState.status, 'running');
  assert.equal(response.executionState.currentStepKey, 'run-company-research');
  assert.match(response.message.content, /公司研究仍在运行/);
  assert.match(response.message.content, /job-running-001/);
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0]?.status, 'running');
  assert.equal(artifactCreated, false);

  const runs = database.prepare('SELECT * FROM agent_runs').all() as Array<{ status: string }>;
  const toolCalls = database.prepare('SELECT * FROM agent_tool_calls').all() as Array<{ status: string; finished_at: string | null }>;
  assert.equal(runs[0]?.status, 'running');
  assert.equal(toolCalls[0]?.status, 'running');
  assert.equal(toolCalls[0]?.finished_at, null);
});

test('AgentService degrades to artifact persistence when company research skill dependencies are missing', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let savedMarkdown = '';
  const service = new AgentService({
    config,
    repository,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('上海松井机械有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => {
        throw new Error('skill 依赖未满足，暂不可执行: company-research');
      },
      getSkillJob: async () => {
        throw new Error('should not poll blocked skill');
      },
      getSkillJobArtifact: async () => {
        throw new Error('should not download blocked skill artifact');
      },
    } as any,
    artifactService: {
      createCompanyResearchArtifact: async (input: any) => {
        savedMarkdown = input.markdown;
        return {
          artifact: {
            artifactId: 'artifact-fallback-001',
            versionId: 'version-fallback-001',
            version: 1,
            title: input.title,
            sourceToolCode: input.sourceToolCode,
            vectorStatus: 'pending_config',
            anchors: input.anchors,
            chunkCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-agent-fallback-001',
    sceneKey: 'chat',
    query: '研究这家公司 上海松井机械有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.executionState.status, 'completed');
  assert.match(response.message.content, /已生成降级 Artifact/);
  assert.match(response.message.content, /DEEPSEEK_API_KEY/);
  assert.match(savedMarkdown, /上海松井机械有限公司 公司研究（MVP降级）/);
  assert.equal(response.message.extraInfo.evidence?.[0]?.artifactId, 'artifact-fallback-001');
  assert.equal(response.toolCalls[0]?.status, 'failed');
  assert.equal(response.toolCalls[1]?.status, 'succeeded');

  const toolCalls = database.prepare('SELECT * FROM agent_tool_calls ORDER BY started_at').all();
  assert.equal(toolCalls.length, 2);
});
