import {
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Col, List, Progress, Row, Space, Tag, Typography } from 'antd';

const { Paragraph, Text } = Typography;

type MetricStatus = 'healthy' | 'attention' | 'risk';

interface OperationsMetric {
  key: string;
  title: string;
  value: number;
  suffix: string;
  description: string;
  status: MetricStatus;
}

interface CapabilityUsage {
  key: string;
  name: string;
  owner: string;
  runs: number;
  successRate: number;
  materialized: number;
  pending: number;
  status: MetricStatus;
}

interface RiskItem {
  key: string;
  title: string;
  owner: string;
  severity: '高' | '中';
  updatedAt: string;
  description: string;
}

interface RecentRun {
  traceId: string;
  capability: string;
  status: '已完成' | '待确认' | '待补充' | '失败';
  subject: string;
  writeback: string;
  materialization: string;
  updatedAt: string;
}

interface Workstream {
  key: string;
  name: string;
  value: number;
  target: number;
  status: MetricStatus;
  description: string;
}

const overviewMetrics: OperationsMetric[] = [
  {
    key: 'sessions',
    title: '今日 AI 会话',
    value: 86,
    suffix: '轮',
    description: '销售侧有效请求，排除空输入与重复刷新',
    status: 'healthy',
  },
  {
    key: 'runs',
    title: '任务运行完成',
    value: 64,
    suffix: '次',
    description: '公司研究、拜访准备、录音处理主链路',
    status: 'healthy',
  },
  {
    key: 'pending',
    title: '待处理确认',
    value: 7,
    suffix: '项',
    description: '写回、资料复用和单选澄清等待销售处理',
    status: 'attention',
  },
  {
    key: 'failed',
    title: '失败运行',
    value: 3,
    suffix: '次',
    description: '外部 Skill 超时或记录系统检索无结果',
    status: 'risk',
  },
];

const capabilityUsage: CapabilityUsage[] = [
  {
    key: 'company-research',
    name: '公司研究',
    owner: '销售运营',
    runs: 31,
    successRate: 96,
    materialized: 24,
    pending: 2,
    status: 'healthy',
  },
  {
    key: 'visit-prep',
    name: '拜访准备',
    owner: '客户成功',
    runs: 18,
    successRate: 89,
    materialized: 0,
    pending: 3,
    status: 'attention',
  },
  {
    key: 'recording',
    name: '录音处理',
    owner: '实施交付',
    runs: 15,
    successRate: 87,
    materialized: 13,
    pending: 1,
    status: 'attention',
  },
  {
    key: 'writeback',
    name: '记录写回',
    owner: '销售运营',
    runs: 22,
    successRate: 95,
    materialized: 19,
    pending: 1,
    status: 'healthy',
  },
];

const workstreams: Workstream[] = [
  {
    key: 'writeback',
    name: '确认后写回完成率',
    value: 95,
    target: 92,
    status: 'healthy',
    description: '客户、联系人、商机和跟进记录写回链路',
  },
  {
    key: 'materialization',
    name: '资料沉淀命中率',
    value: 88,
    target: 85,
    status: 'healthy',
    description: '公司研究与录音分析资料进入统一资料空间',
  },
  {
    key: 'recording',
    name: '录音处理完成率',
    value: 87,
    target: 90,
    status: 'attention',
    description: '上传、转写、资料包生成和下游分析',
  },
  {
    key: 'resolution',
    name: '待补充当日解决率',
    value: 76,
    target: 80,
    status: 'attention',
    description: '客户选择、资料选择和缺失字段补充',
  },
];

const riskItems: RiskItem[] = [
  {
    key: 'recording-latency',
    title: '录音处理平均耗时高于运营阈值',
    owner: '实施交付',
    severity: '高',
    updatedAt: '11:42',
    description: '近 2 小时内大文件转写等待时间上升，需优先观察通义音频服务队列和公网 viewer 可访问性。',
  },
  {
    key: 'visit-prep-source',
    title: '拜访准备缺少有效公司研究资料',
    owner: '客户成功',
    severity: '中',
    updatedAt: '10:58',
    description: '部分客户缺少可复用公司研究，拜访准备进入澄清或阻断状态，建议补齐客户关联资料。',
  },
  {
    key: 'confirm-aging',
    title: '待确认写回超过运营响应时限',
    owner: '销售运营',
    severity: '中',
    updatedAt: '10:21',
    description: '7 项确认中有 2 项超过 30 分钟，需提醒销售在 AI 工作台完成同意或拒绝。',
  },
];

