import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
} from '@ant-design/pro-components';
import { Alert, List, Space, Tag, Typography } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import { systemAlerts, systemHealth, tenantContext, traceLogs } from '@shared';

const { Paragraph, Text } = Typography;

type TraceRow = (typeof traceLogs)[number];

const columns: ProColumns<TraceRow>[] = [
  { title: '追踪ID', dataIndex: 'traceId', copyable: true, width: 190 },
  { title: '任务ID', dataIndex: 'taskId', copyable: true, width: 140 },
  { title: '租户ID', dataIndex: 'eid', width: 170 },
  { title: '应用ID', dataIndex: 'appId', width: 170 },
  { title: '场景', dataIndex: 'scene', width: 180 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={record.status === '成功' ? 'success' : 'warning'}>{record.status}</Tag>
    ),
  },
  {
    title: '工具调用链',
    dataIndex: 'toolChain',
    render: (_, record) => record.toolChain.join(' -> '),
  },
  { title: '写回结果', dataIndex: 'writebackResult' },
];

const MonitorPage = () => {
  return (
    <PageContainer
      title="运行监控"
      subTitle="聚焦场景任务状态、追踪上下文、工具调用链和异常告警"
    >
      <Alert
        type="info"
        showIcon
        message="监控口径"
        description="所有运行指标均围绕真实业务链路：会话任务 -> 技能编排 -> 资产沉淀 -> 确认写回，而不是传统站点访问量仪表盘。"
      />

      <ProCard split="vertical" style={{ marginTop: 16 }}>
        <ProCard title="租户上下文" colSpan="35%">
          <ProDescriptions column={1} dataSource={tenantContext}>
            <ProDescriptions.Item label="租户名称" dataIndex="tenantName" />
            <ProDescriptions.Item label="租户ID" dataIndex="eid" />
            <ProDescriptions.Item label="应用ID" dataIndex="appId" />
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
        <ProTable<TraceRow>
          rowKey="traceId"
          search={false}
          toolBarRender={false}
          options={false}
          pagination={false}
          columns={columns}
          dataSource={traceLogs}
          scroll={{ x: 1400 }}
        />
      </ProCard>
    </PageContainer>
  );
};

export default MonitorPage;
