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
  sceneTasks,
  tenantContext,
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
          <Link to="/skills/record-skills/followup">进入跟进记录技能详情</Link>
        </Button>,
        <Button key="skills">
          <Link to="/skills/record-skills">打开记录系统技能</Link>
        </Button>,
      ]}
    >
      <ProCard split="vertical">
        <ProCard colSpan="65%" title="今日运营摘要">
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Paragraph style={{ marginBottom: 0 }}>
              双系统已经进入“正式后台 + 正式 AI 端”协同原型阶段，管理员当前最重要的工作是保证对象元数据、工具版本、确认策略和运行观测始终一致。
            </Paragraph>
            <Timeline
              items={[
                { children: '09:18 客户研究计划进入等待补源状态。 ' },
                { children: '10:51 星海精工会话任务完成写回确认。' },
                { children: '11:32 录音导入相关 TaskPlan 挂起等待补充纪要。' },
              ]}
            />
          </Space>
        </ProCard>
        <ProCard colSpan="35%" title="今日关键指标">
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Statistic title="活跃任务" value={sceneTasks.length} suffix="个" />
            <Statistic title="会话任务" value={sceneTasks.length} suffix="个" />
            <Statistic title="待确认任务" value={1} suffix="个" />
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
              {
                title: '客户技能详情',
                path: '/skills/record-skills/customer',
                desc: '查看客户技能、字段快照与刷新状态。',
              },
              { title: '会话任务', path: '/agent-governance/sessions', desc: '查看用户会话、计划状态和任务沉淀。' },
              { title: '运行观测', path: '/agent-governance/runtime-observability', desc: '按追踪ID / 任务ID 排查问题。' },
              { title: '策略与确认', path: '/agent-governance/policies-confirmation', desc: '查看写回确认和守卫规则。' },
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
                    <Space orientation="vertical" size={0}>
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
