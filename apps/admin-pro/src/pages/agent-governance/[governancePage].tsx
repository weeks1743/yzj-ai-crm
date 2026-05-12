import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Button, Collapse, Drawer, Empty, List, Result, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  AgentConversationProcessResponse,
  AgentConfirmationAuditRow,
  AgentRunDiagnosticItem,
  AgentConfirmationListResponse,
  AgentRunDetailResponse,
  AgentRunListResponse,
  AgentRunSummary,
  AgentToolRow,
} from '@shared';
import {
  agentToolRows,
} from '@shared';
import { requestJson } from '@/utils/request';
import { formatLocalDateTime } from '@/utils/time';

const { Paragraph, Text } = Typography;

type GovernancePageKey =
  | 'tools-objects'
  | 'runtime-observability';

const pageMeta: Record<GovernancePageKey, { title: string; subTitle: string }> = {
  'tools-objects': {
    title: '工具与对象',
    subTitle: '统一治理工具注册表、记录对象、外部工具和元工具。',
  },
  'runtime-observability': {
    title: '运行观测',
    subTitle: '查看意图帧、任务计划、执行状态和工具调用链。',
  },
};

const toolTypeLabels: Record<AgentToolRow['type'], string> = {
  record: '记录工具',
  external: '外部工具',
  meta: '元工具',
};

const toolStatusMeta: Record<AgentToolRow['status'], { label: string; color: string }> = {
  ready: { label: '就绪', color: 'success' },
  warning: { label: '关注', color: 'warning' },
  placeholder: { label: '占位', color: 'default' },
};

const riskColor: Record<AgentToolRow['riskLevel'], string> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const executionStatusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  running: { label: '运行中', color: 'processing' },
  waiting_input: { label: '待补充', color: 'warning' },
  waiting_selection: { label: '待选择', color: 'warning' },
  waiting_confirmation: { label: '待确认', color: 'warning' },
  paused: { label: '已挂起', color: 'default' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
  tool_unavailable: { label: '工具不可用', color: 'error' },
};

const confirmationStatusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: 'warning' },
  approved: { label: '已同意', color: 'success' },
  rejected: { label: '已拒绝', color: 'error' },
  expired: { label: '已过期', color: 'default' },
};

const executionStatusValueEnum = Object.fromEntries(
  Object.entries(executionStatusLabels).map(([value, meta]) => [value, { text: meta.label }]),
);

