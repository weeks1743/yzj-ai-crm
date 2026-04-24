import {
  PageContainer,
  ProDescriptions,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Result,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  ExternalSkillCatalogItem,
  ImageGenerationRequest,
  ImageGenerationResponse,
  WritebackPolicy,
} from '@shared';
import { writebackPolicies } from '@shared';
import { requestJson } from '@/utils/request';

const { Paragraph } = Typography;
const { TextArea } = Input;

type RowData = ExternalSkillCatalogItem | WritebackPolicy;

const pageMap = {
  'external-skills': {
    title: '外部技能',
    summary: '统一查看 ext.* 能力的实现方式、可调用状态与当前风险，并在后台对首个真实能力进行试运行。',
  },
  'writeback-policies': {
    title: '写回确认策略',
    summary: '治理视图，用于查看对象写回确认边界、审批角色与回滚规则，不在本轮承担执行控制。',
    metrics: [
      { label: '对象策略数', value: `${writebackPolicies.length}`, helper: '当前静态治理草案' },
      { label: '高抽样策略', value: '100%', helper: '关键对象维持全量审计' },
    ],
    rows: writebackPolicies as RowData[],
  },
} as const;

const implementationTypeLabels: Record<ExternalSkillCatalogItem['implementationType'], string> = {
  http_request: 'HTTP 请求',
  tool: 'Tool',
  mcp: 'MCP',
  skill: 'Skill',
  placeholder: '占位能力',
};

function isExternalSkillRecord(record: RowData): record is ExternalSkillCatalogItem {
  return 'skillCode' in record;
}

function getStatusColor(status: ExternalSkillCatalogItem['status']) {
  switch (status) {
    case '运行中':
      return 'success';
    case '告警中':
      return 'warning';
    case '占位中':
      return 'default';
  }
}

function getStatusAlertType(status: ExternalSkillCatalogItem['status']) {
  switch (status) {
    case '运行中':
      return 'success';
    case '告警中':
      return 'warning';
    case '占位中':
      return 'info';
  }
}

function buildColumns(
  pageKey: keyof typeof pageMap,
  onOpen: (row: RowData) => void,
): ProColumns<RowData>[] {
  if (pageKey === 'writeback-policies') {
    return [
      {
        title: '对象',
        dataIndex: 'objectKey',
        render: (_, record) => <a onClick={() => onOpen(record)}>{(record as WritebackPolicy).objectKey}</a>,
      },
      { title: '策略', dataIndex: 'strategy' },
      { title: '触发时机', dataIndex: 'trigger' },
      { title: '审批角色', dataIndex: 'approver', width: 120 },
      { title: '审计抽样', dataIndex: 'auditSampling', width: 120 },
      { title: '回滚规则', dataIndex: 'rollbackRule' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
    ];
  }

  return [
    {
      title: '技能名称',
      dataIndex: 'label',
      render: (_, record) =>
        isExternalSkillRecord(record) ? <a onClick={() => onOpen(record)}>{record.label}</a> : null,
    },
    { title: '技能编码', dataIndex: 'skillCode', width: 220 },
    {
      title: '实现方式',
      dataIndex: 'implementationType',
      width: 130,
      render: (_, record) =>
        isExternalSkillRecord(record) ? (
          <Tag>{implementationTypeLabels[record.implementationType]}</Tag>
        ) : null,
    },
    {
      title: '是否可调用',
      dataIndex: 'supportsInvoke',
      width: 120,
      render: (_, record) =>
        isExternalSkillRecord(record) ? (
          <Tag color={record.supportsInvoke ? 'success' : 'default'}>
            {record.supportsInvoke ? '可调用' : '仅占位'}
          </Tag>
        ) : null,
    },
    {
      title: '模型 / Provider',
      width: 240,
      render: (_, record) =>
        isExternalSkillRecord(record) ? `${record.model ?? '-'} / ${record.provider ?? '-'}` : null,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, record) =>
        isExternalSkillRecord(record) ? (
          <Tag color={getStatusColor(record.status)}>{record.status}</Tag>
        ) : null,
    },
    { title: '负责人', dataIndex: 'owner', width: 120 },
  ];
}

const imageSizeOptions = [
  { label: 'auto', value: 'auto' },
  { label: '1024 x 1024', value: '1024x1024' },
  { label: '1536 x 1024', value: '1536x1024' },
  { label: '1024 x 1536', value: '1024x1536' },
];

const imageQualityOptions = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
];

