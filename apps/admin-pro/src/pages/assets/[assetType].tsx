import {
  PageContainer,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import {
  Alert,
  Drawer,
  List,
  Result,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { AssetItem } from '@shared';
import { assetPages } from '@shared';

const { Paragraph, Text } = Typography;

function statusColor(status: string) {
  if (status.includes('完成') || status.includes('已下发') || status.includes('可复用')) {
    return 'success';
  }
  if (status.includes('运行') || status.includes('分析')) {
    return 'processing';
  }
  if (status.includes('待') || status.includes('草稿')) {
    return 'warning';
  }
  return 'default';
}

const AssetsPage = () => {
  const location = useLocation();
  const pageKey = location.pathname.split('/').pop() ?? '';
  const config = assetPages[pageKey];
  const [currentItem, setCurrentItem] = useState<AssetItem | undefined>();

  const columns = useMemo<ProColumns<AssetItem>[]>(
    () => [
      {
        title: '资产标题',
        dataIndex: 'title',
        render: (_, record) => (
          <a onClick={() => setCurrentItem(record)}>{record.title}</a>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 120,
        render: (_, record) => (
          <Tag color={statusColor(record.status)}>{record.status}</Tag>
        ),
      },
      { title: '负责人', dataIndex: 'owner', width: 120 },
      { title: '实体锚点', dataIndex: 'entityAnchor' },
      { title: '质量 / 评分', dataIndex: 'score', width: 110 },
      {
        title: '标签',
        dataIndex: 'tags',
        render: (_, record) => (
          <Space wrap>
            {record.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ),
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
      { title: '摘要', dataIndex: 'summary', ellipsis: true },
    ],
    [],
  );

  if (!config) {
    return <Result status="404" title="资产页不存在" />;
  }

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message="资产说明"
        description="这些资产全部面向正式业务链路沉淀，用于管理员回看真实使用情况、复用效果和排障过程。"
      />

      <Space size={16} style={{ width: '100%', marginTop: 16 }} wrap>
        {config.metrics.map((item) => (
          <StatisticCard
            key={item.key}
            style={{ minWidth: 260 }}
            statistic={{
              title: item.label,
              value: item.value,
              description: `${item.helper} · ${item.trend}`,
            }}
          />
        ))}
      </Space>

      <ProTable<AssetItem>
        style={{ marginTop: 16 }}
        rowKey="id"
        columns={columns}
        dataSource={config.items}
        search={{ labelWidth: 'auto' }}
        toolBarRender={false}
        pagination={{ pageSize: 5, showSizeChanger: false }}
      />

      <Drawer
        size="large"
        open={Boolean(currentItem)}
        onClose={() => setCurrentItem(undefined)}
        title={currentItem?.title}
      >
        {currentItem ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <ProDescriptions<AssetItem> column={2} dataSource={currentItem}>
              <ProDescriptions.Item label="状态" dataIndex="status">
                <Tag color={statusColor(currentItem.status)}>{currentItem.status}</Tag>
              </ProDescriptions.Item>
              <ProDescriptions.Item label="负责人" dataIndex="owner" />
              <ProDescriptions.Item label="实体锚点" dataIndex="entityAnchor" />
              <ProDescriptions.Item label="评分" dataIndex="score" />
              <ProDescriptions.Item span={2} label="摘要" dataIndex="summary" />
            </ProDescriptions>

            <div>
              <Text strong>资产标签</Text>
              <div style={{ marginTop: 8 }}>
                {currentItem.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            </div>

            <div>
              <Text strong>时间线</Text>
              <Timeline
                style={{ marginTop: 12 }}
                items={currentItem.timeline.map((item) => ({
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
                      <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph>
                    </Space>
                  ),
                }))}
              />
            </div>
          </Space>
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default AssetsPage;
