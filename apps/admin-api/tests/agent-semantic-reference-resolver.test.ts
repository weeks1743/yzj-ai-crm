import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSemanticReference, type SemanticEmbeddingProvider } from '../src/agent-semantic-reference-resolver.js';
import type {
  AgentToolDefinition,
  ContextReferenceCandidate,
  GenericIntentFrame,
} from '../src/agent-core.js';

const recordTool = {
  code: 'record.account.preview_create',
  type: 'record',
  provider: 'test',
  description: 'test record writer',
  whenToUse: 'test',
  inputSchema: {},
  outputSchema: {},
  riskLevel: 'high',
  confirmationPolicy: 'required_before_write',
  displayCardType: 'test',
  owner: 'test',
  enabled: true,
  recordCapability: {
    subjectBinding: {
      acceptedSubjectTypes: ['external_subject'],
      identityFromSubject: true,
    },
  },
  execute: async () => {
    throw new Error('not used');
  },
} satisfies AgentToolDefinition;

const contactSearchTool = {
  code: 'record.contact.search',
  type: 'record',
  provider: 'test',
  description: 'test contact search',
  whenToUse: 'test',
  inputSchema: {},
  outputSchema: {},
  riskLevel: 'low',
  confirmationPolicy: 'read_only',
  displayCardType: 'test',
  owner: 'test',
  enabled: true,
  recordCapability: {
    objectLabels: ['联系人'],
    subjectBinding: {
      acceptedSubjectTypes: ['customer'],
      searchFilterField: 'linked_customer_form_inst_id',
      searchValueSource: 'subject_id',
    },
    identityFields: ['contact_name'],
    fieldLabels: {
      contact_name: '联系人姓名',
    },
  },
  execute: async () => {
    throw new Error('not used');
  },
} satisfies AgentToolDefinition;

const genericIntent: GenericIntentFrame = {
  actionType: 'write',
  goal: '写入结构化记录',
  target: {
    kind: 'record',
    objectType: 'account',
    name: '目标主体',
  },
  inputMaterials: [],
  constraints: [],
  missingSlots: [],
  confidence: 0.8,
  source: 'fallback',
  legacyIntentFrame: {
    actionType: 'write',
    goal: '写入结构化记录',
    targetType: 'unknown',
    targets: [],
    inputMaterials: [],
    constraints: [],
    missingSlots: [],
    confidence: 0.8,
    source: 'fallback',
  },
};

const candidates: ContextReferenceCandidate[] = [
  {
    candidateId: 'run-a',
    subject: {
      kind: 'external_subject',
      type: 'external_subject',
      id: 'alpha',
      name: '上海精文投资有限公司',
    },
    sourceRunId: 'run-a',
    evidenceRefs: [],
    text: '上海精文投资有限公司 公司研究 销售切入点',
    recencyRank: 0,
    confidence: 0.9,
    source: 'context_subject',
  },
  {
    candidateId: 'run-b',
    subject: {
      kind: 'external_subject',
      type: 'external_subject',
      id: 'beta',
      name: '潍坊舒珍堂医药有限公司',
    },
    sourceRunId: 'run-b',
    evidenceRefs: [],
    text: '潍坊舒珍堂医药有限公司 公司研究 医药行业客户',
    recencyRank: 1,
    confidence: 0.9,
    source: 'context_subject',
  },
];

class FakeEmbeddingProvider implements SemanticEmbeddingProvider {
  providerName = 'fake.semantic.embedding';

  constructor(private readonly mode: 'alpha' | 'ambiguous') {}

  isConfigured() {
    return true;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((text, index) => {
      if (this.mode === 'ambiguous' && index > 0) {
        return index === 1 ? [0.71, 0.29] : [0.70, 0.30];
      }
      if (index === 0 || text.includes('上海精文')) {
        return [1, 0];
      }
      return [0, 1];
    });
  }
}

test('semantic resolver uses embedding candidates without pronoun regex dependency', async () => {
  const result = await resolveSemanticReference({
    request: {
      conversationKey: 'conv-semantic',
      sceneKey: 'chat',
      query: '继续把刚才分析过的主体录入记录',
    },
    intentFrame: genericIntent,
    contextCandidates: candidates,
    availableTools: [recordTool],
    embeddingProvider: new FakeEmbeddingProvider('alpha'),
  });

  assert.equal(result.resolvedContext.usedContext, true);
  assert.equal(result.intentFrame.target.name, '上海精文投资有限公司');
  assert.equal(result.semanticResolution.targetWasOverridden, true);
  assert.equal(result.semanticResolution.embeddingProvider, 'fake.semantic.embedding');
});

test('semantic resolver keeps explicit target instead of overriding with nearby context', async () => {
  const result = await resolveSemanticReference({
    request: {
      conversationKey: 'conv-semantic-explicit',
      sceneKey: 'chat',
      query: '录入潍坊舒珍堂医药有限公司',
    },
    intentFrame: {
      ...genericIntent,
      target: {
        ...genericIntent.target,
        name: '潍坊舒珍堂医药有限公司',
      },
    },
    contextCandidates: candidates,
    availableTools: [recordTool],
    embeddingProvider: new FakeEmbeddingProvider('alpha'),
  });

  assert.equal(result.resolvedContext.usedContext, false);
  assert.equal(result.intentFrame.target.name, '潍坊舒珍堂医药有限公司');
  assert.equal(result.semanticResolution.targetWasOverridden, false);
});

