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
  Radio,
  Result,
  Select,
  Space,
  Switch,
  Tag,
  Tabs,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { ProColumns } from '@ant-design/pro-components';
import type {
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

const assetArtifactKindLabels: Record<string, string> = {
  company_research: '公司研究资料',
  recording_material: '录音资料包',
  analysis_material: '分析资料',
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
      title: '模型 / 服务提供方',
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

interface SkillJobFormValues {
  requestText: string;
  model?: SkillRuntimeModelName;
  attachmentsText?: string;
  workingDirectory?: string;
}

interface CompanyResearchConversationStep {
  key: string;
  title: string;
  description: string;
}

const companyResearchUsageDefaults = {
  chatEnabled: true,
  reuseMode: 'reuse_valid',
  saveMode: 'one_company_one_profile',
  relationMode: 'safe_customer_match',
  invalidMode: 'task_record_only',
};

const companyResearchConversationSteps: CompanyResearchConversationStep[] = [
  {
    key: 'resolve-customer',
    title: '先确认客户',
    description: '用户说“这个客户”时，先确定是哪一条客户资料。',
  },
  {
    key: 'read-records',
    title: '读取系统内资料',
    description: '读取客户资料、联系人、商机和跟进记录，作为系统内事实。',
  },
  {
    key: 'find-research',
    title: '查找公司研究',
    description: '优先使用已关联的公司研究；找不到时，再按公司名称查已有有效资料。',
  },
  {
    key: 'compose-answer',
    title: '组合回答',
    description: '把系统内资料、公司研究和建议判断分开说明，方便销售判断来源。',
  },
  {
    key: 'ask-before-research',
    title: '没有资料先询问',
    description: '没有有效公司研究时，只询问是否需要研究，不编造外部背景。',
  },
];

const companyResearchConversationColumns: ProColumns<CompanyResearchConversationStep>[] = [
  {
    title: '聊天步骤',
    dataIndex: 'title',
    width: 150,
  },
  {
    title: '系统怎么做',
    dataIndex: 'description',
  },
];

function CompanyResearchUsageConfigPreview() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5}>使用配置</Typography.Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          这里是面向普通管理员的配置设计稿，当前只展示推荐规则，不会保存到后台规则引擎。
        </Paragraph>
      </div>

      <Alert
        type="info"
        showIcon
        message="推荐规则"
        description="已有有效公司研究时直接复用；查不到有效资料时只保留任务记录，不进入聊天可引用资料。"
      />

      <Form
        disabled
        layout="vertical"
        initialValues={companyResearchUsageDefaults}
        style={{ maxWidth: 720 }}
      >
        <Form.Item
          label="聊天里可以使用公司研究"
          name="chatEnabled"
          valuePropName="checked"
          extra="开启后，客户聊天可以引用已经保存的有效公司研究。"
        >
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item
          label="已有公司研究时"
          name="reuseMode"
          extra="避免同一家公司反复研究，减少重复资料。"
        >
          <Radio.Group>
            <Radio value="reuse_valid">直接使用已有有效结果，不重新研究</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="研究结果怎么保存"
          name="saveMode"
          extra="同一家公司只保留一份可用资料；后续有效研究会进入历史版本。"
        >
          <Radio.Group>
            <Radio value="one_company_one_profile">同一家公司保存为一份资料</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="怎么和客户资料关联"
          name="relationMode"
          extra="只有明确知道是哪一个客户时才自动关联，匹配到多个客户时交给用户选择。"
        >
          <Radio.Group>
            <Radio value="safe_customer_match">唯一客户自动关联，多个客户让用户选择</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="没查到有效资料时"
          name="invalidMode"
          extra="不会让聊天引用这类结果，也不需要管理员额外标记。"
        >
          <Radio.Group>
            <Radio value="task_record_only">只保留任务记录，不作为可用资料</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>

      <div>
        <Typography.Title level={5}>聊天如何组合使用</Typography.Title>
        <ProTable<CompanyResearchConversationStep>
          rowKey="key"
          columns={companyResearchConversationColumns}
          dataSource={companyResearchConversationSteps}
          search={false}
          options={false}
          pagination={false}
          size="small"
        />
      </div>
    </Space>
  );
}

function getUpstreamMaterialConfig(skillCode: string): {
  materials: string[];
  actions: string[];
  enabled: boolean;
} | null {
  const configs: Record<string, { materials: string[]; actions: string[]; enabled: boolean }> = {
    'ext.visit_conversation_understanding': {
      materials: ['通义结构化分析 JSON', '录音资料包', '客户资料', '商机资料'],
      actions: ['拜访会话理解'],
      enabled: true,
    },
    'ext.customer_needs_todo_analysis': {
      materials: ['通义结构化分析 JSON', '录音资料包', '客户资料', '商机资料'],
      actions: ['客户需求工作待办分析'],
      enabled: true,
    },
    'ext.customer_value_positioning_pm': {
      materials: ['客户需求工作待办分析', '拜访会话理解', '客户资料', '商机资料'],
      actions: ['客户价值定位'],
      enabled: true,
    },
  };
  return configs[skillCode] ?? null;
}

