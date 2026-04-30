import {
  FundProjectionScreenOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ThoughtChainItemProps } from '@ant-design/x';
import { ThoughtChain } from '@ant-design/x';
import { Alert, Button, Card, Drawer, Empty, List, Space, Tag, Tabs, Typography } from 'antd';
import { createStyles } from 'antd-style';
import type {
  AssistantChatMessage,
  AssistantEvidenceCard,
  AssistantRecordWritePreviewRow,
} from './agent-api-provider';

const { Paragraph, Text } = Typography;

type AgentTrace = NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']>;

interface RunInsightScene {
  key: string;
  title: string;
  subtitle: string;
  description: string;
}

interface RunInsightTenantContext {
  tenantName: string;
  eidLabel: string;
  appIdLabel: string;
}

interface RunInsightDrawerProps {
  open: boolean;
  onClose: () => void;
  scene: RunInsightScene;
  sourceTags: string[];
  slashCommand: string;
  tenantContext: RunInsightTenantContext;
  agentTrace?: AgentTrace;
  evidence?: AssistantEvidenceCard[];
  adminBaseUrl: string;
}

const useStyles = createStyles(({ token, css }) => ({
  insightCard: css`
    border-radius: 8px;
    margin-bottom: 12px;
    box-shadow: none;
  `,
  tagWrap: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  summaryGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
    }
  `,
  summaryItem: css`
    min-width: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 10px 12px;
    background: ${token.colorFillQuaternary};
  `,
  mutedBlock: css`
    border: 1px dashed ${token.colorBorder};
    border-radius: 8px;
    padding: 12px;
    color: ${token.colorTextSecondary};
    background: ${token.colorFillQuaternary};
  `,
  flowCanvas: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  flowNode: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 12px;
    background: ${token.colorBgContainer};
  `,
  flowNodeHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  `,
  flowNodeDetails: css`
    margin-top: 8px;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    word-break: break-word;
  `,
  flowConnector: css`
    width: 1px;
    height: 18px;
    margin-left: 20px;
    background: ${token.colorBorder};
    position: relative;

    &::after {
      content: '';
      position: absolute;
      left: -4px;
      bottom: -1px;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid ${token.colorBorder};
    }
  `,
  jsonText: css`
    margin-bottom: 0;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  `,
}));

const executionStatusMeta: Record<string, { label: string; color: string }> = {
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

function mapPlanStepStatus(status?: string): ThoughtChainItemProps['status'] | undefined {
  if (status === 'succeeded') {
    return 'success';
  }
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'running') {
    return 'loading';
  }
  if (status === 'skipped') {
    return 'abort';
  }
  return undefined;
}

function renderExecutionStatus(status?: string) {
  if (!status) {
    return <Tag>暂无状态</Tag>;
  }
  const meta = executionStatusMeta[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function renderJson(value: unknown, className: string) {
  return (
    <Paragraph copyable className={className}>
      {JSON.stringify(value, null, 2)}
    </Paragraph>
  );
}

function renderSummaryRows(rows?: AssistantRecordWritePreviewRow[]) {
  if (!rows?.length) {
    return null;
  }
  return (
    <List
      size="small"
      dataSource={rows}
      renderItem={(row) => (
        <List.Item>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space wrap>
              <Text strong>{row.label}</Text>
              {row.source ? <Tag>{row.source}</Tag> : null}
            </Space>
            <Text type="secondary">{row.value || row.reason || '-'}</Text>
          </Space>
        </List.Item>
      )}
    />
  );
}

interface RunFlowNode {
  key: string;
  title: string;
  status: 'success' | 'warning' | 'error' | 'processing' | 'default';
  summary: string;
  details?: string;
}

function RunInsightFlow({
  agentTrace,
  styles,
}: {
  agentTrace: AgentTrace;
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  const nodes = buildRunFlowNodes(agentTrace);
  return (
    <div className={styles.flowCanvas}>
      {nodes.map((node, index) => (
        <div key={node.key}>
          <div className={styles.flowNode}>
            <div className={styles.flowNodeHeader}>
              <Text strong>{node.title}</Text>
              <Tag color={flowStatusColor[node.status]}>{flowStatusText[node.status]}</Tag>
            </div>
            <Text>{node.summary}</Text>
            {node.details ? <div className={styles.flowNodeDetails}>{node.details}</div> : null}
          </div>
          {index < nodes.length - 1 ? <div className={styles.flowConnector} /> : null}
        </div>
      ))}
    </div>
  );
}

const flowStatusText = {
  success: '通过',
  warning: '待处理',
  error: '阻断',
  processing: '运行',
  default: '记录',
};

const flowStatusColor = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  processing: 'processing',
  default: 'default',
};

function buildRunFlowNodes(agentTrace: AgentTrace): RunFlowNode[] {
  const selectedTool = agentTrace.selectedTool;
  const toolCalls = agentTrace.toolCalls ?? [];
  const policyDecisions = agentTrace.policyDecisions ?? [];
  const lastToolCall = toolCalls[toolCalls.length - 1];
  const blockingPolicy = [...policyDecisions].reverse().find((item: any) => item.action && item.action !== 'audit');
  const params = readSelectedToolParams(selectedTool?.input);
  const paramsEmpty = selectedTool?.toolCode?.includes('.preview_') && Object.keys(params).length === 0;
  const emptyGuard = policyDecisions.some((item: any) => item.policyCode === 'record.preview_empty_payload_guard');
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
      summary: selectedTool
        ? summarizeSelectedToolInput(selectedTool.input)
        : '暂无工具输入',
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
        : agentTrace.executionState?.status?.startsWith('waiting_')
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

function readSelectedToolParams(input?: Record<string, unknown>): Record<string, unknown> {
  const params = input?.params;
  return params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

export function summarizeSelectedToolInput(input?: Record<string, unknown>): string {
  if (!input) {
    return '暂无工具输入';
  }
  const filters = Array.isArray(input.filters) ? input.filters : null;
  if (filters) {
    const filterText = filters.length
      ? `查询过滤：${filters.map(formatSearchFilter).join('、')}`
      : '查询过滤：无';
    const sourceText = summarizeSearchFilterSources(input);
    const targetText = summarizeTargetSanitization(input);
    return [filterText, sourceText, targetText].filter(Boolean).join('；');
  }
  const formInstId = typeof input.formInstId === 'string' && input.formInstId ? '已绑定记录' : '';
  const params = readSelectedToolParams(input);
  const paramKeys = Object.keys(params);
  const paramsText = paramKeys.length ? `写入字段：${paramKeys.join('、')}` : '写入字段：无';
  return [formInstId, paramsText].filter(Boolean).join('；') || JSON.stringify(input);
}

export function summarizeContextFlow(agentTrace: AgentTrace): Pick<RunFlowNode, 'status' | 'summary' | 'details'> {
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

function formatContextSubject(subject: { kind?: string; type?: string; id?: string; name?: string }): string {
  return `${subject.type ?? subject.kind ?? 'subject'}：${subject.name ?? subject.id ?? '-'}`;
}

function formatCandidateOnlyDetails(agentTrace: AgentTrace): string | undefined {
  const reason = agentTrace.resolvedContext?.reason || agentTrace.semanticResolution?.reason;
  const candidate = agentTrace.semanticResolution?.selectedCandidate?.subject;
  const candidateText = candidate ? `候选未承接：${formatContextSubject(candidate)}` : '';
  return [reason, candidateText].filter(Boolean).join('；') || undefined;
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

function buildAdminTraceUrl(adminBaseUrl: string, traceId: string) {
  const baseUrl = adminBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/agent-governance/runtime-observability?traceId=${encodeURIComponent(traceId)}`;
}

export function RunInsightDrawer({
  open,
  onClose,
  scene,
  sourceTags,
  slashCommand,
  tenantContext,
  agentTrace,
  evidence = [],
  adminBaseUrl,
}: RunInsightDrawerProps) {
  const { styles } = useStyles();
  const traceId = agentTrace?.traceId;
  const executionState = agentTrace?.executionState;
  const taskPlan = agentTrace?.taskPlan;
  const intentFrame = agentTrace?.intentFrame;
  const planSteps = Array.isArray(taskPlan?.steps) ? taskPlan.steps : [];
  const toolCalls = agentTrace?.toolCalls ?? [];
  const policyDecisions = agentTrace?.policyDecisions ?? [];
  const pendingConfirmation = agentTrace?.pendingConfirmation;
  const pendingInteraction = agentTrace?.pendingInteraction;
  const toolArbitration = agentTrace?.toolArbitration;
  const adminTraceUrl = traceId ? buildAdminTraceUrl(adminBaseUrl, traceId) : '';

  return (
    <Drawer
      title="运行洞察"
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
      extra={
        <Button
          icon={<FundProjectionScreenOutlined />}
          disabled={!traceId}
          onClick={() => {
            if (adminTraceUrl) {
              window.open(adminTraceUrl, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          后台排查
        </Button>
      }
    >
      {!agentTrace ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发送请求后会展示真实智能体运行洞察" />
      ) : (
        <Tabs
          items={[
            {
              key: 'overview',
              label: '总览',
              children: (
                <>
                  <Card className={styles.insightCard} title="运行状态">
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Space wrap>
                        {renderExecutionStatus(executionState?.status)}
                        {traceId ? <Text copyable>{traceId}</Text> : null}
                      </Space>
                      <Text>{executionState?.message || '暂无执行摘要'}</Text>
                      <div className={styles.summaryGrid}>
                        <div className={styles.summaryItem}>
                          <Text type="secondary">当前步骤</Text>
                          <div><Text strong>{executionState?.currentStepKey || '-'}</Text></div>
                        </div>
                        <div className={styles.summaryItem}>
                          <Text type="secondary">计划类型</Text>
                          <div><Text strong>{taskPlan?.kind || '-'}</Text></div>
                        </div>
                      </div>
                    </Space>
                  </Card>
                  <Card className={styles.insightCard} title="当前上下文">
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{scene.title}</Text>
                        <Tag color={scene.key === 'chat' ? 'cyan' : 'purple'}>{slashCommand}</Tag>
                      </Space>
                      <Text type="secondary">{scene.subtitle}</Text>
                      <Text>{scene.description}</Text>
                      <div className={styles.tagWrap}>
                        {sourceTags.map((item) => <Tag key={item} color="blue">{item}</Tag>)}
                      </div>
                      <Text type="secondary">
                        {tenantContext.tenantName} · eid: {tenantContext.eidLabel} · appId: {tenantContext.appIdLabel}
                      </Text>
                    </Space>
                  </Card>
                  <Card
                    className={styles.insightCard}
                    title={<Space><SafetyCertificateOutlined />策略说明</Space>}
                  >
                    {policyDecisions.length ? (
                      <List
                        size="small"
                        dataSource={policyDecisions}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space wrap>
                                <Text strong>{item.policyCode}</Text>
                                <Tag>{item.action}</Tag>
                              </Space>
                              <Text type="secondary">{item.reason}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <div className={styles.mutedBlock}>暂无策略记录</div>
                    )}
                  </Card>
                </>
              ),
            },
            {
              key: 'flow',
              label: '运行流程',
              children: (
                <Card className={styles.insightCard} title="诊断流程图">
                  <RunInsightFlow agentTrace={agentTrace} styles={styles} />
                </Card>
              ),
            },
                  {
                    key: 'plan',
                    label: '计划',
              children: (
                <>
                  <Card className={styles.insightCard} title={taskPlan?.title || '任务计划'}>
                    {planSteps.length ? (
                      <ThoughtChain
                        line="dashed"
                        items={planSteps.map((step: any, index: number) => ({
                          key: step.key ?? `step-${index}`,
                          title: step.title ?? `步骤 ${index + 1}`,
                          description: Array.isArray(step.toolRefs) ? step.toolRefs.join(' / ') : step.status,
                          status: mapPlanStepStatus(step.status),
                          blink: step.status === 'running',
                        }))}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无计划步骤" />
                    )}
                  </Card>
                  <Card className={styles.insightCard} title="意图帧">
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Text>{intentFrame?.goal || '-'}</Text>
                      <Space wrap>
                        <Tag>{intentFrame?.actionType || 'unknown'}</Tag>
                        <Tag>{intentFrame?.targetType || 'unknown'}</Tag>
                        {intentFrame?.source ? <Tag>{intentFrame.source}</Tag> : null}
                      </Space>
                      <div className={styles.tagWrap}>
                        {(intentFrame?.targets ?? []).map((target: any, index: number) => (
                          <Tag key={`${target.type}-${target.id}-${index}`} color="blue">
                            {target.name || target.type}
                          </Tag>
                        ))}
                        {(intentFrame?.missingSlots ?? []).map((slot: string) => (
                          <Tag key={slot} color="warning">{slot}</Tag>
                        ))}
                      </div>
                    </Space>
                  </Card>
                </>
              ),
            },
            {
              key: 'tools',
              label: '工具 / 证据',
              children: (
                <>
                  <Card className={styles.insightCard} title={<Space><ToolOutlined />工具调用</Space>}>
                    {toolCalls.length ? (
                      <List
                        dataSource={toolCalls}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Space wrap>
                                <Text strong>{item.toolCode}</Text>
                                <Tag color={item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'error' : 'processing'}>
                                  {item.status}
                                </Tag>
                              </Space>
                              {item.inputSummary ? <Text type="secondary">输入：{item.inputSummary}</Text> : null}
                              {item.outputSummary ? <Text>输出：{item.outputSummary}</Text> : null}
                              {item.errorMessage ? <Alert type="error" showIcon message={item.errorMessage} /> : null}
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工具调用" />
                    )}
                  </Card>
                  <Card className={styles.insightCard} title="证据">
                    {evidence.length ? (
                      <List
                        dataSource={evidence}
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
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据引用" />
                    )}
                  </Card>
                </>
              ),
            },
            {
              key: 'state',
              label: '确认 / 等待',
              children: (
                <>
                  <Card className={styles.insightCard} title="待确认写回">
                    {pendingConfirmation ? (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Space wrap>
                          <Text strong>{pendingConfirmation.title}</Text>
                          <Tag color="warning">{pendingConfirmation.status}</Tag>
                        </Space>
                        <Text>{pendingConfirmation.summary}</Text>
                        {renderSummaryRows(pendingConfirmation.userPreview?.summaryRows)}
                        {renderSummaryRows(pendingConfirmation.userPreview?.missingRequiredRows)}
                        {renderSummaryRows(pendingConfirmation.userPreview?.blockedRows)}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待确认写回" />
                    )}
                  </Card>
                  <Card className={styles.insightCard} title="等待态 / 承接">
                    {pendingInteraction || agentTrace.continuationResolution ? (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        {pendingInteraction ? (
                          <>
                            <Space wrap>
                              <Text strong>{pendingInteraction.title}</Text>
                              <Tag>{pendingInteraction.kind}</Tag>
                              <Tag color="warning">{pendingInteraction.status}</Tag>
                            </Space>
                            <Text>{pendingInteraction.summary}</Text>
                            {renderSummaryRows(pendingInteraction.missingRows)}
                            {renderSummaryRows(pendingInteraction.blockedRows)}
                          </>
                        ) : null}
                        {agentTrace.continuationResolution ? (
                          <Alert
                            type={agentTrace.continuationResolution.usedContinuation ? 'success' : 'info'}
                            showIcon
                            message={agentTrace.continuationResolution.action}
                            description={agentTrace.continuationResolution.reason}
                          />
                        ) : null}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无等待态或承接记录" />
                    )}
                  </Card>
                  <Card className={styles.insightCard} title="工具语义仲裁">
                    {toolArbitration ? (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color="blue">{toolArbitration.action}</Tag>
                          <Tag>{toolArbitration.conflictGroup}</Tag>
                          {toolArbitration.selectedToolCode ? <Tag color="success">{toolArbitration.selectedToolCode}</Tag> : null}
                        </Space>
                        <Text>{toolArbitration.reason}</Text>
                        <div className={styles.tagWrap}>
                          {toolArbitration.candidateTools.map((item) => (
                            <Tag key={item.toolCode}>{item.toolCode}</Tag>
                          ))}
                        </div>
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工具语义仲裁记录" />
                    )}
                  </Card>
                </>
              ),
            },
            {
              key: 'raw',
              label: '原始追踪',
              children: renderJson(agentTrace, styles.jsonText),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