const recentRuns: RecentRun[] = [
  {
    traceId: 'trace-agent-ad0c71dc',
    capability: '拜访准备',
    status: '已完成',
    subject: '贝斯美',
    writeback: '无写回',
    materialization: '运行时 Markdown',
    updatedAt: '11:36',
  },
  {
    traceId: 'trace-agent-64fa9f2d',
    capability: '拜访准备',
    status: '已完成',
    subject: '绍兴贝斯美化工股份有限公司',
    writeback: '无写回',
    materialization: '运行时 Markdown',
    updatedAt: '11:18',
  },
  {
    traceId: 'trace-agent-7fd23c18',
    capability: '公司研究',
    status: '待确认',
    subject: '星海精工股份',
    writeback: '等待确认',
    materialization: 'company_research',
    updatedAt: '10:52',
  },
  {
    traceId: 'trace-agent-2c88bb30',
    capability: '录音处理',
    status: '待补充',
    subject: '华东渠道复盘录音',
    writeback: '未触发',
    materialization: 'recording_material',
    updatedAt: '10:09',
  },
  {
    traceId: 'trace-agent-91ea20bf',
    capability: '记录写回',
    status: '失败',
    subject: '跟进记录',
    writeback: '工具不可用',
    materialization: '无',
    updatedAt: '09:47',
  },
];

const tenantIsolationStatus = {
  tenantName: '云之家销售组织',
  eid: '当前登录 EID',
  aiAppId: 'AI 轻应用 appId 仅用于 SSO',
  lightCloudAppId: '501037649',
  isolationKey: 'eid + lightCloud.appId',
  artifactSpace: '资料资产、向量检索、运行观测统一归属',
  status: '隔离键一致',
};

const operationActions = [
  '优先处理超过 30 分钟的写回确认，避免销售侧重复发起同一写入请求。',
  '对录音处理队列继续观察大文件耗时，必要时先暂停批量上传。',
  '为拜访准备高频客户补齐公司研究资料，降低澄清卡片出现频率。',
  '保持资料空间只使用 lightCloud.appId，发现历史误落空间时走版本化修复脚本。',
];

const statusMeta: Record<MetricStatus, { label: string; color: string }> = {
  healthy: { label: '稳定', color: 'success' },
  attention: { label: '关注', color: 'warning' },
  risk: { label: '风险', color: 'error' },
};

const runStatusMeta: Record<RecentRun['status'], { color: string }> = {
  已完成: { color: 'success' },
  待确认: { color: 'warning' },
  待补充: { color: 'processing' },
  失败: { color: 'error' },
};

const capabilityColumns: ProColumns<CapabilityUsage>[] = [
  {
    title: '能力',
    dataIndex: 'name',
    render: (_, record) => (
      <Space>
        <Text strong>{record.name}</Text>
        <Tag color={statusMeta[record.status].color}>{statusMeta[record.status].label}</Tag>
      </Space>
    ),
  },
  { title: '负责人', dataIndex: 'owner', width: 120 },
  { title: '今日运行', dataIndex: 'runs', width: 100, render: (_, record) => `${record.runs} 次` },
  {
    title: '成功率',
    dataIndex: 'successRate',
    width: 180,
    render: (_, record) => (
      <Progress
        percent={record.successRate}
        size="small"
        status={record.status === 'risk' ? 'exception' : 'active'}
      />
    ),
  },
  { title: '资料沉淀', dataIndex: 'materialized', width: 110, render: (_, record) => `${record.materialized} 份` },
  {
    title: '待处理',
    dataIndex: 'pending',
    width: 100,
    render: (_, record) => (record.pending ? <Tag color="warning">{record.pending} 项</Tag> : '-'),
  },
];

const recentRunColumns: ProColumns<RecentRun>[] = [
  { title: '追踪编号', dataIndex: 'traceId', width: 210, copyable: true },
  { title: '能力', dataIndex: 'capability', width: 120 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => <Tag color={runStatusMeta[record.status].color}>{record.status}</Tag>,
  },
  { title: '业务主体', dataIndex: 'subject', ellipsis: true },
  { title: '写回结果', dataIndex: 'writeback', width: 130 },
  { title: '资料结果', dataIndex: 'materialization', width: 160 },
  { title: '更新时间', dataIndex: 'updatedAt', width: 100 },
];

