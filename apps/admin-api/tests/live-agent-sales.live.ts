import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const API_BASE_URL = process.env.AGENT_API_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3001';
const OPERATOR_OPEN_ID = process.env.YZJ_AGENT_LIVE_OPERATOR_OPEN_ID || '69e75eb5e4b0e65b61c014da';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORT_DIR = process.env.AGENT_LIVE_REPORT_DIR || join(REPO_ROOT, '.local/agent-live-reports');
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const companies = [
  '上海精文投资有限公司',
  '潍坊舒珍堂医药有限公司',
  '威海三阳服饰有限公司',
  '上海奥威科技开发有限公司',
];

interface AgentChatResponseLike {
  success: true;
  message: {
    content: string;
    extraInfo: {
      headline: string;
      agentTrace?: {
        selectedTool?: {
          toolCode: string;
          input?: Record<string, unknown>;
        };
        pendingConfirmation?: {
          confirmationId: string;
          runId: string;
          toolCode: string;
          debugPayload?: unknown;
        } | null;
        semanticResolution?: unknown;
        resolvedContext?: unknown;
        continuationResolution?: unknown;
        policyDecisions?: Array<{ policyCode: string; action: string; reason: string }>;
      };
    };
  };
  executionState: {
    runId: string;
    status: string;
    message: string;
  };
  taskPlan: {
    steps: Array<{ toolRefs: string[] }>;
  };
}

interface TurnReport {
  index: number;
  query: string;
  status: string;
  headline: string;
  selectedTool?: string;
  pendingConfirmationId?: string;
  formInstIds: string[];
  contentExcerpt: string;
  semanticResolution?: unknown;
  resolvedContext?: unknown;
  continuationResolution?: unknown;
  policyDecisions?: Array<{ policyCode: string; action: string; reason: string }>;
  error?: string;
}

interface SendOptions {
  allowToolUnavailable?: boolean;
  maxAttempts?: number;
}

interface CompanyReport {
  company: string;
  conversationKey: string;
  blocked: boolean;
  blockReason?: string;
  customerFormInstId?: string;
  writebackFormInstIds: string[];
  turns: TurnReport[];
}

interface LiveReport {
  version: '0.6.4';
  apiBaseUrl: string;
  operatorOpenId: string;
  startedAt: string;
  finishedAt?: string;
  companies: CompanyReport[];
  failures: Array<{ company: string; turn: number; query: string; reason: string }>;
}

test('live sales journey calls real Agent API for 4 companies', { timeout: 30 * 60 * 1000 }, async () => {
  await assertApiReachable();
  const report: LiveReport = {
    version: '0.6.4',
    apiBaseUrl: API_BASE_URL,
    operatorOpenId: OPERATOR_OPEN_ID,
    startedAt: new Date().toISOString(),
    companies: [],
    failures: [],
  };

  for (const [index, company] of companies.entries()) {
    const companyReport = await runCompanyJourney(company, index);
    report.companies.push(companyReport);
  }

  report.finishedAt = new Date().toISOString();
  report.failures = collectUnresolvedFailures(report.companies);
  const reportPath = await writeReport(report);

  assert.equal(
    report.failures.length,
    0,
    `live harness 存在未恢复失败。报告：${reportPath}`,
  );
  assert.equal(
    report.companies.every((item) => !item.blocked),
    true,
    `每家公司都应完成真实销售旅程，不应 blocked。报告：${reportPath}`,
  );
  assert.equal(
    report.companies.every((item) => item.turns.length >= 12),
    true,
    `每家公司应不少于 12 轮。报告：${reportPath}`,
  );
  assert.equal(
    report.companies.every((item) => item.turns.every((turn) => !turn.selectedTool?.startsWith('scene.'))),
    true,
    `Tool Registry / selectedTool 不应出现 scene.*。报告：${reportPath}`,
  );
  assert.equal(
    report.companies.every((item) => item.turns.every((turn) => !turn.selectedTool?.includes('.delete'))),
    true,
    `live harness 不允许触发 delete。报告：${reportPath}`,
  );
});

