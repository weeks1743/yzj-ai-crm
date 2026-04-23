import {
  BarsOutlined,
  CompassOutlined,
  CopyOutlined,
  EditOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ProductOutlined,
  QuestionCircleOutlined,
  ScheduleOutlined,
  SearchOutlined,
  ShareAltOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type {
  ActionsFeedbackProps,
  BubbleListProps,
  ThoughtChainItemProps,
} from '@ant-design/x';
import {
  Actions,
  Attachments,
  Bubble,
  Conversations,
  Prompts,
  Sender,
  Think,
  ThoughtChain,
  Welcome,
  XProvider,
} from '@ant-design/x';
import type { ComponentProps } from '@ant-design/x-markdown';
import XMarkdown from '@ant-design/x-markdown';
import { useXChat, useXConversations } from '@ant-design/x-sdk';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Flex,
  List,
  Progress,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import type { GetProp } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  assistantScenes,
  audioImportTasks,
  researchSnapshots,
  sceneTasks,
  tenantContext,
  visitBriefs,
} from '@shared';
import {
  type AssistantChatMessage,
  defaultConversationItems,
  historyMessageFactory,
  providerFactory,
} from './mock-chat';
import { buildPromptGroups, getSceneByPath, sceneContextData, sceneOrder } from './scene-meta';

const { Paragraph, Text, Title } = Typography;

