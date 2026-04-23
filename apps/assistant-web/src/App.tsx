import {
  BarsOutlined,
  BugOutlined,
  CloudUploadOutlined,
  CompassOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  PaperClipOutlined,
  ProductOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  ScheduleOutlined,
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
import type { BubbleListRef } from '@ant-design/x/es/bubble';
import type { ComponentProps } from '@ant-design/x-markdown';
import XMarkdown from '@ant-design/x-markdown';
import { useXChat, useXConversations } from '@ant-design/x-sdk';
import {
  Avatar,
  Button,
  Card,
  Drawer,
  Flex,
  List,
  Progress,
  Space,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import type { GetProp } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  assistantScenes,
  audioImportTasks,
  researchSnapshots,
  sceneTasks,
  tenantContext,
  traceLogs,
  visitBriefs,
} from '@shared';
import {
  type AssistantChatMessage,
  defaultConversationItems,
  historyMessageFactory,
  providerFactory,
} from './mock-chat';
import { buildPromptGroups, getSceneByPath, sceneOrder } from './scene-meta';
import { useMarkdownTheme } from './use-markdown-theme';

const { Paragraph, Text, Title } = Typography;

const HOME_CONVERSATION_KEY = 'conv-home';

const sceneIconMap: Record<string, React.ReactNode> = {
  'audio-import': <ScheduleOutlined />,
  'company-research': <FileSearchOutlined />,
  'visit-prepare': <ProductOutlined />,
  tasks: <BarsOutlined />,
  chat: <CompassOutlined />,
};

const senderShortcutIcons = [
  <ScheduleOutlined />,
  <ProductOutlined />,
  <FileSearchOutlined />,
  <CompassOutlined />,
];

const promptGroupStyles = {
  list: { height: '100%' },
  item: {
    flex: 1,
    backgroundImage: 'linear-gradient(123deg, #e5f4ff 0%, #efe7ff 100%)',
    borderRadius: 12,
    border: 'none',
  },
  subItem: { background: '#ffffffa6' },
} satisfies NonNullable<GetProp<typeof Prompts, 'styles'>>;

const useStyles = createStyles(({ token, css }) => ({
  layout: css`
    width: 100%;
    height: 100vh;
    display: flex;
    background: ${token.colorBgContainer};
    font-family:
      AlibabaPuHuiTi,
      "Alibaba Sans",
      ${token.fontFamily},
      sans-serif;
  `,
  side: css`
    background: ${token.colorBgLayout}80;
    width: 280px;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 0 12px;
    box-sizing: border-box;
    flex-shrink: 0;
  `,
  logo: css`
    display: flex;
    align-items: center;
    justify-content: start;
    padding: 0 24px;
    box-sizing: border-box;
    gap: 10px;
    margin: 24px 0 18px;
  `,
  logoMark: css`
    width: 24px;
    height: 24px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #fff;
    background: linear-gradient(135deg, ${token.colorPrimary}, ${token.colorInfo});
  `,
  logoText: css`
    display: flex;
    flex-direction: column;
    justify-content: center;

    span {
      font-weight: 600;
      color: ${token.colorText};
      font-size: 16px;
      line-height: 1.2;
    }
  `,
  conversations: css`
    overflow-y: auto;
    margin-top: 12px;
    padding: 0;
    flex: 1;

    .ant-conversations-list {
      padding-inline-start: 0;
    }
  `,
  sideFooter: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  `,
  sideFooterInfo: css`
    min-width: 0;
  `,
  chat: css`
    height: 100%;
    width: calc(100% - 280px);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
    overflow: hidden;

    .ant-bubble-content-updating {
      background-image: linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    }
  `,
  chatToolbar: css`
    padding: 20px 24px 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  `,
  chatList: css`
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-height: 0;
    padding: 0 24px 8px;
  `,
  placeholder: css`
    width: 100%;
    padding: ${token.paddingLG}px 0;
    box-sizing: border-box;
  `,
  welcome: css`
    width: 100%;
    max-width: 840px;
  `,
  promptRow: css`
    display: flex;
    gap: 16px;
    justify-content: center;
    width: 100%;
    flex-wrap: wrap;
  `,
  promptCard: css`
    flex: 1;
    min-width: 320px;
    max-width: 408px;

    .ant-prompts-label {
      color: #000000e0 !important;
    }

    .ant-prompts-desc {
      color: #000000a6 !important;
      width: 100%;
    }

    .ant-prompts-icon {
      color: #000000a6 !important;
    }

    @media (max-width: 1180px) {
      min-width: 100%;
      max-width: none;
    }
  `,
  bubbleList: css`
    width: 100%;

    .ant-bubble {
      max-width: 880px;
    }
  `,
  senderPanel: css`
    width: 100%;
    padding: 0 8px 12px;
    box-sizing: border-box;
  `,
  sender: css`
    width: 100%;
    max-width: 840px;
  `,
  senderPrompt: css`
    width: 100%;
    max-width: 840px;
    margin: 0 auto;
    color: ${token.colorText};
  `,
  inlineRefs: css`
    margin-top: 12px;
  `,
  drawerCard: css`
    border-radius: 16px;
    box-shadow: none;
    margin-bottom: 12px;
  `,
  tagWrap: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
}));

const statusConfig = {
  loading: { title: 'Main Agent 正在编排', status: 'loading' },
  updating: { title: 'Main Agent 正在编排', status: 'loading' },
  success: { title: '任务执行完成', status: 'success' },
  error: { title: '任务执行失败', status: 'error' },
  abort: { title: '任务已中止', status: 'abort' },
} as const;

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

function buildSceneEntryPrompts() {
  return [
    {
      key: 'scene-entry',
      label: '场景技能入口',
      children: sceneOrder
        .filter((item) => item.key !== 'chat')
        .map((item) => ({
          key: `scene-${item.key}`,
          label: item.title,
          description: item.subtitle,
          icon: sceneIconMap[item.key],
          route: item.route,
        })),
    },
  ] satisfies GetProp<typeof Prompts, 'items'>;
}

function buildSenderPrompts(scene = assistantScenes.chat) {
  return scene.prompts.slice(0, 4).map((item, index) => ({
    key: item.key,
    description: item.label,
    icon: senderShortcutIcons[index] ?? <CompassOutlined />,
  })) satisfies GetProp<typeof Prompts, 'items'>;
}

function getSceneSourceTags(sceneKey: string) {
  if (sceneKey === 'audio-import') {
    return ['客户上下文', '商机上下文', '跟进记录草稿', '录音附件'];
  }
  if (sceneKey === 'company-research') {
    return ['外部检索', '研究快照', '来源引用'];
  }
  if (sceneKey === 'visit-prepare') {
    return visitBriefs[0].sourceMix;
  }
  if (sceneKey === 'tasks') {
    return ['traceId', 'taskId', '资产结果', '写回状态'];
  }
  return ['对话上下文', '记录系统技能', '场景技能', '外部技能'];
}

function MessageFooter({
  id,
  content,
  extraInfo,
  status,
}: {
  id?: string | number;
  content: string;
  status?: string;
  extraInfo?: AssistantChatMessage['extraInfo'];
}) {
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
      <div style={{ display: 'flex' }}>{id ? <Actions items={items} /> : null}</div>
    </>
  );
}

function buildRole(
  styles: ReturnType<typeof useStyles>['styles'],
  markdownClassName: string,
): BubbleListProps['role'] {
  return {
    assistant: {
      placement: 'start',
      avatar: (
        <Avatar
          size={30}
          style={{ backgroundColor: '#1677ff' }}
        >
          YZ
        </Avatar>
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
            className={markdownClassName}
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
    user: { placement: 'end' },
  };
}

function SceneDebugDrawer({ open, onClose, scene }: { open: boolean; onClose: () => void; scene: ReturnType<typeof getSceneByPath> }) {
  const { styles } = useStyles();
  const relatedTasks =
    scene.key === 'chat'
      ? sceneTasks
      : sceneTasks.filter((item) => item.route === scene.route);
  const relatedTraces =
    scene.key === 'chat'
      ? traceLogs
      : traceLogs.filter((item) =>
          relatedTasks.some((task) => task.traceId === item.traceId || task.taskId === item.taskId),
        );

  const assetContent = (() => {
    if (scene.key === 'audio-import') {
      return (
        <List
          dataSource={audioImportTasks}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <span>{item.title}</span>
                    <Tag color={item.progress === 100 ? 'success' : 'processing'}>
                      {item.branch}
                    </Tag>
                  </Space>
                }
                description={`${item.transcriptStatus} / ${item.analysisStatus} / ${item.writebackStatus}`}
              />
            </List.Item>
          )}
        />
      );
    }
    if (scene.key === 'company-research') {
      return (
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
      );
    }
    if (scene.key === 'visit-prepare') {
      return (
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
      );
    }
    return (
      <List
        dataSource={relatedTasks.length ? relatedTasks : sceneTasks}
        renderItem={(item) => (
          <List.Item>
            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
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
              <Text type="secondary">{item.nextAction}</Text>
            </Space>
          </List.Item>
        )}
      />
    );
  })();

  return (
    <Drawer
      title="调试区 / 上下文"
      size={440}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      <Tabs
        items={[
          {
            key: 'context',
            label: '当前上下文',
            children: (
              <>
                <Card className={styles.drawerCard} title="当前场景">
                  <Space orientation="vertical" size={8}>
                    <Text strong>{scene.title}</Text>
                    <Text type="secondary">{scene.subtitle}</Text>
                    <Paragraph style={{ marginBottom: 0 }}>{scene.description}</Paragraph>
                  </Space>
                </Card>
                <Card className={styles.drawerCard} title="租户上下文">
                  <Space orientation="vertical" size={8}>
                    <Text strong>{tenantContext.tenantName}</Text>
                    <Text type="secondary">eid: {tenantContext.eid}</Text>
                    <Text type="secondary">appId: {tenantContext.appId}</Text>
                  </Space>
                </Card>
                <Card className={styles.drawerCard} title="多源输入命中">
                  <div className={styles.tagWrap}>
                    {getSceneSourceTags(scene.key).map((item) => (
                      <Tag key={item} color="blue">
                        {item}
                      </Tag>
                    ))}
                  </div>
                </Card>
              </>
            ),
          },
          {
            key: 'assets',
            label: '任务 / 资产',
            children: (
              <>
                <Card className={styles.drawerCard} title="相关任务">
                  {relatedTasks.length ? (
                    <List
                      dataSource={relatedTasks}
                      renderItem={(item) => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <Space>
                                <span>{item.title}</span>
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
                            }
                            description={`${item.traceId} · ${item.entityAnchor}`}
                          />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Text type="secondary">当前场景暂无独立任务，主要通过对话触发。</Text>
                  )}
                </Card>
                <Card className={styles.drawerCard} title="相关资产">
                  {assetContent}
                </Card>
              </>
            ),
          },
          {
            key: 'trace',
            label: 'Trace / 引用',
            children: (
              <>
                <Card className={styles.drawerCard} title="Trace 链路">
                  <List
                    dataSource={relatedTraces.length ? relatedTraces : traceLogs}
                    renderItem={(item) => (
                      <List.Item>
                        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                          <Space wrap>
                            <Text strong>{item.traceId}</Text>
                            <Tag
                              color={item.status === '成功' ? 'success' : 'warning'}
                            >
                              {item.status}
                            </Tag>
                          </Space>
                          <Text type="secondary">{item.taskId}</Text>
                          <div className={styles.tagWrap}>
                            {item.toolChain.map((tool) => (
                              <Tag key={tool}>{tool}</Tag>
                            ))}
                          </div>
                          <Text>{item.writebackResult}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Card>
              </>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

function AssistantWorkspace() {
  const { styles } = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const [markdownClassName] = useMarkdownTheme();
  const [messageApi, contextHolder] = message.useMessage();
  const listRef = useRef<BubbleListRef>(null);
  const scene = getSceneByPath(location.pathname);
  const [inputValue, setInputValue] = useState('');
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<GetProp<typeof Attachments, 'items'>>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const homeConversation = useMemo(
    () => ({
      key: HOME_CONVERSATION_KEY,
      label: '新对话',
      route: '/chat',
      group: '今天',
      lastMessage: '从这里发起新的销售任务。',
      updatedAt: '刚刚',
      scene: 'chat',
    }),
    [],
  );
  const baseConversations = useMemo(
    () => [homeConversation, ...defaultConversationItems],
    [homeConversation],
  );
  const getConversationKeyByRoute = React.useCallback(
    (route: string) =>
      baseConversations.find((item) => item.route === route)?.key ?? HOME_CONVERSATION_KEY,
    [baseConversations],
  );
  const promptGroups = useMemo(() => buildPromptGroups(scene), [scene]);
  const sceneEntryPrompts = useMemo(() => buildSceneEntryPrompts(), []);
  const senderPrompts = useMemo(() => buildSenderPrompts(scene), [scene]);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: baseConversations,
    defaultActiveConversationKey: getConversationKeyByRoute(location.pathname),
  });

  useEffect(() => {
    const expectedConversationKey = conversations.find(
      (item) => item.route === location.pathname,
    )?.key ?? getConversationKeyByRoute(location.pathname);

    if (expectedConversationKey === activeConversationKey) {
      return;
    }

    setActiveConversationKey(expectedConversationKey);
  }, [
    activeConversationKey,
    conversations,
    getConversationKeyByRoute,
    location.pathname,
    setActiveConversationKey,
  ]);

  const { onRequest, messages, isRequesting, abort, onReload, setMessage } =
    useXChat<AssistantChatMessage>({
      provider: providerFactory(activeConversationKey) as any,
      conversationKey: activeConversationKey,
      defaultMessages: historyMessageFactory(activeConversationKey),
      requestPlaceholder: () => ({
        role: 'assistant',
        content: '<think>正在检索上下文、编排技能并准备返回内容。</think>',
      }),
      requestFallback: (_, { error, messageInfo }) => {
        if (error.name === 'AbortError') {
          return {
            role: 'assistant',
            content: messageInfo?.message?.content || '请求已中止。',
          };
        }

        return {
          role: 'assistant',
          content: '本次请求失败，请稍后重试或转到管理员后台排查 trace。',
        };
      },
    });

  const messageList = messages ?? [];
  const safeScrollToBottom = React.useCallback(() => {
    const bubbleList = listRef.current;
    if (!bubbleList?.scrollBoxNativeElement) {
      return;
    }

    bubbleList.scrollTo({ top: 'bottom' });
  }, []);

  useEffect(() => {
    if (messageList.length) {
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    }
  }, [activeConversationKey, messageList.length, safeScrollToBottom]);

  const role = useMemo(
    () => buildRole(styles, markdownClassName),
    [markdownClassName, styles],
  );

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
    window.requestAnimationFrame(() => {
      safeScrollToBottom();
    });
  };

  const navigateToScene = (route: string) => {
    setActiveConversationKey(getConversationKeyByRoute(route));
    navigate(route);
    setDebugOpen(false);
  };

  const submitPromptText = (value?: string) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    onSubmit(normalized);
  };

  const senderHeader = (
    <Sender.Header
      title="文件上传"
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
                icon: <CloudUploadOutlined />,
                title: '上传录音与材料',
                description: '支持录音、纪要、研究资料和临时附件',
              }
        }
      />
    </Sender.Header>
  );

  const renderWelcomePrompts = () => {
    if (scene.key === 'chat') {
      return (
        <div className={styles.promptRow}>
          <Prompts
            items={promptGroups.hotTopics}
            styles={promptGroupStyles}
            onItemClick={(info) => {
              submitPromptText(info.data.description as string);
            }}
            className={styles.promptCard}
          />
          <Prompts
            items={sceneEntryPrompts}
            styles={promptGroupStyles}
            onItemClick={(info) => {
              const route = (info.data as { route?: string }).route;
              if (route) {
                navigateToScene(route);
              }
            }}
            className={styles.promptCard}
          />
        </div>
      );
    }

    return (
      <div className={styles.promptRow}>
        <Prompts
          items={promptGroups.hotTopics}
          styles={promptGroupStyles}
          onItemClick={(info) => {
            submitPromptText(info.data.description as string);
          }}
          className={styles.promptCard}
        />
        <Prompts
          items={promptGroups.guides}
          styles={promptGroupStyles}
          onItemClick={(info) => {
            submitPromptText((info.data.description || info.data.label) as string);
          }}
          className={styles.promptCard}
        />
      </div>
    );
  };

  const onCreateConversation = () => {
    setInputValue('');
    setAttachedFiles([]);
    setAttachmentsOpen(false);
    setDebugOpen(false);
    setActiveConversationKey(HOME_CONVERSATION_KEY);
    navigate('/chat');
  };

  const chatSide = (
    <div className={styles.side}>
      <div className={styles.logo}>
        <span className={styles.logoMark}>
          <RobotOutlined />
        </span>
        <div className={styles.logoText}>
          <span>AI销售助手</span>
        </div>
      </div>
      <Conversations
        creation={{ onClick: onCreateConversation }}
        items={conversations.map(({ key, label, ...other }) => ({
          key,
          label: key === activeConversationKey ? `[当前]${label}` : label,
          ...other,
        }))}
        className={styles.conversations}
        activeKey={activeConversationKey}
        onActiveChange={(key) => {
          const matched = conversations.find((item) => item.key === key);
          if (!matched) {
            return;
          }
          setActiveConversationKey(key);
          if (matched?.route) {
            navigate(matched.route);
          }
        }}
        groupable
        styles={{ item: { padding: '0 8px' } }}
        menu={(conversation) => {
          if (conversation.key === HOME_CONVERSATION_KEY) {
            return undefined;
          }

          return {
            items: [
              {
                label: '重命名',
                key: 'rename',
                icon: <EditOutlined />,
                onClick: () => {
                  messageApi.info('重命名将在后续迭代补齐。');
                },
              },
              {
                label: '删除',
                key: 'delete',
                icon: <DeleteOutlined />,
                danger: true,
                onClick: () => {
                  const nextList = conversations.filter((item) => item.key !== conversation.key);
                  setConversations(nextList);
                  if (conversation.key === activeConversationKey) {
                    const fallback = nextList[0] ?? homeConversation;
                    setActiveConversationKey(fallback.key);
                    navigate(fallback.route);
                  }
                },
              },
            ],
          };
        }}
      />

      <div className={styles.sideFooter}>
        <Space size={10}>
          <Avatar size={24} style={{ backgroundColor: '#1677ff' }}>
            {tenantContext.owner.slice(0, 1)}
          </Avatar>
          <Space orientation="vertical" size={0} className={styles.sideFooterInfo}>
            <Text strong ellipsis>
              {tenantContext.owner}
            </Text>
            <Text type="secondary" ellipsis>
              {tenantContext.tenantName}
            </Text>
          </Space>
        </Space>
        <Button
          type="text"
          icon={<QuestionCircleOutlined />}
          onClick={() => messageApi.info('帮助中心原型将在后续迭代补齐。')}
        />
      </div>
    </div>
  );

  const welcomeExtra = (
    <Space>
      <Button
        icon={<ShareAltOutlined />}
        onClick={() => messageApi.info('分享功能原型暂未开放。')}
      />
      <Button icon={<EllipsisOutlined />} onClick={() => setDebugOpen(true)} />
    </Space>
  );

  const chatList = (
    <div className={styles.chatList}>
      {messageList.length ? (
        <Bubble.List
          ref={listRef}
          className={styles.bubbleList}
          role={role}
          styles={{ root: { maxWidth: 940 } }}
          items={messageList.map((item) => ({
            ...item.message,
            key: item.id,
            status: item.status,
            loading: item.status === 'loading',
            extraInfo: item.extraInfo,
          }))}
        />
      ) : (
        <Flex
          vertical
          gap={16}
          align="center"
          className={styles.placeholder}
          style={{ maxWidth: 840 }}
        >
          <Welcome
            className={styles.welcome}
            variant="borderless"
            icon="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
            title={scene.title}
            description={scene.description}
            extra={welcomeExtra}
          />
          {renderWelcomePrompts()}
        </Flex>
      )}
    </div>
  );

  const chatSender = (
    <Flex vertical gap={12} align="center" className={styles.senderPanel}>
      {!attachmentsOpen ? (
        <Prompts
          items={senderPrompts}
          onItemClick={(info) => {
            submitPromptText(info.data.description as string);
          }}
          styles={{ item: { padding: '6px 12px' } }}
          className={styles.senderPrompt}
        />
      ) : null}
      <Sender
        value={inputValue}
        header={senderHeader}
        onSubmit={() => {
          onSubmit(inputValue);
        }}
        onChange={setInputValue}
        onCancel={() => {
          abort();
        }}
        prefix={
          <Button
            type="text"
            icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
            onClick={() => setAttachmentsOpen(!attachmentsOpen)}
          />
        }
        loading={isRequesting}
        className={styles.sender}
        allowSpeech
        placeholder={scene.defaultInput}
      />
    </Flex>
  );

  return (
    <XProvider>
      <ChatContext.Provider value={{ onReload, setMessage }}>
        {contextHolder}
        <div className={styles.layout}>
          {chatSide}
          <div className={styles.chat}>
            <div className={styles.chatToolbar}>
              {scene.key !== 'chat' ? <Tag color="blue">{scene.title}</Tag> : null}
              <Button
                type="text"
                icon={<BugOutlined />}
                onClick={() => setDebugOpen(true)}
              >
                调试区
              </Button>
            </div>
            {chatList}
            {chatSender}
          </div>
        </div>
        <SceneDebugDrawer
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          scene={scene}
        />
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
