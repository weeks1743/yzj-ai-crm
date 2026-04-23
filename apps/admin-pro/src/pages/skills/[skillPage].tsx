import {
  PageContainer,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Drawer, Result, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { SkillCatalogItem, ToolRegistryItem, WritebackPolicy } from '@shared';
import {
  externalSkillRows,
  sceneSkillRows,
  toolRegistryRows,
  writebackPolicies,
} from '@shared';

const { Paragraph } = Typography;

type RowData = ToolRegistryItem | SkillCatalogItem | WritebackPolicy;

const pageMap = {
  'tool-registry': {
    title: '工具注册表',
    summary: '动态技能中心，展示对象注册表、templateId / codeId、生成状态、字段权限、确认策略和技能版本。',
    metrics: [
      { label: '对象技能', value: `${toolRegistryRows.length}`, helper: '已注册对象' },
      { label: '生成成功率', value: '100%', helper: '当前示例环境' },
    ],
    rows: toolRegistryRows as RowData[],
  },
  'scene-skills': {
    title: '场景技能',
    summary: '围绕正式业务链路编排的场景技能，而不是演示性质按钮集合。',
    metrics: [
      { label: '场景技能', value: `${sceneSkillRows.length}`, helper: '已上线场景' },
      { label: '平均 SLA', value: 'P95 < 15 分钟', helper: '含异步链路' },
    ],
    rows: sceneSkillRows as RowData[],
  },
  'external-skills': {
    title: '外部技能',
    summary: '与研究、转写等外部能力对接的技能目录。',
    metrics: [
      { label: '外部技能', value: `${externalSkillRows.length}`, helper: '运行中 / 告警中' },
      { label: '降级策略', value: '已配置', helper: '能力提供方失败可回退' },
    ],
    rows: externalSkillRows as RowData[],
  },
  'writeback-policies': {
    title: '写回确认策略',
    summary: '所有主数据写回都应由策略驱动，防止正式后台和 AI 端出现无约束回写。',
    metrics: [
      { label: '对象策略', value: `${writebackPolicies.length}`, helper: '关键对象已覆盖' },
      { label: '审计抽样', value: '30%~100%', helper: '按对象策略控制' },
    ],
    rows: writebackPolicies as RowData[],
  },
} as const;

function buildColumns(pageKey: string, onOpen: (row: RowData) => void): ProColumns<RowData>[] {
  if (pageKey === 'tool-registry') {
    return [
      {
        title: '技能名称',
        dataIndex: 'label',
        render: (_, record) => <a onClick={() => onOpen(record)}>{(record as ToolRegistryItem).label}</a>,
      },
      { title: '对象', dataIndex: 'objectKey', width: 120 },
      { title: 'templateId', dataIndex: 'templateId', copyable: true },
      { title: 'codeId', dataIndex: 'codeId', copyable: true },
      {
        title: '生成状态',
        dataIndex: 'generationStatus',
        render: (_, record) => <Tag color="success">{(record as ToolRegistryItem).generationStatus}</Tag>,
      },
      { title: '确认策略', dataIndex: 'confirmationPolicy' },
      { title: '技能版本', dataIndex: 'version', width: 120 },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
    ];
  }

  if (pageKey === 'writeback-policies') {
    return [
      {
        title: '对象',
        dataIndex: 'objectKey',
        render: (_, record) => <a onClick={() => onOpen(record)}>{(record as WritebackPolicy).objectKey}</a>,
      },
      { title: '策略', dataIndex: 'strategy' },
      { title: '触发时机', dataIndex: 'trigger' },
      { title: '审批角色', dataIndex: 'approver', width: 120 },
      { title: '审计抽样', dataIndex: 'auditSampling', width: 110 },
      { title: '回滚规则', dataIndex: 'rollbackRule' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
    ];
  }

  return [
    {
      title: '技能名称',
      dataIndex: 'label',
      render: (_, record) => <a onClick={() => onOpen(record)}>{(record as SkillCatalogItem).label}</a>,
    },
    { title: '类型', dataIndex: 'type', width: 120 },
    { title: '触发方式', dataIndex: 'trigger' },
    { title: '依赖', dataIndex: 'dependencies', render: (_, record) => (record as SkillCatalogItem).dependencies.join(' / ') },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => (
        <Tag color={(record as SkillCatalogItem).status === '运行中' ? 'processing' : 'warning'}>
          {(record as SkillCatalogItem).status}
        </Tag>
      ),
    },
    { title: 'SLA', dataIndex: 'sla', width: 140 },
    { title: '负责人', dataIndex: 'owner', width: 120 },
  ];
}

const SkillsPage = () => {
  const location = useLocation();
  const pageKey = location.pathname.split('/').pop() ?? '';
  const config = pageMap[pageKey as keyof typeof pageMap];
  const [current, setCurrent] = useState<RowData | undefined>();

  const columns = useMemo(() => buildColumns(pageKey, setCurrent), [pageKey]);

  if (!config) {
    return <Result status="404" title="技能页不存在" />;
  }

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message="正式治理口径"
        description="技能页不是演示开关面板，而是管理员理解对象、场景、外部能力和写回约束的核心后台。"
      />

      <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
        {config.metrics.map((item) => (
          <StatisticCard
            key={item.label}
            style={{ minWidth: 260 }}
            statistic={{
              title: item.label,
              value: item.value,
              description: item.helper,
            }}
          />
        ))}
      </Space>

      <ProTable<RowData>
        style={{ marginTop: 16 }}
        rowKey="id"
        columns={columns}
        dataSource={config.rows}
        search={false}
        toolBarRender={false}
        pagination={false}
      />

      <Drawer
        size="large"
        open={Boolean(current)}
        onClose={() => setCurrent(undefined)}
        title={pageKey === 'writeback-policies' ? '策略详情' : '技能详情'}
      >
        {current ? (
          <>
            {'templateId' in current ? (
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="success"
                  showIcon
                  message="对象注册表"
                  description="这里展示对象技能如何由 templateId / codeId 驱动生成，并带出可写字段、只读字段和确认策略。"
                />
                <ProDescriptions<ToolRegistryItem> column={1} dataSource={current}>
                  <ProDescriptions.Item label="对象">{current.objectKey}</ProDescriptions.Item>
                  <ProDescriptions.Item label="templateId">{current.templateId}</ProDescriptions.Item>
                  <ProDescriptions.Item label="codeId">{current.codeId}</ProDescriptions.Item>
                  <ProDescriptions.Item label="版本">{current.version}</ProDescriptions.Item>
                  <ProDescriptions.Item label="确认策略">{current.confirmationPolicy}</ProDescriptions.Item>
                </ProDescriptions>
                <div>
                  <Paragraph strong>可写字段</Paragraph>
                  <Space wrap>
                    {current.writableFields.map((field) => (
                      <Tag key={field} color="blue">
                        {field}
                      </Tag>
                    ))}
                  </Space>
                </div>
                <div>
                  <Paragraph strong>只读字段</Paragraph>
                  <Space wrap>
                    {current.readonlyFields.map((field) => (
                      <Tag key={field}>{field}</Tag>
                    ))}
                  </Space>
                </div>
              </Space>
            ) : 'strategy' in current ? (
              <ProDescriptions<WritebackPolicy> column={1} dataSource={current}>
                <ProDescriptions.Item label="对象">{current.objectKey}</ProDescriptions.Item>
                <ProDescriptions.Item label="策略">{current.strategy}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发时机">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="审批角色">{current.approver}</ProDescriptions.Item>
                <ProDescriptions.Item label="审计抽样">{current.auditSampling}</ProDescriptions.Item>
                <ProDescriptions.Item label="回滚规则">{current.rollbackRule}</ProDescriptions.Item>
              </ProDescriptions>
            ) : (
              <ProDescriptions<SkillCatalogItem> column={1} dataSource={current}>
                <ProDescriptions.Item label="技能名称">{current.label}</ProDescriptions.Item>
                <ProDescriptions.Item label="类型">{current.type}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发方式">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="路由">{current.route}</ProDescriptions.Item>
                <ProDescriptions.Item label="依赖">
                  <Space wrap>
                    {current.dependencies.map((dep) => (
                      <Tag key={dep}>{dep}</Tag>
                    ))}
                  </Space>
                </ProDescriptions.Item>
              </ProDescriptions>
            )}
          </>
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default SkillsPage;
