import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Drawer, Empty, List, Result, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  AgentPlanTemplate,
  AgentPolicy,
  AgentRuntimeTrace,
  AgentToolRow,
} from '@shared';
import {
  agentPlanTemplates,
  agentPolicies,
  agentRuntimeTraces,
  agentToolRows,
} from '@shared';

const { Paragraph, Text } = Typography;

type GovernancePageKey =
  | 'tools-objects'
  | 'plan-templates'
  | 'policies-confirmation'
  | 'runtime-observability';

const pageMeta: Record<GovernancePageKey, { title: string; subTitle: string }> = {
  'tools-objects': {
    title: '工具与对象',
    subTitle: '统一治理 Tool Registry、记录对象、外部工具和 Meta 工具。',
  },
  'plan-templates': {
    title: '计划模板',
    subTitle: '管理可推荐给 TaskPlan 的模板，不配置固定场景工作流。',
  },
  'policies-confirmation': {
    title: '策略与确认',
    subTitle: '治理写回确认、字段风险、证据要求和跨租户守卫。',
  },
  'runtime-observability': {
    title: '运行观测',
    subTitle: '查看 IntentFrame、TaskPlan、ExecutionState 和工具调用链。',
  },
};

const toolTypeLabels: Record<AgentToolRow['type'], string> = {
  record: '记录工具',
  external: '外部工具',
  meta: 'Meta 工具',
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
    { title: 'Provider', dataIndex: 'provider', width: 180 },
    { title: '负责人', dataIndex: 'owner', width: 130 },
  ];

  const metrics = useMemo(() => {
    const readyCount = agentToolRows.filter((item) => item.status === 'ready').length;
    const highRiskCount = agentToolRows.filter((item) => item.riskLevel === 'high').length;
    return [
      { key: 'total', title: '工具总数', value: `${agentToolRows.length}`, helper: 'record / external / meta' },
      { key: 'ready', title: '就绪工具', value: `${readyCount}`, helper: '当前可被 TaskPlan 选择' },
      { key: 'high', title: '高风险工具', value: `${highRiskCount}`, helper: '必须走确认或守卫' },
    ];
  }, []);

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="Tool Registry"
        description="这里展示 Agent 可选择的通用工具。工具可以服务 CRM 样例，但不以固定业务流程作为运行时分类。"
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
              <ProDescriptions.Item label="Provider" dataIndex="provider" />
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
        message="Plan Template 不是固定工作流"
        description="模板只给 TaskPlan 提供推荐步骤、确认点和可跳过选项；Agent 仍基于 IntentFrame 动态选择工具。"
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
        description="策略与确认是 Agent 的硬边界：写入、证据、跨租户、MVP 禁用能力都在这里治理。"
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
  const [current, setCurrent] = useState<AgentRuntimeTrace | null>(null);
  const columns: ProColumns<AgentRuntimeTrace>[] = [
    {
      title: '运行记录',
      dataIndex: 'id',
      width: 150,
      render: (_, record) => <a onClick={() => setCurrent(record)}>{record.id}</a>,
    },
    { title: '用户输入', dataIndex: 'userInput', ellipsis: true },
    { title: 'Intent', render: (_, record) => record.intentFrame.actionType, width: 120 },
    { title: 'Plan 状态', render: (_, record) => record.taskPlan.status, width: 150 },
    { title: 'ExecutionState', dataIndex: 'executionState', width: 180 },
    { title: '时间', dataIndex: 'timestamp', width: 170 },
  ];

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="Agent 运行观测"
        description="这里看的是用户意图如何落成计划、计划如何选择工具、执行如何进入等待确认或挂起状态。"
      />
      {renderMetricCards([
        { key: 'runs', title: '观测样例', value: `${agentRuntimeTraces.length}`, helper: '静态原型 trace' },
        { key: 'paused', title: '挂起状态', value: `${agentRuntimeTraces.filter((item) => item.executionState.includes('paused')).length}`, helper: '等待用户补充或继续' },
        { key: 'confirm', title: '待确认', value: `${agentRuntimeTraces.filter((item) => item.executionState.includes('confirmation')).length}`, helper: '写入前确认' },
      ])}
      <ProTable<AgentRuntimeTrace>
        style={{ marginTop: 16 }}
        rowKey="id"
        search={false}
        toolBarRender={false}
        columns={columns}
        dataSource={agentRuntimeTraces}
        scroll={{ x: 1200 }}
      />
      <Drawer
        width={760}
        open={Boolean(current)}
        onClose={() => setCurrent(null)}
        title="运行观测详情"
      >
        {current ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <ProCard title="IntentFrame" bordered>
              <ProDescriptions column={1} dataSource={current.intentFrame}>
                <ProDescriptions.Item label="Action Type" dataIndex="actionType" />
                <ProDescriptions.Item label="目标" dataIndex="goal" />
                <ProDescriptions.Item label="目标对象">{current.intentFrame.targets.join(', ') || '-'}</ProDescriptions.Item>
                <ProDescriptions.Item label="缺失信息">{current.intentFrame.missingSlots.join(', ') || '-'}</ProDescriptions.Item>
              </ProDescriptions>
            </ProCard>
            <ProCard title="TaskPlan / ExecutionState" bordered>
              <ProDescriptions column={1} dataSource={current.taskPlan}>
                <ProDescriptions.Item label="Plan ID" dataIndex="planId" />
                <ProDescriptions.Item label="Plan 状态" dataIndex="status" />
                <ProDescriptions.Item label="执行状态">{current.executionState}</ProDescriptions.Item>
                <ProDescriptions.Item label="步骤">{current.taskPlan.steps.join(' -> ')}</ProDescriptions.Item>
              </ProDescriptions>
            </ProCard>
            <ProCard title="工具与证据" bordered>
              <Space direction="vertical" size={8}>
                <Text>工具调用链：{current.toolChain.join(' -> ')}</Text>
                <Text>证据引用：{current.evidenceRefs.join(', ') || '-'}</Text>
                <Text>结果：{current.result}</Text>
              </Space>
            </ProCard>
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
    return <Result status="404" title="Agent 治理页面不存在" />;
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
