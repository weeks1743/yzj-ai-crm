import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  StatisticCard,
  ProTable,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Button, Divider, Result, Space, Spin, Tag, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  ApiErrorResponse,
  CredentialSummary,
  ManualSyncStartResponse,
  OrgSyncRunSummary,
  OrgSyncSettingsResponse,
  TenantAppSettingsResponse,
  TraceLog,
  YzjAuthSettingsResponse,
} from '@shared';
import { settingPages, traceLogs } from '@shared';

const { Text } = Typography;

const observabilityColumns: ProColumns<TraceLog>[] = [
  { title: '追踪ID', dataIndex: 'traceId', copyable: true, width: 180 },
  { title: '任务ID', dataIndex: 'taskId', copyable: true, width: 140 },
  { title: '租户ID', dataIndex: 'eid', width: 170 },
  { title: '应用ID', dataIndex: 'appId', width: 170 },
  { title: '场景', dataIndex: 'scene', width: 170 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (_, record) => (
      <Tag color={record.status === '成功' ? 'success' : 'warning'}>{record.status}</Tag>
    ),
  },
  {
    title: '工具调用链',
    dataIndex: 'toolChain',
    render: (_, record) => record.toolChain.join(' -> '),
  },
  { title: '写回结果', dataIndex: 'writebackResult' },
  { title: '时间', dataIndex: 'timestamp', width: 170 },
];

const credentialColumns: ProColumns<CredentialSummary>[] = [
  { title: '配置项', dataIndex: 'label', width: 160 },
  {
    title: '状态',
    dataIndex: 'configured',
    width: 120,
    render: (_, record) => (
      <Tag color={record.configured ? 'success' : 'error'}>
        {record.configured ? '已配置' : '未配置'}
      </Tag>
    ),
  },
  { title: '脱敏摘要', dataIndex: 'maskedValue', copyable: true, width: 200 },
  { title: '说明', dataIndex: 'description' },
];

const orgSyncRunColumns: ProColumns<OrgSyncRunSummary>[] = [
  { title: '运行ID', dataIndex: 'id', copyable: true, width: 240 },
  {
    title: '触发方式',
    dataIndex: 'triggerType',
    width: 100,
    render: (_, record) => <Tag>{record.triggerType === 'manual' ? '手动' : record.triggerType}</Tag>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 120,
    render: (_, record) => {
      if (record.status === 'completed') {
        return <Tag color="success">成功</Tag>;
      }
      if (record.status === 'failed') {
        return <Tag color="error">失败</Tag>;
      }
      return <Tag color="processing">运行中</Tag>;
    },
  },
  { title: '开始时间', dataIndex: 'startedAt', width: 180 },
  {
    title: '完成时间',
    dataIndex: 'finishedAt',
    width: 180,
    render: (_, record) => record.finishedAt ?? '-',
  },
  { title: '分页数', dataIndex: 'pageCount', width: 90 },
  { title: '拉取数', dataIndex: 'fetchedCount', width: 90 },
  { title: '写入数', dataIndex: 'upsertedCount', width: 90 },
  { title: '跳过数', dataIndex: 'skippedCount', width: 90 },
  {
    title: '错误信息',
    dataIndex: 'errorMessage',
    ellipsis: true,
    render: (_, record) => record.errorMessage ?? '-',
  },
];

type RealPageKey = 'tenant-app' | 'yzj-auth' | 'org-sync';
type RealPagePayload = TenantAppSettingsResponse | YzjAuthSettingsResponse | OrgSyncSettingsResponse;

const realPageKeys = new Set<RealPageKey>(['tenant-app', 'yzj-auth', 'org-sync']);

function isRealPageKey(pageKey: string): pageKey is RealPageKey {
  return realPageKeys.has(pageKey as RealPageKey);
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as T | ApiErrorResponse)
    : ({ message: await response.text() } as ApiErrorResponse);

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' && payload && 'message' in payload
        ? payload.message
        : '请求失败';
    throw new Error(errorMessage);
  }

  return payload as T;
}

function renderMetrics(items: Array<{ key: string; label: string; value: string | number; helper: string }>) {
  return (
    <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
      {items.map((item) => (
        <StatisticCard
          key={item.key}
          style={{ minWidth: 260 }}
          statistic={{
            title: item.label,
            value: item.value,
            description: item.helper,
          }}
        />
      ))}
    </Space>
  );
}

