import {
  PageContainer,
  ProCard,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation, useNavigate, useParams } from '@umijs/max';
import { Alert, Button, Drawer, Result, Space, Tabs, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  ShadowDictionaryBindingView,
  ShadowObjectDetailView,
  ShadowObjectKey,
  ShadowSkillView,
  ShadowStandardizedFieldView,
} from '@shared';
import {
  fetchShadowObjectDetail,
  fetchShadowObjectDictionaries,
  fetchShadowObjectSkills,
  formatJson,
  getActivationStatusColor,
  getActivationStatusLabel,
  getExecutionPhaseLabel,
  getRefreshStatusColor,
  getRefreshStatusLabel,
  refreshShadowObject,
  shadowObjectLabels,
  shadowOperationLabels,
} from '../shared';

const { Paragraph, Text } = Typography;

interface RecordSkillsLocationState {
  fromRecordSkills?: boolean;
}

function isShadowObjectKey(value: string | undefined): value is ShadowObjectKey {
  if (!value) {
    return false;
  }

  return value in shadowObjectLabels;
}

function renderTagList(items: string[], color?: string) {
  if (items.length === 0) {
    return <Text type="secondary">无</Text>;
  }

  return (
    <Space wrap>
      {items.map((item) => (
        <Tag key={item} color={color}>
          {item}
        </Tag>
      ))}
    </Space>
  );
}

function renderCompactValue(value: string | null | undefined, width = 420) {
  if (!value) {
    return '-';
  }

  return (
    <Text
      style={{
        display: 'inline-block',
        maxWidth: width,
        whiteSpace: 'nowrap',
      }}
      ellipsis={{ tooltip: value }}
      copyable={{ text: value }}
    >
      {value}
    </Text>
  );
}

function getExecutionPhaseColor(phase: ShadowSkillView['executionBinding']['phase']) {
  if (phase === 'live_write_enabled') {
    return 'error';
  }
  if (phase === 'live_read_enabled') {
    return 'success';
  }
  return 'default';
}

const fieldColumns: ProColumns<ShadowStandardizedFieldView>[] = [
  { title: 'fieldCode', dataIndex: 'fieldCode', width: 180, copyable: true },
  { title: '字段名', dataIndex: 'label', width: 180 },
  { title: '控件类型', dataIndex: 'widgetType', width: 180 },
  {
    title: '必填',
    dataIndex: 'required',
    width: 80,
    render: (_, record) => (record.required ? <Tag color="error">是</Tag> : '否'),
  },
  {
    title: '只读',
    dataIndex: 'readOnly',
    width: 80,
    render: (_, record) => (record.readOnly ? <Tag>是</Tag> : '否'),
  },
  {
    title: '多值',
    dataIndex: 'multi',
    width: 80,
    render: (_, record) => (record.multi ? <Tag color="processing">是</Tag> : '否'),
  },
  {
    title: '语义槽位',
    dataIndex: 'semanticSlot',
    width: 180,
    render: (_, record) => record.semanticSlot ?? '-',
  },
  {
    title: 'referId',
    dataIndex: 'referId',
    width: 160,
    render: (_, record) => record.referId ?? '-',
  },
  {
    title: '关联绑定',
    dataIndex: 'relationBinding',
    render: (_, record) =>
      record.relationBinding ? (
        <Space wrap>
          <Tag color="blue">{record.relationBinding.formCodeId ?? '关联模板未识别'}</Tag>
          <Tag>{record.relationBinding.modelName ?? '未知模型'}</Tag>
          <Tag>{record.relationBinding.displayCol ?? '未知展示列'}</Tag>
        </Space>
      ) : (
        '-'
      ),
  },
];

const dictionaryColumns: ProColumns<ShadowDictionaryBindingView>[] = [
  { title: 'fieldCode', dataIndex: 'fieldCode', width: 180, copyable: true },
  { title: '字段名', dataIndex: 'label', width: 180 },
  { title: 'referId', dataIndex: 'referId', width: 160, render: (_, record) => record.referId ?? '-' },
  { title: '来源', dataIndex: 'source', width: 120 },
  {
    title: '解析状态',
    dataIndex: 'resolutionStatus',
    width: 120,
    render: (_, record) => (
      <Tag color={record.resolutionStatus === 'resolved' ? 'success' : record.resolutionStatus === 'failed' ? 'error' : 'warning'}>
        {record.resolutionStatus}
      </Tag>
    ),
  },
  { title: '输入形态', dataIndex: 'acceptedValueShape', width: 180 },
  {
    title: '元素数',
    dataIndex: 'entries',
    width: 90,
    render: (_, record) => record.entries.length,
  },
  { title: '快照版本', dataIndex: 'snapshotVersion', width: 180 },
];

