import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { AgentRunRepository } from '../src/agent-run-repository.js';
import { MainAgentRuntime } from '../src/agent-runtime.js';
import { AgentService } from '../src/agent-service.js';
import { inferFallbackIntent } from '../src/agent-utils.js';
import { createCrmAgentRuntimeParts } from '../src/crm-agent-pack.js';
import { ExternalSkillService } from '../src/external-skill-service.js';
import { IntentFrameService } from '../src/intent-frame-service.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';
import type { AppConfig, IntentFrame } from '../src/contracts.js';
import { DeepSeekChatCompletionClient } from '../../skill-runtime/src/deepseek-client.js';
import { probeDependencies } from '../../skill-runtime/src/dependency-probe.js';
import { VolcWebSearchClient } from '../../skill-runtime/src/volc-web-search-client.js';
import {
  createRuntimeHarness,
  createTempDir,
  createTestConfig as createSkillRuntimeTestConfig,
  REPO_ROOT,
} from '../../skill-runtime/tests/test-helpers.js';

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

function createAgentTestService(input: {
  config?: AppConfig;
  repository: AgentRunRepository;
  intentFrameService: Pick<IntentFrameService, 'createIntentFrame'>;
  externalSkillService?: unknown;
  artifactService?: unknown;
  shadowMetadataService?: unknown;
  companyResearchMaxWaitMs?: number;
}) {
  const config = input.config ?? createTestConfig();
  const runtimeParts = createCrmAgentRuntimeParts({
    config,
    repository: input.repository,
    intentFrameService: input.intentFrameService as IntentFrameService,
    shadowMetadataService: (input.shadowMetadataService ?? {
      executeSearch: async () => ({ records: [] }),
      executeGet: async () => ({ record: null }),
      previewUpsert: async () => ({
        readyToSend: false,
        missingRequiredParams: [],
        missingRuntimeInputs: ['operatorOpenId'],
        validationErrors: [],
      }),
      executeUpsert: async () => ({ formInstIds: [] }),
    }) as any,
    externalSkillService: (input.externalSkillService ?? {
      createSkillJob: async () => {
        throw new Error('external skill service not stubbed');
      },
      getSkillJob: async () => {
        throw new Error('external skill service not stubbed');
      },
      getSkillJobArtifact: async () => {
        throw new Error('external skill service not stubbed');
      },
    }) as any,
    artifactService: (input.artifactService ?? {
      findLatestCompanyResearchArtifact: async () => null,
      createCompanyResearchArtifact: async () => {
        throw new Error('artifact service not stubbed');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    }) as any,
    companyResearchMaxWaitMs: input.companyResearchMaxWaitMs,
  });

  return new AgentService({
    config,
    repository: input.repository,
    runtime: new MainAgentRuntime({
      config,
      registry: runtimeParts.registry,
      intentResolver: runtimeParts.intentResolver,
      planner: runtimeParts.planner,
    }),
  });
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

test('IntentFrame fallback supports company research slash command', async () => {
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
    query: '/公司研究 上海松井机械有限公司',
  });

  assert.equal(intent.source, 'fallback');
  assert.equal(intent.actionType, 'analyze');
  assert.equal(intent.targetType, 'company');
  assert.equal(intent.targets[0]?.name, '上海松井机械有限公司');
});

