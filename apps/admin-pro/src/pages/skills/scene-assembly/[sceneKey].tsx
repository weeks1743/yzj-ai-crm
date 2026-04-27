import {
  PageContainer,
  ProCard,
  ProTable,
} from '@ant-design/pro-components';
import { history, useParams } from '@umijs/max';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Result,
  Space,
  Steps,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  SceneAssemblyDependency,
  SceneAssemblyKey,
  SceneAssemblyResolvedView,
} from '@shared';
import { sceneAssemblyDrafts } from '@shared';
import {
  fetchResolvedSceneAssemblyViews,
  getSalesStageColor,
  getSceneAssemblyStatusColor,
  salesStageMeta,
  salesStageOrder,
} from '../shared';

const { Paragraph, Text } = Typography;

function isSceneAssemblyKey(value: string | undefined): value is SceneAssemblyKey {
  if (!value) {
    return false;
  }

  return sceneAssemblyDrafts.some((item) => item.key === value);
}

function formatSceneStatus(status: SceneAssemblyResolvedView['status']) {
  if (status === '待组装') {
    return '已可用';
  }

  return status;
}

function formatDependencyStatus(status: SceneAssemblyDependency['status']) {
  switch (status) {
    case 'available':
      return '已接入';
    case 'gap':
      return '缺失';
    case 'risk':
      return '风险';
  }
}

function getDependencyStatusColor(status: SceneAssemblyDependency['status']) {
  switch (status) {
    case 'available':
      return 'success';
    case 'gap':
      return 'error';
    case 'risk':
      return 'warning';
  }
}

function renderTagGroup(items: string[], color?: string) {
  return (
    <Space wrap size={[6, 8]}>
      {items.map((item) => (
        <Tag key={item} color={color}>
          {item}
        </Tag>
      ))}
    </Space>
  );
}

function renderBulletList(items: string[]) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item) => (
        <li key={item} style={{ marginBottom: 6 }}>
          <Text type="secondary">{item}</Text>
        </li>
      ))}
    </ul>
  );
}

const recordDependencyColumns: ProColumns<SceneAssemblyDependency>[] = [
  {
    title: '对象能力',
    dataIndex: 'label',
    width: 200,
    ellipsis: true,
  },
  {
    title: '技能编码',
    dataIndex: 'code',
    width: 220,
    ellipsis: true,
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={getDependencyStatusColor(record.status)}>
        {formatDependencyStatus(record.status)}
      </Tag>
    ),
  },
  {
    title: '说明',
    dataIndex: 'reason',
    render: (_, record) => record.reason ?? record.summary ?? '-',
  },
];

const externalDependencyColumns: ProColumns<SceneAssemblyDependency>[] = [
  {
    title: '外部供给',
    dataIndex: 'label',
    width: 220,
    ellipsis: true,
  },
  {
    title: '技能编码',
    dataIndex: 'code',
    width: 220,
    ellipsis: true,
  },
  {
    title: '负责人',
    dataIndex: 'owner',
    width: 120,
    render: (_, record) => record.owner ?? '-',
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={getDependencyStatusColor(record.status)}>
        {formatDependencyStatus(record.status)}
      </Tag>
    ),
  },
  {
    title: '说明',
    dataIndex: 'reason',
    render: (_, record) => record.reason ?? record.summary ?? '-',
  },
];