const referenceColumns: ProColumns<ShadowSkillView>[] = [
  { title: '技能', dataIndex: 'skillName', width: 220 },
  { title: 'skillPath', dataIndex: 'skillPath', copyable: true },
  {
    title: 'agentMetadataPath',
    dataIndex: 'agentMetadataPath',
    render: (_, record) => record.agentMetadataPath ?? '-',
  },
  {
    title: 'references',
    dataIndex: 'referencePaths',
    render: (_, record) => (
      <Space direction="vertical" size={4}>
        <Text copyable={{ text: record.referencePaths.skillBundle }}>
          bundle: {record.referencePaths.skillBundle}
        </Text>
        <Text copyable={{ text: record.referencePaths.templateSummary }}>
          template-summary: {record.referencePaths.templateSummary}
        </Text>
        <Text copyable={{ text: record.referencePaths.dictionaries }}>
          dictionaries: {record.referencePaths.dictionaries}
        </Text>
        <Text copyable={{ text: record.referencePaths.execution }}>
          execution: {record.referencePaths.execution}
        </Text>
      </Space>
    ),
  },
];

const RecordSkillDetailPage = () => {
  const params = useParams<{ objectKey: string }>();
  const navigate = useNavigate();
  const location = useLocation() as { state?: RecordSkillsLocationState };
  const objectKey = isShadowObjectKey(params.objectKey) ? params.objectKey : undefined;
  const [objectDetail, setObjectDetail] = useState<ShadowObjectDetailView | null>(null);
  const [skills, setSkills] = useState<ShadowSkillView[]>([]);
  const [dictionaries, setDictionaries] = useState<ShadowDictionaryBindingView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<ShadowSkillView | null>(null);

  const load = async (targetObjectKey: ShadowObjectKey) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const [detail, skillRows, dictionaryRows] = await Promise.all([
        fetchShadowObjectDetail(targetObjectKey),
        fetchShadowObjectSkills(targetObjectKey),
        fetchShadowObjectDictionaries(targetObjectKey),
      ]);

      setObjectDetail(detail);
      setSkills(skillRows);
      setDictionaries(dictionaryRows);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '对象详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!objectKey) {
      return;
    }

    void load(objectKey);
  }, [objectKey]);

  const pendingDictionaryCount = useMemo(
    () => dictionaries.filter((item) => item.resolutionStatus !== 'resolved').length,
    [dictionaries],
  );

  if (!objectKey) {
    return <Result status="404" title="对象详情不存在" />;
  }

  const handleBack = () => {
    if (location.state?.fromRecordSkills) {
      navigate(-1);
      return;
    }

    navigate('/skills/record-skills');
  };

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await refreshShadowObject(objectKey);
      await load(objectKey);
      message.success('模板快照已刷新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageContainer
      title={`${shadowObjectLabels[objectKey]}技能详情`}
      subTitle="查看当前对象的技能、字段准备情况和字典状态。"
      onBack={handleBack}
      extra={[
        <Button key="back" onClick={handleBack}>
          返回记录系统技能
        </Button>,
        <Button key="refresh" type="primary" loading={refreshing} onClick={() => void handleRefresh()}>
          刷新模板快照
        </Button>,
      ]}
    >
      <Alert
        type={errorMessage ? 'warning' : 'info'}
        showIcon
        message="当前对象说明"
        description={
          errorMessage
            ? `对象详情加载失败：${errorMessage}`
            : '这里主要展示对象当前可用技能、字段准备情况和字典状态，帮助管理员判断是否可以投入使用。'
        }
      />

      <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
        <StatisticCard
          style={{ minWidth: 220 }}
          loading={loading}
          statistic={{
            title: '对象状态',
            value: objectDetail ? getActivationStatusLabel(objectDetail.activationStatus) : '-',
            description: objectDetail?.formCodeId ? '已绑定业务模板' : '业务模板暂未配置',
          }}
        />
        <StatisticCard
          style={{ minWidth: 220 }}
          loading={loading}
          statistic={{
            title: '快照版本',
            value: objectDetail?.snapshotVersion ?? '-',
            description: objectDetail?.lastRefreshAt ?? '尚未刷新',
          }}
        />
        <StatisticCard
          style={{ minWidth: 220 }}
          loading={loading}
          statistic={{
            title: '字段数',
            value: objectDetail?.fields.length ?? 0,
            description: '标准化字段快照',
          }}
        />
        <StatisticCard
          style={{ minWidth: 220 }}
          loading={loading}
          statistic={{
            title: '技能数',
            value: skills.length,
            description: `待处理字典 ${pendingDictionaryCount} 项`,
          }}
        />
      </Space>

      <ProCard loading={loading} style={{ marginTop: 16 }}>
        <ProDescriptions<ShadowObjectDetailView> column={2} dataSource={objectDetail ?? undefined}>
          <ProDescriptions.Item label="模板编码">
            {renderCompactValue(objectDetail?.formCodeId, 360)}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="接入状态">
            {objectDetail ? (
              <Tag color={getActivationStatusColor(objectDetail.activationStatus)}>
                {getActivationStatusLabel(objectDetail.activationStatus)}
              </Tag>
            ) : (
              '-'
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="刷新状态">
            {objectDetail ? (
              <Tag color={getRefreshStatusColor(objectDetail.refreshStatus)}>
                {getRefreshStatusLabel(objectDetail.refreshStatus)}
              </Tag>
            ) : (
              '-'
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label="最近刷新">
            {objectDetail?.lastRefreshAt ?? '-'}
          </ProDescriptions.Item>
        </ProDescriptions>
        {objectDetail?.lastError ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message="最近一次刷新存在异常"
            description={objectDetail.lastError}
          />
        ) : null}
      </ProCard>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'skills',
            label: '技能清单',
            children:
              skills.length === 0 ? (
                <Result
                  status="info"
                  title="当前对象尚未生成技能"
                  subTitle="可先检查对象是否已激活、是否完成模板刷新。"
                />
              ) : (
                <ProCard gutter={[16, 16]} wrap ghost>
                  {skills.map((skill) => (
                    <ProCard
                      key={skill.skillName}
                      colSpan={{ xs: 24, xl: 12 }}
                      hoverable
                      bordered
                      style={{ cursor: 'pointer', height: '100%' }}
                      onClick={() => setSelectedSkill(skill)}
                      title={`${shadowOperationLabels[skill.operation]}技能`}
                      extra={
                        <Space>
                          <Tag color="blue">{skill.skillName}</Tag>
                          <Tag color={getExecutionPhaseColor(skill.executionBinding.phase)}>
                            {getExecutionPhaseLabel(skill.executionBinding.phase)}
                          </Tag>
                        </Space>
                      }
                    >
                      <Space direction="vertical" size={14} style={{ width: '100%' }}>
                        <Paragraph ellipsis={{ rows: 2, tooltip: skill.description }} style={{ marginBottom: 0 }}>
                          {skill.description}
                        </Paragraph>
                        <Space wrap>
                          <Tag color="error">必填 {skill.requiredParams.length}</Tag>
                          <Tag color="blue">可选 {skill.optionalParams.length}</Tag>
                          <Tag>{skill.confirmationPolicy}</Tag>
                        </Space>
                        <div>
                          <Text type="secondary">whenToUse</Text>
                          <Paragraph ellipsis={{ rows: 2, tooltip: skill.whenToUse }} style={{ marginBottom: 0, marginTop: 4 }}>
                            {skill.whenToUse}
                          </Paragraph>
                        </div>
                        <div>
                          <Text type="secondary">预览接口</Text>
                          <div style={{ marginTop: 4 }}>
                            {renderCompactValue(skill.executionBinding.previewApi.path, 420)}
                          </div>
                        </div>
                        <Button type="link" style={{ paddingInline: 0 }} onClick={(event) => {
                          event.stopPropagation();
                          setSelectedSkill(skill);
                        }}>
                          查看技能详情
                        </Button>
                      </Space>
                    </ProCard>
                  ))}
                </ProCard>
              ),
          },
          {
            key: 'fields',
            label: '字段快照',
            children: (
              <ProTable<ShadowStandardizedFieldView>
                rowKey="fieldCode"
                search={false}
                toolBarRender={false}
                pagination={false}
                columns={fieldColumns}
                dataSource={objectDetail?.fields ?? []}
                loading={loading}
              />
            ),
          },
          {
            key: 'dictionaries',
            label: '字典绑定',
            children: (
              <ProTable<ShadowDictionaryBindingView>
                rowKey={(record) => `${record.fieldCode}-${record.referId ?? 'none'}`}
                search={false}
                toolBarRender={false}
                pagination={false}
                columns={dictionaryColumns}
                dataSource={dictionaries}
                loading={loading}
              />
            ),
          },
          {
            key: 'references',
            label: '引用资源',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="仅展示引用路径"
                  description="本轮不在后台内联渲染原始 SKILL.md 或 template-raw.json 文件正文，管理员查看的是 bundle 路径和引用资源位置。"
                />
                <ProTable<ShadowSkillView>
                  rowKey="skillName"
                  search={false}
                  toolBarRender={false}
                  pagination={false}
                  columns={referenceColumns}
                  dataSource={skills}
                  loading={loading}
                />
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        width={860}
        title={selectedSkill ? `${shadowOperationLabels[selectedSkill.operation]}技能详情` : '技能详情'}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkill(null)}
      >
        {selectedSkill ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color="blue">{selectedSkill.skillName}</Tag>
              <Tag color={getExecutionPhaseColor(selectedSkill.executionBinding.phase)}>
                {getExecutionPhaseLabel(selectedSkill.executionBinding.phase)}
              </Tag>
              <Tag>{selectedSkill.confirmationPolicy}</Tag>
              <Tag>{selectedSkill.outputCardType}</Tag>
            </Space>

            <Paragraph style={{ marginBottom: 0 }}>{selectedSkill.description}</Paragraph>

            <ProDescriptions<ShadowSkillView>
              column={1}
              size="small"
              dataSource={selectedSkill}
            >
              <ProDescriptions.Item label="whenToUse">
                {selectedSkill.whenToUse}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="notWhenToUse">
                {selectedSkill.notWhenToUse}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="requiredParams">
                {renderTagList(selectedSkill.requiredParams, 'error')}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="optionalParams">
                {renderTagList(selectedSkill.optionalParams, 'blue')}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="previewApi">
                <Space direction="vertical" size={4}>
                  <Text>{selectedSkill.executionBinding.previewApi.method}</Text>
                  {renderCompactValue(selectedSkill.executionBinding.previewApi.path, 620)}
                </Space>
              </ProDescriptions.Item>
              <ProDescriptions.Item label="liveApi">
                {selectedSkill.executionBinding.liveApi ? (
                  <Space direction="vertical" size={4}>
                    <Text>{selectedSkill.executionBinding.liveApi.method}</Text>
                    {renderCompactValue(selectedSkill.executionBinding.liveApi.path, 620)}
                  </Space>
                ) : (
                  '未启用'
                )}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="LightCloud Preview">
                <Space direction="vertical" size={4}>
                  <Text>{selectedSkill.executionBinding.lightCloudPreview.method}</Text>
                  {renderCompactValue(selectedSkill.executionBinding.lightCloudPreview.url, 620)}
                </Space>
              </ProDescriptions.Item>
              <ProDescriptions.Item label="LightCloud Live">
                {selectedSkill.executionBinding.lightCloudLive ? (
                  <Space direction="vertical" size={4}>
                    <Text>{selectedSkill.executionBinding.lightCloudLive.method}</Text>
                    {renderCompactValue(selectedSkill.executionBinding.lightCloudLive.url, 620)}
                  </Space>
                ) : (
                  '未启用'
                )}
              </ProDescriptions.Item>
              <ProDescriptions.Item label="引用路径">
                <Space direction="vertical" size={4}>
                  {renderCompactValue(selectedSkill.skillPath, 620)}
                  {selectedSkill.agentMetadataPath ? (
                    renderCompactValue(selectedSkill.agentMetadataPath, 620)
                  ) : (
                    <Text type="secondary">无 agent metadata</Text>
                  )}
                </Space>
              </ProDescriptions.Item>
            </ProDescriptions>

            <div>
              <Text strong>Preview Payload Example</Text>
              <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {formatJson(selectedSkill.executionBinding.previewApi.payloadExample)}
              </pre>
            </div>

            {selectedSkill.executionBinding.liveApi ? (
              <div>
                <Text strong>Live Payload Example</Text>
                <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {formatJson(selectedSkill.executionBinding.liveApi.payloadExample)}
                </pre>
              </div>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default RecordSkillDetailPage;