function renderStatusTag(status: string) {
  const meta = executionStatusLabels[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function renderConfirmationStatusTag(status: string) {
  const meta = confirmationStatusLabels[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function renderJson(value: unknown) {
  return (
    <Paragraph
      copyable
      style={{ marginBottom: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}
    >
      {JSON.stringify(value, null, 2)}
    </Paragraph>
  );
}

interface AdminAgentTrace {
  traceId?: string;
  intentFrame?: Record<string, any>;
  taskPlan?: Record<string, any>;
  executionState?: Record<string, any>;
  toolCalls?: Array<Record<string, any>>;
  selectedTool?: {
    toolCode?: string;
    reason?: string;
    input?: Record<string, unknown>;
  } | null;
  pendingConfirmation?: Record<string, any> | null;
  pendingInteraction?: Record<string, any> | null;
  continuationResolution?: Record<string, any> | null;
  resolvedContext?: Record<string, any> | null;
  semanticResolution?: Record<string, any> | null;
  toolArbitration?: Record<string, any> | null;
  policyDecisions?: Array<Record<string, any>>;
}

interface RunFlowNode {
  key: string;
  title: string;
  status: 'success' | 'warning' | 'error' | 'processing' | 'default';
  summary: string;
  details?: string;
}

const runFlowStatusText = {
  success: '通过',
  warning: '待处理',
  error: '阻断',
  processing: '运行',
  default: '记录',
};

const runFlowStatusColor = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  processing: 'processing',
  default: 'default',
};

function readRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function extractAgentTrace(detail: AgentRunDetailResponse | null): AdminAgentTrace | null {
  if (!detail) {
    return null;
  }
  const messageTrace = [...detail.messages]
    .reverse()
    .map((message) => readRecord(readRecord(message.extraInfo)?.agentTrace))
    .find(Boolean);
  return {
    ...(messageTrace ?? {}),
    traceId: String(messageTrace?.traceId ?? detail.run.traceId ?? ''),
    intentFrame: readRecord(messageTrace?.intentFrame) ?? readRecord(detail.intentFrame) ?? undefined,
    taskPlan: readRecord(messageTrace?.taskPlan) ?? readRecord(detail.taskPlan) ?? undefined,
    executionState: readRecord(messageTrace?.executionState) ?? readRecord(detail.executionState) ?? undefined,
    toolCalls: Array.isArray(messageTrace?.toolCalls) ? messageTrace.toolCalls : detail.toolCalls,
  };
}

function readSelectedToolParams(input?: Record<string, unknown>): Record<string, unknown> {
  const params = input?.params;
  return params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

function formatSearchFilter(filter: unknown): string {
  if (!filter || typeof filter !== 'object') {
    return String(filter);
  }
  const record = filter as { field?: unknown; operator?: unknown; value?: unknown };
  return `${String(record.field ?? '-')}${String(record.operator ?? '=')}${String(record.value ?? '')}`;
}

function summarizeSearchFilterSources(input: Record<string, unknown>): string {
  const control = input.agentControl && typeof input.agentControl === 'object'
    ? input.agentControl as { searchExtraction?: { filterSources?: unknown[]; fallbackName?: unknown; conditions?: unknown[] } }
    : {};
  const filterSources = Array.isArray(control.searchExtraction?.filterSources)
    ? control.searchExtraction.filterSources
    : [];
  const labels = filterSources
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const source = String((item as { source?: unknown }).source ?? '');
      if (source === 'relation_context') {
        return '关系上下文绑定';
      }
      if (source === 'name_fallback') {
        return '名称 fallback';
      }
      if (source === 'explicit_condition') {
        return '用户显式条件';
      }
      if (source === 'implicit_condition') {
        return '隐式条件抽取';
      }
      return source;
    })
    .filter(Boolean);
  if (!labels.length && typeof control.searchExtraction?.fallbackName === 'string') {
    labels.push('名称 fallback');
  }
  if (!labels.length && Array.isArray(control.searchExtraction?.conditions) && control.searchExtraction.conditions.length) {
    labels.push('用户显式条件');
  }
  return labels.length ? `过滤来源：${Array.from(new Set(labels)).join('、')}` : '过滤来源：无';
}

function summarizeTargetSanitization(input: Record<string, unknown>): string {
  const control = input.agentControl && typeof input.agentControl === 'object'
    ? input.agentControl as { targetSanitization?: { reasonCode?: unknown; ignoredTargetName?: unknown } }
    : {};
  const target = control.targetSanitization;
  if (target?.reasonCode !== 'ignored_ungrounded_target') {
    return '';
  }
  return `已忽略未落在用户输入中的 LLM target：${String(target.ignoredTargetName ?? '-')}`;
}

function summarizeSelectedToolInput(input?: Record<string, unknown>): string {
  if (!input) {
    return '暂无工具输入';
  }
  const filters = Array.isArray(input.filters) ? input.filters : null;
  if (filters) {
    const filterText = filters.length
      ? `查询过滤：${filters.map(formatSearchFilter).join('、')}`
      : '查询过滤：无';
    return [filterText, summarizeSearchFilterSources(input), summarizeTargetSanitization(input)].filter(Boolean).join('；');
  }
  const formInstId = typeof input.formInstId === 'string' && input.formInstId ? '已绑定记录' : '';
  const params = readSelectedToolParams(input);
  const paramKeys = Object.keys(params);
  const paramsText = paramKeys.length ? `写入字段：${paramKeys.join('、')}` : '写入字段：无';
  return [formInstId, paramsText].filter(Boolean).join('；') || JSON.stringify(input);
}

function formatContextSubject(subject: { kind?: string; type?: string; id?: string; name?: string }): string {
  return `${subject.type ?? subject.kind ?? 'subject'}：${subject.name ?? subject.id ?? '-'}`;
}

function formatCandidateOnlyDetails(agentTrace: AdminAgentTrace): string | undefined {
  const reason = agentTrace.resolvedContext?.reason || agentTrace.semanticResolution?.reason;
  const candidate = agentTrace.semanticResolution?.selectedCandidate?.subject;
  const candidateText = candidate ? `候选未承接：${formatContextSubject(candidate)}` : '';
  return [reason, candidateText].filter(Boolean).join('；') || undefined;
}

function summarizeContextFlow(agentTrace: AdminAgentTrace): Pick<RunFlowNode, 'status' | 'summary' | 'details'> {
  const resolvedContext = agentTrace.resolvedContext;
  const semanticResolution = agentTrace.semanticResolution;
  const usedSubject = resolvedContext?.usedContext ? resolvedContext.subject : null;
  if (usedSubject) {
    return {
      status: 'success',
      summary: `已使用上下文：${formatContextSubject(usedSubject)}`,
      details: resolvedContext?.reason,
    };
  }

  if (resolvedContext?.usageMode === 'skipped_collection_query'
    || semanticResolution?.usageMode === 'skipped_collection_query'
    || resolvedContext?.skipReasonCode === 'record.collection_query') {
    return {
      status: 'default',
      summary: '未使用上下文：本轮是集合查询',
      details: formatCandidateOnlyDetails(agentTrace),
    };
  }

  const candidate = semanticResolution?.selectedCandidate;
  if (candidate) {
    return {
      status: 'default',
      summary: `仅记录候选：${formatContextSubject(candidate.subject)}`,
      details: resolvedContext?.reason || semanticResolution?.reason,
    };
  }

  const pendingSubject = agentTrace.pendingInteraction?.contextSubject;
  if (pendingSubject) {
    return {
      status: 'warning',
      summary: `等待态上下文：${formatContextSubject(pendingSubject)}`,
      details: agentTrace.pendingInteraction?.summary,
    };
  }

  return {
    status: 'default',
    summary: '本轮未绑定明确上下文主体',
    details: resolvedContext?.reason || semanticResolution?.reason,
  };
}

function buildRunFlowNodes(agentTrace: AdminAgentTrace): RunFlowNode[] {
  const selectedTool = agentTrace.selectedTool;
  const toolCalls = agentTrace.toolCalls ?? [];
  const policyDecisions = agentTrace.policyDecisions ?? [];
  const lastToolCall = toolCalls[toolCalls.length - 1];
  const blockingPolicy = [...policyDecisions].reverse().find((item) => item.action && item.action !== 'audit');
  const params = readSelectedToolParams(selectedTool?.input);
  const paramsEmpty = selectedTool?.toolCode?.includes('.preview_') && Object.keys(params).length === 0;
  const emptyGuard = policyDecisions.some((item) => item.policyCode === 'record.preview_empty_payload_guard');
  const contextFlow = summarizeContextFlow(agentTrace);

  return [
    {
      key: 'intent',
      title: '1. 意图识别',
      status: 'success',
      summary: agentTrace.intentFrame?.goal || '已生成意图帧',
      details: [
        agentTrace.intentFrame?.actionType ? `动作：${agentTrace.intentFrame.actionType}` : '',
        agentTrace.intentFrame?.targetType ? `对象：${agentTrace.intentFrame.targetType}` : '',
      ].filter(Boolean).join('；'),
    },
    {
      key: 'context',
      title: '2. 上下文绑定',
      status: contextFlow.status,
      summary: contextFlow.summary,
      details: contextFlow.details,
    },
    {
      key: 'tool',
      title: '3. 工具选择',
      status: selectedTool ? 'success' : 'warning',
      summary: selectedTool?.toolCode || '未选择工具',
      details: selectedTool?.reason,
    },
    {
      key: 'input',
      title: '4. 工具输入',
      status: paramsEmpty ? 'warning' : 'success',
      summary: selectedTool ? summarizeSelectedToolInput(selectedTool.input) : '暂无工具输入',
      details: paramsEmpty ? '写入参数 params 为空，后续预览无法生成真实写入字段。' : undefined,
    },
    {
      key: 'tool-result',
      title: '5. 工具结果',
      status: lastToolCall?.status === 'succeeded'
        ? 'success'
        : lastToolCall?.status === 'failed'
          ? 'error'
          : lastToolCall?.status === 'skipped'
            ? 'warning'
            : 'default',
      summary: lastToolCall?.outputSummary || '暂无工具执行结果',
      details: lastToolCall?.errorMessage ?? undefined,
    },
    {
      key: 'policy',
      title: '6. 策略 / 守卫',
      status: emptyGuard ? 'error' : blockingPolicy ? 'warning' : 'success',
      summary: emptyGuard
        ? '字段抽取为空 -> params={} -> 空写入守卫阻断'
        : blockingPolicy?.reason || '未触发阻断策略',
      details: blockingPolicy?.policyCode,
    },
    {
      key: 'state',
      title: '7. 最终状态',
      status: agentTrace.executionState?.status === 'completed'
        ? 'success'
        : String(agentTrace.executionState?.status ?? '').startsWith('waiting_')
          ? 'warning'
          : agentTrace.executionState?.status === 'failed'
            ? 'error'
            : 'default',
      summary: agentTrace.executionState?.message || agentTrace.executionState?.status || '暂无状态',
      details: agentTrace.pendingConfirmation
        ? '已进入写回确认'
        : agentTrace.pendingInteraction?.summary,
    },
  ];
}

function RunFlowChart({ agentTrace }: { agentTrace: AdminAgentTrace | null }) {
  if (!agentTrace) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前运行没有可展示的追踪流程" />;
  }
  const nodes = buildRunFlowNodes(agentTrace);
  return (
    <div className="yzj-run-flow">
      {nodes.map((node, index) => (
        <div key={node.key} className="yzj-run-flow-item">
          <div className="yzj-run-flow-node">
            <div className="yzj-run-flow-node-header">
              <Text strong>{node.title}</Text>
              <Tag color={runFlowStatusColor[node.status]}>{runFlowStatusText[node.status]}</Tag>
            </div>
            <Text>{node.summary}</Text>
            {node.details ? <div className="yzj-run-flow-node-details">{node.details}</div> : null}
          </div>
          {index < nodes.length - 1 ? <div className="yzj-run-flow-connector" /> : null}
        </div>
      ))}
    </div>
  );
}

function renderDiagnosticIssueTag(severity: AgentRunDiagnosticItem['issue']['severity']) {
  if (severity === 'error') {
    return <Tag color="error">需要排查</Tag>;
  }
  if (severity === 'warning') {
    return <Tag color="warning">待处理</Tag>;
  }
  return <Tag color="success">正常</Tag>;
}

function pickDefaultDiagnosticRunKey(
  runs: AgentRunDiagnosticItem[],
  currentRunId?: string,
  attentionRunId?: string | null,
): string | undefined {
  return currentRunId && runs.some((item) => item.runId === currentRunId)
    ? currentRunId
    : attentionRunId
      || [...runs].reverse().find((item) => item.issue.severity !== 'info')?.runId
      || runs[runs.length - 1]?.runId;
}

function DiagnosticRunFlow({ run }: { run: AgentRunDiagnosticItem }) {
  return (
    <div className="yzj-run-flow">
      {run.steps.map((node, index) => (
        <div key={node.key} className="yzj-run-flow-item">
          <div className="yzj-run-flow-node">
            <div className="yzj-run-flow-node-header">
              <Text strong>{node.title}</Text>
              <Tag color={runFlowStatusColor[node.status]}>{node.statusLabel}</Tag>
            </div>
            <Text>{node.summary}</Text>
            {node.details ? <div className="yzj-run-flow-node-details">{node.details}</div> : null}
          </div>
          {index < run.steps.length - 1 ? <div className="yzj-run-flow-connector" /> : null}
        </div>
      ))}
    </div>
  );
}

function ConversationDiagnosticPanel({
  process,
  currentRunId,
  loading,
  fallbackTrace,
}: {
  process: AgentConversationProcessResponse | null;
  currentRunId?: string;
  loading: boolean;
  fallbackTrace: AdminAgentTrace | null;
}) {
  const diagnostics = process?.diagnostics;
  const runs = diagnostics?.runs ?? [];
  if (loading && !process) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin tip="正在加载会话诊断..." />
      </div>
    );
  }

  if (!runs.length) {
    return <RunFlowChart agentTrace={fallbackTrace} />;
  }

  const defaultRunKey = pickDefaultDiagnosticRunKey(runs, currentRunId, diagnostics?.summary.attentionRunId);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <ProCard split="vertical" bordered>
        <ProCard title="会话总览">
          <Space direction="vertical" size={8}>
            <Space wrap>
              <Tag color="blue">意图 {diagnostics?.summary.totalRuns ?? runs.length}</Tag>
              <Tag color="warning">等待 {diagnostics?.summary.waitingCount ?? 0}</Tag>
              <Tag color="error">失败 {diagnostics?.summary.failedCount ?? 0}</Tag>
            </Space>
            <Text>{diagnostics?.summary.attentionSummary ?? '暂无明显阻断。'}</Text>
          </Space>
        </ProCard>
        <ProCard title="当前关注">
          <Space direction="vertical" size={8}>
            <Space wrap>
              {renderDiagnosticIssueTag(diagnostics?.summary.attentionSeverity ?? 'info')}
              <Text strong>{diagnostics?.summary.attentionTitle ?? '本会话暂无明显阻断'}</Text>
            </Space>
            {diagnostics?.summary.attentionTraceId ? <Text copyable>{diagnostics.summary.attentionTraceId}</Text> : null}
          </Space>
        </ProCard>
      </ProCard>
      <Collapse
        defaultActiveKey={defaultRunKey ? [defaultRunKey] : undefined}
        items={runs.map((run, index) => ({
          key: run.runId,
          label: (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Space wrap>
                {renderDiagnosticIssueTag(run.issue.severity)}
                <Text strong>{`意图 ${index + 1}：${run.goal || run.userInput || run.planTitle}`}</Text>
                <Text copyable type="secondary">{run.traceId}</Text>
              </Space>
              <Text type="secondary">{run.issue.title} · {run.issue.summary}</Text>
            </Space>
          ),
          children: <DiagnosticRunFlow run={run} />,
        }))}
      />
    </Space>
  );
}

