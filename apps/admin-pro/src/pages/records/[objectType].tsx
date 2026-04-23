import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Result,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { RecordEntity } from '@shared';
import { recordPages } from '@shared';

const { Statistic } = StatisticCard;
const { Paragraph, Text } = Typography;

function getStatusColor(status: string) {
  if (status.includes('已') || status.includes('跟进') || status.includes('方案')) {
    return 'success';
  }
  if (status.includes('待') || status.includes('风险')) {
    return 'warning';
  }
  return 'default';
}

function getHealthColor(health: RecordEntity['health']) {
  if (health === 'healthy') {
    return 'success';
  }
  if (health === 'attention') {
    return 'warning';
  }
  return 'error';
}

function getHealthLabel(health: RecordEntity['health']) {
  if (health === 'healthy') {
    return '稳定';
  }
  if (health === 'attention') {
    return '关注';
  }
  return '风险';
}

const ObjectRecordsPage = () => {
  const location = useLocation();
  const pageKey = location.pathname.split('/').pop() ?? '';
  const config = recordPages[pageKey];
  const [currentRecord, setCurrentRecord] = useState<RecordEntity | undefined>();

  const columns = useMemo<ProColumns<RecordEntity>[]>(() => {
    const secondaryTitle =
      pageKey === 'customers'
        ? '行业'
        : pageKey === 'contacts'
          ? '手机号'
          : pageKey === 'opportunities'
            ? '预计金额'
            : '关联商机';

    return [
      {
        title: config?.title ?? '名称',
        dataIndex: 'name',
        copyable: true,
        render: (_, record) => (
          <Button type="link" style={{ paddingInline: 0 }} onClick={() => setCurrentRecord(record)}>
            {record.name}
          </Button>
        ),
      },
      { title: '编号', dataIndex: 'code', width: 140 },
      {
        title: '状态',
        dataIndex: 'status',
        width: 120,
        valueType: 'select',
        valueEnum: Object.fromEntries(
          (config?.records ?? []).map((item) => [item.status, { text: item.status }]),
        ),
        render: (_, record) => <Tag color={getStatusColor(record.status)}>{record.status}</Tag>,
      },
      {
        title: secondaryTitle,
        dataIndex:
          pageKey === 'customers'
            ? 'industry'
            : pageKey === 'contacts'
              ? 'phone'
              : pageKey === 'opportunities'
                ? 'amount'
                : 'opportunityName',
      },
      {
        title: pageKey === 'contacts' ? '所属客户' : '负责人',
        dataIndex: pageKey === 'contacts' ? 'customerName' : 'owner',
      },
      {
        title: '来源',
        dataIndex: 'source',
        valueType: 'select',
        valueEnum: Object.fromEntries(
          (config?.records ?? []).map((item) => [item.source, { text: item.source }]),
        ),
        render: (_, record) => <Tag>{record.source}</Tag>,
      },
      {
        title: '健康度',
        dataIndex: 'health',
        width: 100,
        valueType: 'select',
        valueEnum: {
          healthy: { text: '稳定' },
          attention: { text: '关注' },
          risk: { text: '风险' },
        },
        render: (_, record) => (
          <Tag color={getHealthColor(record.health)}>{getHealthLabel(record.health)}</Tag>
        ),
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170, sorter: (a, b) => a.updatedAt.localeCompare(b.updatedAt) },
      { title: '下一步动作', dataIndex: 'nextAction', ellipsis: true },
      {
        title: '操作',
        valueType: 'option',
        width: 160,
        render: (_, record) => [
          <a key="detail" onClick={() => setCurrentRecord(record)}>
            查看详情
          </a>,
          <a key="skill">发起技能</a>,
        ],
      },
    ];
  }, [config, pageKey]);

  if (!config) {
    return <Result status="404" title="对象页不存在" />;
  }

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message="对象元数据提醒"
        description={`当前对象由轻云模板 ${config.meta.templateId} 与 codeId ${config.meta.codeId} 驱动。后台展示的是“可治理的对象页”，不是写死数据结构的传统 CRM 列表。`}
      />

      <ProCard gutter={[16, 16]} wrap style={{ marginTop: 16 }}>
        {config.metrics.map((item) => (
          <ProCard key={item.key} colSpan={{ xs: 24, md: 8 }}>
            <StatisticCard
              statistic={{
                title: item.label,
                value: item.value,
                description: `${item.helper} · ${item.trend}`,
              }}
            />
          </ProCard>
        ))}
      </ProCard>

      <ProCard title="对象元数据" style={{ marginTop: 16 }}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="templateId">{config.meta.templateId}</Descriptions.Item>
          <Descriptions.Item label="codeId">{config.meta.codeId}</Descriptions.Item>
          <Descriptions.Item label="技能版本">{config.meta.skillVersion}</Descriptions.Item>
          <Descriptions.Item label="字段数">{config.meta.fieldCount}</Descriptions.Item>
          <Descriptions.Item label="生成状态">{config.meta.generationStatus}</Descriptions.Item>
          <Descriptions.Item label="确认策略">{config.meta.confirmationPolicy}</Descriptions.Item>
        </Descriptions>
      </ProCard>

      <ProCard style={{ marginTop: 16 }}>
        <ProTable<RecordEntity>
          rowKey="id"
          columns={columns}
          dataSource={config.records}
          search={{ labelWidth: 'auto' }}
          rowSelection={{}}
          toolBarRender={() => [
            <Button key="sync" type="primary">
              同步模板字段
            </Button>,
            <Button key="export">导出当前对象</Button>,
          ]}
          pagination={{ pageSize: 5, showSizeChanger: false }}
        />
      </ProCard>

      <Drawer
        size="large"
        open={Boolean(currentRecord)}
        onClose={() => setCurrentRecord(undefined)}
        title={currentRecord?.name}
      >
        {currentRecord ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="warning"
              showIcon
              message="写回确认策略"
              description={`${config.meta.confirmationPolicy}。关键字段写回前必须保留确认和审计链路。`}
            />
            <ProDescriptions<RecordEntity> column={2} dataSource={currentRecord}>
              <ProDescriptions.Item label="编号" dataIndex="code" />
              <ProDescriptions.Item label="状态" dataIndex="status">
                <Tag color={getStatusColor(currentRecord.status)}>{currentRecord.status}</Tag>
              </ProDescriptions.Item>
              <ProDescriptions.Item label="负责人" dataIndex="owner" />
              <ProDescriptions.Item label="来源" dataIndex="source" />
              <ProDescriptions.Item label="更新时间" dataIndex="updatedAt" />
              <ProDescriptions.Item label="下一步动作" dataIndex="nextAction" />
              <ProDescriptions.Item span={2} label="说明" dataIndex="description" />
            </ProDescriptions>

            <Tabs
              items={[
                {
                  key: 'related',
                  label: '关联信息',
                  children: (
                    <Descriptions bordered column={1}>
                      {currentRecord.related.map((item) => (
                        <Descriptions.Item key={item.label} label={item.label}>
                          {item.value}
                        </Descriptions.Item>
                      ))}
                    </Descriptions>
                  ),
                },
                {
                  key: 'timeline',
                  label: '审计时间线',
                  children: (
                    <Timeline
                      items={currentRecord.timeline.map((item) => ({
                        color:
                          item.status === 'success'
                            ? 'green'
                            : item.status === 'processing'
                              ? 'blue'
                              : 'orange',
                        children: (
                          <Space orientation="vertical" size={0}>
                            <Text strong>{item.title}</Text>
                            <Text type="secondary">
                              {item.time} · {item.actor}
                            </Text>
                            <Paragraph style={{ marginBottom: 0 }}>
                              {item.description}
                            </Paragraph>
                          </Space>
                        ),
                      }))}
                    />
                  ),
                },
                {
                  key: 'meta',
                  label: '字段与权限',
                  children: (
                    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <Text strong>可写字段</Text>
                        <div style={{ marginTop: 8 }}>
                          {config.meta.writableFields.map((field) => (
                            <Tag key={field} color="blue">
                              {field}
                            </Tag>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Text strong>只读字段</Text>
                        <div style={{ marginTop: 8 }}>
                          {config.meta.readonlyFields.map((field) => (
                            <Tag key={field}>{field}</Tag>
                          ))}
                        </div>
                      </div>
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default ObjectRecordsPage;