test('AgentService waits for company full name and does not call lookup or skill for placeholders', async () => {
  const placeholders = [
    '/公司研究',
    '/公司研究 输入公司全称',
    '/公司研究 公司全称',
    '/公司研究 XX公司',
  ];

  for (const query of placeholders) {
    const config = createTestConfig();
    const database = createInMemoryDatabase();
    const repository = new AgentRunRepository(database);
    let lookupCalled = false;
    let skillCalled = false;
    let artifactCreated = false;
    const service = createAgentTestService({
      config,
      repository,
      intentFrameService: {
        createIntentFrame: async (request: Parameters<IntentFrameService['createIntentFrame']>[0]) => (
          inferFallbackIntent(request, null, 'test')
        ),
      } as any,
      externalSkillService: {
        createSkillJob: async () => {
          skillCalled = true;
          throw new Error('should not call external company research without valid company name');
        },
        getSkillJob: async () => {
          throw new Error('should not poll company research without valid company name');
        },
        getSkillJobArtifact: async () => {
          throw new Error('should not download company research without valid company name');
        },
      } as any,
      artifactService: {
        findLatestCompanyResearchArtifact: async () => {
          lookupCalled = true;
          return null;
        },
        createCompanyResearchArtifact: async () => {
          artifactCreated = true;
          throw new Error('should not create company research artifact without valid company name');
        },
        search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
      } as any,
    });

    const response = await service.chat({
      conversationKey: `conv-placeholder-${query}`,
      sceneKey: 'chat',
      query,
    });

    assert.equal(response.success, true);
    assert.equal(response.executionState.status, 'waiting_input');
    assert.match(response.message.content, /需要公司全称|请输入公司全称/);
    assert.equal(response.message.extraInfo.evidence?.length ?? 0, 0);
    assert.equal(response.message.attachments?.length ?? 0, 0);
    assert.equal(response.toolCalls.length, 0);
    assert.equal(lookupCalled, false);
    assert.equal(skillCalled, false);
    assert.equal(artifactCreated, false);
  }
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

test('fallback intent treats focused-context questions as artifact queries without domain keyword rules', () => {
  const intent = inferFallbackIntent(
    {
      query: '江苏友升 核心竞争优势是什么',
    },
    '江苏友升',
  );

  assert.equal(intent.actionType, 'query');
  assert.equal(intent.targetType, 'artifact');
  assert.equal(intent.targets[0]?.name, '江苏友升');
});

test('AgentService runs company research, persists run, and returns evidence card', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  const service = createAgentTestService({
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
        content: Buffer.from([
          '# 东港投资发展集团有限公司 公司研究',
          '',
          '## 公司概览',
          '东港投资发展集团有限公司是本次研究目标公司，公开资料显示其值得关注资金与产业投资动向。',
          '',
          '## 业务定位',
          '围绕区域产业投资、项目运营和园区资源整合展开。',
          '',
          '## 核心风险',
          '需要继续核实资金安排、项目周期和公开披露信息。',
          '',
          '## 来源引用',
          '- 公开资料显示其业务与区域产业投资、项目运营相关。',
        ].join('\n')),
      }),
    } as any,
    artifactService: {
      findLatestCompanyResearchArtifact: async () => null,
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
  assert.equal(response.taskPlan.kind, 'tool_execution');
  assert.equal(response.message.extraInfo.agentTrace.selectedTool?.toolCode, 'external.company_research');
  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.evidence?.[0]?.artifactId, 'artifact-001');
  assert.match(response.message.content, /公司研究已完成/);
  assert.match(response.message.content, /研究摘要/);
  assert.doesNotMatch(response.message.content, /Artifact|ext\.company_research_pm|vectorStatus|indexed|preview/);
  assert.equal(response.message.attachments?.length ?? 0, 0);

  const runs = await database.query(`SELECT * FROM ${database.table('agent_runs')}`);
  const toolCalls = await database.query(`SELECT * FROM ${database.table('agent_tool_calls')}`);
  assert.equal(runs.length, 1);
  assert.equal(toolCalls.length, 3);
});

