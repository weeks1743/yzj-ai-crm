import {
  PageContainer,
  ProCard,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useParams } from '@umijs/max';
import { Alert, Button, List, Result, Space, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { SceneAssemblyDependency, SceneAssemblyKey, SceneAssemblyResolvedView } from '@shared';
import { sceneAssemblyDrafts } from '@shared';
import {
  fetchResolvedSceneAssemblyViews,
  getSceneAssemblyStatusColor,
} from '../shared';

function isSceneAssemblyKey(value: string | undefined): value is SceneAssemblyKey {
  if (!value) {
    return false;
  }

  return sceneAssemblyDrafts.some((item) => item.key === value);
}

const recordDependencyColumns: ProColumns<SceneAssemblyDependency>[] = [
  { title: '技能编码', dataIndex: 'code', width: 220 },
  { title: '对象能力', dataIndex: 'label', width: 180 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={record.status === 'available' ? 'success' : 'error'}>{record.status}</Tag>
    ),
  },
  {
    title: '说明',
    dataIndex: 'reason',
    render: (_, record) => record.reason ?? record.summary ?? '-',
  },
];

const externalDependencyColumns: ProColumns<SceneAssemblyDependency>[] = [
  { title: '技能编码', dataIndex: 'code', width: 220 },
  { title: '外部能力', dataIndex: 'label', width: 180 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={record.status === 'available' ? 'success' : 'warning'}>{record.status}</Tag>
    ),
  },
  { title: '负责人', dataIndex: 'owner', width: 120, render: (_, record) => record.owner ?? '-' },
  { title: '路由', dataIndex: 'route', width: 220, render: (_, record) => record.route ?? '-' },
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

        setErrorMessage(error instanceof Error ? error.message : '场景详情加载失败');
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

  const metrics = useMemo(() => {
    if (!scene) {
      return [];
    }

    const availableRecordCount = scene.recordSkillDependencies.filter(
      (item) => item.status === 'available',
    ).length;
    const availableExternalCount = scene.externalSkillDependencies.filter(
      (item) => item.status === 'available',
    ).length;

    return [
      {
        label: '对象能力依赖',
        value: `${availableRecordCount} / ${scene.recordSkillDependencies.length}`,
        helper: 'shadow.* 对象能力覆盖度',
      },
      {
        label: '外部技能依赖',
        value: `${availableExternalCount} / ${scene.externalSkillDependencies.length}`,
        helper: 'ext.* 依赖覆盖度',
      },
      {
        label: '主要缺口数',
        value: `${scene.gaps.length}`,
        helper: '需要后续补齐的依赖项',
      },
      {
        label: '总体状态',
        value: scene.status,
        helper: '当前仅为准备态，不进入正式编排',
      },
    ];
  }, [scene]);

  if (!sceneKey) {
    return <Result status="404" title="场景组装详情不存在" />;
  }

  if (!loading && !errorMessage && !scene) {
    return <Result status="404" title="未找到对应场景草案" />;
  }

  return (
    <PageContainer
      title={scene?.label ?? '场景组装详情'}
      subTitle={scene?.businessGoal ?? '查看场景依赖矩阵、编排边界与缺口清单。'}
      extra={[
        <Button key="reload" onClick={() => window.location.reload()}>
          重新加载
        </Button>,
      ]}
    >
      <Alert
        type={errorMessage ? 'warning' : 'info'}
        showIcon
        message="只读场景治理"
        description={
          errorMessage
            ? `场景详情加载失败：${errorMessage}`
            : '此页只负责表达依赖关系和编排边界，真正的 scene.* 实现与保存发布不在本轮范围内。'
        }
      />

      {scene ? (
        <>
          <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
            {metrics.map((item) => (
              <StatisticCard
                key={item.label}
                style={{ minWidth: 250 }}
                statistic={{
                  title: item.label,
                  value: item.value,
                  description: item.helper,
                }}
              />
            ))}
          </Space>

          <ProCard style={{ marginTop: 16 }}>
            <Space wrap size={12}>
              <Tag color={getSceneAssemblyStatusColor(scene.status)}>{scene.status}</Tag>
              <Tag>{scene.key}</Tag>
              <Tag color="blue">{scene.entityAnchor}</Tag>
            </Space>
            <div style={{ marginTop: 12 }}>{scene.summary}</div>
          </ProCard>

          <ProCard title="依赖矩阵" style={{ marginTop: 16 }} loading={loading}>
            <ProCard
              title="对象能力依赖"
              type="inner"
              style={{ marginBottom: 16 }}
            >
              <ProTable<SceneAssemblyDependency>
                rowKey="code"
                search={false}
                toolBarRender={false}
                pagination={false}
                columns={recordDependencyColumns}
                dataSource={scene.recordSkillDependencies}
              />
            </ProCard>
            <ProCard title="外部技能依赖" type="inner">
              <ProTable<SceneAssemblyDependency>
                rowKey="code"
                search={false}
                toolBarRender={false}
                pagination={false}
                columns={externalDependencyColumns}
                dataSource={scene.externalSkillDependencies}
              />
            </ProCard>
          </ProCard>

          <ProCard title="编排边界" style={{ marginTop: 16 }} loading={loading}>
            <ProCard gutter={[16, 16]} wrap ghost>
              <ProCard colSpan={{ xs: 24, xl: 12 }} title="场景负责什么">
                <List
                  size="small"
                  dataSource={scene.boundaries.scene}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </ProCard>
              <ProCard colSpan={{ xs: 24, xl: 12 }} title="交给 shadow.* 的步骤">
                <List
                  size="small"
                  dataSource={scene.boundaries.shadow}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </ProCard>
              <ProCard colSpan={{ xs: 24, xl: 12 }} title="交给 ext.* 的步骤">
                <List
                  size="small"
                  dataSource={scene.boundaries.external}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </ProCard>
              <ProCard colSpan={{ xs: 24, xl: 12 }} title="写回确认边界">
                <List
                  size="small"
                  dataSource={scene.boundaries.writeback}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </ProCard>
            </ProCard>
          </ProCard>

          <ProCard title="缺口清单" style={{ marginTop: 16 }} loading={loading}>
            {scene.gaps.length === 0 ? (
              <Alert
                type="success"
                showIcon
                message="当前依赖已齐"
                description="依赖关系已满足，但场景仍停留在准备态，后续还需要正式编排实现。"
              />
            ) : (
              <List
                bordered
                dataSource={[
                  ...scene.recordSkillDependencies
                    .filter((item) => item.status === 'gap')
                    .map((item) => `${item.code}: ${item.reason ?? '对象能力缺失'}`),
                  ...scene.externalSkillDependencies
                    .filter((item) => item.status === 'risk')
                    .map((item) => `${item.code}: ${item.reason ?? '外部技能存在风险'}`),
                ]}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            )}
          </ProCard>
        </>
      ) : null}
    </PageContainer>
  );
};

export default SceneAssemblyDetailPage;
