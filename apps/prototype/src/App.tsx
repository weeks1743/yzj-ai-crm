import { startTransition, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  Divider,
  List,
  Segmented,
  Space,
  Steps,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  ApartmentOutlined,
  AudioOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  RadarChartOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ShareAltOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import {
  PageContainer,
  ProCard,
  ProLayout,
  ProTable,
} from '@ant-design/pro-components';
import { Bubble, Conversations, Prompts, Sender, Welcome } from '@ant-design/x';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import type { ProColumns } from '@ant-design/pro-components';
import type { TaskItem } from './mock-data';
import {
  audioBranches,
  companyResearchSummary,
  conversations,
  mainIntents,
  objectRegistryRows,
  observabilityMetrics,
  promptItems,
  recordDatasets,
  settingsSections,
  skillFieldRows,
  skillRegistryRows,
  spanTimeline,
  starterMessages,
  tasks,
  traceRows,
  visitPrepareCombos,
  writeBackAudit,
} from './mock-data';

const { Paragraph, Text, Title } = Typography;

type MenuRoute = {
  path?: string;
  name: string;
  icon?: React.ReactNode;
  children?: MenuRoute[];
};

const menuRoutes: MenuRoute[] = [
  {
    path: '/assistant',
    name: 'AI工作台',
    icon: <RobotOutlined />,
    children: [
      { path: '/assistant', name: '对话入口', icon: <RobotOutlined /> },
      { path: '/assistant/tasks', name: '任务总览', icon: <RadarChartOutlined /> },
      { path: '/assistant/audio-import', name: '录音导入与拜访分析', icon: <AudioOutlined /> },
      { path: '/assistant/visit-prepare', name: '准备拜访材料', icon: <ShareAltOutlined /> },
      { path: '/assistant/company-research', name: '公司分析', icon: <SearchOutlined /> },
    ],
  },
  {
    path: '/records/customers',
    name: '记录系统',
    icon: <DatabaseOutlined />,
    children: [
      { path: '/records/customers', name: '客户', icon: <ApartmentOutlined /> },
      { path: '/records/contacts', name: '联系人', icon: <LinkOutlined /> },
      { path: '/records/opportunities', name: '商机', icon: <FolderOpenOutlined /> },
      { path: '/records/followups', name: '商机跟进记录', icon: <SoundOutlined /> },
    ],
  },
  {
    path: '/settings/tenant-app',
    name: '系统设置',
    icon: <SettingOutlined />,
    children: [
      { path: '/settings/tenant-app', name: '租户与应用识别', icon: <SettingOutlined /> },
      { path: '/settings/yzj-auth', name: '云之家接入配置', icon: <ApiOutlined /> },
      { path: '/settings/org-sync', name: '组织同步配置', icon: <ApartmentOutlined /> },
      { path: '/settings/shadow-objects', name: '影子系统配置', icon: <DatabaseOutlined /> },
      { path: '/settings/models', name: '模型与 AI 配置', icon: <RobotOutlined /> },
      { path: '/settings/audio', name: '录音转写配置', icon: <AudioOutlined /> },
      { path: '/settings/research', name: '外部研究配置', icon: <SearchOutlined /> },
      { path: '/settings/storage', name: '存储配置', icon: <FolderOpenOutlined /> },
      { path: '/settings/observability', name: '可观测性配置', icon: <RadarChartOutlined /> },
      { path: '/settings/security', name: '安全与运营配置', icon: <SafetyCertificateOutlined /> },
      { path: '/settings/tool-registry', name: '动态技能中心', icon: <ShareAltOutlined /> },
    ],
  },
];

const routeTitleMap = new Map<string, string>([
  ['/assistant', 'AI 工作台 / 对话入口'],
  ['/assistant/tasks', 'AI 工作台 / 任务总览'],
  ['/assistant/audio-import', '录音导入与拜访分析'],
  ['/assistant/visit-prepare', '准备拜访材料'],
  ['/assistant/company-research', '公司分析'],
  ['/records/customers', '记录系统 / 客户'],
  ['/records/contacts', '记录系统 / 联系人'],
  ['/records/opportunities', '记录系统 / 商机'],
  ['/records/followups', '记录系统 / 商机跟进记录'],
  ['/settings/tenant-app', '系统设置 / 租户与应用识别'],
  ['/settings/yzj-auth', '系统设置 / 云之家接入配置'],
  ['/settings/org-sync', '系统设置 / 组织同步配置'],
  ['/settings/shadow-objects', '系统设置 / 影子系统配置'],
  ['/settings/models', '系统设置 / 模型与 AI 配置'],
  ['/settings/audio', '系统设置 / 录音转写配置'],
  ['/settings/research', '系统设置 / 外部研究配置'],
  ['/settings/storage', '系统设置 / 存储配置'],
  ['/settings/observability', '系统设置 / 可观测性配置'],
  ['/settings/security', '系统设置 / 安全与运营配置'],
  ['/settings/tool-registry', '系统设置 / 动态技能中心'],
]);

const taskColumns: ProColumns<TaskItem>[] = [
  {
    title: '任务名称',
    dataIndex: 'title',
    render: (_, record) => <Link to={record.targetPath}>{record.title}</Link>,
  },
  {
    title: '技能编码',
    dataIndex: 'scene',
    render: (_, record) => <Text code>{record.scene}</Text>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    render: (_, record) => <StatusTag status={record.status} />,
  },
  {
    title: '下一步动作',
    dataIndex: 'nextAction',
  },
  {
    title: '实体锚点',
    dataIndex: 'entity',
  },
  {
    title: 'Trace',
    dataIndex: 'traceId',
    render: (_, record) => <Text code>{record.traceId}</Text>,
  },
];

function StatusTag({ status }: { status: string }) {
  const color =
    status === '已完成'
      ? 'success'
      : status === '进行中'
        ? 'processing'
        : status === '待确认'
          ? 'warning'
          : 'error';

  return <Badge status={color as 'success' | 'processing' | 'warning' | 'error'} text={status} />;
}

function summarizePrompt(message: string) {
  if (message.includes('录音')) {
    return {
      scene: 'scene.audio_import',
      reply: (
        <div>
          <Paragraph>
            已按 <Text code>scene.audio_import</Text> 处理。当前不会先直接给你总结报告，而是先补齐客户与商机上下文，再创建商机跟进记录，最后异步启动录音分析。
          </Paragraph>
          <Space wrap>
            <Button size="small" type="primary">
              <Link to="/assistant/audio-import">查看录音导入时序</Link>
            </Button>
            <Button size="small">
              <Link to="/records/followups">查看跟进记录回写目标</Link>
            </Button>
          </Space>
        </div>
      ),
    };
  }

  if (message.includes('拜访')) {
    return {
      scene: 'scene.visit_prepare',
      reply: (
        <div>
          <Paragraph>
            已按 <Text code>scene.visit_prepare</Text> 规划。系统会优先读取影子系统主数据，再组合公司分析快照、录音分析结果与 AI 原生记忆，输出拜访摘要、问题清单、风险提示和建议动作。
          </Paragraph>
          <Space wrap>
            <Button size="small" type="primary">
              <Link to="/assistant/visit-prepare">查看拜访材料组合方式</Link>
            </Button>
            <Button size="small">
              <Link to="/assistant/company-research">查看公司分析输入</Link>
            </Button>
          </Space>
        </div>
      ),
    };
  }

  if (message.includes('分析') || message.includes('公司')) {
    return {
      scene: 'ext.company_research_pm',
      reply: (
        <div>
          <Paragraph>
            当前“公司分析”在 v1 中按 <Text code>ext.company_research_pm</Text> 作为外部技能接入。它可以生成研究快照建议，但不会直接绕过确认写入影子系统主数据。
          </Paragraph>
          <Space wrap>
            <Button size="small" type="primary">
              <Link to="/assistant/company-research">查看外部技能页</Link>
            </Button>
            <Button size="small">
              <Link to="/settings/tool-registry">查看 Tool Registry</Link>
            </Button>
          </Space>
        </div>
      ),
    };
  }

  return {
    scene: 'shadow.customer_create',
    reply: (
      <div>
        <Paragraph>
          已识别为记录系统写操作意图，将优先命中 <Text code>shadow.*</Text> 技能，并在真正写回轻云前触发确认卡片。
        </Paragraph>
        <Space wrap>
          <Button size="small" type="primary">
            <Link to="/records/customers">查看客户对象页</Link>
          </Button>
          <Button size="small">
            <Link to="/settings/shadow-objects">查看影子系统配置</Link>
          </Button>
        </Space>
      </div>
    ),
  };
}

function AssistantWorkbenchPage() {
  const [activeConversation, setActiveConversation] = useState(conversations[0].key);
  const [messages, setMessages] = useState(starterMessages);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (input: string) => {
    const value = input.trim();
    if (!value) {
      return;
    }

    setDraft('');
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      {
        key: `user-${Date.now()}`,
        role: 'user',
        content: value,
      },
    ]);

    window.setTimeout(() => {
      const response = summarizePrompt(value);
      startTransition(() => {
        setMessages((prev) => [
          ...prev,
          {
            key: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response.reply,
            footer: `Main Agent -> ${response.scene} -> Deterministic Guards`,
          },
        ]);
        setLoading(false);
      });
    }, 600);
  };

  const activeTask = tasks.find((item) => item.status === '进行中') ?? tasks[0];

  return (
    <PageContainer
      title="AI 工作台 / 对话入口"
      subTitle="AI销售助手 是主入口，记录系统只是影子主数据底座。"
      extra={[
        <Tag key="version" color="blue">
          0.0.1 原型
        </Tag>,
        <Tag key="entry" color="cyan">
          Chat First
        </Tag>,
      ]}
    >
      <div className="assistant-home-grid">
        <div className="assistant-pane">
          <Card className="glass-card" title="会话列表" extra={<Text type="secondary">Ant Design X</Text>}>
            <Conversations
              items={conversations}
              activeKey={activeConversation}
              onActiveChange={setActiveConversation}
              groupable
            />
          </Card>
          <Card className="glass-card" title="当前主意图">
            <List
              size="small"
              dataSource={mainIntents}
              renderItem={(item) => (
                <List.Item>
                  <Space align="start">
                    <Badge status="processing" />
                    <Text>{item}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </div>

        <div className="assistant-pane assistant-center">
          <Card className="hero-card">
            <Welcome
              icon={<Avatar icon={<RobotOutlined />} style={{ background: '#1768ac' }} />}
              title="AI销售助手"
              description="对话层是系统主入口。你可以直接录入客户、导入录音、分析公司或准备拜访材料，系统会自动选择记录系统技能、场景技能或外部技能。"
              extra={
                <Space wrap>
                  <Tag color="geekblue">Main Agent</Tag>
                  <Tag color="gold">Tool Registry</Tag>
                  <Tag color="green">Deterministic Guards</Tag>
                </Space>
              }
            />
            <Divider />
            <Prompts
              title="推荐入口"
              items={promptItems}
              wrap
              onItemClick={({ data }) => handleSubmit(String(data.label))}
            />
          </Card>

          <Card className="chat-card" title="主对话区" extra={<Text type="secondary">Bubble / Sender</Text>}>
            <Bubble.List
              className="bubble-list"
              items={messages.map((item) => ({
                key: item.key,
                role: item.role,
                content: item.content,
                footer: item.footer,
              }))}
              roles={{
                assistant: {
                  placement: 'start',
                  avatar: { icon: <RobotOutlined />, style: { background: '#1768ac' } },
                  variant: 'borderless',
                },
                user: {
                  placement: 'end',
                  avatar: { style: { background: '#f97316' }, children: '我' },
                  variant: 'filled',
                },
              }}
            />
            <div className="sender-wrap">
              <Sender
                value={draft}
                onChange={(value) => setDraft(value)}
                onSubmit={handleSubmit}
                loading={loading}
                placeholder="试试：把这段录音导入并生成跟进记录"
                submitType="enter"
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
            </div>
          </Card>
        </div>

        <div className="assistant-pane">
          <Card className="glass-card" title="Main Agent 当前判断">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <Text type="secondary">当前活跃任务</Text>
                <Title level={5} style={{ marginTop: 8 }}>
                  {activeTask.title}
                </Title>
                <StatusTag status={activeTask.status} />
              </div>
              <Descriptions column={1} size="small" colon={false}>
                <Descriptions.Item label="技能编码">
                  <Text code>{activeTask.scene}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="下一步">
                  {activeTask.nextAction}
                </Descriptions.Item>
                <Descriptions.Item label="Trace">
                  <Text code>{activeTask.traceId}</Text>
                </Descriptions.Item>
              </Descriptions>
              <Button type="primary" block>
                <Link to={activeTask.targetPath}>进入当前主链路</Link>
              </Button>
            </Space>
          </Card>

          <Card className="glass-card" title="上下文与回写目标">
            <Space wrap>
              <Tag>eid=EID-HZ-001</Tag>
              <Tag>appId=AICRM-01</Tag>
              <Tag>threadId=thread-demo-1</Tag>
              <Tag>customerId=cust_0091</Tag>
            </Space>
            <Divider />
            <List
              size="small"
              dataSource={[
                { label: '记录系统', path: '/records/customers' },
                { label: '动态技能中心', path: '/settings/tool-registry' },
                { label: '可观测性', path: '/settings/observability' },
              ]}
              renderItem={(item) => (
                <List.Item actions={[<Link key={item.path} to={item.path}>进入</Link>]}>
                  <Text>{item.label}</Text>
                </List.Item>
              )}
            />
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function AssistantTasksPage() {
  return (
    <PageContainer
      title="AI 工作台 / 任务总览"
      subTitle="任务页展示 scene.*、ext.* 与 shadow.* 如何在同一产品里协同，而不是拆成两个并列系统。"
    >
      <div className="metric-grid">
        {[
          { label: '进行中任务', value: '1', note: '录音导入主链路' },
          { label: '待确认事项', value: '2', note: '写回前确认' },
          { label: '可复用快照', value: '5', note: '研究 / 录音分析资产' },
          { label: '关联主数据对象', value: '4', note: '客户 / 联系人 / 商机 / 跟进记录' },
        ].map((item) => (
          <Card key={item.label} className="metric-card">
            <Text type="secondary">{item.label}</Text>
            <Title level={2}>{item.value}</Title>
            <Text>{item.note}</Text>
          </Card>
        ))}
      </div>

      <div className="page-grid">
        <Card className="glass-card" title="任务状态流">
          <Timeline
            items={tasks.map((task) => ({
              color:
                task.status === '已完成'
                  ? 'green'
                  : task.status === '进行中'
                    ? 'blue'
                    : task.status === '待确认'
                      ? 'orange'
                      : 'red',
              children: (
                <Space direction="vertical" size={4}>
                  <Space wrap>
                    <Text strong>{task.title}</Text>
                    <StatusTag status={task.status} />
                  </Space>
                  <Text type="secondary">{task.nextAction}</Text>
                  <Space wrap>
                    <Text code>{task.scene}</Text>
                    <Text code>{task.traceId}</Text>
                  </Space>
                </Space>
              ),
            }))}
          />
        </Card>

        <Card className="glass-card" title="可从任务反查到的页面">
          <List
            dataSource={[
              { label: '录音导入与拜访分析', path: '/assistant/audio-import' },
              { label: '准备拜访材料', path: '/assistant/visit-prepare' },
              { label: '公司分析', path: '/assistant/company-research' },
              { label: '影子系统 / 商机跟进记录', path: '/records/followups' },
            ]}
            renderItem={(item) => (
              <List.Item actions={[<Link key={item.path} to={item.path}>打开</Link>]}>
                {item.label}
              </List.Item>
            )}
          />
        </Card>
      </div>

      <Card className="glass-card" title="任务表">
        <ProTable<TaskItem>
          rowKey="key"
          search={false}
          options={false}
          toolBarRender={false}
          dataSource={tasks}
          columns={taskColumns}
        />
      </Card>
    </PageContainer>
  );
}

function AudioImportPage() {
  return (
    <PageContainer
      title="录音导入与拜访分析"
      subTitle="先补齐客户与商机上下文，再创建商机跟进记录，最后才异步分析录音。"
      extra={[
        <Tag key="scene" color="blue">
          scene.audio_import
        </Tag>,
        <Tag key="provider" color="purple">
          tongyi_agent_provider
        </Tag>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        message="这不是一个“上传录音后直接先出总结”的页面。录音只是商机跟进记录附带的非结构化内容，主链路必须先跑通结构化回写。"
      />
      <div style={{ height: 16 }} />
      <ProCard tabs={{ type: 'card' }}>
        {audioBranches.map((branch) => (
          <ProCard.TabPane key={branch.key} tab={branch.title}>
            <div className="page-grid">
              <Card className="glass-card" title="处理时序">
                <Paragraph>{branch.summary}</Paragraph>
                <Steps
                  direction="vertical"
                  current={branch.steps.findIndex((item) => item.status === 'process')}
                  items={branch.steps.map((step) => ({
                    title: step.title,
                    status: step.status,
                    description: step.description,
                  }))}
                />
              </Card>
              <div className="card-column">
                <Card className="glass-card" title="当前上下文">
                  <List
                    size="small"
                    dataSource={branch.context}
                    renderItem={(item) => (
                      <List.Item>
                        <Text code>{item}</Text>
                      </List.Item>
                    )}
                  />
                </Card>
                <Card className="glass-card" title="状态锚点">
                  <Space direction="vertical" size={8}>
                    <Tag color="gold">next_required_action: {branch.nextRequiredAction}</Tag>
                    {branch.result.map((item) => (
                      <Text key={item} code>
                        {item}
                      </Text>
                    ))}
                  </Space>
                </Card>
                <Card className="glass-card" title="回写目标">
                  <Paragraph>
                    正式业务锚点固定为 <Text code>followup_record_id</Text>。音频文件、转写、分析结果都要回挂到跟进记录，而不是直接覆盖客户或商机主数据。
                  </Paragraph>
                  <Button type="primary" block>
                    <Link to="/records/followups">查看商机跟进记录对象</Link>
                  </Button>
                </Card>
              </div>
            </div>
          </ProCard.TabPane>
        ))}
      </ProCard>
    </PageContainer>
  );
}

function VisitPreparePage() {
  const [comboKey, setComboKey] = useState(visitPrepareCombos[0].key);
  const activeCombo = visitPrepareCombos.find((item) => item.key === comboKey) ?? visitPrepareCombos[0];

  return (
    <PageContainer
      title="准备拜访材料"
      subTitle="这是一个复合场景技能，不是单一文档导出页。它要整合主数据、研究快照、录音分析和 AI 原生记忆。"
      extra={[
        <Tag key="scene" color="blue">
          scene.visit_prepare
        </Tag>,
        <Tag key="output" color="green">
          非 PPT 输出
        </Tag>,
      ]}
    >
      <Alert
        showIcon
        type="success"
        message="标准输出固定为：拜访摘要卡、Markdown 一页简报、建议沟通问题、风险与异议预测、建议动作清单。"
      />
      <div style={{ height: 16 }} />
      <Card className="glass-card" title="数据组合模式">
        <Segmented
          block
          value={comboKey}
          onChange={(value) => setComboKey(String(value))}
          options={visitPrepareCombos.map((item) => ({
            label: item.name,
            value: item.key,
          }))}
        />
        <div style={{ height: 16 }} />
        <div className="page-grid">
          <Card className="glass-card" title="输入来源">
            <Tag color="cyan">{activeCombo.readiness}</Tag>
            <Paragraph style={{ marginTop: 12 }}>{activeCombo.summary}</Paragraph>
            <List
              size="small"
              dataSource={activeCombo.sources}
              renderItem={(item) => (
                <List.Item>
                  <Space align="start">
                    <Badge status="processing" />
                    <Text>{item}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <div className="card-column">
            <Card className="glass-card" title="拜访摘要卡">
              <Paragraph>{activeCombo.outputs.brief}</Paragraph>
            </Card>
            <Card className="glass-card" title="建议沟通问题">
              <List
                size="small"
                dataSource={activeCombo.outputs.questions}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
          </div>

          <div className="card-column">
            <Card className="glass-card" title="风险提示">
              <List
                size="small"
                dataSource={activeCombo.outputs.risks}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
            <Card className="glass-card" title="建议动作">
              <List
                size="small"
                dataSource={activeCombo.outputs.actions}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
              <Divider />
              <Space wrap>
                <Button type="primary">
                  <Link to="/assistant/company-research">补充公司分析</Link>
                </Button>
                <Button>
                  <Link to="/assistant/audio-import">查看录音分析来源</Link>
                </Button>
              </Space>
            </Card>
          </div>
        </div>
      </Card>
    </PageContainer>
  );
}

function CompanyResearchPage() {
  const [companyName, setCompanyName] = useState('联创医疗');

  return (
    <PageContainer
      title="公司分析"
      subTitle="当前按外部技能入口设计，不包装成 v1 的主场景首页。"
      extra={[
        <Tag key="type" color="purple">
          外部技能
        </Tag>,
        <Tag key="skill" color="magenta">
          ext.company_research_pm
        </Tag>,
      ]}
    >
      <div className="page-grid">
        <Card
          className="glass-card"
          title="当前定位"
          extra={<Text type="secondary">{companyResearchSummary.provider}</Text>}
        >
          <Paragraph>{companyResearchSummary.description}</Paragraph>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label="能力角色">{companyResearchSummary.role}</Descriptions.Item>
            <Descriptions.Item label="核心输入">
              <Text code>companyName</Text>
            </Descriptions.Item>
          </Descriptions>
          <Divider />
          <Space wrap>
            {['联创医疗', '华南生物', '博远集团'].map((item) => (
              <Button key={item} size="small" onClick={() => setCompanyName(item)}>
                {item}
              </Button>
            ))}
          </Space>
          <div style={{ height: 16 }} />
          <Card size="small" className="inner-card" title={`当前研究对象：${companyName}`}>
            <Paragraph>
              本页展示的是外部研究入口能力。未来如果要升级成“公司深度分析”，需要增加客户绑定、研究快照版本治理、后台刷新和复用链路。
            </Paragraph>
          </Card>
        </Card>

        <div className="card-column">
          <Card className="glass-card" title="研究快照建议">
            <List
              size="small"
              dataSource={companyResearchSummary.snapshots}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Text strong>{item.company}</Text>
                    <Text type="secondary">
                      新鲜度 {item.freshness} · 来源 {item.sourceCount}
                    </Text>
                    <Tag color={item.status.includes('过期') ? 'orange' : 'green'}>{item.status}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card className="glass-card" title="可被谁复用">
            <List
              size="small"
              dataSource={[
                '准备拜访材料',
                '对话问答',
                '客户背景补充',
                '未来的公司深度分析场景',
              ]}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function buildRecordColumns(datasetKey: keyof typeof recordDatasets): ProColumns<Record<string, string>>[] {
  const labelMap: Record<string, Record<string, string>> = {
    customers: {
      customerName: '客户名称',
      status: '客户状态',
      owner: '归属人',
      industry: '行业',
      latestFollowup: '最近跟进',
    },
    contacts: {
      contactName: '姓名',
      customer: '所属客户',
      title: '职务',
      phone: '手机号',
      status: '状态',
    },
    opportunities: {
      opportunityName: '商机标题',
      customer: '所属客户',
      stage: '阶段',
      amount: '预算金额',
      owner: '负责人',
    },
    followups: {
      title: '跟进标题',
      opportunity: '所属商机',
      method: '跟进方式',
      owner: '责任人',
      visitDate: '跟进日期',
    },
  };

  const sample = recordDatasets[datasetKey].rows[0];
  return Object.keys(sample)
    .filter((key) => key !== 'key')
    .map((key) => ({
      title: labelMap[datasetKey][key] ?? key,
      dataIndex: key,
    }));
}

function RecordPage({ datasetKey }: { datasetKey: keyof typeof recordDatasets }) {
  const dataset = recordDatasets[datasetKey];

  return (
    <PageContainer title={`记录系统 / ${dataset.title}`} subTitle={dataset.subtitle}>
      <Alert
        showIcon
        type="info"
        message={`字段真值来源固定为：系统设置中的 templateId + 官方模板接口 + codeId。当前页面只展示原型语义，不把截图字段当最终 schema。`}
      />
      <div style={{ height: 16 }} />
      <div className="metric-grid">
        <Card className="metric-card">
          <Text type="secondary">模板 ID</Text>
          <Title level={4}>{dataset.templateId}</Title>
        </Card>
        <Card className="metric-card">
          <Text type="secondary">Code ID</Text>
          <Title level={4}>{dataset.codeId}</Title>
        </Card>
        <Card className="metric-card">
          <Text type="secondary">元数据版本</Text>
          <Title level={4}>{dataset.sourceVersion.slice(0, 10)}</Title>
        </Card>
      </div>
      <div className="page-grid">
        <Card className="glass-card" title={`${dataset.title}对象实例`}>
          <ProTable<Record<string, string>>
            rowKey="key"
            search={false}
            options={false}
            toolBarRender={false}
            dataSource={dataset.rows}
            columns={buildRecordColumns(datasetKey)}
            pagination={false}
          />
        </Card>
        <div className="card-column">
          <Card className="glass-card" title="对象元数据摘要">
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="对象定位">{dataset.subtitle}</Descriptions.Item>
              <Descriptions.Item label="AI 开放边界">
                只开放确认后安全写入，不开放 delete。
              </Descriptions.Item>
              <Descriptions.Item label="回写角色">
                作为 AI 确认后的影子主数据真值与查询结果查看页。
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card className="glass-card" title="字段开放边界">
            <Table
              rowKey="fieldCode"
              pagination={false}
              size="small"
              dataSource={dataset.fields}
              columns={[
                { title: '字段', dataIndex: 'label' },
                { title: 'code', dataIndex: 'fieldCode', render: (value) => <Text code>{value}</Text> },
                { title: 'AI 权限', dataIndex: 'aiAccess' },
                { title: '必填', dataIndex: 'required' },
              ]}
            />
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function SettingsPage({ sectionKey }: { sectionKey: keyof typeof settingsSections }) {
  const section = settingsSections[sectionKey];

  return (
    <PageContainer title={`系统设置 / ${section.title}`} subTitle={section.summary}>
      <div className="page-grid">
        <Card className="glass-card" title="配置项">
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={section.items}
            columns={[
              { title: '配置名', dataIndex: 'name' },
              { title: '配置键', dataIndex: 'key', render: (value) => <Text code>{value}</Text> },
              { title: '说明', dataIndex: 'description' },
              { title: '当前示例值', dataIndex: 'value' },
            ]}
          />
        </Card>
        <div className="card-column">
          <Card className="glass-card" title="设计说明">
            <List
              size="small"
              dataSource={section.designNotes}
              renderItem={(item) => (
                <List.Item>
                  <Space align="start">
                    <Badge status="processing" />
                    <Text>{item}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
          <Card className="glass-card" title="与主链路的关系">
            <Paragraph>
              当前页面属于系统基础设置层，它决定系统能否完成租户识别、身份解析、技能生成、任务编排与观测追踪，不是附属性的普通设置页。
            </Paragraph>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function ToolRegistryPage() {
  return (
    <PageContainer
      title="系统设置 / 动态技能中心"
      subTitle="对象注册表先于技能生成，技能生成先于 Main Agent 调用。"
    >
      <Alert
        showIcon
        type="warning"
        message="这里展示的是“把轻云影子系统变成 AI 可执行能力”的桥梁层，而不是手写死的一组后台按钮。"
      />
      <div style={{ height: 16 }} />
      <div className="page-grid">
        <Card className="glass-card" title="对象注册表">
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={objectRegistryRows}
            columns={[
              { title: '对象', dataIndex: 'object' },
              { title: 'templateId', dataIndex: 'templateId', render: (value) => <Text code>{value}</Text> },
              { title: 'codeId', dataIndex: 'codeId', render: (value) => <Text code>{value}</Text> },
              { title: '状态', dataIndex: 'status' },
              { title: 'AI 开放情况', dataIndex: 'aiStatus' },
            ]}
          />
        </Card>
        <Card className="glass-card" title="技能注册表">
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={skillRegistryRows}
            columns={[
              { title: '技能', dataIndex: 'skill', render: (value) => <Text code>{value}</Text> },
              { title: '类别', dataIndex: 'category' },
              { title: '来源', dataIndex: 'source' },
              { title: '确认策略', dataIndex: 'confirmationPolicy' },
              { title: '版本', dataIndex: 'version' },
            ]}
          />
        </Card>
      </div>
      <div style={{ height: 16 }} />
      <div className="page-grid">
        <Card className="glass-card" title="字段开放边界">
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={skillFieldRows}
            columns={[
              { title: '字段编码', dataIndex: 'field', render: (value) => <Text code>{value}</Text> },
              { title: '展示名', dataIndex: 'label' },
              { title: '类型', dataIndex: 'type' },
              { title: '可写', dataIndex: 'writable' },
              { title: '确认要求', dataIndex: 'confirmation' },
            ]}
          />
        </Card>
        <Card className="glass-card" title="技能契约示例">
          <Paragraph>
            <Text code>shadow.customer_create</Text> 必须带描述、使用时机、禁用时机、必填参数、确认策略、输出卡片类型和 source version。
          </Paragraph>
          <pre className="code-block">{`{
  "skill_name": "shadow.customer_create",
  "required_params": ["customer_name"],
  "confirmation_policy": "required_before_write",
  "output_card_type": "customer-create-preview",
  "source_object": "customer",
  "source_version": "v2026.04.22"
}`}</pre>
        </Card>
      </div>
    </PageContainer>
  );
}

function ObservabilityPage() {
  return (
    <PageContainer
      title="系统设置 / 可观测性配置"
      subTitle="可观测性必须同时覆盖系统链路、AI 决策和业务结果。"
    >
      <div className="metric-grid">
        {observabilityMetrics.map((item) => (
          <Card key={item.label} className="metric-card">
            <Text type="secondary">{item.label}</Text>
            <Title level={2}>{item.value}</Title>
            <Text>{item.detail}</Text>
          </Card>
        ))}
      </div>
      <div className="page-grid">
        <Card className="glass-card" title="核心 Trace">
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={traceRows}
            columns={[
              { title: 'traceId', dataIndex: 'traceId', render: (value) => <Text code>{value}</Text> },
              { title: 'taskId', dataIndex: 'taskId', render: (value) => <Text code>{value}</Text> },
              { title: 'toolName', dataIndex: 'toolName', render: (value) => <Text code>{value}</Text> },
              { title: '状态', dataIndex: 'status' },
              { title: '租户上下文', dataIndex: 'tenant' },
            ]}
          />
        </Card>
        <Card className="glass-card" title="Tool 调用链">
          <Timeline
            items={spanTimeline.map((item) => ({
              children: item,
            }))}
          />
        </Card>
      </div>
      <div style={{ height: 16 }} />
      <Card className="glass-card" title="写回审计">
        <Table
          rowKey="key"
          pagination={false}
          size="small"
          dataSource={writeBackAudit}
          columns={[
            { title: '时间', dataIndex: 'time' },
            { title: '对象', dataIndex: 'object' },
            { title: '动作', dataIndex: 'action', render: (value) => <Text code>{value}</Text> },
            { title: '结果', dataIndex: 'result' },
            { title: '说明', dataIndex: 'detail' },
          ]}
        />
      </Card>
    </PageContainer>
  );
}

function AppLayout() {
  const location = useLocation();
  const pageTitle = routeTitleMap.get(location.pathname) ?? 'AI销售助手';
  const routeConfig = useMemo(() => ({ routes: menuRoutes }), []);

  return (
    <div className="app-shell">
      <ProLayout
        title="AI销售助手"
        logo={false}
        route={routeConfig}
        location={{ pathname: location.pathname }}
        menuItemRender={(item, dom) =>
          item.path ? (
            <Link to={item.path}>
              {dom}
            </Link>
          ) : (
            dom
          )
        }
        layout="mix"
        splitMenus={false}
        fixSiderbar
        contentWidth="Fluid"
        siderWidth={248}
        avatarProps={{
          title: '华东示范租户',
          render: () => (
            <Space>
              <Avatar style={{ background: '#0f766e' }}>华</Avatar>
              <div>
                <div className="tenant-title">华东示范租户</div>
                <Text type="secondary">EID-HZ-001</Text>
              </div>
            </Space>
          ),
        }}
        actionsRender={() => [
          <Tag key="tag" color="blue">
            v0.0.1
          </Tag>,
          <Button key="docs" type="text">
            <a href="/docs/README.md">docs/</a>
          </Button>,
        ]}
        headerTitleRender={() => (
          <Space>
            <Avatar icon={<RobotOutlined />} style={{ background: '#1768ac' }} />
            <div>
              <div className="app-title">AI销售助手</div>
              <Text type="secondary">{pageTitle}</Text>
            </div>
          </Space>
        )}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/assistant" replace />} />
          <Route path="/assistant" element={<AssistantWorkbenchPage />} />
          <Route path="/assistant/tasks" element={<AssistantTasksPage />} />
          <Route path="/assistant/audio-import" element={<AudioImportPage />} />
          <Route path="/assistant/visit-prepare" element={<VisitPreparePage />} />
          <Route path="/assistant/company-research" element={<CompanyResearchPage />} />
          <Route path="/records/customers" element={<RecordPage datasetKey="customers" />} />
          <Route path="/records/contacts" element={<RecordPage datasetKey="contacts" />} />
          <Route path="/records/opportunities" element={<RecordPage datasetKey="opportunities" />} />
          <Route path="/records/followups" element={<RecordPage datasetKey="followups" />} />
          <Route path="/settings/tenant-app" element={<SettingsPage sectionKey="tenant-app" />} />
          <Route path="/settings/yzj-auth" element={<SettingsPage sectionKey="yzj-auth" />} />
          <Route path="/settings/org-sync" element={<SettingsPage sectionKey="org-sync" />} />
          <Route path="/settings/shadow-objects" element={<SettingsPage sectionKey="shadow-objects" />} />
          <Route path="/settings/models" element={<SettingsPage sectionKey="models" />} />
          <Route path="/settings/audio" element={<SettingsPage sectionKey="audio" />} />
          <Route path="/settings/research" element={<SettingsPage sectionKey="research" />} />
          <Route path="/settings/storage" element={<SettingsPage sectionKey="storage" />} />
          <Route path="/settings/observability" element={<ObservabilityPage />} />
          <Route path="/settings/security" element={<SettingsPage sectionKey="security" />} />
          <Route path="/settings/tool-registry" element={<ToolRegistryPage />} />
        </Routes>
      </ProLayout>
    </div>
  );
}

export default function App() {
  return <AppLayout />;
}