test('AgentService reuses existing company research artifact without rerunning skill', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let skillCreated = false;
  let artifactCreated = false;
  const service = createAgentTestService({
    config,
    repository,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('上海松井机械有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => {
        skillCreated = true;
        throw new Error('should not rerun company research when artifact exists');
      },
      getSkillJob: async () => {
        throw new Error('should not poll reused company research');
      },
      getSkillJobArtifact: async () => {
        throw new Error('should not download reused company research');
      },
    } as any,
    artifactService: {
      findLatestCompanyResearchArtifact: async () => ({
        artifact: {
          artifactId: 'artifact-reused-001',
          versionId: 'version-reused-001',
          version: 2,
          title: '上海松井机械有限公司 公司研究',
          sourceToolCode: 'ext.company_research_pm',
          vectorStatus: 'indexed',
          anchors: [{ type: 'company', id: '上海松井机械有限公司', name: '上海松井机械有限公司' }],
          chunkCount: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        markdown: '# 上海松井机械有限公司\n\n## 研究摘要\n已有有效研究。',
        summary: '- 已有有效研究。',
      }),
      createCompanyResearchArtifact: async () => {
        artifactCreated = true;
        throw new Error('should not create new artifact when reusing');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-agent-reuse-001',
    sceneKey: 'chat',
    query: '/公司研究 上海松井机械有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.executionState.status, 'completed');
  assert.equal(response.message.extraInfo.evidence?.[0]?.artifactId, 'artifact-reused-001');
  assert.match(response.message.content, /已使用已有公司研究资料/);
  assert.doesNotMatch(response.message.content, /Artifact|ext\.company_research_pm|vectorStatus|indexed|preview/);
  assert.equal(response.message.attachments?.length ?? 0, 0);
  assert.equal(skillCreated, false);
  assert.equal(artifactCreated, false);
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0]?.toolCode, 'artifact.company_research.lookup');
  assert.equal(response.toolCalls[0]?.status, 'succeeded');
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
  const service = createAgentTestService({
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
      findLatestCompanyResearchArtifact: async () => null,
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
  assert.equal(response.executionState.currentStepKey, 'execute-tool');
  assert.match(response.message.content, /公司研究仍在运行/);
  assert.doesNotMatch(response.message.content, /job-running-001|Skill Job|Artifact|ext\.company_research_pm|preview/);
  assert.equal(response.toolCalls.length, 2);
  assert.equal(response.toolCalls[0]?.status, 'skipped');
  assert.equal(response.toolCalls[1]?.status, 'running');
  assert.equal(artifactCreated, false);

  const runs = await database.query<{ status: string }>(`SELECT * FROM ${database.table('agent_runs')}`);
  const toolCalls = await database.query<{ status: string; finished_at: string | null }>(
    `SELECT * FROM ${database.table('agent_tool_calls')}`,
  );
  assert.equal(runs[0]?.status, 'running');
  assert.equal(toolCalls.some((item) => item.status === 'skipped'), true);
  assert.equal(toolCalls.some((item) => item.status === 'running' && item.finished_at === null), true);
});

test('AgentService surfaces company research dependency failure without degraded artifact', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let artifactCreated = false;
  const service = createAgentTestService({
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
      findLatestCompanyResearchArtifact: async () => null,
      createCompanyResearchArtifact: async () => {
        artifactCreated = true;
        throw new Error('should not persist degraded company research artifact');
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
  assert.equal(response.executionState.status, 'tool_unavailable');
  assert.match(response.message.content, /公司研究服务执行失败/);
  assert.match(response.message.content, /未生成降级资料/);
  assert.match(response.message.content, /服务依赖未满足/);
  assert.doesNotMatch(response.message.content, /Artifact|ext\.company_research_pm|vectorStatus|indexed|preview|company-research/);
  assert.equal(response.message.extraInfo.evidence?.length, 0);
  assert.equal(artifactCreated, false);
  assert.equal(response.toolCalls[0]?.status, 'skipped');
  assert.equal(response.toolCalls[1]?.status, 'failed');
  assert.equal(response.message.extraInfo.agentTrace.policyDecisions?.some((item) => (
    item.policyCode === 'external.company_research.no_degraded_artifact'
  )), true);

  const toolCalls = await database.query(
    `SELECT * FROM ${database.table('agent_tool_calls')} ORDER BY started_at`,
  );
  assert.equal(toolCalls.length, 2);
});

test('AgentService does not persist unusable company research markdown returned by skill', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let artifactCreated = false;
  const service = createAgentTestService({
    config,
    repository,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('上海你你你你你你你有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => ({
        jobId: 'job-invalid-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: '# 未生成公司研究资料\n\n未检索到「上海你你你你你你你有限公司」的有效公开公司信息，无法确认公司主体。',
        events: [],
        artifacts: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJob: async () => ({
        jobId: 'job-invalid-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: '# 未生成公司研究资料\n\n未检索到「上海你你你你你你你有限公司」的有效公开公司信息，无法确认公司主体。',
        events: [],
        artifacts: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    } as any,
    artifactService: {
      findLatestCompanyResearchArtifact: async () => null,
      createCompanyResearchArtifact: async () => {
        artifactCreated = true;
        throw new Error('should not persist unusable company research markdown');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-invalid-company-research',
    sceneKey: 'chat',
    query: '/公司研究 上海你你你你你你你有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.executionState.status, 'tool_unavailable');
  assert.match(response.message.content, /未生成公司研究资料/);
  assert.equal(response.message.extraInfo.evidence?.length ?? 0, 0);
  assert.equal(response.message.attachments?.length ?? 0, 0);
  assert.equal(artifactCreated, false);
  assert.equal(response.toolCalls.length, 2);
  assert.equal(response.toolCalls[0]?.toolCode, 'artifact.company_research.lookup');
  assert.equal(response.toolCalls[1]?.toolCode, 'ext.company_research_pm');
  assert.equal(response.message.extraInfo.agentTrace.policyDecisions?.some((item) => (
    item.policyCode === 'external.company_research.invalid_result_no_artifact'
  )), true);
});

test('AgentService does not persist company research markdown for another company subject', async () => {
  const config = createTestConfig();
  const database = createInMemoryDatabase();
  const repository = new AgentRunRepository(database);
  let artifactCreated = false;
  const service = createAgentTestService({
    config,
    repository,
    intentFrameService: {
      createIntentFrame: async () => companyIntent('上海松井机械有限公司'),
    } as any,
    externalSkillService: {
      createSkillJob: async () => ({
        jobId: 'job-wrong-company-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: '# 北京松井机械有限公司 公司研究\n\n## 公司概览\n北京松井机械有限公司主营机械产品。\n\n## 核心风险\n需要关注行业周期和公开资料完整性。',
        events: [],
        artifacts: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJob: async () => ({
        jobId: 'job-wrong-company-001',
        skillCode: 'ext.company_research_pm',
        runtimeSkillName: 'company-research',
        model: 'deepseek-v4-flash',
        status: 'succeeded',
        finalText: '# 北京松井机械有限公司 公司研究\n\n## 公司概览\n北京松井机械有限公司主营机械产品。\n\n## 核心风险\n需要关注行业周期和公开资料完整性。',
        events: [],
        artifacts: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getSkillJobArtifact: async () => {
        throw new Error('not used');
      },
    } as any,
    artifactService: {
      findLatestCompanyResearchArtifact: async () => null,
      createCompanyResearchArtifact: async () => {
        artifactCreated = true;
        throw new Error('should not persist company research for another subject');
      },
      search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
    } as any,
  });

  const response = await service.chat({
    conversationKey: 'conv-wrong-company-research',
    sceneKey: 'chat',
    query: '/公司研究 上海松井机械有限公司',
  });

  assert.equal(response.success, true);
  assert.equal(response.executionState.status, 'tool_unavailable');
  assert.match(response.message.content, /没有明确指向目标公司主体|未生成公司研究资料/);
  assert.equal(response.message.extraInfo.evidence?.length ?? 0, 0);
  assert.equal(response.message.attachments?.length ?? 0, 0);
  assert.equal(artifactCreated, false);
});

function createLiveSkillRuntimeConfig(tempRoot: string) {
  assert.ok(
    process.env.DEEPSEEK_API_KEY,
    'DEEPSEEK_API_KEY is required for the ordinary real company research invalid-result test',
  );
  assert.ok(
    process.env.ARK_API_KEY,
    'ARK_API_KEY is required for the ordinary real company research invalid-result test',
  );

  const config = createSkillRuntimeTestConfig({
    rootDir: tempRoot,
    skillDirs: [resolve(REPO_ROOT, '3rdSkill')],
    allowedRoots: [tempRoot, REPO_ROOT],
    artifactDir: join(tempRoot, 'artifacts'),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    arkApiKey: process.env.ARK_API_KEY,
    arkWebSearchModel: process.env.ARK_WEB_SEARCH_MODEL || 'doubao-seed-2-0-lite-260215',
  });
  config.deepseek.baseUrl = 'https://api.deepseek.com';
  config.ark.baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
  return config;
}

const hasLiveCompanyResearchKeys = Boolean(process.env.DEEPSEEK_API_KEY && process.env.ARK_API_KEY);

test('AgentService rejects real company research result for nonexistent company without artifact', {
  timeout: 240_000,
  skip: hasLiveCompanyResearchKeys
    ? false
    : 'requires DEEPSEEK_API_KEY and ARK_API_KEY for live company research',
}, async () => {
  const tempRoot = createTempDir('admin-api-real-invalid-company-research-');
  let harness: Awaited<ReturnType<typeof createRuntimeHarness>> | null = null;
  try {
    const runtimeConfig = createLiveSkillRuntimeConfig(tempRoot);
    harness = await createRuntimeHarness({
      config: runtimeConfig,
      dependencySnapshot: probeDependencies(runtimeConfig),
      chatClient: new DeepSeekChatCompletionClient({
        baseUrl: runtimeConfig.deepseek.baseUrl,
        apiKey: runtimeConfig.deepseek.apiKey!,
      }),
      webSearchClient: new VolcWebSearchClient({
        baseUrl: runtimeConfig.ark.baseUrl,
        apiKey: runtimeConfig.ark.apiKey!,
        model: runtimeConfig.ark.webSearchModel,
      }),
    });

    const config = createTestConfig({
      skillRuntimeBaseUrl: harness.baseUrl,
      deepseekDefaultModel: 'deepseek-v4-flash',
    });
    const database = createInMemoryDatabase();
    const repository = new AgentRunRepository(database);
    let artifactCreated = false;
    const service = createAgentTestService({
      config,
      repository,
      intentFrameService: {
        createIntentFrame: async () => companyIntent('上海你你你你你你你有限公司'),
      } as any,
      externalSkillService: new ExternalSkillService({ config }),
      artifactService: {
        findLatestCompanyResearchArtifact: async () => null,
        createCompanyResearchArtifact: async () => {
          artifactCreated = true;
          throw new Error('should not persist invalid real company research result');
        },
        search: async () => ({ evidence: [], qdrantFilter: {}, vectorStatus: 'searched', query: '' }),
      } as any,
      companyResearchMaxWaitMs: 220_000,
    });

    const response = await service.chat({
      conversationKey: 'conv-real-invalid-company-research',
      sceneKey: 'chat',
      query: '/公司研究 上海你你你你你你你有限公司',
    });

    assert.equal(response.success, true);
    assert.equal(response.executionState.status, 'tool_unavailable');
    assert.match(response.message.content, /未生成公司研究资料|未检索到|未找到|无法确认/);
    assert.equal(response.message.extraInfo.evidence?.length ?? 0, 0);
    assert.equal(response.message.attachments?.length ?? 0, 0);
    assert.equal(artifactCreated, false);
    assert.equal(response.toolCalls.some((item) => item.toolCode === 'artifact.company_research'), false);
  } finally {
    await harness?.close().catch(() => undefined);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