async function runCompanyJourney(company: string, companyIndex: number): Promise<CompanyReport> {
  const conversationKey = `live-sales-0.6.4-${RUN_STAMP}-${companyIndex}`;
  const fixture = buildSalesFixture(company, companyIndex);
  const companyReport: CompanyReport = {
    company,
    conversationKey,
    blocked: false,
    writebackFormInstIds: [],
    turns: [],
  };

  const send = async (query: string, resume?: {
    runId: string;
    action: 'confirm_writeback';
    decision: 'approve' | 'reject';
    confirmationId?: string;
  }, options: SendOptions = {}) => {
    const maxAttempts = Math.max(1, options.maxAttempts ?? (resume ? 1 : 2));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await callAgentApi({ conversationKey, query, resume });
        if (response.executionState.status === 'tool_unavailable' && attempt < maxAttempts) {
          await sleep(800 * attempt);
          continue;
        }
        const turn = buildTurnReport(companyReport.turns.length + 1, query, response);
        companyReport.turns.push(turn);
        companyReport.writebackFormInstIds.push(...turn.formInstIds);
        if (!companyReport.customerFormInstId) {
          companyReport.customerFormInstId = inferCustomerFormInstId(response) ?? undefined;
        }
        if (response.executionState.status === 'tool_unavailable' && !options.allowToolUnavailable) {
          companyReport.blocked = true;
          companyReport.blockReason = response.executionState.message || response.message.extraInfo.headline;
          throw new Error(companyReport.blockReason);
        }
        await sleep(300);
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && !resume) {
          await sleep(800 * attempt);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!companyReport.turns.some((turn) => turn.query === query && turn.error)) {
          companyReport.turns.push({
            index: companyReport.turns.length + 1,
            query,
            status: 'failed',
            headline: 'Agent API 请求失败',
            formInstIds: [],
            contentExcerpt: '',
            error: message,
          });
        }
        companyReport.blocked = true;
        companyReport.blockReason = message;
        throw error;
      }
    }
    throw lastError;
  };

  try {
    let research = await send(`研究这家公司 ${company}`, undefined, {
      allowToolUnavailable: true,
      maxAttempts: 2,
    });
    if (research.executionState.status !== 'completed') {
      research = await send(`重新研究这家公司 ${company}`, undefined, {
        allowToolUnavailable: true,
        maxAttempts: 2,
      });
    }
    if (research.executionState.status !== 'completed') {
      companyReport.blocked = true;
      companyReport.blockReason = `公司研究未完成：${research.executionState.status}`;
      return companyReport;
    }

    await send('这家公司最近有什么值得关注，请结合刚才的研究给销售切入点');
    const customerSearch = await send(`查询客户 ${company}`);
    companyReport.customerFormInstId = inferCustomerFormInstId(customerSearch) ?? companyReport.customerFormInstId;

    let customerWrite = await send(`录入这个客户 ${fixture.customerFields}`);
    customerWrite = await resolveWriteIfNeeded(send, customerWrite, {
      selectionQuery: `更新已有 formInstId:${inferCandidateFormInstId(customerWrite) || companyReport.customerFormInstId || ''}`,
      fallbackSupplementQuery: fixture.customerFields,
    });
    companyReport.customerFormInstId = inferCustomerFormInstId(customerWrite) ?? companyReport.customerFormInstId;

    const customerIdText = companyReport.customerFormInstId
      ? ` 关联客户：${companyReport.customerFormInstId}`
      : '';
    let contactWrite = await send(`新增联系人 ${fixture.contactName} 手机：${fixture.phone} 启用状态：启用${customerIdText}`);
    contactWrite = await resolveWriteIfNeeded(send, contactWrite, {
      fallbackSupplementQuery: `启用状态：启用${customerIdText}`,
    });

    const customerId = companyReport.customerFormInstId || inferCustomerFormInstId(contactWrite) || '';
    const opportunityCustomerText = customerId ? `客户编号：${customerId}` : `客户名称：${company}`;
  let opportunityWrite = await send(
      `新增商机 ${fixture.opportunityName} ${opportunityCustomerText} 销售阶段：初期沟通 预计成交时间：2026-06-30 商机预算（元）：${fixture.budget}`,
    );
    opportunityWrite = await resolveWriteIfNeeded(send, opportunityWrite, {
      fallbackSupplementQuery: `${opportunityCustomerText} 销售阶段：初期沟通 预计成交时间：2026-06-30 商机预算（元）：${fixture.budget}`,
    });

    const followupCustomerText = customerId ? `客户编号：${customerId}` : `客户名称：${company}`;
    let followupWrite = await send(
      `新增跟进记录 跟进记录：${fixture.followupRecord} 跟进方式：电话 ${followupCustomerText} 跟进负责人：${OPERATOR_OPEN_ID}`,
    );
    followupWrite = await resolveWriteIfNeeded(send, followupWrite, {
      fallbackSupplementQuery: `跟进方式：电话 ${followupCustomerText} 跟进负责人：${OPERATOR_OPEN_ID}`,
    });

    await send('查询这个客户的联系人');
    await send('查询这个客户的商机');
    await send('查询这个客户的跟进记录');
    await send('列出这个客户的客户旅程');
    await send('基于这个客户旅程，给出下一步推进建议');

    assertNoInvalidToolRefs(companyReport);
  } catch (error) {
    if (!companyReport.blocked) {
      companyReport.blocked = true;
      companyReport.blockReason = error instanceof Error ? error.message : String(error);
    }
  }
  return companyReport;
}

