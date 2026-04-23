import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
} from '@ant-design/pro-components';
import { Alert, List, Space, Tag, Typography } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import { systemAlerts, systemHealth, tenantContext, traceLogs } from '@shared';

const { Paragraph } = Typography;

type TraceRow = (typeof traceLogs)[number];

const columns: ProColumns<TraceRow>[] = [
  { title: 'traceId', dataIndex: 'traceId', copyable: true, width: 190 },
  { title: 'taskId', dataIndex: 'taskId', copyable: true, width: 140 },
  { title: 'eid', dataIndex: 'eid', width: 170 },
  { title: 'appId', dataIndex: 'appId', width: 170 },
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
    title: 'Tool 调用链',
    dataIndex: 'toolChain',
    render: (_, record) => record.toolChain.join(' -> '),
  },
  { title: '写回结果', dataIndex: 'writebackResult' },
];

const MonitorPage = () => {
  return (
    <PageContainer
      title="运行监控"
      subTitle="聚焦场景任务状态、trace 上下文、tool 调用链和异常告警"
    >
      <Alert
        type="info"
        showIcon
        message="监控口径"
        description="所有运行指标均围绕真实业务链路：会话任务 -> 技能编排 -> 资产沉淀 -> 确认写回，而不是传统站点 PV/UV 仪表盘。"
      />

      <ProCard split="vertical" style={{ marginTop: 16 }}>
        <ProCard title="租户上下文" colSpan="35%">
          <ProDescriptions column={1} dataSource={tenantContext}>
            <ProDescriptions.Item label="tenantName" dataIndex="tenantName" />
            <ProDescriptions.Item label="eid" dataIndex="eid" />
            <ProDescriptions.Item label="appId" dataIndex="appId" />
            <ProDescriptions.Item label="接入状态" dataIndex="accessStatus" />
            <ProDescriptions.Item label="组织同步" dataIndex="orgSyncStatus" />
            <ProDescriptions.Item label="最近心跳" dataIndex="lastHeartbeatAt" />
          </ProDescriptions>
        </ProCard>
        <ProCard title="服务健康度" colSpan="30%">
          <List
            dataSource={systemHealth}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta title={item.name} description={item.description} />
                <Space direction="vertical" size={4}>
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
                  <span>{item.target}</span>
                </Space>
              </List.Item>
            )}
          />
        </ProCard>
        <ProCard title="最新异常" colSpan="35%">
          <List
            dataSource={systemAlerts}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color={item.severity === '高' ? 'red' : 'orange'}>{item.severity}</Tag>
                      {item.title}
                    </Space>
                  }
                  description={`${item.owner} · ${item.updatedAt}`}
                />
                <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph>
              </List.Item>
            )}
          />
        </ProCard>
      </ProCard>

      <ProCard title="Trace 明细" style={{ marginTop: 16 }}>
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
