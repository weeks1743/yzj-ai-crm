import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Button, Drawer, Empty, List, Result, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  AgentConfirmationAuditRow,
  AgentConfirmationListResponse,
  AgentPlanTemplate,
  AgentPolicy,
  AgentRunDetailResponse,
  AgentRunListResponse,
  AgentRunSummary,
  AgentToolRow,
} from '@shared';
import {
  agentPlanTemplates,
  agentPolicies,
  agentToolRows,
} from '@shared';
import { requestJson } from '@/utils/request';

const { Paragraph, Text } = Typography;

type GovernancePageKey =
  | 'tools-objects'
  | 'plan-templates'
  | 'policies-confirmation'
  | 'runtime-observability';

const pageMeta: Record<GovernancePageKey, { title: string; subTitle: string }> = {
  'tools-objects': {
    title: '工具与对象',
    subTitle: '统一治理工具注册表、记录对象、外部工具和元工具。',
  },
  'plan-templates': {
    title: '计划模板',
    subTitle: '管理可推荐给任务计划的模板，不配置固定场景工作流。',
  },
  'policies-confirmation': {
    title: '策略与确认',
    subTitle: '治理写回确认、字段风险、证据要求和跨租户守卫。',
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

const policyActionLabels: Record<AgentPolicy['action'], string> = {
  block: '阻断',
  require_confirmation: '要求确认',
  clarify: '要求澄清',
  downgrade_to_draft: '降级草稿',
  audit: '记录审计',
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

function getPageKey(pathname: string): GovernancePageKey | null {
  const key = pathname.split('/').filter(Boolean).pop();
  return key && key in pageMeta ? (key as GovernancePageKey) : null;
}

function renderMetricCards(items: Array<{ key: string; title: string; value: string; helper: string }>) {
  return (
    <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
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
      <Alert
        type="info"
        showIcon
        message="工具注册表"
        description="这里展示智能体可选择的通用工具。工具可以服务 CRM 样例，但不以固定业务流程作为运行时分类。"
      />
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

function PlanTemplatesView() {
  const [current, setCurrent] = useState<AgentPlanTemplate | null>(null);
  const columns: ProColumns<AgentPlanTemplate>[] = [
    {
      title: '模板名称',
      dataIndex: 'name',
      render: (_, record) => <a onClick={() => setCurrent(record)}>{record.name}</a>,
    },
    { title: '适用意图', dataIndex: 'intentPattern', width: 260 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => (
        <Tag color={record.status === 'enabled' ? 'success' : 'default'}>
          {record.status === 'enabled' ? '启用' : '草稿'}
        </Tag>
      ),
    },
    {
      title: '步骤数',
      width: 90,
      render: (_, record) => record.steps.length,
    },
    {
      title: '涉及工具',
      render: (_, record) => Array.from(new Set(record.steps.flatMap((step) => step.toolRefs))).join(', '),
    },
  ];

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="计划模板不是固定工作流"
        description="模板只给任务计划提供推荐步骤、确认点和可跳过选项；智能体仍基于意图帧动态选择工具。"
      />
      {renderMetricCards([
        { key: 'templates', title: '计划模板', value: `${agentPlanTemplates.length}`, helper: '当前静态治理模板' },
        {
          key: 'steps',
          title: '推荐步骤',
          value: `${agentPlanTemplates.reduce((sum, item) => sum + item.steps.length, 0)}`,
          helper: '均可被用户裁剪或跳过',
        },
        { key: 'enabled', title: '启用模板', value: `${agentPlanTemplates.filter((item) => item.status === 'enabled').length}`, helper: '可被 /计划 推荐' },
      ])}
      <ProTable<AgentPlanTemplate>
        style={{ marginTop: 16 }}
        rowKey="id"
        search={false}
        toolBarRender={false}
        columns={columns}
        dataSource={agentPlanTemplates}
      />
      <Drawer
        width={760}
        open={Boolean(current)}
        onClose={() => setCurrent(null)}
        title="计划模板详情"
      >
        {current ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Paragraph>{current.summary}</Paragraph>
            <ProCard title="示例输入" bordered>
              <Space wrap>
                {current.sampleUtterances.map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </Space>
            </ProCard>
            <ProCard title="推荐步骤" bordered>
              <List
                dataSource={current.steps}
                renderItem={(step) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <Text strong>{step.title}</Text>
                          <Tag>{step.actionType}</Tag>
                          {step.required ? <Tag color="blue">必选</Tag> : <Tag>可选</Tag>}
                          {step.skippable ? <Tag color="green">可跳过</Tag> : null}
                          {step.confirmationRequired ? <Tag color="red">需确认</Tag> : null}
                        </Space>
                      }
                      description={step.toolRefs.join(', ')}
                    />
                  </List.Item>
                )}
              />
            </ProCard>
            <ProCard title="治理说明" bordered>
              <List
                dataSource={current.governanceNotes}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </ProCard>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}

function PoliciesConfirmationView() {
  const [current, setCurrent] = useState<AgentPolicy | null>(null);
  const columns: ProColumns<AgentPolicy>[] = [
    {
      title: '策略',
      dataIndex: 'name',
      render: (_, record) => <a onClick={() => setCurrent(record)}>{record.name}</a>,
    },
    { title: '适用范围', dataIndex: 'target', width: 260 },
    { title: '触发条件', dataIndex: 'trigger' },
    {
      title: '动作',
      dataIndex: 'action',
      width: 130,
      render: (_, record) => <Tag>{policyActionLabels[record.action]}</Tag>,
    },
    {
      title: '风险',
      dataIndex: 'severity',
      width: 100,
      render: (_, record) => <Tag color={riskColor[record.severity]}>{record.severity}</Tag>,
    },
    { title: '负责人', dataIndex: 'owner', width: 130 },
    { title: '最近触发', dataIndex: 'lastTriggered', width: 170 },
  ];

  return (
    <>
      <Alert
        type="warning"
        showIcon
        message="确定性守卫"
        description="策略与确认是智能体的硬边界：写入、证据、跨租户、MVP 禁用能力都在这里治理。"
      />
      {renderMetricCards([
        { key: 'policies', title: '策略数', value: `${agentPolicies.length}`, helper: '确认、阻断、审计与降级' },
        { key: 'high', title: '高风险策略', value: `${agentPolicies.filter((item) => item.severity === 'high').length}`, helper: '必须强制执行' },
        { key: 'confirm', title: '确认类策略', value: `${agentPolicies.filter((item) => item.action === 'require_confirmation').length}`, helper: '写入前确认' },
      ])}
      <ProTable<AgentPolicy>
        style={{ marginTop: 16 }}
        rowKey="id"
        search={false}
        toolBarRender={false}
        columns={columns}
        dataSource={agentPolicies}
      />
      <Drawer
        width={680}
        open={Boolean(current)}
        onClose={() => setCurrent(null)}
        title="策略详情"
      >
        {current ? (
          <ProDescriptions<AgentPolicy> column={1} dataSource={current}>
            <ProDescriptions.Item label="策略名称" dataIndex="name" />
            <ProDescriptions.Item label="适用范围" dataIndex="target" />
            <ProDescriptions.Item label="触发条件" dataIndex="trigger" />
            <ProDescriptions.Item label="动作">{policyActionLabels[current.action]}</ProDescriptions.Item>
            <ProDescriptions.Item label="风险等级">{current.severity}</ProDescriptions.Item>
            <ProDescriptions.Item label="负责人" dataIndex="owner" />
            <ProDescriptions.Item label="最近触发" dataIndex="lastTriggered" />
          </ProDescriptions>
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
  const [runData, setRunData] = useState<AgentRunListResponse | null>(null);
  const [confirmationData, setConfirmationData] = useState<AgentConfirmationListResponse | null>(null);
  const [current, setCurrent] = useState<AgentRunDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true);
    try {
      setCurrent(await requestJson<AgentRunDetailResponse>(`/api/agent/runs/${encodeURIComponent(runId)}`));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '运行详情加载失败');
    } finally {
      setDetailLoading(false);
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
  }, [loadRunDetail, traceIdFromQuery]);

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
      render: (_, record) => <a onClick={() => void loadRunDetail(record.runId)}>{record.traceId}</a>,
    },
    { title: '用户输入', dataIndex: 'userInput', ellipsis: true },
    { title: '目标', dataIndex: 'goal', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, record) => renderStatusTag(record.status),
    },
    { title: '计划', dataIndex: 'planTitle', ellipsis: true },
    {
      title: '工具',
      width: 90,
      render: (_, record) => record.toolCallCount,
    },
    {
      title: '待确认',
      width: 100,
      render: (_, record) => (
        record.pendingConfirmationCount ? <Tag color="warning">{record.pendingConfirmationCount}</Tag> : '-'
      ),
    },
    { title: '场景', dataIndex: 'sceneKey', width: 130 },
    { title: '时间', dataIndex: 'createdAt', width: 190 },
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
    { title: '创建时间', dataIndex: 'createdAt', width: 190 },
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

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="智能体运行观测"
        description={
          traceIdFromQuery
            ? `已按用户 AI 端传入的追踪编号过滤：${traceIdFromQuery}`
            : '这里看的是用户意图如何落成计划、计划如何选择工具、执行如何进入等待确认或挂起状态。'
        }
      />
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
      ])}
      {loading && !runData ? (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Spin tip="正在加载真实智能体运行记录..." />
        </div>
      ) : null}
      <ProTable<AgentRunSummary>
        style={{ marginTop: 16 }}
        rowKey="runId"
        search={false}
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
      <ProCard title="确认审计" style={{ marginTop: 16 }}>
        <ProTable<AgentConfirmationAuditRow>
          rowKey="confirmationId"
          search={false}
          toolBarRender={() => [
            <Button key="refresh-confirmations" loading={confirmationLoading} onClick={() => void loadConfirmations()}>
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
      </ProCard>
      <Drawer
        width={880}
        open={Boolean(current) || detailLoading}
        onClose={() => setCurrent(null)}
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
              <ProDescriptions.Item label="租户 / 应用">{`${current.run.eid} / ${current.run.appId}`}</ProDescriptions.Item>
              <ProDescriptions.Item label="用户输入" dataIndex="userInput" />
              <ProDescriptions.Item label="状态">{renderStatusTag(current.run.status)}</ProDescriptions.Item>
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
                    label: '运行流程',
                    children: <RunFlowChart agentTrace={agentTrace} />,
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
    'plan-templates': <PlanTemplatesView />,
    'policies-confirmation': <PoliciesConfirmationView />,
    'runtime-observability': <RuntimeObservabilityView />,
  }[pageKey] ?? <Empty />;

  return (
    <PageContainer title={meta.title} subTitle={meta.subTitle}>
      {content}
    </PageContainer>
  );
}