const SettingsPage = () => {
  const location = useLocation();
  const pageKey = location.pathname.split('/').pop() ?? '';
  const config = settingPages[pageKey];
  const [realPageData, setRealPageData] = useState<RealPagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reloadRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});

  reloadRef.current = async (silent = false) => {
    if (!isRealPageKey(pageKey)) {
      return;
    }

    if (!silent) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      if (pageKey === 'tenant-app') {
        setRealPageData(await requestJson<TenantAppSettingsResponse>('/api/settings/tenant-app'));
      } else if (pageKey === 'yzj-auth') {
        setRealPageData(await requestJson<YzjAuthSettingsResponse>('/api/settings/yzj-auth'));
      } else {
        setRealPageData(await requestJson<OrgSyncSettingsResponse>('/api/settings/org-sync'));
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : '设置页加载失败';
      setErrorMessage(messageText);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isRealPageKey(pageKey)) {
      setRealPageData(null);
      setErrorMessage(null);
      setLoading(false);
      return;
    }

    void reloadRef.current();
  }, [pageKey]);

  useEffect(() => {
    if (pageKey !== 'org-sync') {
      return;
    }

    const data = realPageData as OrgSyncSettingsResponse | null;
    if (!data?.isSyncing) {
      return;
    }

    const timer = window.setInterval(() => {
      void reloadRef.current(true);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [pageKey, realPageData]);

  const handleManualSync = async () => {
    setActionLoading(true);
    try {
      const result = await requestJson<ManualSyncStartResponse>('/api/settings/org-sync/manual-sync', {
        method: 'POST',
      });
      message.success(`${result.message}，运行 ID: ${result.runId}`);
      await reloadRef.current();
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '手动同步触发失败');
      await reloadRef.current(true);
    } finally {
      setActionLoading(false);
    }
  };

  if (!config) {
    return <Result status="404" title="设置页不存在" />;
  }

  if (isRealPageKey(pageKey)) {
    const title = config.title;
    const subTitle = config.summary;

    return (
      <PageContainer title={title} subTitle={subTitle}>
        <Alert
          type="info"
          showIcon
          message="真实联调设置"
          description="这三类设置页已接入 admin-api：凭据从本地 .env 读取，页面只做只读展示与手动同步操作，不在后台明文保存任何密钥。"
        />

        {loading && !realPageData ? (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Spin tip="正在加载真实设置..." />
          </div>
        ) : null}

        {errorMessage ? (
          <Result
            status="warning"
            title="设置页加载失败"
            subTitle={errorMessage}
            extra={
              <Button type="primary" onClick={() => void reloadRef.current()}>
                重新加载
              </Button>
            }
          />
        ) : null}

        {!loading && !errorMessage && realPageData && pageKey === 'tenant-app' ? (
          <>
            {renderMetrics([
              { key: 'eid', label: '租户 EID', value: realPageData.eid, helper: '当前接入租户识别键' },
              { key: 'appId', label: '应用实例', value: realPageData.appId, helper: '当前自建应用实例标识' },
              { key: 'configSource', label: '配置来源', value: realPageData.configSource, helper: '当前阶段统一从本地 .env 读取' },
            ])}

            <ProCard style={{ marginTop: 16 }}>
              <ProDescriptions<TenantAppSettingsResponse> column={2} dataSource={realPageData}>
                <ProDescriptions.Item label="应用名称" dataIndex="appName" />
                <ProDescriptions.Item
                  label="启用状态"
                  render={(_, record) => (
                    <Tag color={record.enabled ? 'success' : 'default'}>
                      {record.enabled ? '已启用' : '未启用'}
                    </Tag>
                  )}
                />
                <ProDescriptions.Item label="EID" dataIndex="eid" />
                <ProDescriptions.Item label="App ID" dataIndex="appId" />
                <ProDescriptions.Item label="隔离键" dataIndex="isolationKey" />
                <ProDescriptions.Item label="配置来源" dataIndex="configSource" />
              </ProDescriptions>
            </ProCard>
          </>
        ) : null}

        {!loading && !errorMessage && realPageData && pageKey === 'yzj-auth' ? (
          <>
            {renderMetrics([
              { key: 'baseUrl', label: '服务根地址', value: realPageData.yzjServerBaseUrl, helper: '当前云之家服务端根地址' },
              { key: 'scope', label: 'Token Scope', value: realPageData.tokenScope, helper: '组织通讯录读取使用 resGroupSecret' },
              { key: 'credentialCount', label: '配置项数量', value: realPageData.credentials.length, helper: '只读展示脱敏摘要' },
            ])}

            <ProCard style={{ marginTop: 16 }}>
              <ProDescriptions<YzjAuthSettingsResponse> column={1} dataSource={realPageData}>
                <ProDescriptions.Item label="Token 接口" dataIndex="tokenEndpoint" />
                <ProDescriptions.Item label="在职人员接口" dataIndex="employeeEndpoint" />
              </ProDescriptions>
            </ProCard>

            <ProTable<CredentialSummary>
              style={{ marginTop: 16 }}
              rowKey="key"
              search={false}
              toolBarRender={false}
              pagination={false}
              columns={credentialColumns}
              dataSource={realPageData.credentials}
            />
          </>
        ) : null}

        {!loading && !errorMessage && realPageData && pageKey === 'org-sync' ? (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="当前阶段口径"
              description="只支持手动触发的一次性全量同步，只同步在职人员；不做定时任务、不做增量同步，也不处理部门、角色与上下级关系。"
            />

            {renderMetrics([
              {
                key: 'employeeCount',
                label: '在职人员快照',
                value: realPageData.employeeCount,
                helper: '当前 SQLite 中已保存的在职人员数量',
              },
              {
                key: 'syncMode',
                label: '同步模式',
                value: '手动全量',
                helper: `分页大小 ${realPageData.pageSize}，定时任务 ${realPageData.schedulerEnabled ? '已启用' : '未启用'}`,
              },
              {
                key: 'lastRun',
                label: '最近状态',
                value:
                  realPageData.lastRun?.status === 'completed'
                    ? '成功'
                    : realPageData.lastRun?.status === 'failed'
                      ? '失败'
                      : realPageData.isSyncing
                        ? '运行中'
                        : '未执行',
                helper: realPageData.lastRun?.finishedAt ?? '尚未完成过同步',
              },
            ])}

            <ProCard
              style={{ marginTop: 16 }}
              title="手动同步"
              extra={
                <Button
                  type="primary"
                  loading={actionLoading}
                  disabled={realPageData.isSyncing}
                  onClick={() => void handleManualSync()}
                >
                  {realPageData.isSyncing ? '同步进行中' : '手动同步'}
                </Button>
              }
            >
              <Space direction="vertical" size={8}>
                <Text>同步来源：云之家组织通讯录只读密钥换取的 `resGroupSecret` AccessToken。</Text>
                <Text>同步范围：全部在职人员；接口分页从 `begin=0` 开始，按 `count=1000` 遍历。</Text>
                <Text>
                  最近一次运行：
                  {realPageData.lastRun
                    ? ` ${realPageData.lastRun.id}（${realPageData.lastRun.status}）`
                    : ' 暂无记录'}
                </Text>
              </Space>
            </ProCard>

            <ProTable<OrgSyncRunSummary>
              style={{ marginTop: 16 }}
              rowKey="id"
              headerTitle="最近同步记录"
              search={false}
              toolBarRender={false}
              pagination={false}
              columns={orgSyncRunColumns}
              dataSource={realPageData.recentRuns}
              scroll={{ x: 1600 }}
            />
          </>
        ) : null}
      </PageContainer>
    );
  }

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message="配置说明"
        description="这些设置以正式后台能力组织，不简化成一个普通“设置页”，并为后续真实云之家联调与模型接入预留位置。"
      />

      <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
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

      <ProForm
        style={{ marginTop: 16 }}
        submitter={{
          searchConfig: {
            submitText: '保存配置',
            resetText: '恢复默认',
          },
        }}
        onFinish={async () => {
          message.success('已保存当前页面原型配置。');
        }}
        initialValues={Object.fromEntries(
          config.groups.flatMap((group) => group.fields.map((field) => [field.name, field.value])),
        )}
      >
        {config.groups.map((group) => (
          <div key={group.key}>
            <Divider orientation="left">{group.title}</Divider>
            <Alert
              type="success"
              showIcon
              message={group.summary}
              description={
                <>
                  {group.healthNote}
                  <div style={{ marginTop: 8 }}>
                    {group.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                </>
              }
              style={{ marginBottom: 16 }}
            />
            {group.fields.map((field) => {
              if (field.kind === 'switch') {
                return (
                  <ProFormSwitch
                    key={field.name}
                    name={field.name}
                    label={field.label}
                  />
                );
              }
              if (field.kind === 'select') {
                return (
                  <ProFormSelect
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    options={(field.options ?? []).map((option) => ({
                      label: option,
                      value: option,
                    }))}
                  />
                );
              }
              if (field.kind === 'textarea') {
                return (
                  <ProFormTextArea
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    fieldProps={{ autoSize: { minRows: 3, maxRows: 6 } }}
                  />
                );
              }
              return (
                <ProFormText
                  key={field.name}
                  name={field.name}
                  label={field.label}
                />
              );
            })}
          </div>
        ))}
      </ProForm>

      {pageKey === 'observability' ? (
        <ProTable<TraceLog>
          style={{ marginTop: 24 }}
          rowKey="traceId"
          headerTitle="追踪 / 任务 / 工具调用链"
          search={false}
          toolBarRender={false}
          pagination={false}
          columns={observabilityColumns}
          dataSource={traceLogs}
          scroll={{ x: 1600 }}
        />
      ) : null}
    </PageContainer>
  );
};

export default SettingsPage;
