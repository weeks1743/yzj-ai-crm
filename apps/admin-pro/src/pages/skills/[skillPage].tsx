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
  Divider,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Result,
  Select,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
  EnterprisePptTemplateItem,
  EnterprisePptTemplateListResponse,
  ExternalSkillCatalogItem,
  ExternalSkillJobRequest,
  ExternalSkillJobResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  SkillRuntimeModelName,
  WritebackPolicy,
} from '@shared';
import { writebackPolicies } from '@shared';
import { requestJson } from '@/utils/request';
import { getSuperPptEditorUrl } from '@/utils/superPptEditor';

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

interface PresentationReadyEventData {
  pptId?: string;
  subject?: string;
  templateId?: string | null;
  coverUrl?: string | null;
  animation?: boolean;
  artifactId?: string;
}

interface SkillJobFormValues {
  requestText: string;
  model?: SkillRuntimeModelName;
  attachmentsText?: string;
  workingDirectory?: string;
}

function parseLineSeparatedPaths(value?: string): string[] | undefined {
  const items = (value ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function getPresentationReadyEvent(
  job: ExternalSkillJobResponse | null,
): PresentationReadyEventData | null {
  if (!job) {
    return null;
  }

  const event = [...job.events]
    .reverse()
    .find((item) => item.type === 'presentation_ready' && item.data && typeof item.data === 'object');

  return event ? (event.data as PresentationReadyEventData) : null;
}

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
  const [skillJobLoading, setSkillJobLoading] = useState(false);
  const [skillJobError, setSkillJobError] = useState<string | null>(null);
  const [lastSkillJobRequest, setLastSkillJobRequest] = useState<ExternalSkillJobRequest | null>(null);
  const [skillJobResult, setSkillJobResult] = useState<ExternalSkillJobResponse | null>(null);
  const [pptTemplateInfo, setPptTemplateInfo] = useState<EnterprisePptTemplateListResponse | null>(null);
  const [pptTemplateError, setPptTemplateError] = useState<string | null>(null);
  const [imageForm] = Form.useForm<ImageGenerationRequest>();
  const [skillJobForm] = Form.useForm<SkillJobFormValues>();

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

    void requestJson<EnterprisePptTemplateListResponse>('/api/settings/ppt-templates')
      .then((payload) => {
        if (!cancelled) {
          setPptTemplateInfo(payload);
          setPptTemplateError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPptTemplateInfo(null);
          setPptTemplateError(error instanceof Error ? error.message : '企业 PPT 模板信息加载失败');
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
    setSkillJobError(null);
    setLastSkillJobRequest(null);
    setSkillJobResult(null);
    imageForm.resetFields();
    skillJobForm.resetFields();
    imageForm.setFieldsValue({
      size: 'auto',
      quality: 'auto',
    });
    if (isExternalSkillRecord(row) && row.debugMode === 'skill_job') {
      skillJobForm.setFieldsValue({
        model: row.debugConfig?.defaultModel,
        requestText: '',
        attachmentsText: '',
        workingDirectory: '',
      });
    }
  };

  const columns = useMemo(
    () => buildColumns(pageKey, handleOpen),
    [pageKey],
  );

  const dataSource = isExternalSkillsPage ? externalSkills : pageMap['writeback-policies'].rows;
  const metrics = isExternalSkillsPage ? externalMetrics : pageMap['writeback-policies'].metrics;
  const presentationReadyEvent = useMemo(
    () => getPresentationReadyEvent(skillJobResult),
    [skillJobResult],
  );
  const activePptTemplate = pptTemplateInfo?.activeTemplate ?? null;

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

  const runSkillJob = async (payload: ExternalSkillJobRequest) => {
    if (!current || !isExternalSkillRecord(current)) {
      return;
    }

    setSkillJobLoading(true);
    setSkillJobError(null);
    setLastSkillJobRequest(payload);

    try {
      const result = await requestJson<ExternalSkillJobResponse>(
        `/api/external-skills/${encodeURIComponent(current.skillCode)}/jobs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      setSkillJobResult(result);
    } catch (error) {
      setSkillJobResult(null);
      setSkillJobError(error instanceof Error ? error.message : '调试提交失败');
    } finally {
      setSkillJobLoading(false);
    }
  };

  const handleInvokeSkillJob = async (values: SkillJobFormValues) => {
    const payload: ExternalSkillJobRequest = {
      requestText: values.requestText.trim(),
      model: values.model,
      attachments: parseLineSeparatedPaths(values.attachmentsText),
      workingDirectory: values.workingDirectory?.trim() || undefined,
    };
    await runSkillJob(payload);
  };

  useEffect(() => {
    if (
      !current
      || !isExternalSkillRecord(current)
      || current.debugMode !== 'skill_job'
      || !skillJobResult
      || (skillJobResult.status !== 'queued' && skillJobResult.status !== 'running')
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void requestJson<ExternalSkillJobResponse>(
        `/api/external-skills/jobs/${encodeURIComponent(skillJobResult.jobId)}`,
      )
        .then((payload) => {
          if (!cancelled) {
            setSkillJobResult(payload);
            setSkillJobError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSkillJobError(error instanceof Error ? error.message : '调试结果加载失败');
          }
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [current, skillJobResult]);

  return (
    <PageContainer title={config.title} subTitle={config.summary}>
      <Alert
        type="info"
        showIcon
        message={isExternalSkillsPage ? '真实目录 / 试运行台' : '目录 / 治理视图'}
        description={
          isExternalSkillsPage
            ? '这里展示 ext.* 的真实目录状态；当前支持 ext.image_generate 专属试运行，以及 implementationType=skill 的统一 Job 调试。'
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
                <ProDescriptions.Item label="缺失依赖">
                  {current.missingDependencies && current.missingDependencies.length > 0 ? (
                    <Space wrap>
                      {current.missingDependencies.map((dependency) => (
                        <Tag color="warning" key={dependency}>
                          {dependency}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    '—'
                  )}
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
              ) : current.debugMode === 'skill_job' && current.supportsInvoke ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type={current.status === '运行中' ? 'success' : 'warning'}
                    showIcon
                    message="统一 Job 调试台"
                    description={
                      current.status === '运行中'
                        ? '当前能力走独立 skill-runtime，支持提交调试请求、查看事件和下载 markdown 产物。'
                        : '当前能力已挂到统一调试台，但底层 runtime 或依赖存在风险，提交时会返回可读错误。'
                    }
                  />

                  {current.skillCode === 'ext.super_ppt' ? (
                    pptTemplateError ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="企业模板状态暂不可读"
                        description={pptTemplateError}
                      />
                    ) : activePptTemplate ? (
                      <Alert
                        type="success"
                        showIcon
                        message={`当前企业默认模板：${activePptTemplate.name}`}
                        description={`templateId: ${activePptTemplate.templateId}。super-ppt 会始终使用该企业默认模板生成，本次调试不支持临时覆盖。当前保存提示词：${pptTemplateInfo?.defaultPrompt ?? '未读取到'}；实际生效提示词：${pptTemplateInfo?.effectivePrompt ?? '未读取到'}${pptTemplateInfo?.isFallbackApplied ? `。${pptTemplateInfo.fallbackReason ?? ''}` : ''}`}
                      />
                    ) : (
                      <Alert
                        type="info"
                        showIcon
                        message="当前没有启用企业模板"
                        description={`本次 super-ppt 调试将回退到 Docmee 默认模板生成，不支持单次任务临时选模板。当前保存提示词：${pptTemplateInfo?.defaultPrompt ?? '未读取到'}；实际生效提示词：${pptTemplateInfo?.effectivePrompt ?? '未读取到'}${pptTemplateInfo?.isFallbackApplied ? `。${pptTemplateInfo.fallbackReason ?? ''}` : ''}`}
                      />
                    )
                  ) : null}

                  <Form<SkillJobFormValues>
                    form={skillJobForm}
                    layout="vertical"
                    onFinish={handleInvokeSkillJob}
                  >
                    <Form.Item
                      label="请求内容"
                      name="requestText"
                      rules={[{ required: true, message: '请输入调试请求内容' }]}
                    >
                      <TextArea
                        rows={6}
                        placeholder={
                          current.debugConfig?.requestPlaceholder
                          || '请输入要交给该 skill 处理的内容或目标。'
                        }
                      />
                    </Form.Item>

                    {(current.debugConfig?.supportedModels ?? []).length > 0 ? (
                      <Form.Item label="模型" name="model">
                        <Select
                          options={(current.debugConfig?.supportedModels ?? []).map((model) => ({
                            label: model,
                            value: model,
                          }))}
                          placeholder="使用默认模型"
                        />
                      </Form.Item>
                    ) : null}

                    <Form.Item label="附件路径（可选，一行一个绝对路径）" name="attachmentsText">
                      <TextArea
                        rows={4}
                        placeholder={
                          current.skillCode === 'ext.super_ppt'
                            ? '例如：\n/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/tmp/绍兴贝斯美化工企业研究报告.md'
                            : '例如：\n/abs/path/input.md\n/abs/path/context.txt'
                        }
                      />
                    </Form.Item>

                    <Form.Item label="工作目录（可选，绝对路径）" name="workingDirectory">
                      <Input placeholder="/abs/path/working-directory" />
                    </Form.Item>

                    <Space>
                      <Button type="primary" htmlType="submit" loading={skillJobLoading}>
                        提交调试
                      </Button>
                      {lastSkillJobRequest ? (
                        <Button
                          disabled={skillJobLoading}
                          onClick={() => {
                            void runSkillJob(lastSkillJobRequest);
                          }}
                        >
                          重试上次请求
                        </Button>
                      ) : null}
                    </Space>
                  </Form>

                  {skillJobError ? (
                    <Alert type="error" showIcon message="调试执行失败" description={skillJobError} />
                  ) : null}

                  {skillJobResult ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Alert
                        type={
                          skillJobResult.status === 'succeeded'
                            ? 'success'
                            : skillJobResult.status === 'failed'
                              ? 'error'
                              : 'info'
                        }
                        showIcon
                        message={`Job 状态：${skillJobResult.status}`}
                        description={`Job ID: ${skillJobResult.jobId}`}
                      />

                      <ProDescriptions<ExternalSkillJobResponse> column={1} dataSource={skillJobResult}>
                        <ProDescriptions.Item label="技能编码">{skillJobResult.skillCode}</ProDescriptions.Item>
                        <ProDescriptions.Item label="Runtime Skill">
                          {skillJobResult.runtimeSkillName}
                        </ProDescriptions.Item>
                        <ProDescriptions.Item label="模型">
                          {skillJobResult.model ?? '无需模型'}
                        </ProDescriptions.Item>
                        <ProDescriptions.Item label="创建时间">{skillJobResult.createdAt}</ProDescriptions.Item>
                        <ProDescriptions.Item label="更新时间">{skillJobResult.updatedAt}</ProDescriptions.Item>
                      </ProDescriptions>

                      <div>
                        <Typography.Title level={5}>最终文本</Typography.Title>
                        {skillJobResult.finalText ? (
                          <div
                            style={{
                              whiteSpace: 'pre-wrap',
                              background: '#fafafa',
                              border: '1px solid #f0f0f0',
                              borderRadius: 8,
                              padding: 12,
                            }}
                          >
                            {skillJobResult.finalText}
                          </div>
                        ) : (
                          <Empty description="当前尚未产出 finalText。" />
                        )}
                      </div>

                      <div>
                        <Typography.Title level={5}>产物</Typography.Title>
                        {skillJobResult.artifacts.length > 0 ? (
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            {presentationReadyEvent?.pptId ? (
                              <Alert
                                type="success"
                                showIcon
                                message={`PPT 已就绪：${presentationReadyEvent.subject || presentationReadyEvent.pptId}`}
                                description={
                                  <Space wrap>
                                    <Typography.Text type="secondary">
                                      pptId: {presentationReadyEvent.pptId}
                                    </Typography.Text>
                                    <Button
                                      type="primary"
                                      onClick={() => {
                                        window.open(
                                          getSuperPptEditorUrl(skillJobResult.jobId),
                                          '_blank',
                                          'noopener,noreferrer',
                                        );
                                      }}
                                    >
                                      独立打开编辑器
                                    </Button>
                                  </Space>
                                }
                              />
                            ) : null}
                            {skillJobResult.artifacts.map((artifact) => (
                              <Space key={artifact.artifactId} wrap>
                                <Typography.Text>{artifact.fileName}</Typography.Text>
                                <Tag>{artifact.mimeType}</Tag>
                                <Typography.Text type="secondary">
                                  {artifact.byteSize} bytes
                                </Typography.Text>
                                <Button type="link" href={artifact.downloadPath} target="_blank">
                                  下载
                                </Button>
                              </Space>
                            ))}
                          </Space>
                        ) : (
                          <Empty description="当前没有产物。" />
                        )}
                      </div>

                      <Divider style={{ margin: '8px 0' }} />

                      <div>
                        <Typography.Title level={5}>事件时间线</Typography.Title>
                        {skillJobResult.events.length > 0 ? (
                          <Timeline
                            items={skillJobResult.events.map((event) => ({
                              color:
                                event.type === 'error'
                                  ? 'red'
                                  : event.type === 'artifact' || event.type === 'presentation_ready'
                                    ? 'green'
                                    : 'blue',
                              children: (
                                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                  <Typography.Text>{event.message}</Typography.Text>
                                  <Typography.Text type="secondary">
                                    {event.createdAt} · {event.type}
                                  </Typography.Text>
                                </Space>
                              ),
                            }))}
                          />
                        ) : (
                          <Empty description="当前没有事件日志。" />
                        )}
                      </div>
                    </Space>
                  ) : (
                    <Empty description="尚未提交调试请求，执行后会在这里展示状态、事件和产物。" />
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