function renderStatusTag(status: MetricStatus) {
  const meta = statusMeta[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

const AnalysisPage = () => {
  return (
    <PageContainer
      title="分析运营看板"
      subTitle="面向销售 AI 助手的会话运行、能力使用、写回确认和资料沉淀运营视图"
    >
      <Row gutter={[16, 16]}>
        {overviewMetrics.map((item) => (
          <Col key={item.key} xs={24} sm={12} xl={6}>
            <StatisticCard
              statistic={{
                title: item.title,
                value: item.value,
                suffix: item.suffix,
                description: item.description,
              }}
              chart={renderStatusTag(item.status)}
            />
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={15}>
          <ProCard
            title="核心能力使用"
            extra={<Tag bordered={false}>今日</Tag>}
          >
            <ProTable<CapabilityUsage>
              rowKey="key"
              search={false}
              toolBarRender={false}
              options={false}
              pagination={false}
              columns={capabilityColumns}
              dataSource={capabilityUsage}
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={9}>
          <ProCard title="业务链路健康度">
            <Space orientation="vertical" size={16} style={{ width: '100%' }}>
              {workstreams.map((item) => (
                <div key={item.key}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text strong>{item.name}</Text>
                    <Space>
                      <Text>{item.value}%</Text>
                      {renderStatusTag(item.status)}
                    </Space>
                  </Space>
                  <Progress
                    percent={item.value}
                    size="small"
                    status={item.status === 'risk' ? 'exception' : 'active'}
                  />
                  <Text type="secondary">
                    目标 {item.target}% · {item.description}
                  </Text>
                </div>
              ))}
            </Space>
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={9}>
          <ProCard title="租户隔离与应用 ID">
            <ProDescriptions column={1} dataSource={tenantIsolationStatus} bordered size="small">
              <ProDescriptions.Item label="租户" dataIndex="tenantName" />
              <ProDescriptions.Item label="EID" dataIndex="eid" />
              <ProDescriptions.Item label="AI 轻应用" dataIndex="aiAppId" />
              <ProDescriptions.Item label="轻云记录系统" dataIndex="lightCloudAppId" copyable />
              <ProDescriptions.Item label="隔离键" dataIndex="isolationKey" />
              <ProDescriptions.Item label="资料空间" dataIndex="artifactSpace" />
              <ProDescriptions.Item label="状态">
                <Tag color="success">{tenantIsolationStatus.status}</Tag>
              </ProDescriptions.Item>
            </ProDescriptions>
          </ProCard>
        </Col>
        <Col xs={24} xl={15}>
          <ProCard title="近期风险">
            <List
              itemLayout="vertical"
              dataSource={riskItems}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={
                      item.severity === '高'
                        ? <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
                        : <ClockCircleOutlined style={{ color: '#faad14', fontSize: 20 }} />
                    }
                    title={
                      <Space wrap>
                        <Text strong>{item.title}</Text>
                        <Tag color={item.severity === '高' ? 'red' : 'orange'}>{item.severity}</Tag>
                        <Tag bordered={false}>{item.owner}</Tag>
                      </Space>
                    }
                    description={`更新时间 ${item.updatedAt}`}
                  />
                  <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph>
                </List.Item>
              )}
            />
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={8}>
          <ProCard title="运营动作">
            <List
              dataSource={operationActions}
              renderItem={(item, index) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Tag color="blue">{index + 1}</Tag>}
                    title={item}
                  />
                </List.Item>
              )}
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={16}>
          <ProCard
            title="链路分布"
            extra={(
              <Space>
                <Tag icon={<FileSearchOutlined />}>资料</Tag>
                <Tag icon={<SafetyCertificateOutlined />}>确认</Tag>
                <Tag icon={<FieldTimeOutlined />}>等待态</Tag>
                <Tag icon={<SyncOutlined spin={false} />}>运行</Tag>
              </Space>
            )}
          >
            <Row gutter={[16, 16]}>
              {capabilityUsage.map((item) => (
                <Col key={item.key} xs={24} md={12}>
                  <div
                    style={{
                      border: '1px solid rgba(5, 5, 5, 0.06)',
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Text strong>{item.name}</Text>
                        {renderStatusTag(item.status)}
                      </Space>
                      <StatisticCard
                        statistic={{
                          value: item.runs,
                          suffix: '次',
                          description: `${item.owner} · 成功率 ${item.successRate}%`,
                        }}
                      />
                      <Text type="secondary">
                        资料沉淀 {item.materialized} 份 · 待处理 {item.pending} 项
                      </Text>
                    </Space>
                  </div>
                </Col>
              ))}
            </Row>
          </ProCard>
        </Col>
      </Row>

      <ProCard title="最近运行结果" style={{ marginTop: 16 }}>
        <ProTable<RecentRun>
          rowKey="traceId"
          search={false}
          toolBarRender={false}
          options={false}
          pagination={false}
          columns={recentRunColumns}
          dataSource={recentRuns}
          scroll={{ x: 1100 }}
        />
      </ProCard>
    </PageContainer>
  );
};

export default AnalysisPage;
