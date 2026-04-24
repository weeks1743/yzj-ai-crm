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
import type { ExternalSkillCatalogItem, WritebackPolicy } from '@shared';
import { externalSkillRows, writebackPolicies } from '@shared';

const { Paragraph } = Typography;

type RowData = ExternalSkillCatalogItem | WritebackPolicy;

const pageMap = {
  'external-skills': {
    title: '外部技能',
    summary: '目录视图，用于查看当前场景依赖的外部能力、风险状态与责任归属，不伪装成已联通的运行台。',
    metrics: [
      { label: '外部技能数', value: `${externalSkillRows.length}`, helper: '当前纳入治理的 ext.* 能力' },
      {
        label: '告警中能力',
        value: `${externalSkillRows.filter((item) => item.status === '告警中').length}`,
        helper: '需要纳入场景风险评估',
      },
    ],
    rows: externalSkillRows as RowData[],
  },
  'writeback-policies': {
    title: '写回确认策略',
    summary: '治理视图，用于查看对象写回确认边界、审批角色与回滚规则，不在本轮承担执行控制。',
    metrics: [
      { label: '对象策略数', value: `${writebackPolicies.length}`, helper: '当前静态治理草案' },
      { label: '高抽样策略', value: '100%', helper: '关键对象维持全量审计' },
    ],
    rows: writebackPolicies as RowData[],
  },
} as const;

function buildColumns(
  pageKey: keyof typeof pageMap,
  onOpen: (row: RowData) => void,
): ProColumns<RowData>[] {
  if (pageKey === 'writeback-policies') {
    return [
      {
        title: '对象',
        dataIndex: 'objectKey',
        render: (_, record) => (
          <a onClick={() => onOpen(record)}>{(record as WritebackPolicy).objectKey}</a>
        ),
      },
      { title: '策略', dataIndex: 'strategy' },
      { title: '触发时机', dataIndex: 'trigger' },
      { title: '审批角色', dataIndex: 'approver', width: 120 },
      { title: '审计抽样', dataIndex: 'auditSampling', width: 120 },
      { title: '回滚规则', dataIndex: 'rollbackRule' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
    ];
  }

  return [
    {
      title: '技能名称',
      dataIndex: 'label',
      render: (_, record) => (
        <a onClick={() => onOpen(record)}>{(record as ExternalSkillCatalogItem).label}</a>
      ),
    },
    { title: '技能编码', dataIndex: 'skillCode', width: 220 },
    { title: '触发方式', dataIndex: 'trigger' },
    {
      title: '依赖',
      dataIndex: 'dependencies',
      render: (_, record) => (record as ExternalSkillCatalogItem).dependencies.join(' / '),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => (
        <Tag
          color={(record as ExternalSkillCatalogItem).status === '运行中' ? 'processing' : 'warning'}
        >
          {(record as ExternalSkillCatalogItem).status}
        </Tag>
      ),
    },
    { title: 'SLA', dataIndex: 'sla', width: 140 },
    { title: '负责人', dataIndex: 'owner', width: 120 },
  ];
}

const SkillsCatalogPage = () => {
  const location = useLocation();
  const pageKey = (location.pathname.split('/').pop() ?? '') as keyof typeof pageMap;
  const config = pageMap[pageKey];
  const [current, setCurrent] = useState<RowData | undefined>();

  const columns = useMemo(
    () => (config ? buildColumns(pageKey, setCurrent) : []),
    [config, pageKey],
  );

  if (!config) {
    return <Result status="404" title="技能页不存在" />;
  }

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message="目录 / 治理视图"
        description="这里保留的是外部能力目录与写回策略治理视图，不再展示旧的伪对象注册表或伪场景技能运行页。"
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
        title={pageKey === 'writeback-policies' ? '策略详情' : '外部技能详情'}
      >
        {current ? (
          'strategy' in current ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert
                type="warning"
                showIcon
                message="写回治理说明"
                description="本页只负责呈现当前对象的确认边界与审计要求，真正的写回执行仍应落在 shadow.* 技能和后续场景编排里。"
              />
              <ProDescriptions<WritebackPolicy> column={1} dataSource={current}>
                <ProDescriptions.Item label="对象">{current.objectKey}</ProDescriptions.Item>
                <ProDescriptions.Item label="策略">{current.strategy}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发时机">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="审批角色">{current.approver}</ProDescriptions.Item>
                <ProDescriptions.Item label="审计抽样">{current.auditSampling}</ProDescriptions.Item>
                <ProDescriptions.Item label="回滚规则">{current.rollbackRule}</ProDescriptions.Item>
                <ProDescriptions.Item label="更新时间">{current.updatedAt}</ProDescriptions.Item>
              </ProDescriptions>
            </Space>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert
                type={current.status === '运行中' ? 'success' : 'warning'}
                showIcon
                message={current.status === '运行中' ? '能力运行正常' : '能力存在风险'}
                description={current.summary}
              />
              <ProDescriptions<ExternalSkillCatalogItem> column={1} dataSource={current}>
                <ProDescriptions.Item label="技能名称">{current.label}</ProDescriptions.Item>
                <ProDescriptions.Item label="技能编码">{current.skillCode}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发方式">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="状态">
                  <Tag color={current.status === '运行中' ? 'processing' : 'warning'}>
                    {current.status}
                  </Tag>
                </ProDescriptions.Item>
                <ProDescriptions.Item label="路由">{current.route}</ProDescriptions.Item>
                <ProDescriptions.Item label="负责人">{current.owner}</ProDescriptions.Item>
                <ProDescriptions.Item label="SLA">{current.sla}</ProDescriptions.Item>
                <ProDescriptions.Item label="依赖">
                  <Space wrap>
                    {current.dependencies.map((dependency) => (
                      <Tag key={dependency}>{dependency}</Tag>
                    ))}
                  </Space>
                </ProDescriptions.Item>
              </ProDescriptions>
              <Paragraph style={{ marginBottom: 0 }}>
                这类能力会在“场景组装准备”里作为 `ext.*` 依赖被引用，用于明确风险归属，而不是直接承担记录系统主数据读写。
              </Paragraph>
            </Space>
          )
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default SkillsCatalogPage;
