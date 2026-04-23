import {
  PageContainer,
  ProForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  StatisticCard,
  ProTable,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, Divider, Result, Space, Tag, message } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import type { TraceLog } from '@shared';
import { settingPages, traceLogs } from '@shared';

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

const SettingsPage = () => {
  const location = useLocation();
  const pageKey = location.pathname.split('/').pop() ?? '';
  const config = settingPages[pageKey];

  if (!config) {
    return <Result status="404" title="设置页不存在" />;
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
