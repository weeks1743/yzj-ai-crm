import {
  PageContainer,
  ProCard,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import { Button, List, Space, Tag, Timeline, Typography } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import {
  assetPages,
  sceneTasks,
  tenantContext,
  visitBriefs,
} from '@shared';

const { Statistic } = StatisticCard;
const { Paragraph, Text } = Typography;

type TaskRow = (typeof sceneTasks)[number];

const columns: ProColumns<TaskRow>[] = [
  { title: '任务名称', dataIndex: 'title' },
  { title: '场景', dataIndex: 'scene', width: 150 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag
        color={
          record.status === '已完成'
            ? 'success'
            : record.status === '运行中'
              ? 'processing'
              : 'warning'
        }
      >
        {record.status}
      </Tag>
    ),
  },
  { title: '实体锚点', dataIndex: 'entityAnchor' },
  { title: '下一步动作', dataIndex: 'nextAction' },
  { title: '更新时间', dataIndex: 'updatedAt', width: 100 },
];

const WorkplacePage = () => {
  return (
    <PageContainer
      title={`欢迎回来，${tenantContext.owner}`}
      subTitle="面向管理员的正式运营工作台"
      extra={[
        <Button key="records" type="primary">
          <Link to="/records/followups">查看待确认跟进记录</Link>
        </Button>,
        <Button key="skills">
          <Link to="/skills/tool-registry">打开 Tool Registry</Link>
        </Button>,
      ]}
    >
      <ProCard split="vertical">
        <ProCard colSpan="65%" title="今日运营摘要">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Paragraph style={{ marginBottom: 0 }}>
              双系统已经进入“正式后台 + 正式 AI 端”协同原型阶段，管理员当前最重要的工作是保证对象元数据、技能版本、确认策略和资产可观测性始终一致。
            </Paragraph>
            <Timeline
              items={[
                { children: '09:18 公司研究快照待补源，已通知研究能力组。 ' },
                { children: '10:51 星海精工拜访材料生成成功并下发销售。' },
                { children: '11:32 录音导入链路完成回写，trace 审计正常。' },
              ]}
            />
          </Space>
        </ProCard>
        <ProCard colSpan="35%" title="今日关键指标">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Statistic title="活跃任务" value={sceneTasks.length} suffix="个" />
            <Statistic title="拜访材料结果" value={visitBriefs.length} suffix="份" />
            <Statistic
              title="录音分析资产"
              value={assetPages['audio-analysis'].items.length}
              suffix="条"
            />
          </Space>
        </ProCard>
      </ProCard>

      <ProCard split="vertical" style={{ marginTop: 16 }}>
        <ProCard title="待办任务" colSpan="60%">
          <ProTable<TaskRow>
            rowKey="id"
            search={false}
            toolBarRender={false}
            options={false}
            pagination={false}
            dataSource={sceneTasks}
            columns={columns}
          />
        </ProCard>
        <ProCard title="快捷入口" colSpan="40%">
          <List
            dataSource={[
              { title: '客户对象页', path: '/records/customers', desc: '排查对象字段与写回状态。' },
              { title: '录音分析资产', path: '/assets/audio-analysis', desc: '查看转写和异步分析结果。' },
              { title: '可观测性', path: '/settings/observability', desc: '按 traceId / taskId 排查问题。' },
              { title: '安全与运营', path: '/settings/security', desc: '查看跨租户拦截和脱敏规则。' },
            ]}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="open" type="link">
                    <Link to={item.path}>打开</Link>
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={item.title}
                  description={
                    <Space direction="vertical" size={0}>
                      <Text type="secondary">{item.desc}</Text>
                      <Text className="yzj-muted">{item.path}</Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </ProCard>
      </ProCard>
    </PageContainer>
  );
};

export default WorkplacePage;