const SceneAssemblyDetailPage = () => {
  const params = useParams<{ sceneKey: string }>();
  const sceneKey = isSceneAssemblyKey(params.sceneKey) ? params.sceneKey : undefined;
  const [scene, setScene] = useState<SceneAssemblyResolvedView | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sceneKey) {
      return;
    }

    let alive = true;

    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const result = await fetchResolvedSceneAssemblyViews();
        const matched = result.views.find((item) => item.key === sceneKey) ?? null;

        if (!alive) {
          return;
        }

        setScene(matched);
      } catch (error) {
        if (!alive) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : '场景技能详情加载失败');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [sceneKey]);

  if (!sceneKey) {
    return <Result status="404" title="场景技能详情不存在" />;
  }

  if (!loading && !errorMessage && !scene) {
    return <Empty description="未找到对应场景技能" />;
  }

  return (
    <PageContainer
      title={scene?.label ?? '场景技能详情'}
      subTitle={scene?.businessGoal ?? '查看当前场景的真实入口、业务链路和供给关系。'}
      extra={[
        <Button key="back" onClick={() => history.push('/skills/scene-assembly')}>
          返回清单
        </Button>,
        <Button key="reload" onClick={() => window.location.reload()}>
          重新加载
        </Button>,
      ]}
    >
      {errorMessage ? (
        <Alert
          showIcon
          type="warning"
          message="详情加载异常"
          description={errorMessage}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {scene ? (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
          <ProCard bordered loading={loading}>
            <Descriptions
              size="small"
              column={{ xs: 1, md: 2, xl: 4 }}
              items={[
                {
                  key: 'category',
                  label: '场景类别',
                  children: (
                    <Tag color={scene.category === '复合场景' ? 'purple' : 'blue'}>
                      {scene.category}
                    </Tag>
                  ),
                },
                {
                  key: 'stage',
                  label: '适用阶段',
                  children: (
                    <Tag color={getSalesStageColor(scene.salesStage)}>
                      {scene.salesStage}
                    </Tag>
                  ),
                },
                {
                  key: 'status',
                  label: '当前状态',
                  children: (
                    <Tag color={getSceneAssemblyStatusColor(scene.status)}>
                      {formatSceneStatus(scene.status)}
                    </Tag>
                  ),
                },
                {
                  key: 'anchor',
                  label: '业务锚点',
                  children: scene.entityAnchor,
                },
                {
                  key: 'recordCount',
                  label: '记录系统技能',
                  children: `${scene.recordSkillDependencies.length} 个`,
                },
                {
                  key: 'externalCount',
                  label: '外部供给',
                  children: `${scene.externalSkillDependencies.length} 个`,
                },
                {
                  key: 'upstreamCount',
                  label: '上游资产',
                  children: `${scene.upstreamAssets.length} 项`,
                },
                {
                  key: 'outputCount',
                  label: '标准输出',
                  children: `${scene.outputs.length} 项`,
                },
              ]}
            />
          </ProCard>

          <Tabs
            items={[
              {
                key: 'overview',
                label: '场景总览',
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <ProCard title="场景定位" bordered>
                      <Paragraph style={{ marginBottom: 16 }}>{scene.summary}</Paragraph>
                      <Descriptions
                        size="small"
                        column={{ xs: 1, xl: 2 }}
                        items={[
                          {
                            key: 'goal',
                            label: '业务目标',
                            children: scene.businessGoal,
                          },
                          {
                            key: 'anchorDetail',
                            label: '记录系统锚点',
                            children: scene.entityAnchor,
                          },
                        ]}
                      />
                    </ProCard>

                    <ProCard title="销售链路位置" bordered>
                      <Steps
                        size="small"
                        direction="vertical"
                        current={Math.max(salesStageOrder.indexOf(scene.salesStage as (typeof salesStageOrder)[number]), 0)}
                        items={salesStageOrder.map((stageName) => ({
                          title: stageName,
                          description:
                            stageName === scene.salesStage
                              ? `${scene.label}：${salesStageMeta[stageName]?.focus ?? ''}`
                              : undefined,
                        }))}
                      />
                    </ProCard>

                    <ProCard title="入口、输入与产出" bordered>
                      <Descriptions
                        bordered
                        size="small"
                        column={1}
                        items={[
                          {
                            key: 'triggers',
                            label: '触发入口',
                            children: renderTagGroup(scene.triggerEntries, 'blue'),
                          },
                          {
                            key: 'upstream',
                            label: '上游资产',
                            children: renderTagGroup(scene.upstreamAssets),
                          },
                          {
                            key: 'outputs',
                            label: '标准输出',
                            children: renderTagGroup(scene.outputs, 'green'),
                          },
                        ]}
                      />
                    </ProCard>

                    <ProCard title="标准业务链路" bordered>
                      <Steps
                        size="small"
                        direction="vertical"
                        current={Math.max(scene.orchestrationChain.length - 1, 0)}
                        items={scene.orchestrationChain.map((item) => ({
                          title: item,
                        }))}
                      />
                    </ProCard>
                  </Space>
                ),
              },
              {
                key: 'dependencies',
                label: `供给关系 (${scene.recordSkillDependencies.length + scene.externalSkillDependencies.length})`,
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <ProCard title={`记录系统技能 (${scene.recordSkillDependencies.length})`} bordered>
                      <ProTable<SceneAssemblyDependency>
                        rowKey="code"
                        search={false}
                        options={false}
                        toolBarRender={false}
                        pagination={false}
                        columns={recordDependencyColumns}
                        dataSource={scene.recordSkillDependencies}
                        scroll={{ x: 920 }}
                      />
                    </ProCard>

                    <ProCard title={`外部供给 (${scene.externalSkillDependencies.length})`} bordered>
                      <ProTable<SceneAssemblyDependency>
                        rowKey="code"
                        search={false}
                        options={false}
                        toolBarRender={false}
                        pagination={false}
                        columns={externalDependencyColumns}
                        dataSource={scene.externalSkillDependencies}
                        scroll={{ x: 980 }}
                      />
                    </ProCard>
                  </Space>
                ),
              },
              {
                key: 'boundaries',
                label: '边界与写回',
                children: (
                  <ProCard title="边界说明" bordered>
                    <Descriptions
                      bordered
                      size="small"
                      column={1}
                      items={[
                        {
                          key: 'sceneBoundary',
                          label: '场景职责',
                          children: renderBulletList(scene.boundaries.scene),
                        },
                        {
                          key: 'shadowBoundary',
                          label: '记录系统边界',
                          children: renderBulletList(scene.boundaries.shadow),
                        },
                        {
                          key: 'externalBoundary',
                          label: '外部供给边界',
                          children: renderBulletList(scene.boundaries.external),
                        },
                        {
                          key: 'writebackBoundary',
                          label: '写回边界',
                          children: renderBulletList(scene.boundaries.writeback),
                        },
                      ]}
                    />
                  </ProCard>
                ),
              },
            ]}
          />
        </Space>
      ) : null}
    </PageContainer>
  );
};

export default SceneAssemblyDetailPage;