const SkillsCatalogPage = () => {
  const location = useLocation();
  const pageKey = (location.pathname.split('/').pop() ?? '') as keyof typeof pageMap;
  const config = pageMap[pageKey];
  const isExternalSkillsPage = pageKey === 'external-skills';
  const [current, setCurrent] = useState<RowData | undefined>();
  const [externalSkills, setExternalSkills] = useState<ExternalSkillCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invokeLoading, setInvokeLoading] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<ImageGenerationRequest | null>(null);
  const [imageResult, setImageResult] = useState<ImageGenerationResponse | null>(null);
  const [imageForm] = Form.useForm<ImageGenerationRequest>();

  useEffect(() => {
    if (!isExternalSkillsPage) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    void requestJson<ExternalSkillCatalogItem[]>('/api/external-skills')
      .then((payload) => {
        if (!cancelled) {
          setExternalSkills(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setExternalSkills([]);
          setErrorMessage(error instanceof Error ? error.message : '外部技能目录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExternalSkillsPage]);

  const externalMetrics = useMemo(
    () => [
      {
        label: '真实能力数',
        value: `${externalSkills.filter((item) => item.implementationType !== 'placeholder').length}`,
        helper: '当前已接真实实现方式的 ext.* 能力',
      },
      {
        label: '占位能力数',
        value: `${externalSkills.filter((item) => item.status === '占位中').length}`,
        helper: '后续仍待接真实 provider 的 ext.* 能力',
      },
      {
        label: '告警能力数',
        value: `${externalSkills.filter((item) => item.status === '告警中').length}`,
        helper: '当前配置或 provider 存在风险的能力',
      },
    ],
    [externalSkills],
  );

  if (!config) {
    return <Result status="404" title="技能页不存在" />;
  }

  const handleOpen = (row: RowData) => {
    setCurrent(row);
    setInvokeError(null);
    setImageResult(null);
    setLastRequest(null);
    imageForm.resetFields();
    imageForm.setFieldsValue({
      size: 'auto',
      quality: 'auto',
    });
  };

  const columns = useMemo(
    () => buildColumns(pageKey, handleOpen),
    [pageKey],
  );

  const dataSource = isExternalSkillsPage ? externalSkills : pageMap['writeback-policies'].rows;
  const metrics = isExternalSkillsPage ? externalMetrics : pageMap['writeback-policies'].metrics;

  const handleInvokeImage = async (values: ImageGenerationRequest) => {
    setInvokeLoading(true);
    setInvokeError(null);
    setLastRequest(values);

    try {
      const result = await requestJson<ImageGenerationResponse>('/api/external-skills/image-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      setImageResult(result);
    } catch (error) {
      setImageResult(null);
      setInvokeError(error instanceof Error ? error.message : '图片生成失败');
    } finally {
      setInvokeLoading(false);
    }
  };

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message={isExternalSkillsPage ? '真实目录 / 试运行台' : '目录 / 治理视图'}
        description={
          isExternalSkillsPage
            ? '这里展示 ext.* 的真实目录状态；当前只对 ext.image_generate 开放后台试运行，其余能力继续按占位口径展示。'
            : '这里保留的是对象写回策略治理视图，不直接承担执行控制。'
        }
      />

      {errorMessage ? (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message={isExternalSkillsPage ? '外部技能目录加载失败' : '页面加载失败'}
          description={errorMessage}
        />
      ) : null}

      <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
        {metrics.map((item) => (
          <StatisticCard
            key={item.label}
            style={{ minWidth: 260 }}
            statistic={{
              title: item.label,
              value: item.value,
              description: item.helper,
            }}
          />
        ))}
      </Space>

      <ProTable<RowData>
        style={{ marginTop: 16 }}
        rowKey={(record) => (isExternalSkillRecord(record) ? record.skillCode : record.id)}
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        search={false}
        toolBarRender={false}
        pagination={false}
      />

      <Drawer
        size="large"
        open={Boolean(current)}
        onClose={() => setCurrent(undefined)}
        title={pageKey === 'writeback-policies' ? '策略详情' : '外部技能详情'}
      >
        {current ? (
          !isExternalSkillRecord(current) ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert
                type="warning"
                showIcon
                message="写回治理说明"
                description="本页只负责呈现当前对象的确认边界与审计要求，真正的写回执行仍应落在 shadow.* 技能和后续场景编排里。"
              />
              <ProDescriptions<WritebackPolicy> column={1} dataSource={current}>
                <ProDescriptions.Item label="对象">{current.objectKey}</ProDescriptions.Item>
                <ProDescriptions.Item label="策略">{current.strategy}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发时机">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="审批角色">{current.approver}</ProDescriptions.Item>
                <ProDescriptions.Item label="审计抽样">{current.auditSampling}</ProDescriptions.Item>
                <ProDescriptions.Item label="回滚规则">{current.rollbackRule}</ProDescriptions.Item>
                <ProDescriptions.Item label="更新时间">{current.updatedAt}</ProDescriptions.Item>
              </ProDescriptions>
            </Space>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert
                type={getStatusAlertType(current.status)}
                showIcon
                message={
                  current.status === '运行中'
                    ? '能力运行正常'
                    : current.status === '告警中'
                      ? '能力已注册，但当前存在配置或 provider 风险'
                      : '能力仍为占位展示'
                }
                description={current.summary}
              />
              <ProDescriptions<ExternalSkillCatalogItem> column={1} dataSource={current}>
                <ProDescriptions.Item label="技能名称">{current.label}</ProDescriptions.Item>
                <ProDescriptions.Item label="技能编码">{current.skillCode}</ProDescriptions.Item>
                <ProDescriptions.Item label="实现方式">
                  {implementationTypeLabels[current.implementationType]}
                </ProDescriptions.Item>
                <ProDescriptions.Item label="是否可调用">
                  <Tag color={current.supportsInvoke ? 'success' : 'default'}>
                    {current.supportsInvoke ? '可调用' : '仅占位'}
                  </Tag>
                </ProDescriptions.Item>
                <ProDescriptions.Item label="状态">
                  <Tag color={getStatusColor(current.status)}>{current.status}</Tag>
                </ProDescriptions.Item>
                <ProDescriptions.Item label="模型">{current.model ?? '—'}</ProDescriptions.Item>
                <ProDescriptions.Item label="Provider">{current.provider ?? '—'}</ProDescriptions.Item>
                <ProDescriptions.Item label="触发方式">{current.trigger}</ProDescriptions.Item>
                <ProDescriptions.Item label="路由">{current.route ?? '—'}</ProDescriptions.Item>
                <ProDescriptions.Item label="负责人">{current.owner}</ProDescriptions.Item>
                <ProDescriptions.Item label="SLA">{current.sla}</ProDescriptions.Item>
                <ProDescriptions.Item label="依赖">
                  <Space wrap>
                    {current.dependencies.map((dependency) => (
                      <Tag key={dependency}>{dependency}</Tag>
                    ))}
                  </Space>
                </ProDescriptions.Item>
              </ProDescriptions>

              {current.skillCode === 'ext.image_generate' && current.supportsInvoke ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type={current.status === '运行中' ? 'success' : 'warning'}
                    showIcon
                    message="图片试运行台"
                    description={
                      current.status === '运行中'
                        ? '当前走真实 HTTP provider，生成结果仅用于后台即时预览，不进入正式 AI 资产体系。'
                        : '当前仍可试运行，但如果缺少本地 .env 配置，接口会返回可读错误而不会静默失败。'
                    }
                  />

                  <Form<ImageGenerationRequest>
                    form={imageForm}
                    layout="vertical"
                    initialValues={{ size: 'auto', quality: 'auto' }}
                    onFinish={handleInvokeImage}
                  >
                    <Form.Item
                      label="Prompt"
                      name="prompt"
                      rules={[{ required: true, message: '请输入图片生成 prompt' }]}
                    >
                      <TextArea
                        rows={4}
                        placeholder="例如：生成一张橙色科技感的 AI 销售助手品牌海报，适合作为后台产品首页视觉图。"
                      />
                    </Form.Item>
                    <Space align="start" size={16} wrap>
                      <Form.Item label="尺寸" name="size" style={{ minWidth: 180 }}>
                        <Select options={imageSizeOptions} />
                      </Form.Item>
                      <Form.Item label="质量" name="quality" style={{ minWidth: 180 }}>
                        <Select options={imageQualityOptions} />
                      </Form.Item>
                    </Space>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={invokeLoading}>
                        生成图片
                      </Button>
                      {lastRequest ? (
                        <Button
                          disabled={invokeLoading}
                          onClick={() => {
                            void handleInvokeImage(lastRequest);
                          }}
                        >
                          重试上次请求
                        </Button>
                      ) : null}
                    </Space>
                  </Form>

                  {invokeError ? (
                    <Alert type="error" showIcon message="图片生成失败" description={invokeError} />
                  ) : null}

                  {imageResult ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Image
                        src={imageResult.previewDataUrl}
                        alt="图片生成预览"
                        style={{
                          width: '100%',
                          maxWidth: 560,
                          borderRadius: 12,
                          border: '1px solid #f0f0f0',
                        }}
                      />
                      <ProDescriptions<ImageGenerationResponse> column={1} dataSource={imageResult}>
                        <ProDescriptions.Item label="模型">{imageResult.model}</ProDescriptions.Item>
                        <ProDescriptions.Item label="Provider">{imageResult.provider}</ProDescriptions.Item>
                        <ProDescriptions.Item label="尺寸">{imageResult.size}</ProDescriptions.Item>
                        <ProDescriptions.Item label="质量">{imageResult.quality}</ProDescriptions.Item>
                        <ProDescriptions.Item label="MIME 类型">{imageResult.mimeType}</ProDescriptions.Item>
                        <ProDescriptions.Item label="耗时">
                          {imageResult.latencyMs} ms
                        </ProDescriptions.Item>
                        <ProDescriptions.Item label="生成时间">
                          {imageResult.generatedAt}
                        </ProDescriptions.Item>
                      </ProDescriptions>
                    </Space>
                  ) : (
                    <Empty description={loading ? '正在加载目录...' : '尚未生成图片，填写 Prompt 后可在这里预览结果。'} />
                  )}
                </Space>
              ) : (
                <Paragraph style={{ marginBottom: 0 }}>
                  当前能力仍保留为目录治理视图。后续接入真实 provider 后，再在这里补执行入口和结果卡片。
                </Paragraph>
              )}
            </Space>
          )
        ) : null}
      </Drawer>
    </PageContainer>
  );
};

export default SkillsCatalogPage;