function collectUnresolvedFailures(companies: CompanyReport[]): LiveReport['failures'] {
  return companies.flatMap((company) => {
    const failedTurns = company.turns.filter((turn) => turn.error && turn.status === 'failed');
    const blockedTurn = company.blocked
      ? [...company.turns].reverse().find((turn) => turn.error)
      : undefined;
    const unresolved = new Map<number, TurnReport>();
    for (const turn of failedTurns) {
      unresolved.set(turn.index, turn);
    }
    if (blockedTurn) {
      unresolved.set(blockedTurn.index, blockedTurn);
    }
    return [...unresolved.values()].map((turn) => ({
      company: company.company,
      turn: turn.index,
      query: turn.query,
      reason: turn.error!,
    }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWriteIfNeeded(
  send: (query: string, resume?: {
    runId: string;
    action: 'confirm_writeback';
    decision: 'approve' | 'reject';
    confirmationId?: string;
  }) => Promise<AgentChatResponseLike>,
  response: AgentChatResponseLike,
  options: {
    selectionQuery?: string;
    fallbackSupplementQuery?: string;
  },
): Promise<AgentChatResponseLike> {
  let current = response;
  if (current.executionState.status === 'waiting_selection' && options.selectionQuery?.trim()) {
    current = await send(options.selectionQuery);
  }
  if (current.executionState.status === 'waiting_input' && options.fallbackSupplementQuery?.trim()) {
    current = await send(options.fallbackSupplementQuery);
  }
  if (current.executionState.status === 'waiting_confirmation') {
    const pending = current.message.extraInfo.agentTrace?.pendingConfirmation;
    assert.ok(pending?.confirmationId, '等待确认状态必须包含 pendingConfirmation.confirmationId');
    current = await send('确认写回', {
      runId: pending.runId || current.executionState.runId,
      action: 'confirm_writeback',
      decision: 'approve',
      confirmationId: pending.confirmationId,
    });
  }
  return current;
}

async function callAgentApi(input: {
  conversationKey: string;
  query: string;
  resume?: {
    runId: string;
    action: 'confirm_writeback';
    decision: 'approve' | 'reject';
    confirmationId?: string;
  };
}): Promise<AgentChatResponseLike> {
  const response = await fetch(`${API_BASE_URL}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationKey: input.conversationKey,
      sceneKey: 'chat',
      query: input.query,
      tenantContext: {
        operatorOpenId: OPERATOR_OPEN_ID,
      },
      resume: input.resume,
    }),
  });
  const payload = await response.json().catch(() => null) as AgentChatResponseLike | { message?: string } | null;
  if (!response.ok || !payload || !('success' in payload)) {
    throw new Error(`Agent API 请求失败：${response.status} ${payload && 'message' in payload ? payload.message : ''}`);
  }
  return payload;
}

async function assertApiReachable(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    assert.ok(response.ok, `admin-api health check failed: ${response.status}`);
  } catch (error) {
    throw new Error(
      `无法连接 ${API_BASE_URL}。请先启动 admin-api 与 skill-runtime，再运行 pnpm --filter @yzj-ai-crm/admin-api test:live-agent-sales。${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildTurnReport(index: number, query: string, response: AgentChatResponseLike): TurnReport {
  const trace = response.message.extraInfo.agentTrace;
  return {
    index,
    query,
    status: response.executionState.status,
    headline: response.message.extraInfo.headline,
    selectedTool: trace?.selectedTool?.toolCode,
    pendingConfirmationId: trace?.pendingConfirmation?.confirmationId,
    formInstIds: extractFormInstIds(response),
    contentExcerpt: response.message.content.slice(0, 1200),
    semanticResolution: trace?.semanticResolution,
    resolvedContext: trace?.resolvedContext,
    continuationResolution: trace?.continuationResolution,
    policyDecisions: trace?.policyDecisions,
    error: response.executionState.status === 'failed' || response.executionState.status === 'tool_unavailable'
      ? response.executionState.message || response.message.content.slice(0, 300)
      : undefined,
  };
}

function inferCustomerFormInstId(response: AgentChatResponseLike): string | null {
  return extractFormInstIds(response)[0] ?? inferCandidateFormInstId(response);
}

function extractFormInstIds(response: AgentChatResponseLike): string[] {
  const values = new Set<string>();
  const text = response.message.content;
  const formLine = text.match(/表单实例[:：]([^\n]+)/)?.[1] ?? '';
  for (const match of formLine.matchAll(/`([A-Za-z0-9_-]{8,})`/g)) {
    if (looksLikeFormInstId(match[1])) {
      values.add(match[1]);
    }
  }
  for (const match of JSON.stringify(response.message.extraInfo.agentTrace?.pendingConfirmation?.debugPayload ?? {}).matchAll(/formInstIds?["']?\s*[:：]\s*(?:\[\s*)?["']([A-Za-z0-9_-]+)["']/g)) {
    if (looksLikeFormInstId(match[1])) {
      values.add(match[1]);
    }
  }
  return [...values];
}

function inferCandidateFormInstId(response: AgentChatResponseLike): string | null {
  const text = response.message.content;
  return text.match(/formInstId["']?\s*[:：]\s*["']([^"',\s}]+)/)?.[1]
    ?? text.match(/form_inst_id["']?\s*[:：]\s*["']([^"',\s}]+)/)?.[1]
    ?? null;
}

function looksLikeFormInstId(value: string | undefined): value is string {
  return Boolean(value && value.length >= 12 && !value.startsWith('trace-') && !value.startsWith('plan-'));
}

function buildSalesFixture(company: string, index: number) {
  const contactNames = ['李伟', '王敏', '张磊', '陈晨'];
  const phone = `13612952${String(100 + index).padStart(3, '0')}`;
  const contactName = contactNames[index] ?? `测试联系人${index + 1}`;
  return {
    contactName,
    phone,
    budget: 180000 + index * 50000,
    opportunityName: `${company} 数字化经营项目`,
    followupRecord: `已与${contactName}沟通经营管理数字化诉求，约定整理方案并确认预算窗口。`,
    customerFields: [
      `联系人姓名：${contactName}`,
      `联系人手机：${phone}`,
      '启用状态：启用',
      '客户类型：普通客户',
      '客户状态：销售线索阶段',
      '客户是否分配：已分配',
      `负责人：${OPERATOR_OPEN_ID}`,
    ].join(' '),
  };
}

function assertNoInvalidToolRefs(companyReport: CompanyReport): void {
  for (const turn of companyReport.turns) {
    assert.equal(turn.selectedTool?.startsWith('scene.'), false, `${companyReport.company} turn ${turn.index}: selected scene tool`);
    assert.equal(turn.selectedTool?.includes('.delete'), false, `${companyReport.company} turn ${turn.index}: selected delete tool`);
  }
}

async function writeReport(report: LiveReport): Promise<string> {
  await mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = join(REPORT_DIR, `agent-live-sales-${RUN_STAMP}.json`);
  const markdownPath = join(REPORT_DIR, `agent-live-sales-${RUN_STAMP}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(markdownPath, renderMarkdownReport(report));
  return jsonPath;
}

function renderMarkdownReport(report: LiveReport): string {
  return [
    '# 0.6.4 Live Agent Sales Journey Report',
    '',
    `- API: ${report.apiBaseUrl}`,
    `- Operator: ${report.operatorOpenId}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt ?? ''}`,
    '',
    ...report.companies.flatMap((company) => [
      `## ${company.company}`,
      '',
      `- Conversation: \`${company.conversationKey}\``,
      `- Blocked: ${company.blocked ? 'yes' : 'no'}`,
      `- Block reason: ${company.blockReason ?? 'none'}`,
      `- Customer formInstId: ${company.customerFormInstId ?? 'unknown'}`,
      `- Writeback formInstIds: ${company.writebackFormInstIds.join(', ') || 'none'}`,
      '',
      '| # | Status | Tool | Query |',
      '|---:|---|---|---|',
      ...company.turns.map((turn) => `| ${turn.index} | ${turn.status} | ${turn.selectedTool ?? ''} | ${turn.query.replace(/\|/g, '\\|')} |`),
      '',
    ]),
    report.failures.length ? '## Failures' : '',
    ...report.failures.map((failure) => `- ${failure.company} turn ${failure.turn}: ${failure.reason}`),
    '',
  ].join('\n');
}
