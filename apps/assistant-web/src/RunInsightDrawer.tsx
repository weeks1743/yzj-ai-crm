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