test('semantic resolver asks for clarification when candidate scores are too close', async () => {
  const result = await resolveSemanticReference({
    request: {
      conversationKey: 'conv-semantic-ambiguous',
      sceneKey: 'chat',
      query: '继续处理上一轮提到的主体',
    },
    intentFrame: genericIntent,
    contextCandidates: candidates,
    availableTools: [recordTool],
    embeddingProvider: new FakeEmbeddingProvider('ambiguous'),
  });

  assert.equal(result.resolvedContext.usedContext, false);
  assert.equal(result.semanticResolution.shouldClarify, true);
  assert.match(result.semanticResolution.reason, /分差/);
});

test('semantic resolver coalesces same entity candidates from context and artifact anchor', async () => {
  const companyName = '安徽佳洪健康科技股份有限公司';
  const result = await resolveSemanticReference({
    request: {
      conversationKey: 'conv-semantic-coalesce',
      sceneKey: 'chat',
      query: '将这个客户录入系统',
    },
    intentFrame: {
      ...genericIntent,
      target: {
        ...genericIntent.target,
        name: '将这个客户录入系统',
      },
    },
    contextCandidates: [
      {
        candidateId: 'run-company:context',
        subject: {
          kind: 'external_subject',
          type: 'external_subject',
          id: companyName,
          name: companyName,
        },
        sourceRunId: 'run-company',
        evidenceRefs: [],
        text: `${companyName} 公司研究`,
        recencyRank: 0,
        confidence: 0.9,
        source: 'context_subject',
      },
      {
        candidateId: 'run-company:evidence',
        subject: {
          kind: 'artifact',
          type: 'artifact_anchor',
          id: 'artifact-001',
          name: companyName,
        },
        sourceRunId: 'run-company',
        evidenceRefs: [],
        text: `${companyName} Artifact anchor`,
        recencyRank: 1,
        confidence: 0.82,
        source: 'evidence',
      },
    ],
    availableTools: [recordTool],
    embeddingProvider: new FakeEmbeddingProvider('ambiguous'),
  });

  assert.equal(result.resolvedContext.usedContext, true);
  assert.equal(result.intentFrame.target.name, companyName);
  assert.equal(result.semanticResolution.shouldClarify, false);
  assert.equal(result.semanticResolution.candidates.length, 1);
});

test('semantic resolver keeps collection queries from binding the current record subject', async () => {
  for (const query of ['查询联系人', '查询所有的联系人']) {
    const result = await resolveSemanticReference({
      request: {
        conversationKey: `conv-contact-list-${query}`,
        sceneKey: 'chat',
        query,
      },
      intentFrame: {
        ...genericIntent,
        actionType: 'query',
        goal: '查询联系人信息',
        target: {
          kind: 'record',
          objectType: 'contact',
          name: '联系人',
        },
      },
      contextCandidates: [
        {
          candidateId: 'contact-current',
          subject: {
            kind: 'record',
            type: 'contact',
            id: 'contact-lilingling-001',
            name: '李玲玲',
          },
          sourceRunId: 'run-contact',
          evidenceRefs: [],
          text: 'record contact contact-lilingling-001 李玲玲',
          recencyRank: 0,
          confidence: 0.9,
          source: 'context_subject',
        },
      ],
      availableTools: [contactSearchTool],
      embeddingProvider: null,
    });

    assert.equal(result.resolvedContext.usedContext, false, query);
    assert.equal(result.resolvedContext.subject, undefined, query);
    assert.equal(result.resolvedContext.usageMode, 'skipped_collection_query', query);
    assert.equal(result.semanticResolution.selectedCandidate?.subject.name, '李玲玲', query);
  }
});

test('semantic resolver still binds context for subject-scoped collection queries', async () => {
  const result = await resolveSemanticReference({
    request: {
      conversationKey: 'conv-customer-contacts',
      sceneKey: 'chat',
      query: '查询这个客户的联系人',
    },
    intentFrame: {
      ...genericIntent,
      actionType: 'query',
      goal: '查询客户关联联系人',
      target: {
        kind: 'record',
        objectType: 'contact',
        name: '这个客户',
      },
    },
    contextCandidates: [
      {
        candidateId: 'customer-current',
        subject: {
          kind: 'record',
          type: 'customer',
          id: 'customer-c1-001',
          name: '苏州恒达机电有限公司',
        },
        sourceRunId: 'run-customer',
        evidenceRefs: [],
        text: 'record customer customer-c1-001 苏州恒达机电有限公司',
        recencyRank: 0,
        confidence: 0.9,
        source: 'context_subject',
      },
    ],
    availableTools: [contactSearchTool],
    embeddingProvider: null,
  });

  assert.equal(result.resolvedContext.usedContext, true);
  assert.equal(result.resolvedContext.subject?.id, 'customer-c1-001');
  assert.equal(result.semanticResolution.usageMode, 'used');
});