function getPageKey(pathname: string): GovernancePageKey | null {
  const key = pathname.split('/').filter(Boolean).pop();
  return key && key in pageMeta ? (key as GovernancePageKey) : null;
}

function renderMetricCards(
  items: Array<{ key: string; title: string; value: string; helper: string }>,
  options?: { className?: string; marginTop?: number },
) {
  return (
    <Space
      wrap
      size={16}
      className={options?.className}
      style={{ width: '100%', marginTop: options?.marginTop ?? 16 }}
    >
      {items.map((item) => (
        <StatisticCard
          key={item.key}
          style={{ minWidth: 240 }}
          statistic={{
            title: item.title,
            value: item.value,
            description: item.helper,
          }}
        />
      ))}
    </Space>
  );
}

function ToolsObjectsView() {
  const [current, setCurrent] = useState<AgentToolRow | null>(null);
  const columns: ProColumns<AgentToolRow>[] = [
    {
      title: '工具',
      dataIndex: 'name',
      render: (_, record) => <a onClick={() => setCurrent(record)}>{record.name}</a>,
    },
    { title: '工具编码', dataIndex: 'code', width: 260, copyable: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (_, record) => <Tag>{toolTypeLabels[record.type]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => {
        const meta = toolStatusMeta[record.status];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '风险',
      dataIndex: 'riskLevel',
      width: 100,
      render: (_, record) => <Tag color={riskColor[record.riskLevel]}>{record.riskLevel}</Tag>,
    },
    { title: '确认策略', dataIndex: 'confirmationPolicy', width: 190 },
    { title: '服务提供方', dataIndex: 'provider', width: 180 },
    { title: '负责人', dataIndex: 'owner', width: 130 },
  ];

  const metrics = useMemo(() => {
    const readyCount = agentToolRows.filter((item) => item.status === 'ready').length;
    const highRiskCount = agentToolRows.filter((item) => item.riskLevel === 'high').length;
    return [
      { key: 'total', title: '工具总数', value: `${agentToolRows.length}`, helper: '记录 / 外部 / 元工具' },
      { key: 'ready', title: '就绪工具', value: `${readyCount}`, helper: '当前可被任务计划选择' },
      { key: 'high', title: '高风险工具', value: `${highRiskCount}`, helper: '必须走确认或守卫' },
    ];
  }, []);

  return (
    <>
      {renderMetricCards(metrics)}
      <ProTable<AgentToolRow>
        style={{ marginTop: 16 }}
        rowKey="id"
        search={false}
        toolBarRender={false}
        columns={columns}
        dataSource={agentToolRows}
        scroll={{ x: 1400 }}
      />
      <Drawer
        width={720}
        open={Boolean(current)}
        onClose={() => setCurrent(null)}
        title="工具详情"
      >
        {current ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={current.status === 'ready' ? 'success' : current.status === 'warning' ? 'warning' : 'info'}
              message={current.healthNote}
            />
            <ProDescriptions<AgentToolRow> column={1} dataSource={current}>
              <ProDescriptions.Item label="工具名称" dataIndex="name" />
              <ProDescriptions.Item label="工具编码" dataIndex="code" copyable />
              <ProDescriptions.Item label="工具类型">{toolTypeLabels[current.type]}</ProDescriptions.Item>
              <ProDescriptions.Item label="服务提供方" dataIndex="provider" />
              <ProDescriptions.Item label="输入摘要" dataIndex="inputSummary" />
              <ProDescriptions.Item label="输出摘要" dataIndex="outputSummary" />
              <ProDescriptions.Item label="确认策略" dataIndex="confirmationPolicy" />
              <ProDescriptions.Item label="负责人" dataIndex="owner" />
            </ProDescriptions>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}

function RuntimeObservabilityView() {
  const location = useLocation();
  const traceIdFromQuery = useMemo(
    () => new URLSearchParams(location.search).get('traceId')?.trim() || '',
    [location.search],
  );
  const [runFilters, setRunFilters] = useState<{ operatorName?: string; status?: string }>({});
  const [runData, setRunData] = useState<AgentRunListResponse | null>(null);
  const [confirmationData, setConfirmationData] = useState<AgentConfirmationListResponse | null>(null);
  const [current, setCurrent] = useState<AgentRunDetailResponse | null>(null);
  const [currentProcess, setCurrentProcess] = useState<AgentConversationProcessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true);
    setProcessLoading(true);
    setCurrentProcess(null);
    try {
      const detail = await requestJson<AgentRunDetailResponse>(`/api/agent/runs/${encodeURIComponent(runId)}`);
      setCurrent(detail);
      setCurrentProcess(await requestJson<AgentConversationProcessResponse>(
        `/api/agent/conversations/${encodeURIComponent(detail.run.conversationKey)}/process`,
      ));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '运行详情加载失败');
    } finally {
      setDetailLoading(false);
      setProcessLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams({
        page: '1',
        pageSize: '20',
      });
      if (traceIdFromQuery) {
        query.set('traceId', traceIdFromQuery);
      }
      if (runFilters.operatorName?.trim()) {
        query.set('operatorName', runFilters.operatorName.trim());
      }
      if (runFilters.status?.trim()) {
        query.set('status', runFilters.status.trim());
      }
      const runs = await requestJson<AgentRunListResponse>(`/api/agent/runs?${query.toString()}`);
      setRunData(runs);
      if (traceIdFromQuery && runs.items[0]) {
        void loadRunDetail(runs.items[0].runId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '智能体运行观测加载失败');
    } finally {
      setLoading(false);
    }
  }, [loadRunDetail, runFilters.operatorName, runFilters.status, traceIdFromQuery]);

  const loadConfirmations = useCallback(async () => {
    setConfirmationLoading(true);
    try {
      setConfirmationData(await requestJson<AgentConfirmationListResponse>('/api/agent/confirmations?page=1&pageSize=20'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '确认审计加载失败');
    } finally {
      setConfirmationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void loadConfirmations();
  }, [loadConfirmations, loadData]);

  const runs = runData?.items ?? [];
  const confirmations = confirmationData?.items ?? [];
  const runningCount = runs.filter((item) => (
    item.status === 'running'
    || item.status === 'waiting_input'
    || item.status === 'waiting_selection'
    || item.status === 'waiting_confirmation'
  )).length;
  const failedCount = runs.filter((item) => item.status === 'failed' || item.status === 'tool_unavailable').length;
  const pendingConfirmationCount = runs.reduce((sum, item) => sum + item.pendingConfirmationCount, 0);

  const columns: ProColumns<AgentRunSummary>[] = [
    {
      title: '追踪编号',
      dataIndex: 'traceId',
      width: 210,
      copyable: true,
      hideInSearch: true,
      search: false,
      render: (_, record) => <a onClick={() => void loadRunDetail(record.runId)}>{record.traceId}</a>,
    },
    {
      title: '用户',
      dataIndex: 'operatorName',
      width: 150,
      order: 1,
      fieldProps: { placeholder: '输入用户名' },
      render: (_, record) => (
        <Text
          style={{ display: 'inline-block', maxWidth: 130, whiteSpace: 'nowrap' }}
          ellipsis={{ tooltip: record.operatorName }}
        >
          {record.operatorName}
        </Text>
      ),
    },
    { title: '用户输入', dataIndex: 'userInput', ellipsis: true, hideInSearch: true, search: false },
    { title: '目标', dataIndex: 'goal', ellipsis: true, hideInSearch: true, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      order: 2,
      valueType: 'select',
      valueEnum: executionStatusValueEnum,
      render: (_, record) => renderStatusTag(record.status),
    },
    { title: '计划', dataIndex: 'planTitle', ellipsis: true, hideInSearch: true, search: false },
    {
      title: '工具',
      width: 90,
      hideInSearch: true,
      search: false,
      render: (_, record) => record.toolCallCount,
    },
    {
      title: '待确认',
      width: 100,
      hideInSearch: true,
      search: false,
      render: (_, record) => (
        record.pendingConfirmationCount ? <Tag color="warning">{record.pendingConfirmationCount}</Tag> : '-'
      ),
    },
    { title: '场景', dataIndex: 'sceneKey', width: 130, hideInSearch: true, search: false },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      hideInSearch: true,
      search: false,
      render: (_, record) => formatLocalDateTime(record.createdAt),
    },
  ];

  const confirmationColumns: ProColumns<AgentConfirmationAuditRow>[] = [
    { title: '确认编号', dataIndex: 'confirmationId', copyable: true, width: 190 },
    { title: '追踪编号', dataIndex: 'traceId', copyable: true, width: 200 },
    { title: '工具', dataIndex: 'toolCode', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (_, record) => renderConfirmationStatusTag(record.status),
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (_, record) => formatLocalDateTime(record.createdAt),
    },
  ];

  const planSteps = Array.isArray((current?.taskPlan as any)?.steps)
    ? (current?.taskPlan as any).steps as Array<Record<string, any>>
    : [];
  const agentTrace = useMemo(() => extractAgentTrace(current), [current]);
  const detailToolColumns: ProColumns<AgentRunDetailResponse['toolCalls'][number]>[] = [
    { title: '工具', dataIndex: 'toolCode', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (_, record) => (
        <Tag color={record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'error' : 'processing'}>
          {record.status}
        </Tag>
      ),
    },
    { title: '输入', dataIndex: 'inputSummary', ellipsis: true },
    { title: '输出', dataIndex: 'outputSummary', ellipsis: true },
    { title: '错误', dataIndex: 'errorMessage', ellipsis: true },
  ];
  const processMessageColumns: ProColumns<AgentConversationProcessResponse['messages'][number]>[] = [
    { title: '角色', dataIndex: 'role', width: 90 },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    { title: '运行编号', dataIndex: 'runId', copyable: true, width: 220 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (_, record) => formatLocalDateTime(record.createdAt),
    },
  ];
  const processToolColumns: ProColumns<AgentConversationProcessResponse['toolCalls'][number]>[] = [
    { title: '工具', dataIndex: 'toolCode', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (_, record) => (
        <Tag color={record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'error' : 'processing'}>
          {record.status}
        </Tag>
      ),
    },
    { title: '输入', dataIndex: 'inputSummary', ellipsis: true },
    { title: '输出', dataIndex: 'outputSummary', ellipsis: true },
    { title: '运行编号', dataIndex: 'runId', copyable: true, width: 220 },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 170,
      render: (_, record) => formatLocalDateTime(record.startedAt),
    },
  ];

  return (
    <>
      {errorMessage ? (
        <Alert
          type="error"
          showIcon
          message="运行观测加载失败"
          description={errorMessage}
          style={{ marginTop: 16 }}
        />
      ) : null}
      {renderMetricCards([
        { key: 'runs', title: '运行记录', value: `${runData?.total ?? 0}`, helper: '来自运行记录表' },
        { key: 'running', title: '进行中 / 等待态', value: `${runningCount}`, helper: '运行中 / 等待类状态' },
        { key: 'failed', title: '失败或不可用', value: `${failedCount}`, helper: '失败 / 工具不可用' },
        { key: 'confirm', title: '待确认', value: `${pendingConfirmationCount}`, helper: '写入前确认' },
      ], { className: 'yzj-runtime-observability-metrics', marginTop: 0 })}
      {loading && !runData ? (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Spin tip="正在加载真实智能体运行记录..." />
        </div>
      ) : null}
      <ProCard
        style={{ marginTop: 16 }}
        tabs={{
          items: [
            {
              key: 'runs',
              label: '运行记录',
              children: (
                <ProTable<AgentRunSummary>
                  rowKey="runId"
                  search={{ labelWidth: 'auto' }}
                  onSubmit={(params) => {
                    setRunFilters({
                      operatorName: typeof params.operatorName === 'string' ? params.operatorName : undefined,
                      status: typeof params.status === 'string' ? params.status : undefined,
                    });
                  }}
                  onReset={() => setRunFilters({})}
                  toolBarRender={() => [
                    <Button key="refresh" loading={loading} onClick={() => void loadData()}>
                      刷新
                    </Button>,
                  ]}
                  options={false}
                  columns={columns}
                  dataSource={runs}
                  pagination={false}
                  scroll={{ x: 1200 }}
                />
              ),
            },
            {
              key: 'confirmations',
              label: '确认审计',
              children: (
                <ProTable<AgentConfirmationAuditRow>
                  rowKey="confirmationId"
                  search={false}
                  toolBarRender={() => [
                    <Button
                      key="refresh-confirmations"
                      loading={confirmationLoading}
                      onClick={() => void loadConfirmations()}
                    >
                      刷新
                    </Button>,
                  ]}
                  options={false}
                  loading={confirmationLoading && !confirmationData}
                  pagination={false}
                  columns={confirmationColumns}
                  dataSource={confirmations}
                  scroll={{ x: 1200 }}
                />
              ),
            },
          ],
        }}
      />
      <Drawer
        width={880}
        open={Boolean(current) || detailLoading}
        onClose={() => {
          setCurrent(null);
          setCurrentProcess(null);
        }}
        title="运行观测详情"
      >
        {detailLoading && !current ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin tip="正在加载运行详情..." />
          </div>
        ) : current ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <ProDescriptions<AgentRunSummary> column={1} dataSource={current.run} bordered>
              <ProDescriptions.Item label="追踪编号" dataIndex="traceId" copyable />
              <ProDescriptions.Item label="运行编号" dataIndex="runId" copyable />
              <ProDescriptions.Item label="用户">{current.run.operatorName}</ProDescriptions.Item>
              <ProDescriptions.Item label="租户 / 应用">{`${current.run.eid} / ${current.run.appId}`}</ProDescriptions.Item>
              <ProDescriptions.Item label="用户输入" dataIndex="userInput" />
              <ProDescriptions.Item label="状态">{renderStatusTag(current.run.status)}</ProDescriptions.Item>
              <ProDescriptions.Item label="创建时间">
                {formatLocalDateTime(current.run.createdAt)}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="更新时间">
                {formatLocalDateTime(current.run.updatedAt)}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="上下文主体">
                {current.contextSubject?.name ?? '-'}
              </ProDescriptions.Item>
            </ProDescriptions>
            <ProCard
              bordered
              tabs={{
                items: [
                  {
                    key: 'flow',
                    label: '会话诊断',
                    children: (
                      <ConversationDiagnosticPanel
                        process={currentProcess}
                        currentRunId={current.run.runId}
                        loading={processLoading}
                        fallbackTrace={agentTrace}
                      />
                    ),
                  },
                  {
                    key: 'plan',
                    label: '计划',
                    children: planSteps.length ? (
                      <ProTable
                        rowKey={(record) => String(record.key)}
                        search={false}
                        toolBarRender={false}
                        options={false}
                        pagination={false}
                        columns={[
                          { title: '步骤', dataIndex: 'title' },
                          { title: '动作', dataIndex: 'actionType', width: 130 },
                          {
                            title: '工具',
                            render: (_, record) => Array.isArray(record.toolRefs) ? record.toolRefs.join(', ') : '-',
                          },
                          { title: '状态', dataIndex: 'status', width: 110 },
                        ]}
                        dataSource={planSteps}
                      />
                    ) : renderJson(current.taskPlan),
                  },
                  {
                    key: 'tools',
                    label: '工具调用',
                    children: (
                      <ProTable
                        rowKey="id"
                        search={false}
                        toolBarRender={false}
                        options={false}
                        pagination={false}
                        columns={detailToolColumns}
                        dataSource={current.toolCalls}
                      />
                    ),
                  },
                  {
                    key: 'process',
                    label: '完整过程',
                    children: processLoading ? (
                      <div style={{ padding: 24, textAlign: 'center' }}>
                        <Spin tip="正在加载会话完整过程..." />
                      </div>
                    ) : currentProcess ? (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <ProTable<AgentConversationProcessResponse['messages'][number]>
                          rowKey="messageId"
                          headerTitle="会话消息"
                          search={false}
                          toolBarRender={false}
                          options={false}
                          pagination={false}
                          columns={processMessageColumns}
                          dataSource={currentProcess.messages}
                          scroll={{ x: 1000 }}
                        />
                        <ProTable<AgentRunSummary>
                          rowKey="runId"
                          headerTitle="会话运行"
                          search={false}
                          toolBarRender={false}
                          options={false}
                          pagination={false}
                          columns={columns}
                          dataSource={currentProcess.runs}
                          scroll={{ x: 1200 }}
                        />
                        <ProTable<AgentConversationProcessResponse['toolCalls'][number]>
                          rowKey="id"
                          headerTitle="会话工具调用"
                          search={false}
                          toolBarRender={false}
                          options={false}
                          pagination={false}
                          columns={processToolColumns}
                          dataSource={currentProcess.toolCalls}
                          scroll={{ x: 1200 }}
                        />
                        <ProTable<AgentConfirmationAuditRow>
                          rowKey="confirmationId"
                          headerTitle="会话确认审计"
                          search={false}
                          toolBarRender={false}
                          options={false}
                          pagination={false}
                          columns={confirmationColumns}
                          dataSource={currentProcess.confirmations}
                          scroll={{ x: 1200 }}
                        />
                      </Space>
                    ) : (
                      <Empty description="当前会话没有完整过程记录" />
                    ),
                  },
                  {
                    key: 'confirmations',
                    label: '确认审计',
                    children: current.confirmations.length ? (
                      <ProTable<AgentConfirmationAuditRow>
                        rowKey="confirmationId"
                        search={false}
                        toolBarRender={false}
                        options={false}
                        pagination={false}
                        columns={confirmationColumns}
                        dataSource={current.confirmations}
                      />
                    ) : (
                      <Empty description="当前运行没有确认审计记录" />
                    ),
                  },
                  {
                    key: 'evidence',
                    label: '证据',
                    children: current.evidenceRefs.length ? (
                      <List
                        dataSource={current.evidenceRefs}
                        renderItem={(item) => (
                          <List.Item>
                            <List.Item.Meta
                              title={<Space wrap><Text strong>{item.title}</Text><Tag>{item.sourceToolCode}</Tag></Space>}
                              description={item.snippet}
                            />
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Empty description="当前运行没有证据引用" />
                    ),
                  },
                  {
                    key: 'json',
                    label: '原始追踪',
                    children: renderJson(current),
                  },
                ],
              }}
            />
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}

export default function AgentGovernancePage() {
  const location = useLocation();
  const pageKey = getPageKey(location.pathname);

  if (!pageKey) {
    return <Result status="404" title="智能体治理页面不存在" />;
  }

  const meta = pageMeta[pageKey];
  const content = {
    'tools-objects': <ToolsObjectsView />,
    'runtime-observability': <RuntimeObservabilityView />,
  }[pageKey] ?? <Empty />;

  return (
    <PageContainer
      title={meta.title}
      subTitle={meta.subTitle}
      className={pageKey === 'runtime-observability' ? 'yzj-runtime-observability-page' : undefined}
    >
      {content}
    </PageContainer>
  );
}
