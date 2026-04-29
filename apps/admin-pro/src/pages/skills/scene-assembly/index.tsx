import {
  PageContainer,
  ProCard,
  ProTable,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import {
  Drawer,
  Alert,
  Button,
  Segmented,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  SceneAssemblyCategory,
  SceneAssemblyResolvedView,
} from '@shared';
import {
  fetchResolvedSceneAssemblyViews,
  getOrderedSalesPhases,
  getSalesPhaseByStage,
  getSalesPhaseColor,
  getSceneAssemblyStatusColor,
  salesPhaseMeta,
  sortSceneAssemblyViewsBySalesStage,
} from '../shared';

const { Paragraph, Text } = Typography;

type SceneFilter = '全部' | SceneAssemblyCategory;
type StageFilter = '全部阶段' | string;

function formatSceneStatus(status: SceneAssemblyResolvedView['status']) {
  if (status === '待组装') {
    return '已可用';
  }

  return status;
}

function renderCompactTags(values: string[], color?: string) {
  return (
    <Space wrap size={[4, 6]}>
      {values.slice(0, 2).map((item) => (
        <Tag key={item} color={color}>
          {item}
        </Tag>
      ))}
      {values.length > 2 ? <Tag>+{values.length - 2}</Tag> : null}
    </Space>
  );
}

function formatPlanStepRequirement(requirement: string) {
  if (requirement === 'required') {
    return '必选';
  }
  if (requirement === 'conditional') {
    return '条件';
  }
  return '可选';
}

const columns: ProColumns<SceneAssemblyResolvedView>[] = [
  {
    title: '场景技能',
    dataIndex: 'label',
    width: 320,
    render: (_, record) => (
      <Space direction="vertical" size={6}>
        <Space wrap size={[6, 6]}>
          <Link to={`/skills/scene-assembly/${record.key}`}>{record.label}</Link>
          <Tag color={record.category === '复合场景' ? 'purple' : 'blue'}>
            {record.category}
          </Tag>
        </Space>
        <Text type="secondary" ellipsis={{ tooltip: record.businessGoal }}>
          {record.businessGoal}
        </Text>
      </Space>
    ),
  },
  {
    title: '适用阶段',
    dataIndex: 'salesStage',
    width: 120,
    ellipsis: true,
  },
  {
    title: '业务锚点',
    dataIndex: 'entityAnchor',
    width: 180,
    ellipsis: true,
  },
  {
    title: '主要入口',
    dataIndex: 'triggerEntries',
    width: 260,
    render: (_, record) => (
      <Text ellipsis={{ tooltip: record.triggerEntries[0] }}>
        {record.triggerEntries[0]}
      </Text>
    ),
  },
  {
    title: '推荐计划模式',
    dataIndex: 'playbook',
    width: 240,
    render: (_, record) => renderCompactTags(record.playbook.planModes, 'geekblue'),
  },
  {
    title: '可选步骤',
    dataIndex: 'playbook',
    width: 170,
    render: (_, record) => {
      const optionalCount = record.playbook.stepLibrary.filter(
        (item) => item.requirement !== 'required',
      ).length;
      return `${optionalCount} 个可跳过 / ${record.playbook.stepLibrary.length} 个步骤`;
    },
  },
  {
    title: '守卫规则',
    dataIndex: 'playbook',
    width: 260,
    render: (_, record) => (
      <Text ellipsis={{ tooltip: record.playbook.policies[0]?.confirmation }}>
        {record.playbook.policies[0]?.confirmation ?? '-'}
      </Text>
    ),
  },
  {
    title: '依赖健康',
    dataIndex: 'status',
    width: 110,
    render: (_, record) => (
      <Tag color={getSceneAssemblyStatusColor(record.status)}>
        {formatSceneStatus(record.status)}
      </Tag>
    ),
  },
  {
    title: '操作',
    valueType: 'option',
    width: 100,
    render: (_, record) => [
      <Link key="detail" to={`/skills/scene-assembly/${record.key}`}>
        查看详情
      </Link>,
    ],
  },
];

const SceneAssemblyPage = () => {
  const [rows, setRows] = useState<SceneAssemblyResolvedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<SceneFilter>('全部');
  const [stageFilter, setStageFilter] = useState<StageFilter>('全部阶段');
  const [previewSceneKey, setPreviewSceneKey] = useState<string | null>(null);

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

        setRows(sortSceneAssemblyViewsBySalesStage(result.views));
      } catch (error) {
        if (!alive) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : '场景技能页加载失败');
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

  const categoryFilteredRows = useMemo(() => {
    if (filter === '全部') {
      return rows;
    }

    return rows.filter((item) => item.category === filter);
  }, [filter, rows]);

  const phaseSummaries = useMemo(
    () =>
      getOrderedSalesPhases(categoryFilteredRows.map((item) => item.salesStage)).map((phaseName) => {
        const phaseRows = categoryFilteredRows.filter(
          (item) => getSalesPhaseByStage(item.salesStage) === phaseName,
        );
        return {
          phaseName,
          rows: phaseRows,
          meta: salesPhaseMeta[phaseName],
        };
      }),
    [categoryFilteredRows],
  );

  const activePhaseName = useMemo(() => {
    if (!phaseSummaries.length || stageFilter === '全部阶段') {
      return undefined;
    }

    if (stageFilter !== '全部阶段' && phaseSummaries.some((item) => item.phaseName === stageFilter)) {
      return stageFilter;
    }
  }, [phaseSummaries, stageFilter]);

  const stageOptions = useMemo(
    () => [
      { label: '全部阶段', value: '全部阶段' },
      ...phaseSummaries.map((item) => ({
        label: `${item.phaseName} (${item.rows.length})`,
        value: item.phaseName,
      })),
    ],
    [phaseSummaries],
  );

  const filteredRows = useMemo(() => {
    if (stageFilter === '全部阶段') {
      return categoryFilteredRows;
    }

    return categoryFilteredRows.filter((item) => getSalesPhaseByStage(item.salesStage) === stageFilter);
  }, [categoryFilteredRows, stageFilter]);

  useEffect(() => {
    if (
      stageFilter !== '全部阶段'
      && !phaseSummaries.some((item) => item.phaseName === stageFilter)
    ) {
      setStageFilter('全部阶段');
    }
  }, [stageFilter, phaseSummaries]);

  const previewScene = useMemo(() => {
    return filteredRows.find((item) => item.key === previewSceneKey) ?? null;
  }, [filteredRows, previewSceneKey]);

  const activePhaseSummary = useMemo(
    () => phaseSummaries.find((item) => item.phaseName === activePhaseName) ?? null,
    [activePhaseName, phaseSummaries],
  );

  return (
    <PageContainer
      title="场景技能"
      subTitle="管理可生成用户计划的业务计划手册，重点看能力边界、推荐步骤、守卫规则和依赖健康。"
      extra={[
        <Button key="reload" onClick={() => window.location.reload()}>
          重新加载
        </Button>,
      ]}
    >
      {errorMessage ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="场景技能页加载失败"
          description={errorMessage}
        />
      ) : null}

      <ProCard
        title="销售阶段地图"
        style={{ marginBottom: 16 }}
        extra={(
          <Space wrap size={12}>
            <Text type="secondary">按 CRM 客户生命周期查看计划手册，管理员维护边界，用户在对话中裁剪计划</Text>
            {stageFilter !== '全部阶段' ? (
              <Button type="link" style={{ paddingInline: 0 }} onClick={() => setStageFilter('全部阶段')}>
                查看全部阶段
              </Button>
            ) : null}
          </Space>
        )}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(phaseSummaries.length, 1)}, minmax(0, 1fr))`,
              gap: 0,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            {phaseSummaries.map((phaseItem, index) => {
              const isActive = activePhaseName === phaseItem.phaseName;
              const backgroundColor = isActive ? '#1677ff' : '#f5f5f5';
              const borderColor = isActive ? '#1677ff' : '#d9d9d9';
              const textColor = isActive ? '#ffffff' : 'rgba(0, 0, 0, 0.88)';

              return (
                <div
                  key={phaseItem.phaseName}
                  role="button"
                  tabIndex={0}
                  onClick={() => setStageFilter(phaseItem.phaseName)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setStageFilter(phaseItem.phaseName);
                    }
                  }}
                  style={{
                    position: 'relative',
                    minWidth: 0,
                    height: 72,
                    padding: '0 30px 0 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: backgroundColor,
                    borderTop: `1px solid ${borderColor}`,
                    borderBottom: `1px solid ${borderColor}`,
                    borderLeft: index === 0 ? `1px solid ${borderColor}` : 'none',
                    borderRadius:
                      index === 0
                        ? '10px 0 0 10px'
                        : index === phaseSummaries.length - 1
                          ? '0 10px 10px 0'
                          : 0,
                    cursor: 'pointer',
                    zIndex: isActive ? 3 : phaseSummaries.length - index,
                  }}
                >
                  {index < phaseSummaries.length - 1 ? (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        right: -14,
                        top: '50%',
                        width: 28,
                        height: 28,
                        background: backgroundColor,
                        borderTop: `1px solid ${borderColor}`,
                        borderRight: `1px solid ${borderColor}`,
                        transform: 'translateY(-50%) rotate(45deg)',
                      }}
                    />
                  ) : null}

                  <Text
                    style={{
                      color: textColor,
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                    ellipsis
                  >
                    {phaseItem.phaseName}
                  </Text>

                  <Tag
                    color={isActive ? 'rgba(255,255,255,0.18)' : getSalesPhaseColor(phaseItem.phaseName)}
                    style={{
                      color: isActive ? '#ffffff' : undefined,
                      marginInlineEnd: 0,
                      border: 'none',
                    }}
                  >
                    {phaseItem.rows.length} 个
                  </Tag>
                </div>
              );
            })}
          </div>

          {activePhaseSummary ? (
            <div
              style={{
                width: '100%',
                padding: 20,
                border: '1px solid #f0f0f0',
                borderRadius: 12,
                background: '#fafafa',
                boxSizing: 'border-box',
              }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap size={[8, 8]}>
                  <Tag color={getSalesPhaseColor(activePhaseSummary.phaseName)}>
                    {activePhaseSummary.meta?.indexLabel ?? '阶段'}
                  </Tag>
                  <Text strong style={{ fontSize: 16 }}>
                    {activePhaseSummary.phaseName}
                  </Text>
                </Space>
                <Paragraph style={{ marginBottom: 0 }}>
                  {activePhaseSummary.meta?.focus ?? '查看当前阶段的关键目标。'}
                </Paragraph>
              </Space>
            </div>
          ) : null}
        </div>
      </ProCard>

      <ProTable<SceneAssemblyResolvedView>
        rowKey="key"
        loading={loading}
        headerTitle={stageFilter === '全部阶段' ? '场景清单' : `${stageFilter} 场景清单`}
        columns={[
          ...columns.slice(0, columns.length - 1),
          {
            title: '操作',
            valueType: 'option',
            width: 140,
            fixed: 'right',
            render: (_, record) => [
              <Button
                key="preview"
                type="link"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewSceneKey(record.key);
                }}
                style={{ paddingInline: 0 }}
              >
                预览
              </Button>,
              <Link key="detail" to={`/skills/scene-assembly/${record.key}`}>
                详情
              </Link>,
            ],
          },
        ]}
        dataSource={filteredRows}
        search={false}
        pagination={false}
        toolBarRender={() => [
          <Space key="scene-toolbar" wrap size={12}>
            <Segmented<SceneFilter>
              value={filter}
              onChange={setFilter}
              options={['全部', '复合场景', '分析场景']}
            />
            <Select<StageFilter>
              value={stageFilter}
              onChange={setStageFilter}
              options={stageOptions}
              style={{ width: 240 }}
            />
          </Space>,
        ]}
        options={false}
        cardBordered
        scroll={{ x: 1280 }}
        onRow={(record) => ({
          onClick: () => setPreviewSceneKey(record.key),
        })}
      />

      <Drawer
        title="当前场景预览"
        width={520}
        open={Boolean(previewScene)}
        onClose={() => setPreviewSceneKey(null)}
        destroyOnClose={false}
      >
        {previewScene ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Space wrap size={[8, 8]}>
                <Tag color={previewScene.category === '复合场景' ? 'purple' : 'blue'}>
                  {previewScene.category}
                </Tag>
                <Tag color="cyan">{previewScene.salesStage}</Tag>
                <Tag color={getSceneAssemblyStatusColor(previewScene.status)}>
                  {formatSceneStatus(previewScene.status)}
                </Tag>
              </Space>
              <Paragraph style={{ marginTop: 12, marginBottom: 8 }}>
                <Text strong>{previewScene.label}</Text>
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {previewScene.summary}
              </Paragraph>
            </div>

            <div>
              <Text strong>真实入口</Text>
              <div style={{ marginTop: 8 }}>
                {renderCompactTags(previewScene.triggerEntries, 'blue')}
              </div>
            </div>

            <div>
                <Text strong>推荐计划变体</Text>
                <div style={{ marginTop: 12 }}>
                  <Steps
                    size="small"
                    direction="vertical"
                    current={0}
                    items={previewScene.playbook.variants.map((item) => ({
                      title: item.label,
                      description: item.summary,
                    }))}
                  />
                </div>
              </div>

              <div>
                <Text strong>步骤库</Text>
                <div style={{ marginTop: 8 }}>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {previewScene.playbook.stepLibrary.slice(0, 5).map((item) => (
                      <Space key={item.key} wrap size={[6, 6]}>
                        <Tag color={item.requirement === 'required' ? 'red' : item.requirement === 'conditional' ? 'gold' : 'blue'}>
                          {formatPlanStepRequirement(item.requirement)}
                        </Tag>
                        <Text>{item.label}</Text>
                        {item.canSkip ? <Tag>可跳过</Tag> : null}
                        {item.canPause ? <Tag>可暂停</Tag> : null}
                      </Space>
                    ))}
                  </Space>
                </div>
            </div>

            <div>
              <Text strong>主要外部供给</Text>
              <div style={{ marginTop: 8 }}>
                {renderCompactTags(
                  previewScene.externalSkillDependencies.map((item) => item.label),
                  'gold',
                )}
              </div>
            </div>

            <div>
              <Text strong>用户可决定</Text>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                {previewScene.playbook.variants[0]?.userDecisions.map((item) => (
                  <li key={item} style={{ marginBottom: 4 }}>
                    <Text type="secondary">{item}</Text>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <Text strong>守卫与写回</Text>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                {previewScene.playbook.policies.map((item) => (
                  <li key={item.confirmation} style={{ marginBottom: 4 }}>
                    <Text type="secondary">{item.confirmation}</Text>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <Link to={`/skills/scene-assembly/${previewScene.key}`}>打开完整详情</Link>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default SceneAssemblyPage;
