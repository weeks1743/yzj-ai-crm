import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import {
  PageContainer,
  ProCard,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Col, List, Progress, Row, Space, Tag, Typography } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import {
  dashboardMetrics,
  dashboardTrendData,
  rankingData,
  systemAlerts,
  systemHealth,
  traceLogs,
} from '@shared';

const { Statistic } = StatisticCard;
const { Paragraph, Text } = Typography;

type TrendRow = {
  date: string;
  metric: string;
  value: number;
};

type TraceRow = (typeof traceLogs)[number];

const traceColumns: ProColumns<TraceRow>[] = [
  { title: 'traceId', dataIndex: 'traceId', width: 180, copyable: true },
  { title: 'taskId', dataIndex: 'taskId', width: 140, copyable: true },
  { title: '场景', dataIndex: 'scene', width: 160 },
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
    render: (_, record) => (
      <Space wrap>
        {record.toolChain.map((tool) => (
          <Tag key={tool}>{tool}</Tag>
        ))}
      </Space>
    ),
  },
  { title: '写回结果', dataIndex: 'writebackResult' },
  { title: '时间', dataIndex: 'timestamp', width: 180 },
];

const trendRows: TrendRow[] = dashboardTrendData.flatMap((item) => [
  { date: item.date, metric: '主数据写回成功率', value: item.writebackSuccess },
  { date: item.date, metric: '录音导入完成率', value: item.audioCompletion },
  { date: item.date, metric: '研究快照复用率', value: item.researchReuse },
  { date: item.date, metric: '拜访材料生成成功率', value: item.visitBriefSuccess },
]);

function renderStatusColor(status: string) {
  if (status === 'healthy') {
    return 'success';
  }
  if (status === 'attention') {
    return 'warning';
  }
  return 'error';
}

const AnalysisPage = () => {
  return (
    <PageContainer
      title="分析页"
      subTitle="对齐正式后台的业务指标、趋势、排行榜、审计和运行视图"
    >
      <ProCard gutter={[16, 16]} wrap>
        {dashboardMetrics.map((item) => (
          <ProCard key={item.key} colSpan={{ xs: 24, sm: 12, xl: 8, xxl: 4 }}>
            <StatisticCard
              className="yzj-metric-card"
              statistic={{
                title: item.label,
                value: item.value,
                description: (
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">{item.helper}</Text>
                    <Text>
                      {item.trend.startsWith('-') ? (
                        <ArrowDownOutlined style={{ color: '#faad14' }} />
                      ) : (
                        <ArrowUpOutlined style={{ color: '#52c41a' }} />
                      )}{' '}
                      {item.trend}
                    </Text>
                  </Space>
                ),
                suffix: (
                  <Tag color={renderStatusColor(item.status)} bordered={false}>
                    {item.status === 'healthy'
                      ? '稳定'
                      : item.status === 'attention'
                        ? '关注'
                        : '风险'}
                  </Tag>
                ),
              }}
            />
          </ProCard>
        ))}
      </ProCard>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={16}>
          <ProCard title="核心链路趋势" extra="近 7 日关键成功率">
            <Line
              height={340}
              data={trendRows}
              xField="date"
              yField="value"
              colorField="metric"
              point={{ size: 4, shape: 'circle' }}
              axis={{
                y: {
                  labelFormatter: (v) => `${v}%`,
                },
              }}
              legend={{ position: 'top' }}
              smooth
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={8}>
          <ProCard title="业务排行榜" extra="按当前业务成效排序">
            <List
              dataSource={rankingData}
              renderItem={(item, index) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={index < 3 ? 'blue' : 'default'}>{index + 1}</Tag>
                        <span>{item.name}</span>
                      </Space>
                    }
                    description={item.category}
                  />
                  <Text strong>{item.value}%</Text>
                </List.Item>
              )}
            />
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={8}>
          <ProCard title="重点告警" extra={`${systemAlerts.length} 条`}>
            <List
              itemLayout="vertical"
              dataSource={systemAlerts}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={item.severity === '高' ? 'red' : 'orange'}>{item.severity}</Tag>
                        <span>{item.title}</span>
                      </Space>
                    }
                    description={`负责人：${item.owner} · 更新时间：${item.updatedAt}`}
                  />
                  <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph>
                </List.Item>
              )}
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={8}>
          <ProCard title="系统健康度" extra="业务服务运行状态">
            <List
              dataSource={systemHealth}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" style={{ width: '100%' }} size={6}>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Text strong>{item.name}</Text>
                      <Tag color={renderStatusColor(item.status)} bordered={false}>
                        {item.value}
                      </Tag>
                    </Space>
                    <Progress
                      percent={Number.parseFloat(item.value)}
                      status={item.status === 'risk' ? 'exception' : 'active'}
                      showInfo={false}
                    />
                    <Text type="secondary">
                      目标：{item.target} · {item.description}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={8}>
          <ProCard title="管理员观察结论" extra="面向正式运营">
            <Space direction="vertical" size={14}>
              <Paragraph style={{ marginBottom: 0 }}>
                当前后台最值得关注的是录音转写链路的区域波动，虽然整体完成率仍在可用区间，但华北节点已开始影响异步分析完成时长。
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                研究快照复用率明显提升，说明用户 AI 端的“公司分析到拜访材料”链路开始真正被消费，而不是停留在孤立展示。
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                写回审计链路完整率保持 100%，已经具备正式后台原型应有的可管控和可追踪状态。
              </Paragraph>
            </Space>
          </ProCard>
        </Col>
      </Row>

      <ProCard title="最新 Trace 与写回结果" style={{ marginTop: 16 }}>
        <ProTable<TraceRow>
          rowKey="traceId"
          search={false}
          toolBarRender={false}
          options={false}
          pagination={false}
          columns={traceColumns}
          dataSource={traceLogs}
        />
      </ProCard>
    </PageContainer>
  );
};

export default AnalysisPage;
