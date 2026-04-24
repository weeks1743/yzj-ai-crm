import {
  PageContainer,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import { Alert, Button, Result, Space, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { SceneAssemblyResolvedView } from '@shared';
import {
  fetchResolvedSceneAssemblyViews,
  getSceneAssemblyStatusColor,
} from '../shared';

const columns: ProColumns<SceneAssemblyResolvedView>[] = [
  {
    title: '场景名',
    dataIndex: 'label',
    width: 220,
    render: (_, record) => (
      <Link to={`/skills/scene-assembly/${record.key}`} prefetch>
        {record.label}
      </Link>
    ),
  },
  {
    title: '业务目标',
    dataIndex: 'businessGoal',
    ellipsis: true,
  },
  {
    title: '实体锚点',
    dataIndex: 'entityAnchor',
    width: 180,
  },
  {
    title: '对象能力依赖',
    dataIndex: 'recordSkillDependencies',
    width: 180,
    render: (_, record) => {
      const availableCount = record.recordSkillDependencies.filter(
        (item) => item.status === 'available',
      ).length;

      return `${availableCount} / ${record.recordSkillDependencies.length}`;
    },
  },
  {
    title: '外部技能依赖',
    dataIndex: 'externalSkillDependencies',
    width: 180,
    render: (_, record) => {
      const availableCount = record.externalSkillDependencies.filter(
        (item) => item.status === 'available',
      ).length;

      return `${availableCount} / ${record.externalSkillDependencies.length}`;
    },
  },
  {
    title: '当前状态',
    dataIndex: 'status',
    width: 120,
    render: (_, record) => (
      <Tag color={getSceneAssemblyStatusColor(record.status)}>{record.status}</Tag>
    ),
  },
  {
    title: '主要缺口',
    dataIndex: 'gaps',
    render: (_, record) =>
      record.gaps.length > 0 ? (
        <Space wrap>
          {record.gaps.map((gap) => (
            <Tag key={gap} color="warning">
              {gap}
            </Tag>
          ))}
        </Space>
      ) : (
        <Tag color="success">依赖已齐</Tag>
      ),
  },
  {
    title: '操作',
    valueType: 'option',
    width: 120,
    render: (_, record) => [
      <Link key="detail" to={`/skills/scene-assembly/${record.key}`} prefetch>
        查看详情
      </Link>,
    ],
  },
];

const SceneAssemblyPage = () => {
  const [rows, setRows] = useState<SceneAssemblyResolvedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [realRecordSkillCount, setRealRecordSkillCount] = useState(0);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const result = await fetchResolvedSceneAssemblyViews();
        if (!alive) {
          return;
        }

        setRows(result.views);
        setRealRecordSkillCount(
          Object.values(result.skillsByObject).reduce(
            (sum, item) => sum + (item?.length ?? 0),
            0,
          ),
        );
      } catch (error) {
        if (!alive) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : '场景组装准备页加载失败');
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
  }, []);

  const metrics = useMemo(() => {
    const sceneDraftCount = rows.length;
    const gapSceneCount = rows.filter((item) => item.status === '依赖缺口').length;
    const externalRiskCount = rows.reduce(
      (sum, item) =>
        sum + item.externalSkillDependencies.filter((dependency) => dependency.status === 'risk').length,
      0,
    );

    return [
      {
        label: '场景草案数',
        value: `${sceneDraftCount}`,
        helper: '当前固定场景草案',
      },
      {
        label: '可用对象能力数',
        value: `${realRecordSkillCount}`,
        helper: '按真实 shadow 对象能力汇总',
      },
      {
        label: '存在缺口的场景数',
        value: `${gapSceneCount}`,
        helper: '至少缺少一个必需 record skill',
      },
      {
        label: '外部技能风险项数',
        value: `${externalRiskCount}`,
        helper: '来自外部能力目录的告警项',
      },
    ];
  }, [realRecordSkillCount, rows]);

  return (
    <PageContainer
      title="场景组装准备"
      subTitle="只读准备中心，用来显式查看 scene.* 对 shadow.* 与 ext.* 的依赖关系和当前缺口。"
      extra={[
        <Button key="reload" onClick={() => window.location.reload()}>
          重新加载
        </Button>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        message="准备中心定位"
        description="本轮只做场景依赖可视化与治理准备，不做拖拽编排、保存、发布或执行。"
      />

      {errorMessage ? (
        <Result
          status="warning"
          title="场景组装准备页加载失败"
          subTitle={errorMessage}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          }
        />
      ) : null}

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

      <ProTable<SceneAssemblyResolvedView>
        style={{ marginTop: 16 }}
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        search={false}
        toolBarRender={false}
        pagination={false}
      />
    </PageContainer>
  );
};

export default SceneAssemblyPage;