const useStyles = createStyles(({ token, css }) => ({
  layout: css`
    display: flex;
    min-height: 100vh;
    padding: 18px;
    gap: 18px;
  `,
  rail: css`
    width: 280px;
    border-radius: 24px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 250, 255, 0.9));
    border: 1px solid rgba(22, 119, 255, 0.08);
    box-shadow: 0 20px 45px rgba(22, 60, 124, 0.08);
    display: flex;
    flex-direction: column;
    padding: 16px;
    backdrop-filter: blur(20px);
  `,
  brand: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  `,
  brandTitle: css`
    display: flex;
    align-items: center;
    gap: 12px;
  `,
  brandMark: css`
    width: 44px;
    height: 44px;
    border-radius: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    background: linear-gradient(135deg, #1677ff 0%, #2f54eb 100%);
    box-shadow: 0 12px 24px rgba(22, 119, 255, 0.28);
  `,
  conversations: css`
    flex: 1;
    overflow-y: auto;
    margin-top: 10px;

    .ant-conversations-list {
      padding-inline-start: 0;
    }
  `,
  railFooter: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    padding-top: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  main: css`
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    border-radius: 28px;
    padding: 18px 18px 10px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 249, 252, 0.9));
    border: 1px solid rgba(22, 119, 255, 0.08);
    box-shadow: 0 20px 45px rgba(22, 60, 124, 0.08);
    backdrop-filter: blur(22px);
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  `,
  sceneNav: css`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  `,
  sceneLink: css`
    padding: 10px 14px;
    border-radius: 999px;
    color: ${token.colorText};
    text-decoration: none;
    background: rgba(242, 246, 255, 0.85);
    border: 1px solid rgba(22, 119, 255, 0.08);
    transition: all 0.2s ease;

    &.active {
      color: #fff;
      background: linear-gradient(135deg, #1677ff 0%, #2f54eb 100%);
      border-color: transparent;
      box-shadow: 0 14px 24px rgba(22, 119, 255, 0.18);
    }
  `,
  sceneSummary: css`
    margin-bottom: 16px;
  `,
  content: css`
    display: flex;
    gap: 18px;
    min-height: 0;
    flex: 1;
  `,
  chatPane: css`
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  `,
  messageViewport: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  `,
  emptyState: css`
    max-width: 920px;
    margin: 0 auto;
    padding: 8px 0 16px;
  `,
  promptGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 18px;

    @media (max-width: 960px) {
      grid-template-columns: 1fr;
    }
  `,
  promptCard: css`
    .ant-prompts-item {
      background: linear-gradient(135deg, #f5f9ff 0%, #edf6ff 100%);
      border: 1px solid rgba(22, 119, 255, 0.08);
      border-radius: 18px;
    }

    .ant-prompts-sub-item {
      background: rgba(255, 255, 255, 0.72);
      border-radius: 12px;
    }
  `,
  bubbleList: css`
    .ant-bubble {
      max-width: 880px;
    }
  `,
  senderWrap: css`
    padding-top: 14px;
  `,
  sender: css`
    width: 100%;
  `,
  senderPrompts: css`
    width: 100%;
    margin-bottom: 10px;
  `,
  context: css`
    width: 320px;
    border-radius: 24px;
    background:
      linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(244, 248, 255, 0.96));
    border: 1px solid rgba(22, 119, 255, 0.08);
    box-shadow: 0 16px 32px rgba(22, 60, 124, 0.07);
    padding: 16px;
    overflow-y: auto;

    @media (max-width: 1320px) {
      display: none;
    }
  `,
  contextCard: css`
    border-radius: 18px;
    margin-bottom: 14px;
    box-shadow: none;
  `,
  footerActions: css`
    margin-top: 10px;
  `,
  inlineRefs: css`
    margin-top: 12px;
  `,
}));

const statusConfig = {
  loading: { title: 'Main Agent 正在编排', status: 'loading' },
  updating: { title: 'Main Agent 正在编排', status: 'loading' },
  success: { title: '任务执行完成', status: 'success' },
  error: { title: '任务执行失败', status: 'error' },
  abort: { title: '任务已中止', status: 'abort' },
} as const;

const senderIcons = [
  { key: 'sender-1', description: '录音导入与拜访分析', icon: <ScheduleOutlined /> },
  { key: 'sender-2', description: '准备拜访材料', icon: <ProductOutlined /> },
  { key: 'sender-3', description: '公司分析', icon: <SearchOutlined /> },
  { key: 'sender-4', description: '我的任务', icon: <BarsOutlined /> },
];

const ChatContext = React.createContext<{
  onReload?: ReturnType<typeof useXChat<AssistantChatMessage>>['onReload'];
  setMessage?: ReturnType<typeof useXChat<AssistantChatMessage>>['setMessage'];
}>({});

const ThinkComponent = React.memo((props: ComponentProps) => {
  const [title, setTitle] = React.useState('正在展开思考...');
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    if (props.streamStatus === 'done') {
      setTitle('思考完成');
      setLoading(false);
    }
  }, [props.streamStatus]);

  return <Think title={title} loading={loading}>{props.children}</Think>;
});

const MessageFooter = ({
  id,
  content,
  extraInfo,
  status,
}: {
  id?: string | number;
  content: string;
  status?: string;
  extraInfo?: AssistantChatMessage['extraInfo'];
}) => {
  const [messageApi, holder] = message.useMessage();
  const context = React.useContext(ChatContext);
  const items = [
    {
      key: 'copy',
      actionRender: <Actions.Copy text={content} icon={<CopyOutlined />} />,
    },
    {
      key: 'retry',
      label: '重试',
      icon: <SyncOutlined />,
      onItemClick: () => {
        if (id) {
          context.onReload?.(id, { userAction: 'retry' });
        }
      },
    },
    {
      key: 'feedback',
      actionRender: (
        <Actions.Feedback
          value={extraInfo?.feedback ?? 'default'}
          onChange={(value) => {
            if (id) {
              context.setMessage?.(id, () => ({
                extraInfo: {
                  ...extraInfo,
                  feedback: value as ActionsFeedbackProps['value'],
                },
              }));
              messageApi.success('已记录反馈');
            }
          }}
        />
      ),
    },
  ];

  if (status === 'loading' || status === 'updating') {
    return null;
  }

  return (
    <>
      {holder}
      <div style={{ display: 'flex' }}>
        {id ? <Actions items={items} /> : null}
      </div>
    </>
  );
};

function buildRole(styles: ReturnType<typeof useStyles>['styles']): BubbleListProps['role'] {
  return {
    assistant: {
      placement: 'start',
      avatar: (
        <Avatar
          size={36}
          style={{
            background: 'linear-gradient(135deg, #1677ff 0%, #2f54eb 100%)',
          }}
          icon={<CompassOutlined />}
        />
      ),
      header: (_, { status, extraInfo }) => {
        const config = statusConfig[status as keyof typeof statusConfig];
        return config ? (
          <ThoughtChain.Item
            variant="solid"
            icon={<GlobalOutlined />}
            status={config.status as ThoughtChainItemProps['status']}
            title={extraInfo?.headline ?? config.title}
            style={{ marginBottom: 8 }}
          />
        ) : null;
      },
      footer: (content, { status, key, extraInfo }) => (
        <MessageFooter
          content={content}
          status={status}
          id={key as string}
          extraInfo={extraInfo as AssistantChatMessage['extraInfo']}
        />
      ),
      contentRender: (content: string, info: any) => (
        <div>
          <XMarkdown
            paragraphTag="div"
            components={{ think: ThinkComponent }}
            streaming={{ hasNextChunk: info.status === 'updating', enableAnimation: true }}
          >
            {content}
          </XMarkdown>
          {(info.attachments as any[])?.length ? (
            <div className={styles.inlineRefs}>
              <Text strong>关联附件</Text>
              <div style={{ marginTop: 8 }}>
                {(info.attachments as any[]).map((attachment: any) => (
                  <Tag key={attachment.name} color="blue">
                    {attachment.name}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
          {info.extraInfo?.references?.length ? (
            <div className={styles.inlineRefs}>
              <Text strong>引用上下文</Text>
              <div style={{ marginTop: 8 }}>
                {info.extraInfo.references.map((item: string) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ),
    },
    user: {
      placement: 'end',
      avatar: <Avatar size={32}>我</Avatar>,
    },
  };
}

function SceneContextPanel({ sceneKey }: { sceneKey: string }) {
  const { styles } = useStyles();

  if (sceneKey === 'audio-import') {
    return (
      <>
        <Card className={styles.contextCard} title="录音导入分支">
          <List
            dataSource={audioImportTasks}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{item.branch}</span>
                      <Tag color={item.progress === 100 ? 'success' : 'processing'}>
                        {item.progress}%
                      </Tag>
                    </Space>
                  }
                  description={`${item.customerName ?? '客户待创建'} / ${item.opportunityName ?? '商机待补齐'}`}
                />
              </List.Item>
            )}
          />
        </Card>
        <Card className={styles.contextCard} title="时序说明">
          <Paragraph>
            正式流程固定为：补齐客户与商机上下文 {'->'} 创建商机跟进记录草稿 {'->'} 异步分析录音。不会直接把总结报告摆在最前面。
          </Paragraph>
        </Card>
      </>
    );
  }

  if (sceneKey === 'company-research') {
    return (
      <>
        <Card className={styles.contextCard} title="最近研究快照">
          <List
            dataSource={researchSnapshots}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={item.companyName}
                  description={`${item.sourceCount} 个来源 · ${item.updatedAt}`}
                />
              </List.Item>
            )}
          />
        </Card>
        <Card className={styles.contextCard} title="研究约束">
          <Paragraph>
            当前 v1 仍按外部技能入口设计。研究快照先资产化，后续再由拜访材料等场景消费。
          </Paragraph>
        </Card>
      </>
    );
  }

  if (sceneKey === 'visit-prepare') {
    return (
      <>
        <Card className={styles.contextCard} title="多源输入">
          <Space wrap>
            {visitBriefs[0].sourceMix.map((item) => (
              <Tag key={item} color="blue">
                {item}
              </Tag>
            ))}
          </Space>
          <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
            当前页面固定产出拜访摘要卡、问题清单、风险提示和建议动作。
          </Paragraph>
        </Card>
        <Card className={styles.contextCard} title="近期拜访包">
          <List
            dataSource={visitBriefs}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={item.customerName}
                  description={`${item.theme} · ${item.updatedAt}`}
                />
              </List.Item>
            )}
          />
        </Card>
      </>
    );
  }

  if (sceneKey === 'tasks') {
    return (
      <>
        <Card className={styles.contextCard} title="任务进度">
          <List
            dataSource={sceneTasks}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" style={{ width: '100%' }} size={6}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Text strong>{item.title}</Text>
                    <Tag
                      color={
                        item.status === '已完成'
                          ? 'success'
                          : item.status === '运行中'
                            ? 'processing'
                            : 'warning'
                      }
                    >
                      {item.status}
                    </Tag>
                  </Space>
                  <Progress percent={item.progress} size="small" showInfo={false} />
                  <Text type="secondary">{item.traceId}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Card className={styles.contextCard} title="当前租户上下文">
        <Space direction="vertical" size={8}>
          <Text strong>{tenantContext.tenantName}</Text>
          <Text type="secondary">eid: {tenantContext.eid}</Text>
          <Text type="secondary">appId: {tenantContext.appId}</Text>
        </Space>
      </Card>
      <Card className={styles.contextCard} title="当前任务观察">
        <List
          dataSource={sceneTasks}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta title={item.title} description={`${item.status} · ${item.updatedAt}`} />
            </List.Item>
          )}
        />
      </Card>
      <Card className={styles.contextCard} title="最近会话">
        <List
          dataSource={sceneContextData.sessions}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta title={item.label} description={item.lastMessage} />
            </List.Item>
          )}
        />
      </Card>
    </>
  );
}

function AssistantWorkspace() {
  const { styles } = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const scene = getSceneByPath(location.pathname);
  const [inputValue, setInputValue] = useState('');
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<GetProp<typeof Attachments, 'items'>>([]);
  const promptGroups = useMemo(() => buildPromptGroups(scene), [scene]);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: defaultConversationItems,
    defaultActiveConversationKey: defaultConversationItems[0].key,
  });

  useEffect(() => {
    const matched = conversations.find((item) => item.route === location.pathname);
    if (matched && matched.key !== activeConversationKey) {
      setActiveConversationKey(matched.key);
    }
  }, [activeConversationKey, conversations, location.pathname, setActiveConversationKey]);

  const { onRequest, messages, isRequesting, abort, onReload, setMessage } =
    useXChat<AssistantChatMessage>({
      provider: providerFactory(activeConversationKey) as any,
      conversationKey: activeConversationKey,
      defaultMessages: historyMessageFactory(activeConversationKey),
      requestPlaceholder: () => ({
        role: 'assistant',
        content: '<think>正在检索上下文、编排技能并准备返回内容。</think>',
      }),
      requestFallback: () => ({
        role: 'assistant',
        content: '本次请求失败，请稍后重试或转到管理员后台排查 trace。',
      }),
    });

  const role = useMemo(() => buildRole(styles), [styles]);

  const onSubmit = (text: string) => {
    if (!text.trim()) {
      return;
    }
    onRequest({
      query: text,
      sceneKey: scene.key,
      conversationKey: activeConversationKey,
      attachments: (attachedFiles ?? []).map((file) => ({
        name: file.name,
        url: '#attachment',
        type: file.type || 'file',
        size: file.size,
      })),
    });
    setInputValue('');
    setAttachedFiles([]);
    setAttachmentsOpen(false);
  };

  const senderHeader = (
    <Sender.Header
      title="上传附件"
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      styles={{ content: { padding: 0 } }}
    >
      <Attachments
        beforeUpload={() => false}
        items={attachedFiles}
        onChange={(info) => setAttachedFiles(info.fileList)}
        placeholder={(type) =>
          type === 'drop'
            ? { title: '把录音、纪要或材料拖到这里' }
            : {
                icon: <PaperClipOutlined />,
                title: '添加录音或材料',
                description: '支持上传录音、纪要、研究材料和临时附件',
              }
        }
      />
    </Sender.Header>
  );

  return (
    <XProvider>
      <ChatContext.Provider value={{ onReload, setMessage }}>
        <div className={styles.layout}>
          <aside className={styles.rail}>
            <div className={styles.brand}>
              <div className={styles.brandTitle}>
                <span className={styles.brandMark}>YZ</span>
                <div>
                  <Title level={5} style={{ margin: 0 }}>
                    AI 销售助手
                  </Title>
                  <Text type="secondary">用户 AI 端</Text>
                </div>
              </div>
              <Button
                shape="circle"
                type="text"
                icon={<PlusOutlined />}
                onClick={() => {
                  const key = dayjs().valueOf().toString();
                  addConversation({
                    key,
                    label: `新对话 ${conversations.length + 1}`,
                    group: '今天',
                    route: scene.route,
                    scene: scene.key,
                    lastMessage: scene.defaultInput,
                    updatedAt: '刚刚',
                  });
                  setActiveConversationKey(key);
                }}
              />
            </div>

            <Alert
              type="info"
              showIcon
              message="真实工作流"
              description="会话会触发任务、资产和回写，不是单纯问答。"
            />

            <Conversations
              className={styles.conversations}
              items={conversations.map((item) => ({
                key: item.key,
                label:
                  item.key === activeConversationKey ? `[当前] ${item.label}` : item.label,
                group: item.group,
              }))}
              activeKey={activeConversationKey}
              onActiveChange={(key) => {
                const matched = conversations.find((item) => item.key === key);
                setActiveConversationKey(key);
                if (matched?.route) {
                  navigate(matched.route);
                }
              }}
              groupable
              menu={(conversation) => ({
                items: [
                  {
                    label: '重命名',
                    key: 'rename',
                    icon: <EditOutlined />,
                  },
                  {
                    label: '删除',
                    key: 'delete',
                    danger: true,
                    onClick: () => {
                      const nextList = conversations.filter((item) => item.key !== conversation.key);
                      setConversations(nextList);
                      if (conversation.key === activeConversationKey && nextList[0]?.route) {
                        setActiveConversationKey(nextList[0].key);
                        navigate(nextList[0].route);
                      }
                    },
                  },
                ],
              })}
            />

            <div className={styles.railFooter}>
              <Space size={10}>
                <Avatar style={{ backgroundColor: '#1677ff' }}>
                  {tenantContext.owner.slice(0, 1)}
                </Avatar>
                <Space direction="vertical" size={0}>
                  <Text strong>{tenantContext.owner}</Text>
                  <Text type="secondary">{tenantContext.tenantName}</Text>
                </Space>
              </Space>
              <Button type="text" icon={<QuestionCircleOutlined />} />
            </div>
          </aside>

          <main className={styles.main}>
            <div className={styles.header}>
              <div className={styles.sceneNav}>
                {sceneOrder.map((item) => (
                  <NavLink key={item.key} to={item.route} className={styles.sceneLink}>
                    {item.title}
                  </NavLink>
                ))}
              </div>
              <Space>
                <Tag color="blue">{scene.subtitle}</Tag>
                <Tag>{tenantContext.eid}</Tag>
              </Space>
            </div>

            <div className={styles.sceneSummary}>
              <Title level={3} style={{ marginBottom: 6 }}>
                {scene.headline}
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {scene.description}
              </Paragraph>
            </div>

            <div className={styles.content}>
              <section className={styles.chatPane}>
                <div className={styles.messageViewport}>
                  {messages.length ? (
                    <Bubble.List
                      className={styles.bubbleList}
                      role={role}
                      items={messages.map((item) => ({
                        ...item.message,
                        key: item.id,
                        status: item.status,
                        loading: item.status === 'loading',
                        extraInfo: item.extraInfo,
                      }))}
                    />
                  ) : (
                    <div className={styles.emptyState}>
                      <Welcome
                        variant="borderless"
                        icon="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
                        title={scene.title}
                        description={scene.description}
                        extra={
                          <Space>
                            <Button icon={<ShareAltOutlined />} />
                            <Button icon={<QuestionCircleOutlined />} />
                          </Space>
                        }
                      />

                      <div className={styles.promptGrid}>
                        <Prompts
                          className={styles.promptCard}
                          items={promptGroups.hotTopics}
                          onItemClick={(info) => onSubmit(info.data.description as string)}
                        />
                        <Prompts
                          className={styles.promptCard}
                          items={promptGroups.guides}
                          onItemClick={(info) => onSubmit(info.data.description as string)}
                        />
                      </div>

                      <Card style={{ marginTop: 18, borderRadius: 20 }}>
                        <Title level={5}>当前场景能力卡</Title>
                        <List
                          dataSource={scene.taskCards}
                          renderItem={(item) => (
                            <List.Item>
                              <List.Item.Meta
                                title={
                                  <Space>
                                    <span>{item.title}</span>
                                    <Tag color="blue">{item.status}</Tag>
                                  </Space>
                                }
                                description={item.description}
                              />
                              <Text strong>{item.metric}</Text>
                            </List.Item>
                          )}
                        />
                      </Card>
                    </div>
                  )}
                </div>

                <div className={styles.senderWrap}>
                  {!attachmentsOpen ? (
                    <Prompts
                      className={styles.senderPrompts}
                      items={senderIcons}
                      onItemClick={(info) => onSubmit(info.data.description as string)}
                      styles={{ item: { padding: '6px 12px' } }}
                    />
                  ) : null}
                  <Sender
                    className={styles.sender}
                    value={inputValue}
                    header={senderHeader}
                    onChange={setInputValue}
                    onSubmit={() => onSubmit(inputValue)}
                    onCancel={abort}
                    loading={isRequesting}
                    allowSpeech
                    placeholder={scene.defaultInput}
                    prefix={
                      <Button
                        type="text"
                        icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
                        onClick={() => setAttachmentsOpen((open) => !open)}
                      />
                    }
                  />
                </div>
              </section>

              <aside className={styles.context}>
                <Card className={styles.contextCard} title="当前上下文">
                  <Space direction="vertical" size={8}>
                    <Text strong>{scene.title}</Text>
                    <Text type="secondary">{scene.subtitle}</Text>
                    <Tag color="processing">Main Agent 已绑定当前场景</Tag>
                  </Space>
                </Card>
                <SceneContextPanel sceneKey={scene.key} />
              </aside>
            </div>
          </main>
        </div>
      </ChatContext.Provider>
    </XProvider>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/chat" element={<AssistantWorkspace />} />
      <Route path="/chat/audio-import" element={<AssistantWorkspace />} />
      <Route path="/chat/company-research" element={<AssistantWorkspace />} />
      <Route path="/chat/visit-prepare" element={<AssistantWorkspace />} />
      <Route path="/chat/tasks" element={<AssistantWorkspace />} />
    </Routes>
  );
}

export default App;
