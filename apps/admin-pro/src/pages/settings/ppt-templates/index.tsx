import {
  PageContainer,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  EnterprisePptTemplateItem,
  EnterprisePptTemplateListResponse,
  EnterprisePptTemplatePromptResponse,
  EnterprisePptTemplateUploadResponse,
} from '@shared';
import { requestJson } from '@/utils/request';

const templateColumns: ProColumns<EnterprisePptTemplateItem>[] = [
  {
    title: '模板名称',
    dataIndex: 'name',
    ellipsis: true,
  },
  {
    title: 'Template ID',
    dataIndex: 'templateId',
    copyable: true,
    ellipsis: true,
    width: 260,
  },
  {
    title: '源文件',
    dataIndex: 'sourceFileName',
    ellipsis: true,
    width: 220,
  },
  {
    title: '状态',
    dataIndex: 'isActive',
    width: 120,
    render: (_, record) => (
      <Tag color={record.isActive ? 'success' : 'default'}>
        {record.isActive ? '企业默认' : '未启用'}
      </Tag>
    ),
  },
  {
    title: '创建时间',
    dataIndex: 'createdAt',
    width: 180,
  },
  {
    title: '更新时间',
    dataIndex: 'updatedAt',
    width: 180,
  },
];

const EnterprisePptTemplateSettingsPage = () => {
  const [templates, setTemplates] = useState<EnterprisePptTemplateItem[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<EnterprisePptTemplateItem | null>(null);
  const [promptInfo, setPromptInfo] = useState<EnterprisePptTemplateListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<EnterprisePptTemplateItem | null>(null);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [uploadForm] = Form.useForm<{ name?: string }>();
  const [renameForm] = Form.useForm<{ name: string }>();
  const [promptForm] = Form.useForm<{ defaultPrompt: string }>();
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  reloadRef.current = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const payload = await requestJson<EnterprisePptTemplateListResponse>('/api/settings/ppt-templates');
      setTemplates(payload.items);
      setActiveTemplate(payload.activeTemplate);
      setPromptInfo(payload);
      promptForm.setFieldsValue({
        defaultPrompt: payload.defaultPrompt,
      });
    } catch (error) {
      setTemplates([]);
      setActiveTemplate(null);
      setPromptInfo(null);
      setErrorMessage(error instanceof Error ? error.message : '企业 PPT 模板列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadRef.current();
  }, []);

  const metrics = useMemo(
    () => [
      {
        key: 'count',
        label: '企业模板数',
        value: templates.length,
        helper: '仅统计本系统上传并登记到本地 SQLite 的模板',
      },
      {
        key: 'active',
        label: '当前启用模板',
        value: activeTemplate ? activeTemplate.name : 'Docmee 默认模板',
        helper: activeTemplate
          ? `templateId: ${activeTemplate.templateId}`
          : '当前无启用模板，super-ppt 生成时将回退到 Docmee 默认模板',
      },
      {
        key: 'strategy',
        label: '模板策略',
        value: '多模板 / 单启用',
        helper: 'super-ppt 始终使用企业默认模板，不开放单次任务覆盖',
      },
    ],
    [activeTemplate, templates.length],
  );

  const handleUpload: UploadProps['beforeUpload'] = () => false;

  const submitPrompt = async (values: { defaultPrompt: string }) => {
    setSavingPrompt(true);
    try {
      const payload = await requestJson<EnterprisePptTemplatePromptResponse>(
        '/api/settings/ppt-templates/default-prompt',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: values.defaultPrompt.trim(),
          }),
        },
      );
      promptForm.setFieldsValue({
        defaultPrompt: payload.defaultPrompt,
      });
      message.success('企业 PPT 缺省提示词已保存');
      await reloadRef.current();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '企业 PPT 缺省提示词保存失败');
    } finally {
      setSavingPrompt(false);
    }
  };

  const submitUpload = async (values: { name?: string }) => {
    const file = uploadFileList[0]?.originFileObj;
    if (!file) {
      message.warning('请先选择 .pptx 模板文件');
      return;
    }

    const formData = new FormData();
    formData.set('file', file);
    if (values.name?.trim()) {
      formData.set('name', values.name.trim());
    }

    setSubmitting(true);
    try {
      const payload = await requestJson<EnterprisePptTemplateUploadResponse>(
        '/api/settings/ppt-templates/upload',
        {
          method: 'POST',
          body: formData,
        },
      );
      message.success(`模板上传成功：${payload.item.name}`);
      setUploadOpen(false);
      setUploadFileList([]);
      uploadForm.resetFields();
      await reloadRef.current();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRename = async (values: { name: string }) => {
    if (!renameTarget) {
      return;
    }

    setSubmitting(true);
    try {
      await requestJson<{ item: EnterprisePptTemplateItem }>(
        `/api/settings/ppt-templates/${encodeURIComponent(renameTarget.templateId)}/rename`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: values.name.trim(),
          }),
        },
      );
      message.success('模板名称已更新');
      setRenameTarget(null);
      renameForm.resetFields();
      await reloadRef.current();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板重命名失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = (record: EnterprisePptTemplateItem) => {
    Modal.confirm({
      title: '设为企业默认模板',
      content: `确认将“${record.name}”设为企业默认模板吗？后续 super-ppt 会始终使用它生成。`,
      okText: '确认启用',
      cancelText: '取消',
      onOk: async () => {
        await requestJson<{ item: EnterprisePptTemplateItem }>(
          `/api/settings/ppt-templates/${encodeURIComponent(record.templateId)}/activate`,
          {
            method: 'POST',
          },
        );
        message.success('已设为企业默认模板');
        await reloadRef.current();
      },
    });
  };

  const handleDelete = (record: EnterprisePptTemplateItem) => {
    Modal.confirm({
      title: '删除企业 PPT 模板',
      content: record.isActive
        ? `“${record.name}”当前是企业默认模板，删除后系统会回退到 Docmee 默认模板。确认继续吗？`
        : `确认删除模板“${record.name}”吗？`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        await requestJson<{ deletedTemplateId: string }>(
          `/api/settings/ppt-templates/${encodeURIComponent(record.templateId)}/delete`,
          {
            method: 'POST',
          },
        );
        message.success('模板已删除');
        await reloadRef.current();
      },
    });
  };

  return (
    <PageContainer
      title="企业PPT模板"
      subTitle="在系统设置中统一管理企业级 PPT 模板，并为 super-ppt 提供唯一生效的默认模板。"
    >
      <Alert
        type="info"
        showIcon
        message="企业模板管理口径"
        description="v1 仅管理本系统上传并登记到本地 SQLite 的模板，不扫描 Docmee 远端全量模板。生成时始终命中当前企业默认模板；如无启用模板，则回退到 Docmee 默认模板。"
      />

      {errorMessage ? (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message="模板列表加载失败"
          description={errorMessage}
        />
      ) : null}

      <Space wrap size={16} style={{ width: '100%', marginTop: 16 }}>
        {metrics.map((item) => (
          <StatisticCard
            key={item.key}
            style={{ minWidth: 280 }}
            statistic={{
              title: item.label,
              value: item.value,
              description: item.helper,
            }}
          />
        ))}
      </Space>

      <Card style={{ marginTop: 16 }} title="企业缺省提示词">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="super-ppt 生成提示词"
            description={`每次调用 super-ppt 时，系统都会把这里的提示词与完整 Markdown 原文一并提交给 Docmee。Docmee 官方建议该提示词不超过 ${promptInfo?.promptMaxLength ?? 50} 个字符，系统运行时会使用“实际生效提示词”。`}
          />

          {promptInfo?.isFallbackApplied ? (
            <Alert
              type="warning"
              showIcon
              message="当前保存的提示词过长"
              description={`${promptInfo.fallbackReason} 当前实际生效提示词：${promptInfo.effectivePrompt}`}
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message="当前提示词可直接用于 Docmee"
              description={`实际生效提示词：${promptInfo?.effectivePrompt ?? '未读取到'}`}
            />
          )}

          <Form<{ defaultPrompt: string }>
            form={promptForm}
            layout="vertical"
            onFinish={submitPrompt}
          >
            <Form.Item
              label="缺省提示词"
              name="defaultPrompt"
              rules={[
                { required: true, message: '请输入企业 PPT 缺省提示词' },
                {
                  validator: async (_, value: string | undefined) => {
                    const length = [...(value?.trim() || '')].length;
                    if (length > (promptInfo?.promptMaxLength ?? 50)) {
                      throw new Error(`企业 PPT 缺省提示词不能超过 ${promptInfo?.promptMaxLength ?? 50} 个字符`);
                    }
                  },
                },
              ]}
              extra={`建议控制在 ${promptInfo?.promptMaxLength ?? 50} 个字符以内，确保与 Docmee V2 官方约束一致。`}
            >
              <Input.TextArea
                rows={6}
                placeholder="请输入 super-ppt 的企业级缺省提示词"
                showCount
              />
            </Form.Item>

            <Space>
              <Button type="primary" htmlType="submit" loading={savingPrompt}>
                保存提示词
              </Button>
            </Space>
          </Form>
        </Space>
      </Card>

      <ProTable<EnterprisePptTemplateItem>
        style={{ marginTop: 16 }}
        rowKey="templateId"
        loading={loading}
        search={false}
        pagination={false}
        columns={[
          ...templateColumns,
          {
            title: '操作',
            valueType: 'option',
            width: 260,
            render: (_, record) => [
              <Button
                key="rename"
                type="link"
                onClick={() => {
                  setRenameTarget(record);
                  renameForm.setFieldsValue({
                    name: record.name,
                  });
                }}
              >
                重命名
              </Button>,
              <Button
                key="activate"
                type="link"
                disabled={record.isActive}
                onClick={() => {
                  handleActivate(record);
                }}
              >
                设为默认
              </Button>,
              <Button
                key="download"
                type="link"
                href={`/api/settings/ppt-templates/${encodeURIComponent(record.templateId)}/download`}
                target="_blank"
              >
                下载
              </Button>,
              <Button
                key="delete"
                type="link"
                danger
                onClick={() => {
                  handleDelete(record);
                }}
              >
                删除
              </Button>,
            ],
          },
        ]}
        dataSource={templates}
        toolBarRender={() => [
          <Button
            key="upload"
            type="primary"
            onClick={() => {
              setUploadOpen(true);
            }}
          >
            上传模板
          </Button>,
        ]}
      />

      <Modal
        destroyOnClose
        open={uploadOpen}
        title="上传企业 PPT 模板"
        okText="上传"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => {
          void uploadForm.submit();
        }}
        onCancel={() => {
          setUploadOpen(false);
          setUploadFileList([]);
          uploadForm.resetFields();
        }}
      >
        <Form<{ name?: string }>
          form={uploadForm}
          layout="vertical"
          onFinish={submitUpload}
        >
          <Form.Item label="模板名称（可选）" name="name">
            <Input placeholder="不填写则默认使用文件名去扩展名" />
          </Form.Item>
          <Form.Item label="模板文件" required>
            <Upload
              accept=".pptx"
              beforeUpload={handleUpload}
              fileList={uploadFileList}
              maxCount={1}
              onChange={({ fileList }) => {
                setUploadFileList(fileList.slice(-1));
              }}
              onRemove={() => {
                setUploadFileList([]);
              }}
            >
              <Button>选择 .pptx 文件</Button>
            </Upload>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              当前仅接受非空 `.pptx` 文件，上传成功后默认不会自动设为企业模板，需要在列表中手动启用。
            </Typography.Paragraph>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        destroyOnClose
        open={Boolean(renameTarget)}
        title="重命名模板"
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => {
          void renameForm.submit();
        }}
        onCancel={() => {
          setRenameTarget(null);
          renameForm.resetFields();
        }}
      >
        <Form<{ name: string }>
          form={renameForm}
          layout="vertical"
          onFinish={submitRename}
        >
          <Form.Item
            label="模板名称"
            name="name"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="请输入新的模板名称" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default EnterprisePptTemplateSettingsPage;