function UpstreamMaterialPreview({ skill }: { skill: ExternalSkillCatalogItem }) {
  const config = getUpstreamMaterialConfig(skill.skillCode);
  if (!config) {
    return null;
  }

  return (
    <Alert
      type="info"
      showIcon
      message="可使用的上游资料"
      description={
        <Space direction="vertical" size={8}>
          <Space wrap>
            {config.materials.map((item) => (
              <Tag key={item} color={item.includes('结构化') ? 'processing' : item === '录音资料包' ? 'blue' : 'default'}>{item}</Tag>
            ))}
          </Space>
          <Typography.Text>用户看到的动作：{config.actions.join('、')}</Typography.Text>
          <Space>
            <Typography.Text>允许在聊天中基于录音资料使用此能力</Typography.Text>
            <Switch checked={config.enabled} disabled checkedChildren="开启" unCheckedChildren="关闭" />
          </Space>
        </Space>
      }
    />
  );
}

function ExternalSkillBasicInfo({ skill }: { skill: ExternalSkillCatalogItem }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type={getStatusAlertType(skill.status)}
        showIcon
        message={
          skill.status === '运行中'
            ? '能力运行正常'
            : skill.status === '告警中'
              ? '能力已注册，但当前存在配置或 provider 风险'
              : '能力仍为占位展示'
        }
        description={skill.summary}
      />
      <ProDescriptions<ExternalSkillCatalogItem> column={1} dataSource={skill}>
        <ProDescriptions.Item label="技能名称">{skill.label}</ProDescriptions.Item>
        <ProDescriptions.Item label="技能编码">{skill.skillCode}</ProDescriptions.Item>
        <ProDescriptions.Item label="实现方式">
          {implementationTypeLabels[skill.implementationType]}
        </ProDescriptions.Item>
        <ProDescriptions.Item label="是否可调用">
          <Tag color={skill.supportsInvoke ? 'success' : 'default'}>
            {skill.supportsInvoke ? '可调用' : '仅占位'}
          </Tag>
        </ProDescriptions.Item>
        <ProDescriptions.Item label="状态">
          <Tag color={getStatusColor(skill.status)}>{skill.status}</Tag>
        </ProDescriptions.Item>
        <ProDescriptions.Item label="模型">{skill.model ?? '—'}</ProDescriptions.Item>
        <ProDescriptions.Item label="服务提供方">{skill.provider ?? '—'}</ProDescriptions.Item>
        <ProDescriptions.Item label="触发方式">{skill.trigger}</ProDescriptions.Item>
        <ProDescriptions.Item label="路由">{skill.route ?? '—'}</ProDescriptions.Item>
        <ProDescriptions.Item label="负责人">{skill.owner}</ProDescriptions.Item>
        <ProDescriptions.Item label="SLA">{skill.sla}</ProDescriptions.Item>
        <ProDescriptions.Item label="依赖">
          <Space wrap>
            {skill.dependencies.map((dependency) => (
              <Tag key={dependency}>{dependency}</Tag>
            ))}
          </Space>
        </ProDescriptions.Item>
        <ProDescriptions.Item label="缺失依赖">
          {skill.missingDependencies && skill.missingDependencies.length > 0 ? (
            <Space wrap>
              {skill.missingDependencies.map((dependency) => (
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
      <ExternalSkillAssetMaterializationPreview skill={skill} />
      <UpstreamMaterialPreview skill={skill} />
    </Space>
  );
}

function ExternalSkillAssetMaterializationPreview({ skill }: { skill: ExternalSkillCatalogItem }) {
  const policy = skill.assetMaterialization ?? {
    enabled: false,
    label: '未配置',
    description: '当前技能未配置资料沉淀策略。',
  };

  return (
    <ProDescriptions column={1} title="资料沉淀策略">
      <ProDescriptions.Item label="是否沉淀资料">
        <Space>
          <Switch
            checked={policy.enabled}
            checkedChildren="开启"
            disabled
            unCheckedChildren="关闭"
          />
          <Tag color={policy.enabled ? 'success' : 'default'}>
            {policy.enabled ? '生成资料资产' : '仅返回结果'}
          </Tag>
        </Space>
      </ProDescriptions.Item>
      <ProDescriptions.Item label="资料类型">
        {policy.artifactKind ? assetArtifactKindLabels[policy.artifactKind] ?? policy.artifactKind : '—'}
      </ProDescriptions.Item>
      <ProDescriptions.Item label="策略标签">{policy.label}</ProDescriptions.Item>
      <ProDescriptions.Item label="说明">{policy.description ?? '—'}</ProDescriptions.Item>
    </ProDescriptions>
  );
}

function parseLineSeparatedPaths(value?: string): string[] | undefined {
  const items = (value ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function readReportReadyUrl(job: ExternalSkillJobResponse): string | null {
  const event = [...job.events]
    .reverse()
    .find((item) => item.type === 'report_ready' && item.data && typeof item.data === 'object');
  if (!event) {
    return null;
  }

  const openUrl = (event.data as { openUrl?: unknown }).openUrl;
  return typeof openUrl === 'string' && openUrl.trim() ? openUrl : null;
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

  const renderSkillJobDebugger = (skill: ExternalSkillCatalogItem) => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type={skill.status === '运行中' ? 'success' : 'warning'}
        showIcon
        message="统一 Job 调试台"
        description={
          skill.status === '运行中'
            ? '当前能力走独立 skill-runtime，支持提交调试请求、查看事件和下载 markdown 产物。'
            : '当前能力已挂到统一调试台，但底层 runtime 或依赖存在风险，提交时会返回可读错误。'
        }
      />

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
              skill.debugConfig?.requestPlaceholder
              || '请输入要交给该 skill 处理的内容或目标。'
            }
          />
        </Form.Item>

        {(skill.debugConfig?.supportedModels ?? []).length > 0 ? (
          <Form.Item label="模型" name="model">
            <Select
              options={(skill.debugConfig?.supportedModels ?? []).map((model) => ({
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
            placeholder="例如：\n/abs/path/input.md\n/abs/path/context.txt"
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
            description={`任务编号: ${skillJobResult.jobId}`}
          />

          <ProDescriptions<ExternalSkillJobResponse> column={1} dataSource={skillJobResult}>
            <ProDescriptions.Item label="技能编码">{skillJobResult.skillCode}</ProDescriptions.Item>
            <ProDescriptions.Item label="运行时技能">
              {skillJobResult.runtimeSkillName}
            </ProDescriptions.Item>
            <ProDescriptions.Item label="模型">
              {skillJobResult.model ?? '无需模型'}
            </ProDescriptions.Item>
            <ProDescriptions.Item label="创建时间">{skillJobResult.createdAt}</ProDescriptions.Item>
            <ProDescriptions.Item label="更新时间">{skillJobResult.updatedAt}</ProDescriptions.Item>
          </ProDescriptions>

          {readReportReadyUrl(skillJobResult) ? (
            <Alert
              type="success"
              showIcon
              message="报告已生成"
              description={
                <Button
                  type="link"
                  href={readReportReadyUrl(skillJobResult)!}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: 0 }}
                >
                  新页面打开报告
                </Button>
              }
            />
          ) : null}

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
                      : event.type === 'artifact'
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
  );

  const shouldUseDetailTabs = (skill: ExternalSkillCatalogItem) =>
    skill.skillCode === 'ext.company_research_pm'
    || (skill.debugMode === 'skill_job' && skill.supportsInvoke);

  const buildExternalSkillDetailTabs = (skill: ExternalSkillCatalogItem) => {
    const items = [
      {
        key: 'basic',
        label: '普通信息',
        children: <ExternalSkillBasicInfo skill={skill} />,
      },
    ];

    if (skill.skillCode === 'ext.company_research_pm') {
      items.push({
        key: 'usage',
        label: '使用配置',
        children: <CompanyResearchUsageConfigPreview />,
      });
    }

    if (skill.debugMode === 'skill_job' && skill.supportsInvoke) {
      items.push({
        key: 'job-debug',
        label: '统一 Job 调试台',
        children: renderSkillJobDebugger(skill),
      });
    }

    return items;
  };

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
              {shouldUseDetailTabs(current) ? (
                <Tabs
                  defaultActiveKey="basic"
                  items={buildExternalSkillDetailTabs(current)}
                />
              ) : (
                <ExternalSkillBasicInfo skill={current} />
              )}

              {current.skillCode === 'ext.image_generate' && current.supportsInvoke ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type={current.status === '运行中' ? 'success' : 'warning'}
                    showIcon
                    message="图片试运行台"
                    description={
                      current.status === '运行中'
                        ? '当前走真实 HTTP provider，生成结果仅用于后台即时预览，不进入正式任务沉淀。'
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
                        <ProDescriptions.Item label="服务提供方">{imageResult.provider}</ProDescriptions.Item>
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
              ) : shouldUseDetailTabs(current) ? null : (
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
