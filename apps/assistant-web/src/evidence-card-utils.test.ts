import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canGenerateEvidenceImage,
  compactEvidenceSnippet,
  getEvidenceCardTitle,
  isCompanyResearchEvidenceCard,
  isReportableEvidenceCard,
  isRecordingEvidenceCard,
  isRecordingMaterialEvidenceCard,
  isLikelyInternalEvidenceId,
  isVisitPrepEvidenceCard,
} from './evidence-card-utils';

test('evidence card helpers strip internal identifiers from visible text', () => {
  assert.equal(isLikelyInternalEvidenceId('69e75eb5e4b0e65b61c014da'), true);
  assert.equal(isLikelyInternalEvidenceId('chunk-69e75eb5e4b0e65b61c014da'), true);

  const snippet = compactEvidenceSnippet(
    'artifactId: artifact-69e75eb5e4b0e65b61c014da chunkId=chunk-69e75eb5e4b0e65b61c014da 该公司聚焦汽车零部件与智能制造升级，近期关注供应链协同。',
  );

  assert.doesNotMatch(snippet, /69e75eb5e4b0e65b61c014da/);
  assert.doesNotMatch(snippet, /artifactId|chunkId/);
  assert.match(snippet, /汽车零部件/);
  assert.ok(snippet.length <= 123);
});

test('evidence card title stays product-facing', () => {
  const title = getEvidenceCardTitle({
    artifactId: 'artifact-001',
    versionId: 'version-001',
    title: '69e75eb5e4b0e65b61c014da',
    version: 1,
    sourceToolCode: 'ext.company_research_pm',
    anchorLabel: '上海松井机械有限公司',
    snippet: '公司研究摘要',
  });

  assert.equal(title, '上海松井机械有限公司 公司研究');
});

test('company research evidence is recognized for legacy and current cards', () => {
  const legacyCard = {
    artifactId: 'artifact-company-001',
    versionId: 'version-company-001',
    title: '上海松井机械有限公司 公司研究',
    version: 1,
    sourceToolCode: 'ext.company_research_pm',
    anchorLabel: '上海松井机械有限公司',
    snippet: '公司研究摘要',
  };
  const currentCard = {
    ...legacyCard,
    kind: 'company_research' as const,
    sourceToolCode: 'external.company_research',
  };

  assert.equal(isCompanyResearchEvidenceCard(legacyCard), true);
  assert.equal(isCompanyResearchEvidenceCard(currentCard), true);
  assert.equal(isReportableEvidenceCard(legacyCard), true);
  assert.equal(isReportableEvidenceCard(currentCard), true);
  assert.equal(canGenerateEvidenceImage(legacyCard), true);
});

test('visit prep analysis material is reportable and image-enabled', () => {
  const card = {
    artifactId: 'artifact-visit-prep-001',
    versionId: 'version-visit-prep-001',
    kind: 'analysis_material' as const,
    title: '绍兴贝斯美化工股份有限公司 客户拜访准备',
    version: 1,
    sourceToolCode: 'ext.yunzhijia_visit_prep',
    anchorLabel: '绍兴贝斯美化工股份有限公司',
    snippet: '拜访准备摘要',
  };

  assert.equal(isCompanyResearchEvidenceCard(card), false);
  assert.equal(isVisitPrepEvidenceCard(card), true);
  assert.equal(isReportableEvidenceCard(card), true);
  assert.equal(canGenerateEvidenceImage(card), true);
  assert.equal(getEvidenceCardTitle(card), '绍兴贝斯美化工股份有限公司 客户拜访准备');
});

test('recording evidence cards use recording-facing title fallback and disable image generation', () => {
  const card = {
    artifactId: 'artifact-recording-001',
    versionId: 'version-recording-001',
    kind: 'recording_material' as const,
    title: 'record-69e75eb5e4b0e65b61c014da',
    version: 1,
    sourceToolCode: 'tongyi.audio.recording_material',
    anchorLabel: '贝斯美拜访',
    snippet: '录音资料包摘要',
  };

  assert.equal(isRecordingEvidenceCard(card), true);
  assert.equal(isRecordingMaterialEvidenceCard(card), true);
  assert.equal(canGenerateEvidenceImage(card), false);
  assert.equal(getEvidenceCardTitle(card), '贝斯美拜访 录音资料包');
});

test('analysis material opens as research content and offers image generation', () => {
  const card = {
    artifactId: 'artifact-analysis-001',
    versionId: 'version-analysis-001',
    kind: 'analysis_material' as const,
    title: '贝斯美拜访 - 拜访会话理解',
    version: 1,
    sourceToolCode: 'ext.visit_conversation_understanding',
    anchorLabel: '贝斯美拜访',
    snippet: '分析资料摘要',
  };

  assert.equal(isRecordingEvidenceCard(card), false);
  assert.equal(isRecordingMaterialEvidenceCard(card), false);
  assert.equal(isReportableEvidenceCard(card), false);
  assert.equal(canGenerateEvidenceImage(card), true);
  assert.equal(getEvidenceCardTitle(card), '贝斯美拜访 - 拜访会话理解');
});
