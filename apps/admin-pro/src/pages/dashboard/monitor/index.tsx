import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
} from '@ant-design/pro-components';
import { Alert, Button, List, Space, Tag, Typography } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import { useCallback, useEffect, useState } from 'react';
import type { AgentRunListResponse, AgentRunSummary } from '@shared';
import { systemAlerts, systemHealth, tenantContext } from '@shared';
import { requestJson } from '@/utils/request';

const { Paragraph, Text } = Typography;

const statusMeta: Record<string, { label: string; color: string }> = {
  running: { label: '运行中', color: 'processing' },
  waiting_input: { label: '待补充', color: 'warning' },
  waiting_selection: { label: '待选择', color: 'warning' },
  waiting_confirmation: { label: '待确认', color: 'warning' },
  completed: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  tool_unavailable: { label: '工具不可用', color: 'error' },
};

const columns: ProColumns<AgentRunSummary>[] = [
  { title: '追踪编号', dataIndex: 'traceId', copyable: true, width: 210 },
  { title: '运行编号', dataIndex: 'runId', copyable: true, width: 210 },
  { title: '租户编号', dataIndex: 'eid', width: 170 },
  { title: '应用编号', dataIndex: 'appId', width: 170 },
  { title: '场景', dataIndex: 'sceneKey', width: 150 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => {
      const meta = statusMeta[record.status] ?? { label: record.status, color: 'default' };
      return <Tag color={meta.color}>{meta.label}</Tag>;
    },
  },
  { title: '用户输入', dataIndex: 'userInput', ellipsis: true },
  { title: '计划', dataIndex: 'planTitle', ellipsis: true },
  { title: '工具调用', dataIndex: 'toolCallCount', width: 100 },
  { title: '待确认', dataIndex: 'pendingConfirmationCount', width: 100 },
  { title: '时间', dataIndex: 'createdAt', width: 190 },
];

const MonitorPage = () => {
  const [runData, setRunData] = useState<AgentRunListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadRuns = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      setRunData(await requestJson<AgentRunListResponse>('/api/agent/runs?page=1&pageSize=10'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '运行记录加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const runRows = runData?.items ?? [];

  return (
    <PageContainer
      title="运行监控"
      subTitle="聚焦智能体计划状态、追踪上下文、工具调用链和异常告警"
    >
      <Alert
        type="info"
        showIcon
        message="监控口径"
        description="所有运行指标均围绕真实业务链路：用户输入 -> 意图帧 -> 任务计划 -> 工具调用 -> 确认写回，而不是传统站点访问量仪表盘。"
      />

      <ProCard split="vertical" style={{ marginTop: 16 }}>
        <ProCard title="租户上下文" colSpan="35%">
          <ProDescriptions column={1} dataSource={tenantContext}>
            <ProDescriptions.Item label="租户名称" dataIndex="tenantName" />
            <ProDescriptions.Item label="租户编号" dataIndex="eid" />
            <ProDescriptions.Item label="应用编号" dataIndex="appId" />
            <ProDescriptions.Item label="接入状态" dataIndex="accessStatus" />
            <ProDescriptions.Item label="组织同步" dataIndex="orgSyncStatus" />
            <ProDescriptions.Item label="最近心跳" dataIndex="lastHeartbeatAt" />
          </ProDescriptions>
        </ProCard>
        <ProCard title="服务健康度" colSpan="30%">
          <List
            dataSource={systemHealth}
            renderItem={(item) => (
              <List.Item style={{ alignItems: 'flex-start' }}>
                <div
                  style={{
                    alignItems: 'flex-start',
                    display: 'flex',
                    gap: 16,
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong>{item.name}</Text>
                    <div>
                      <Text type="secondary">{item.description}</Text>
                    </div>
                  </div>
                  <Space orientation="vertical" size={4} align="end">
                    <Tag
                      color={
                        item.status === 'healthy'
                          ? 'success'
                          : item.status === 'attention'
                            ? 'warning'
                            : 'error'
                      }
                    >
                      {item.value}
                    </Tag>
                    <Text type="secondary">{item.target}</Text>
                  </Space>
                </div>
              </List.Item>
            )}
          />
        </ProCard>
        <ProCard title="最新异常" colSpan="35%">
          <List
            itemLayout="vertical"
            dataSource={systemAlerts}
            renderItem={(item) => (
              <List.Item>
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={item.severity === '高' ? 'red' : 'orange'}>{item.severity}</Tag>
                    <Text strong>{item.title}</Text>
                  </Space>
                  <Text type="secondary">{`负责人：${item.owner} · 更新时间：${item.updatedAt}`}</Text>
                </Space>
                <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph>
              </List.Item>
            )}
          />
        </ProCard>
      </ProCard>

      <ProCard title="追踪明细" style={{ marginTop: 16 }}>
        <ProTable<AgentRunSummary>
          rowKey="runId"
          search={false}
          loading={loading}
          toolBarRender={() => [
            <Button key="refresh" loading={loading} onClick={() => void loadRuns()}>
              刷新
            </Button>,
          ]}
          options={false}
          pagination={false}
          columns={columns}
          dataSource={runRows}
          scroll={{ x: 1400 }}
        />
        {errorMessage ? (
          <Alert
            type="error"
            showIcon
            message="真实运行记录加载失败"
            description={errorMessage}
            style={{ marginTop: 16 }}
          />
        ) : null}
      </ProCard>
    </PageContainer>
  );
};

export default MonitorPage;
