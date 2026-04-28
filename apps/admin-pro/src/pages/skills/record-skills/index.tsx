import {
  PageContainer,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import { Alert, Button, Result, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type { ShadowObjectSummaryView } from '@shared';
import {
  fetchShadowObjectSkills,
  fetchShadowObjects,
  getActivationStatusColor,
  getActivationStatusLabel,
  getRefreshStatusColor,
  getRefreshStatusLabel,
  shadowObjectLabels,
} from '../shared';

const { Text } = Typography;

interface RecordSkillRow extends ShadowObjectSummaryView {
  skillCount: number;
}

function renderCompactText(value: string | null | undefined, options?: {
  width?: number;
  copyable?: boolean;
}) {
  if (!value) {
    return '-';
  }

  return (
    <Text
      style={{
        display: 'inline-block',
        maxWidth: options?.width ?? 220,
        whiteSpace: 'nowrap',
      }}
      ellipsis={{ tooltip: value }}
      copyable={options?.copyable ? { text: value } : undefined}
    >
      {value}
    </Text>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return renderCompactText(value, { width: 180 });
  }

  return renderCompactText(parsed.format('YYYY-MM-DD HH:mm:ss'), {
    width: 180,
    copyable: true,
  });
}

const columns: ProColumns<RecordSkillRow>[] = [
  {
    title: '对象',
    dataIndex: 'label',
    width: 180,
    render: (_, record) => (
      <Link
        to={`/skills/record-skills/${record.objectKey}`}
        state={{ fromRecordSkills: true }}
        prefetch
      >
        {shadowObjectLabels[record.objectKey]}
      </Link>
    ),
  },
  {
    title: '接入状态',
    dataIndex: 'activationStatus',
    width: 120,
    render: (_, record) => (
      <Tag color={getActivationStatusColor(record.activationStatus)}>
        {getActivationStatusLabel(record.activationStatus)}
      </Tag>
    ),
  },
  {
    title: '刷新状态',
    dataIndex: 'refreshStatus',
    width: 120,
    render: (_, record) => (
      <Tag color={getRefreshStatusColor(record.refreshStatus)}>
        {getRefreshStatusLabel(record.refreshStatus)}
      </Tag>
    ),
  },
  {
    title: '模板编码',
    dataIndex: 'formCodeId',
    width: 260,
    render: (_, record) => renderCompactText(record.formCodeId, { width: 240, copyable: true }),
  },
  {
    title: '快照版本',
    dataIndex: 'latestSnapshotVersion',
    width: 220,
    render: (_, record) =>
      renderCompactText(record.latestSnapshotVersion, { width: 200, copyable: true }),
  },
  {
    title: 'Schema Hash',
    dataIndex: 'latestSchemaHash',
    width: 200,
    render: (_, record) =>
      record.latestSchemaHash ? (
        <Text
          style={{ display: 'inline-block', maxWidth: 180, whiteSpace: 'nowrap' }}
          ellipsis={{ tooltip: record.latestSchemaHash }}
          copyable={{ text: record.latestSchemaHash }}
        >
          {record.latestSchemaHash}
        </Text>
      ) : (
        '-'
      ),
  },
  {
    title: '技能数',
    dataIndex: 'skillCount',
    width: 90,
  },
  {
    title: '最近刷新',
    dataIndex: 'lastRefreshAt',
    width: 180,
    render: (_, record) => formatDateTime(record.lastRefreshAt),
  },
  {
    title: '异常信息',
    dataIndex: 'lastError',
    ellipsis: true,
    render: (_, record) => record.lastError ?? '-',
  },
  {
    title: '操作',
    valueType: 'option',
    width: 120,
    render: (_, record) => [
      <Link
        key="detail"
        to={`/skills/record-skills/${record.objectKey}`}
        state={{ fromRecordSkills: true }}
        prefetch
      >
        查看技能详情
      </Link>,
    ],
  },
];

const RecordSkillsPage = () => {
  const [rows, setRows] = useState<RecordSkillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const objects = await fetchShadowObjects();
        const skillsByObject = await Promise.all(
          objects.map(async (objectItem) => ({
            objectKey: objectItem.objectKey,
            skills: await fetchShadowObjectSkills(objectItem.objectKey),
          })),
        );

        if (!alive) {
          return;
        }

        const rowsData = objects.map((objectItem) => ({
          ...objectItem,
          skillCount:
            skillsByObject.find((item) => item.objectKey === objectItem.objectKey)?.skills.length ?? 0,
        }));
        setRows(rowsData);
      } catch (error) {
        if (!alive) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : '记录系统技能页加载失败');
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
    const totalObjects = rows.length;
    const activeObjects = rows.filter((item) => item.activationStatus === 'active').length;
    const totalSkills = rows.reduce((sum, item) => sum + item.skillCount, 0);
    const failedObjects = rows.filter(
      (item) => item.refreshStatus === 'failed' || Boolean(item.lastError),
    ).length;

    return [
      {
        label: '真实对象数',
        value: `${totalObjects}`,
        helper: '当前纳入技能治理的全部对象',
      },
      {
        label: '激活对象数',
        value: `${activeObjects}`,
        helper: '当前允许刷新模板的对象',
      },
      {
        label: '已生成技能总数',
        value: `${totalSkills}`,
        helper: '按当前已生成技能汇总',
      },
      {
        label: '刷新异常对象数',
        value: `${failedObjects}`,
        helper: '存在刷新失败或异常提示',
      },
    ];
  }, [rows]);

  return (
    <PageContainer
      title="记录系统技能"
      subTitle="统一查看记录对象技能、刷新情况和字段准备情况。"
      extra={[
        <Button key="reload" onClick={() => window.location.reload()}>
          重新加载
        </Button>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        message="管理视图说明"
        description="这里聚焦对象接入状态、记录系统技能覆盖情况和刷新结果，方便管理员日常查看和排查。"
      />

      {errorMessage ? (
        <Result
          status="warning"
          title="记录系统技能页加载失败"
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
            style={{ minWidth: 240 }}
            statistic={{
              title: item.label,
              value: item.value,
              description: item.helper,
            }}
          />
        ))}
      </Space>

      <ProTable<RecordSkillRow>
        style={{ marginTop: 16 }}
        rowKey="objectKey"
        loading={loading}
        search={false}
        toolBarRender={false}
        pagination={false}
        scroll={{ x: 1480 }}
        columns={columns}
        dataSource={rows}
      />
    </PageContainer>
  );
};

export default RecordSkillsPage;
