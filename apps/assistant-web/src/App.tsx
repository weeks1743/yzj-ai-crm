import {
  BarsOutlined,
  CloudUploadOutlined,
  CompassOutlined,
  CopyOutlined,
  CloseOutlined,
  EyeOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  PlusOutlined,
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
  ThoughtChainItemType,
  ThoughtChainItemProps,
} from '@ant-design/x';
import {
  Actions,
  Attachments,
  Bubble,
  Conversations,
  FileCard,
  Prompts,
  Sender,
  Think,
  ThoughtChain,
  Welcome,
  XProvider,
} from '@ant-design/x';
import type { BubbleListRef } from '@ant-design/x/es/bubble';
import type { NodeRender } from '@ant-design/x/es/sender/interface';
import {
  Box as A2UIBox,
  Card as A2UICard,
  registerCatalog,
  type Catalog,
} from '@ant-design/x-card';
import type { ComponentProps } from '@ant-design/x-markdown';
import XMarkdown from '@ant-design/x-markdown';
import type { DefaultMessageInfo, MessageInfo } from '@ant-design/x-sdk';
import { useXChat, useXConversations } from '@ant-design/x-sdk';
import {
  Avatar,
  Alert,
  Button,
  Card,
  Divider,
  Drawer,
  Flex,
  Space,
  Skeleton,
  Input,
  Tag,
  Typography,
  message,
} from 'antd';
import type { GetProp } from 'antd';
import { createStyles } from 'antd-style';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AgentUiSurface, ConversationSession } from '@shared/types';
import { brandTitle } from '@shared/brand';
import { applyDocumentBranding } from '@shared/dom-branding';
import {
  type AssistantChatMessage,
  type AssistantEvidenceCard,
  type AssistantMetaQuestion,
  type AssistantMetaQuestionCard,
  providerFactory,
} from './agent-api-provider';
import { assistantScenes, buildPromptGroups, getSceneByPath, sceneOrder } from './scene-meta';
import { RunInsightDrawer } from './RunInsightDrawer';
import { useMarkdownTheme } from './use-markdown-theme';
import brandLogo from '@shared/assets/logo.png';

const { Paragraph, Text } = Typography;

const HOME_CONVERSATION_KEY = 'conv-home';
const CHAT_MESSAGES_STORAGE_KEY = 'yzj-ai-crm.assistant.messages.v2';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'yzj-ai-crm.assistant.activeConversation.v2';
const CHAT_CONVERSATIONS_STORAGE_KEY = 'yzj-ai-crm.assistant.conversations.v2';
const ADMIN_BASE_URL = import.meta.env.VITE_ADMIN_BASE_URL?.trim() || 'http://127.0.0.1:8000';
const LEGACY_CHAT_STORAGE_KEYS = [
  'yzj-ai-crm.assistant.messages.v1',
  'yzj-ai-crm.assistant.activeConversation.v1',
  'yzj-ai-crm.assistant.conversations.v1',
];
const USER_CONVERSATION_KEY_PREFIX = 'conv-user-';
const NEW_CONVERSATION_LABEL = '新会话';
const NEW_CONVERSATION_LAST_MESSAGE = '可以描述目标、选择场景或输入 slash 命令。';
const RECORD_RESULT_A2UI_CATALOG_ID = 'local://yzj-crm/record-result/v1';

const recordResultCatalog: Catalog = {
  $id: RECORD_RESULT_A2UI_CATALOG_ID,
  title: 'CRM record result cards',
  components: {
    RecordResultList: {
      type: 'object',
      properties: {
        result: { type: 'object' },
      },
    },
    RecordResultCard: {
      type: 'object',
      properties: {
        result: { type: 'object' },
      },
    },
    RecordResultEmpty: {
      type: 'object',
      properties: {
        result: { type: 'object' },
      },
    },
  },
};

registerCatalog(recordResultCatalog);

const runtimeTenantContext = {
  owner: '当前用户',
  tenantName: '当前租户',
  eidLabel: '由 admin-api 配置',
  appIdLabel: '由 admin-api 配置',
};

const sceneIconMap: Record<string, React.ReactNode> = {
  'customer-analysis': <FileSearchOutlined />,
  'conversation-understanding': <RobotOutlined />,
  'needs-todo-analysis': <ScheduleOutlined />,
  'problem-statement': <GlobalOutlined />,
  'value-positioning': <ProductOutlined />,
  'solution-matching': <ProductOutlined />,
  tasks: <BarsOutlined />,
  chat: <CompassOutlined />,
};

const senderShortcutIcons = [
  <CloudUploadOutlined />,
  <FileSearchOutlined />,
  <RobotOutlined />,
  <GlobalOutlined />,
  <ProductOutlined />,
  <ShareAltOutlined />,
  <FileSearchOutlined />,
];

const slashCommands = [
  {
    key: 'plan',
    command: '/计划',
    description: '基于录音、纪要或自然语言目标生成可裁剪计划',
    icon: <CompassOutlined />,
    route: '/chat',
    draft: '/计划 ',
  },
  {
    key: 'customer-analysis',
    command: '/客户分析',
    description: '汇总客户、联系人、商机和公司研究供给',
    icon: <FileSearchOutlined />,
    route: '/chat/customer-analysis',
    draft: '/客户分析 ',
  },
  {
    key: 'conversation-understanding',
    command: '/拜访会话理解',
    description: '从录音或纪要提炼事实、承诺事项和风险',
    icon: <RobotOutlined />,
    route: '/chat/conversation-understanding',
    draft: '/拜访会话理解 ',
  },
  {
    key: 'needs-todo-analysis',
    command: '/客户需求工作待办分析',
    description: '拆解客户需求、客户侧待办和我方待办',
    icon: <ScheduleOutlined />,
    route: '/chat/needs-todo-analysis',
    draft: '/客户需求工作待办分析 ',
  },
  {
    key: 'problem-statement',
    command: '/问题陈述',
    description: '把需求、约束和风险整理成统一问题定义',
    icon: <GlobalOutlined />,
    route: '/chat/problem-statement',
    draft: '/问题陈述 ',
  },
  {
    key: 'value-positioning',
    command: '/客户价值定位',
    description: '形成价值主张、推进话术和方案输入',
    icon: <ProductOutlined />,
    route: '/chat/value-positioning',
    draft: '/客户价值定位 ',
  },
  {
    key: 'solution-matching',
    command: '/方案匹配',
    description: '匹配内部方案和可引用案例',
    icon: <ProductOutlined />,
    route: '/chat/solution-matching',
    draft: '/方案匹配 ',
  },
  {
    key: 'tasks',
    command: '/我的任务',
    description: '查看任务、资产、追踪和待确认写回',
    icon: <BarsOutlined />,
    route: '/chat/tasks',
    draft: '/我的任务',
  },
];

type SlashCommand = (typeof slashCommands)[number];

type OpenArtifactHandler = (evidence: AssistantEvidenceCard) => void;
type PresentationTarget = Pick<AssistantEvidenceCard, 'artifactId' | 'versionId' | 'title'>;
type GeneratePresentationHandler = (target: PresentationTarget) => void;
type MetaQuestionSubmitHandler = (input: {
  runId: string;
  interactionId: string;
  answers: Record<string, unknown>;
  queryText: string;
}) => void;
type OpenRecordHandler = (input: {
  objectKey: string;
  formInstId: string;
  title?: string;
}) => void;

interface RecordResultFieldView {
  label: string;
  value: string;
}

interface RecordResultRecordView {
  formInstId: string;
  title: string;
  subtitle?: string;
  tags?: string[];
  primaryFields?: RecordResultFieldView[];
  secondaryFields?: RecordResultFieldView[];
}

interface RecordResultViewModel {
  objectKey: string;
  operation: 'search' | 'get';
  title: string;
  total: number;
  displayMode: 'empty' | 'list' | 'card';
  records: RecordResultRecordView[];
  record?: RecordResultRecordView;
}

type ArtifactPresentationStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

interface ArtifactPresentationPayload {
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactPresentationStatus;
  jobId?: string;
  pptArtifact?: {
    artifactId: string;
    jobId: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    downloadPath: string;
  };
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ArtifactDetailPayload {
  artifact: {
    artifactId: string;
    versionId: string;
    version: number;
    title: string;
    sourceToolCode: string;
    vectorStatus: string;
    chunkCount: number;
    updatedAt: string;
  };
  markdown: string;
  summary?: string;
}

interface ArtifactViewerState {
  open: boolean;
  loading: boolean;
  title: string;
  artifactId?: string;
  markdown: string;
  error: string | null;
  artifact?: ArtifactDetailPayload['artifact'];
}

interface PersistedMessageStore {
  version: 2;
  messages: Record<string, MessageInfo<AssistantChatMessage>[]>;
}

interface PersistedConversationStore {
  version: 2;
  conversations: ConversationSession[];
}

type AssistantMessageStatus = MessageInfo<AssistantChatMessage>['status'];

const persistableMessageStatuses = new Set<AssistantMessageStatus>([
  'local',
  'success',
  'error',
  'abort',
]);

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
    gap: 12px;
    margin: 28px 0 20px;
  `,
  logoMark: css`
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);

    img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      border-radius: inherit;
    }
  `,
  logoText: css`
    display: flex;
    flex-direction: column;
    justify-content: center;

    span {
      color: rgba(0, 0, 0, 0.88);
      font-size: 18px;
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: 0.01em;
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
    position: relative;
  `,
  sender: css`
    width: 100%;
    max-width: 840px;

    .ant-sender-content {
      align-items: flex-start;
      min-height: 72px;
    }

    .ant-sender-skill-tag {
      border-radius: ${token.borderRadiusSM}px;
      background: ${token.colorPrimaryBg};
      color: ${token.colorPrimary};
    }
  `,
  senderPrompt: css`
    width: 100%;
    max-width: 840px;
    margin: 0 auto;
    color: ${token.colorText};
  `,
  slashMenu: css`
    width: 100%;
    max-width: 840px;
    margin: 0 auto;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgElevated};
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.14);
    overflow: hidden;
  `,
  slashMenuItem: css`
    width: 100%;
    min-height: 40px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    display: grid;
    grid-template-columns: 22px minmax(96px, auto) 1fr;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    text-align: left;
    color: ${token.colorText};

    &:hover,
    &:focus-visible {
      background: ${token.colorFillQuaternary};
      outline: none;
    }
  `,
  slashMenuIcon: css`
    color: ${token.colorTextSecondary};
    display: inline-flex;
    justify-content: center;
  `,
  slashCommand: css`
    font-weight: 600;
    white-space: nowrap;
  `,
  slashDescription: css`
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  slashEmpty: css`
    min-height: 40px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    color: ${token.colorTextTertiary};
  `,
  composerFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  `,
  composerFooterLeft: css`
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `,
  composerFooterActions: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
  `,
  composerIconButton: css`
    width: 28px;
    height: 28px;
    padding: 0;
    color: ${token.colorTextSecondary};

    &:hover {
      color: ${token.colorPrimary};
      background: ${token.colorFillQuaternary};
    }
  `,
  composerPlanPill: css`
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: ${token.borderRadiusSM}px;
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
    line-height: 1;

    .anticon {
      font-size: 13px;
    }
  `,
  composerPlanClose: css`
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    background: transparent;
    color: ${token.colorPrimary};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    &:hover {
      color: ${token.colorPrimaryHover};
    }
  `,
  composerAttachmentPill: css`
    height: 26px;
    max-width: 180px;
    padding: 0 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 999px;
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    display: inline-flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;

    span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  inlineRefs: css`
    margin-top: 14px;
  `,
  assistantMessageShell: css`
    width: min(100%, 840px);
  `,
  thinkingPanel: css`
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: 16px;
    background:
      linear-gradient(135deg, rgba(230, 244, 255, 0.92), rgba(246, 255, 237, 0.74)),
      ${token.colorBgContainer};
    box-shadow: 0 10px 30px rgba(22, 119, 255, 0.08);
    padding: 14px 16px;
    margin-bottom: 12px;
  `,
  thoughtChain: css`
    margin-top: 12px;

    .ant-thought-chain-item-content {
      color: ${token.colorTextSecondary};
    }
  `,
  assistantMarkdownCard: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(250, 252, 255, 0.92)),
      ${token.colorBgContainer};
    box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
    padding: 18px 20px;

    h1,
    h2,
    h3 {
      margin-top: 10px;
      margin-bottom: 10px;
      letter-spacing: -0.02em;
    }

    ul,
    ol {
      padding-inline-start: 22px;
    }

    p,
    li {
      line-height: 1.8;
    }
  `,
  recordResultSummary: css`
    color: ${token.colorTextSecondary};
    line-height: 1.7;
    margin-bottom: 10px;
  `,
  recordA2uiSurface: css`
    margin-bottom: 12px;
  `,
  recordResultPanel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
    padding: 16px;
  `,
  recordResultHeader: css`
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 12px;
  `,
  recordResultList: css`
    display: grid;
    gap: 10px;
  `,
  recordResultItem: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 12px;
    background: ${token.colorFillQuaternary};
  `,
  recordResultCardTitle: css`
    min-width: 0;
    word-break: break-word;
  `,
  recordFieldGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px 14px;
    margin-top: 12px;
  `,
  recordFieldItem: css`
    min-width: 0;
  `,
  recordFieldLabel: css`
    color: ${token.colorTextTertiary};
    font-size: 12px;
    line-height: 1.4;
  `,
  recordFieldValue: css`
    color: ${token.colorText};
    font-size: 13px;
    line-height: 1.55;
    word-break: break-word;
  `,
  rawResultJson: css`
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.55;
  `,
  recordPreviewPanel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 14px 16px;
    margin-bottom: 12px;
  `,
  recordPreviewRows: css`
    display: grid;
    grid-template-columns: minmax(92px, 0.34fr) 1fr;
    gap: 8px 12px;
    margin-top: 10px;
  `,
  recordPreviewLabel: css`
    color: ${token.colorTextSecondary};
  `,
  recordPreviewValue: css`
    color: ${token.colorText};
    min-width: 0;
    word-break: break-word;
  `,
  metaQuestionCard: css`
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 14px 16px;
    margin-bottom: 12px;
    box-shadow: 0 10px 26px rgba(22, 119, 255, 0.08);
  `,
  metaQuestionSection: css`
    margin-top: 12px;
  `,
  metaQuestionList: css`
    display: grid;
    gap: 12px;
    margin-top: 12px;
  `,
  metaQuestionItem: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 10px 12px;
    background: ${token.colorFillQuaternary};
  `,
  artifactFileList: css`
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 8px;

    .ant-file-card {
      width: 260px;
      background: ${token.colorBgContainer};
      border-color: ${token.colorPrimaryBorder};
      cursor: pointer;
    }
  `,
  evidenceGrid: css`
    margin-top: 8px;

    .ant-prompts-list {
      gap: 10px;
    }

    .ant-prompts-item {
      border: 1px solid ${token.colorBorderSecondary};
      border-radius: 16px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 255, 0.86)),
        ${token.colorFillQuaternary};
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
      transition:
        border-color 0.2s ease,
        box-shadow 0.2s ease,
        transform 0.2s ease;

      &:hover {
        border-color: ${token.colorPrimaryBorder};
        box-shadow: 0 14px 36px rgba(22, 119, 255, 0.12);
        transform: translateY(-1px);
      }
    }
  `,
  evidenceSnippet: css`
    margin-top: 8px;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.65;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  evidenceMeta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  `,
  evidenceErrorText: css`
    margin-top: 6px;
    color: ${token.colorErrorText};
    font-size: 12px;
    line-height: 1.5;
  `,
  markdownDrawerBody: css`
    .ant-drawer-body {
      padding: 0;
      background: ${token.colorBgLayout};
    }
  `,
  markdownViewer: css`
    padding: 24px;
  `,
  markdownViewerCard: css`
    max-width: 920px;
    margin: 0 auto;
    border-radius: 18px;
    box-shadow: 0 16px 48px rgba(15, 23, 42, 0.08);
  `,
}));

const statusConfig = {
  loading: { title: '主智能体正在编排', status: 'loading' },
  updating: { title: '主智能体正在编排', status: 'loading' },
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

function getEvidenceKey(item: AssistantEvidenceCard, index: number) {
  return `${item.artifactId}-${item.versionId}-${index}`;
}

function getVectorStatusColor(status?: string) {
  if (status === 'indexed' || status === 'searched') {
    return 'success';
  }
  if (status === 'embedding_failed') {
    return 'error';
  }
  if (status === 'pending_config' || status === 'pending_embedding') {
    return 'warning';
  }
  return 'default';
}

function compactSnippet(value?: string) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}…` : normalized;
}

function formatReferenceLabel(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) {
    return `Skill Job · ${value.slice(0, 8)}`;
  }
  if (value === 'company-research' || value === 'company-research-fallback') {
    return 'company-research Skill';
  }
  return value;
}

function isPresentationRunning(status?: ArtifactPresentationStatus) {
  return status === 'queued' || status === 'running';
}

function getPresentationButtonLabel(presentation?: ArtifactPresentationPayload) {
  if (!presentation || presentation.status === 'not_started') {
    return '生成 PPT';
  }
  if (isPresentationRunning(presentation.status)) {
    return 'PPT 生成中';
  }
  if (presentation.status === 'succeeded') {
    return '下载 PPT';
  }
  return '重新生成 PPT';
}

function getBrowserStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearLegacyAssistantStorage() {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  LEGACY_CHAT_STORAGE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  });
}

function readPersistedMessageStore(): PersistedMessageStore {
  const storage = getBrowserStorage();
  if (!storage) {
    return { version: 2, messages: {} };
  }

  try {
    const raw = storage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (!raw) {
      return { version: 2, messages: {} };
    }
    const parsed = JSON.parse(raw) as PersistedMessageStore;
    if (parsed?.version !== 2 || typeof parsed.messages !== 'object' || !parsed.messages) {
      return { version: 2, messages: {} };
    }
    return parsed;
  } catch {
    return { version: 2, messages: {} };
  }
}

function writePersistedMessageStore(store: PersistedMessageStore) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function toPersistableMessageInfo(
  value: unknown,
): MessageInfo<AssistantChatMessage> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as MessageInfo<AssistantChatMessage>;
  const isValid = Boolean(
    candidate.id !== undefined
    && persistableMessageStatuses.has(candidate.status)
    && candidate.message
    && typeof candidate.message === 'object'
    && ['user', 'assistant'].includes((candidate.message as AssistantChatMessage).role)
    && typeof (candidate.message as AssistantChatMessage).content === 'string',
  );
  if (!isValid) {
    return null;
  }

  const extraInfo = (candidate.message.extraInfo ?? candidate.extraInfo) as
    | AssistantChatMessage['extraInfo']
    | undefined;
  return {
    ...candidate,
    message: {
      ...candidate.message,
      extraInfo,
    },
    extraInfo,
  };
}

function loadPersistedMessages(
  conversationKey?: string,
): DefaultMessageInfo<AssistantChatMessage>[] | null {
  if (!conversationKey) {
    return null;
  }
  const stored = readPersistedMessageStore().messages[conversationKey];
  if (!Array.isArray(stored)) {
    return null;
  }
  const sanitized = stored
    .map(toPersistableMessageInfo)
    .filter((item): item is MessageInfo<AssistantChatMessage> => Boolean(item));
  return sanitized.length > 0 ? sanitized : null;
}

function persistMessages(conversationKey: string, messages: MessageInfo<AssistantChatMessage>[]) {
  const sanitized = messages
    .map(toPersistableMessageInfo)
    .filter((item): item is MessageInfo<AssistantChatMessage> => Boolean(item));
  const store = readPersistedMessageStore();
  if (sanitized.length > 0) {
    store.messages[conversationKey] = sanitized;
  } else {
    delete store.messages[conversationKey];
  }
  writePersistedMessageStore(store);
}

function isPersistableConversation(value: unknown): value is ConversationSession {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as ConversationSession;
  return Boolean(
    candidate.key
    && typeof candidate.key === 'string'
    && candidate.label
    && typeof candidate.label === 'string'
    && typeof candidate.route === 'string'
    && typeof candidate.group === 'string'
    && typeof candidate.lastMessage === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.scene === 'string',
  );
}

function isUserCreatedConversationKey(key?: string) {
  return Boolean(key?.startsWith(USER_CONVERSATION_KEY_PREFIX));
}

function normalizeConversationTitle(title: string) {
  if (/^新会话\s+\d{1,2}:\d{2}$/.test(title.trim())) {
    return NEW_CONVERSATION_LABEL;
  }
  return title;
}

function normalizeConversationSession(conversation: ConversationSession): ConversationSession {
  if (!isUserCreatedConversationKey(conversation.key)) {
    return conversation;
  }

  return {
    ...conversation,
    label: normalizeConversationTitle(conversation.label),
  };
}

function isBlankUserConversation(conversation?: ConversationSession) {
  if (!conversation || !isUserCreatedConversationKey(conversation.key)) {
    return false;
  }

  return (
    normalizeConversationTitle(conversation.label) === NEW_CONVERSATION_LABEL
    && conversation.lastMessage === NEW_CONVERSATION_LAST_MESSAGE
  );
}

function buildConversationTitleFromQuery(query: string) {
  const normalized = query
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return NEW_CONVERSATION_LABEL;
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

function readPersistedConversationStore(): PersistedConversationStore {
  const storage = getBrowserStorage();
  if (!storage) {
    return { version: 2, conversations: [] };
  }

  try {
    const raw = storage.getItem(CHAT_CONVERSATIONS_STORAGE_KEY);
    if (!raw) {
      return { version: 2, conversations: [] };
    }
    const parsed = JSON.parse(raw) as PersistedConversationStore;
    if (parsed?.version !== 2 || !Array.isArray(parsed.conversations)) {
      return { version: 2, conversations: [] };
    }
    return {
      version: 2,
      conversations: parsed.conversations
        .filter(isPersistableConversation)
        .map(normalizeConversationSession),
    };
  } catch {
    return { version: 2, conversations: [] };
  }
}

function writePersistedConversationStore(store: PersistedConversationStore) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function mergePersistedConversations(baseConversations: ConversationSession[]) {
  const fixedKeys = new Set(baseConversations.map((item) => item.key));
  const customConversations = readPersistedConversationStore().conversations
    .filter((item) => !fixedKeys.has(item.key));

  return [...customConversations, ...baseConversations];
}

function persistCustomConversations(
  conversations: ConversationSession[],
  baseConversations: ConversationSession[],
) {
  const fixedKeys = new Set(baseConversations.map((item) => item.key));
  writePersistedConversationStore({
    version: 2,
    conversations: conversations
      .filter((item) => !fixedKeys.has(item.key))
      .filter(isPersistableConversation)
      .map(normalizeConversationSession),
  });
}

function getStoredActiveConversationKey(allowedKeys: string[]) {
  const storage = getBrowserStorage();
  const key = storage?.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  return key && allowedKeys.includes(key) ? key : null;
}

function persistActiveConversationKey(key: string) {
  const storage = getBrowserStorage();
  try {
    storage?.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, key);
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function uniqueEvidenceArtifacts(evidence: AssistantEvidenceCard[]) {
  const visited = new Set<string>();
  return evidence.filter((item) => {
    if (visited.has(item.artifactId)) {
      return false;
    }
    visited.add(item.artifactId);
    return true;
  });
}

type PendingConfirmationView = NonNullable<
  NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']>['pendingConfirmation']
>;
type PendingInteractionView = NonNullable<
  NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']>['pendingInteraction']
>;

function RecordWritePreviewPanel({
  pending,
  styles,
}: {
  pending?: PendingConfirmationView | null;
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  const userPreview = pending?.userPreview;
  if (!userPreview || pending?.status !== 'pending') {
    return null;
  }

  const recommendedRows = userPreview.recommendedRows ?? [];
  return (
    <div className={styles.recordPreviewPanel}>
      <Space align="center" wrap>
        <Text strong>{userPreview.title || pending.title}</Text>
        <Tag color="gold">等待确认</Tag>
      </Space>
      {userPreview.summaryRows.length ? (
        <div className={styles.recordPreviewRows}>
          {userPreview.summaryRows.map((row) => (
            <React.Fragment key={`${row.paramKey ?? row.label}-${row.value ?? ''}`}>
              <Text className={styles.recordPreviewLabel}>{row.label}</Text>
              <Text className={styles.recordPreviewValue}>{row.value || '未填写'}</Text>
            </React.Fragment>
          ))}
        </div>
      ) : (
        <Text type="secondary">暂无可展示字段摘要，请查看运行洞察。</Text>
      )}
      {recommendedRows.length ? (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">后续建议补充：</Text>
          <Space size={6} wrap style={{ marginLeft: 8 }}>
            {recommendedRows.map((row) => (
              <Tag key={row.paramKey ?? row.label}>{row.label}</Tag>
            ))}
          </Space>
        </div>
      ) : null}
    </div>
  );
}

function MetaQuestionCardPanel({
  pendingInteraction,
  styles,
  onSubmit,
}: {
  pendingInteraction?: PendingInteractionView | null;
  styles: ReturnType<typeof useStyles>['styles'];
  onSubmit?: MetaQuestionSubmitHandler;
}) {
  const questionCard = pendingInteraction?.questionCard;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setAnswers({});
  }, [pendingInteraction?.interactionId]);

  if (!questionCard || pendingInteraction?.status !== 'pending') {
    return null;
  }

  const currentValues = Object.entries(questionCard.currentValues ?? {});
  const questions = questionCard.questions ?? [];
  const answerCount = Object.values(answers).filter((value) => !isEmptyMetaAnswer(value)).length;
  const canSubmit = Boolean(onSubmit) && answerCount > 0;

  return (
    <div className={styles.metaQuestionCard}>
      <Space align="center" wrap>
        <Text strong>{questionCard.title || pendingInteraction.title}</Text>
        <Tag color="blue">需要补充</Tag>
      </Space>
      {currentValues.length ? (
        <div className={styles.metaQuestionSection}>
          <Text type="secondary">已收到</Text>
          <Space size={6} wrap style={{ marginTop: 8 }}>
            {currentValues.map(([paramKey, row]) => (
              <Tag key={paramKey} color="green">
                {row.label}：{row.value || '已填写'}
              </Tag>
            ))}
          </Space>
        </div>
      ) : null}
      {questions.length ? (
        <div className={styles.metaQuestionList}>
          {questions.map((question) => (
            <MetaQuestionInput
              key={question.questionId}
              question={question}
              value={answers[question.paramKey] ?? question.currentValue}
              styles={styles}
              onChange={(value) => {
                setAnswers((current) => ({
                  ...current,
                  [question.paramKey]: value,
                }));
              }}
            />
          ))}
        </div>
      ) : (
        <Text type="secondary">暂无可结构化补充的问题，可以继续用自然语言输入。</Text>
      )}
      <Space size={8} wrap style={{ marginTop: 12 }}>
        <Button
          type="primary"
          size="small"
          disabled={!canSubmit}
          onClick={() => {
            if (!onSubmit || !pendingInteraction) {
              return;
            }
            const cleaned = Object.fromEntries(
              Object.entries(answers).filter(([, value]) => !isEmptyMetaAnswer(value)),
            );
            onSubmit({
              runId: pendingInteraction.runId,
              interactionId: pendingInteraction.interactionId,
              answers: cleaned,
              queryText: buildMetaQuestionSubmitText(questionCard, cleaned),
            });
          }}
        >
          {questionCard.submitLabel || '补充并继续'}
        </Button>
        <Text type="secondary">也可以继续直接输入自然语言补充。</Text>
      </Space>
    </div>
  );
}

function MetaQuestionInput({
  question,
  value,
  styles,
  onChange,
}: {
  question: AssistantMetaQuestion;
  value: unknown;
  styles: ReturnType<typeof useStyles>['styles'];
  onChange: (value: unknown) => void;
}) {
  return (
    <div className={styles.metaQuestionItem}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Text strong>{question.label}</Text>
          {question.required ? <Tag color="red">必填</Tag> : null}
        </Space>
        {question.options?.length ? (
          <Space size={6} wrap>
            {question.options.map((option) => {
              const active = String(value ?? '') === String(option.value);
              return (
                <Button
                  key={String(option.key ?? option.value)}
                  size="small"
                  type={active ? 'primary' : 'default'}
                  onClick={() => onChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </Space>
        ) : (
          <Input
            size="small"
            value={value === undefined || value === null || Array.isArray(value) ? '' : String(value)}
            placeholder={question.placeholder || `请输入${question.label}`}
            inputMode={question.type === 'phone' ? 'tel' : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {question.reason ? <Text type="secondary">{question.reason}</Text> : null}
      </Space>
    </div>
  );
}

function isEmptyMetaAnswer(value: unknown): boolean {
  return value === undefined
    || value === null
    || typeof value === 'string' && value.trim() === ''
    || Array.isArray(value) && value.length === 0;
}

function buildMetaQuestionSubmitText(questionCard: AssistantMetaQuestionCard, answers: Record<string, unknown>) {
  const labels = new Map(questionCard.questions.map((question) => [question.paramKey, question.label]));
  const parts = Object.entries(answers).map(([paramKey, value]) => {
    const question = questionCard.questions.find((item) => item.paramKey === paramKey);
    const option = question?.options?.find((item) => String(item.value) === String(value));
    const displayValue = option?.label ?? String(value);
    return `${labels.get(paramKey) ?? paramKey}：${displayValue}`;
  });
  return parts.length ? parts.join('，') : '补充信息';
}

function AgentUiSurfacePanel({
  surfaces,
  styles,
  onOpenRecord,
}: {
  surfaces: AgentUiSurface[];
  styles: ReturnType<typeof useStyles>['styles'];
  onOpenRecord?: OpenRecordHandler;
}) {
  const [rawSurface, setRawSurface] = useState<AgentUiSurface | null>(null);
  const components = useMemo(
    () => buildRecordA2UIComponents(styles),
    [styles],
  );

  if (!surfaces.length) {
    return null;
  }

  return (
    <>
      {surfaces.map((surface) => (
        <div key={surface.surfaceId} className={styles.recordA2uiSurface}>
          <A2UIBox
            commands={surface.commands as any}
            components={components}
            onAction={(event: any) => {
              if (event?.name === 'record.open' && event.context?.formInstId) {
                onOpenRecord?.({
                  objectKey: String(event.context.objectKey ?? surface.summary.objectKey),
                  formInstId: String(event.context.formInstId),
                  title: typeof event.context.title === 'string' ? event.context.title : undefined,
                });
              }
            }}
          >
            <A2UICard id={surface.surfaceId} />
          </A2UIBox>
          {surface.rawResult ? (
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              style={{ paddingInline: 0, marginTop: 4 }}
              onClick={() => setRawSurface(surface)}
            >
              查看原始结果
            </Button>
          ) : null}
        </div>
      ))}
      <Drawer
        open={Boolean(rawSurface)}
        width={720}
        title="原始结果"
        onClose={() => setRawSurface(null)}
      >
        <pre className={styles.rawResultJson}>
          {rawSurface?.rawResult ? JSON.stringify(rawSurface.rawResult, null, 2) : ''}
        </pre>
      </Drawer>
    </>
  );
}

function buildRecordA2UIComponents(styles: ReturnType<typeof useStyles>['styles']) {
  return {
    RecordResultList: (props: { result?: RecordResultViewModel; onAction?: (name: string, context: Record<string, unknown>) => void }) => (
      <RecordResultList result={props.result} styles={styles} onAction={props.onAction} />
    ),
    RecordResultCard: (props: { result?: RecordResultViewModel; onAction?: (name: string, context: Record<string, unknown>) => void }) => (
      <RecordResultCard result={props.result} styles={styles} onAction={props.onAction} />
    ),
    RecordResultEmpty: (props: { result?: RecordResultViewModel }) => (
      <RecordResultEmpty result={props.result} styles={styles} />
    ),
  };
}

function RecordResultList({
  result,
  styles,
  onAction,
}: {
  result?: RecordResultViewModel;
  styles: ReturnType<typeof useStyles>['styles'];
  onAction?: (name: string, context: Record<string, unknown>) => void;
}) {
  const records = result?.records ?? [];
  return (
    <div className={styles.recordResultPanel}>
      <div className={styles.recordResultHeader}>
        <div>
          <Text strong>{result?.title ?? '记录查询结果'}</Text>
          <div className={styles.recordResultSummary}>共 {result?.total ?? records.length} 条，优先展示关键字段。</div>
        </div>
        <Tag color="blue">{mapRecordObjectLabel(result?.objectKey)}</Tag>
      </div>
      <div className={styles.recordResultList}>
        {records.map((record) => (
          <div key={record.formInstId || record.title} className={styles.recordResultItem}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div className={styles.recordResultCardTitle}>
                <Text strong>{record.title}</Text>
                {record.subtitle ? <div className={styles.recordResultSummary}>{record.subtitle}</div> : null}
                <RecordTags tags={record.tags} />
              </div>
              {record.formInstId ? (
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => onAction?.('record.open', {
                    objectKey: result?.objectKey,
                    formInstId: record.formInstId,
                    title: record.title,
                  })}
                >
                  查看详情
                </Button>
              ) : null}
            </Space>
            <RecordFieldGrid
              fields={[...(record.primaryFields ?? []), ...(record.secondaryFields ?? []).slice(0, 2)]}
              styles={styles}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordResultCard({
  result,
  styles,
  onAction,
}: {
  result?: RecordResultViewModel;
  styles: ReturnType<typeof useStyles>['styles'];
  onAction?: (name: string, context: Record<string, unknown>) => void;
}) {
  const record = result?.record ?? result?.records?.[0];
  if (!record) {
    return <RecordResultEmpty result={result} styles={styles} />;
  }
  const fields = [...(record.primaryFields ?? []), ...(record.secondaryFields ?? [])];
  return (
    <div className={styles.recordResultPanel}>
      <div className={styles.recordResultHeader}>
        <div className={styles.recordResultCardTitle}>
          <Text strong>{record.title}</Text>
          {record.subtitle ? <div className={styles.recordResultSummary}>{record.subtitle}</div> : null}
          <RecordTags tags={record.tags} />
        </div>
        {record.formInstId && result?.operation !== 'get' ? (
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => onAction?.('record.open', {
              objectKey: result?.objectKey,
              formInstId: record.formInstId,
              title: record.title,
            })}
          >
            查看详情
          </Button>
        ) : null}
      </div>
      <RecordFieldGrid fields={fields} styles={styles} />
    </div>
  );
}

function RecordResultEmpty({
  result,
  styles,
}: {
  result?: RecordResultViewModel;
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  return (
    <Alert
      type="info"
      showIcon
      className={styles.recordResultPanel}
      message={result?.title ?? '未查询到记录'}
      description="可以调整查询条件后再试。"
    />
  );
}

function RecordTags({ tags }: { tags?: string[] }) {
  const visibleTags = (tags ?? []).filter(Boolean).slice(0, 4);
  if (!visibleTags.length) {
    return null;
  }
  return (
    <Space size={6} wrap style={{ marginTop: 8 }}>
      {visibleTags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
    </Space>
  );
}

function RecordFieldGrid({
  fields,
  styles,
}: {
  fields: RecordResultFieldView[];
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  const visibleFields = fields.filter((field) => field.label && field.value);
  if (!visibleFields.length) {
    return null;
  }
  return (
    <div className={styles.recordFieldGrid}>
      {visibleFields.map((field) => (
        <div key={`${field.label}:${field.value}`} className={styles.recordFieldItem}>
          <div className={styles.recordFieldLabel}>{field.label}</div>
          <div className={styles.recordFieldValue}>{field.value}</div>
        </div>
      ))}
    </div>
  );
}

function mapRecordObjectLabel(objectKey?: string) {
  if (objectKey === 'contact') {
    return '联系人';
  }
  if (objectKey === 'opportunity') {
    return '商机';
  }
  if (objectKey === 'followup') {
    return '跟进记录';
  }
  return '客户';
}

function AssistantMessageContent({
  content,
  info,
  styles,
  markdownClassName,
  onOpenArtifact,
  onGeneratePresentation,
  onOpenRecord,
  onSubmitQuestionCard,
  presentationByArtifactId,
}: {
  content: string;
  info: any;
  styles: ReturnType<typeof useStyles>['styles'];
  markdownClassName: string;
  onOpenArtifact: OpenArtifactHandler;
  onGeneratePresentation: GeneratePresentationHandler;
  onOpenRecord?: OpenRecordHandler;
  onSubmitQuestionCard?: MetaQuestionSubmitHandler;
  presentationByArtifactId: Record<string, ArtifactPresentationPayload>;
}) {
  const evidence = (info.extraInfo?.evidence ?? []) as AssistantEvidenceCard[];
  const uiSurfaces = (info.extraInfo?.uiSurfaces ?? []) as AgentUiSurface[];
  const pendingConfirmation = info.extraInfo?.agentTrace?.pendingConfirmation as PendingConfirmationView | null | undefined;
  const pendingInteraction = info.extraInfo?.agentTrace?.pendingInteraction as PendingInteractionView | null | undefined;
  const artifactFiles = uniqueEvidenceArtifacts(evidence);
  const evidenceByKey = new Map(
    evidence.map((item, index) => [getEvidenceKey(item, index), item]),
  );

  return (
    <div className={styles.assistantMessageShell}>
      <AgentThinkingPanel info={info} styles={styles} />
      <RecordWritePreviewPanel pending={pendingConfirmation} styles={styles} />
      <MetaQuestionCardPanel
        pendingInteraction={pendingInteraction}
        styles={styles}
        onSubmit={onSubmitQuestionCard}
      />
      {uiSurfaces.length ? (
        <>
          {content?.trim() ? <div className={styles.recordResultSummary}>{content}</div> : null}
          <AgentUiSurfacePanel
            surfaces={uiSurfaces}
            styles={styles}
            onOpenRecord={onOpenRecord}
          />
        </>
      ) : (
        <div className={styles.assistantMarkdownCard}>
          <XMarkdown
            paragraphTag="div"
            className={markdownClassName}
            components={{ think: ThinkComponent }}
            streaming={{ hasNextChunk: info.status === 'updating', enableAnimation: true }}
          >
            {content}
          </XMarkdown>
        </div>
      )}

      {artifactFiles.length ? (
        <div className={styles.inlineRefs}>
          <Text strong>Markdown Artifact</Text>
          <div className={styles.artifactFileList}>
            {artifactFiles.map((item) => (
              <FileCard
                key={item.artifactId}
                name={`${item.title}.md`}
                icon="markdown"
                description={`v${item.version} · ${item.vectorStatus ?? 'artifact'}`}
                onClick={() => onOpenArtifact(item)}
              />
            ))}
          </div>
        </div>
      ) : null}

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
              <Tag key={item}>{formatReferenceLabel(item)}</Tag>
            ))}
          </div>
        </div>
      ) : null}

      {evidence.length ? (
        <div className={styles.inlineRefs}>
          <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>证据卡</Text>
            <Text type="secondary">{evidence.length} 条可引用片段</Text>
          </Space>
          <Prompts
            vertical
            wrap
            className={styles.evidenceGrid}
            items={evidence.map((item, index) => ({
              key: getEvidenceKey(item, index),
              icon: <FileSearchOutlined />,
              label: (
                <Space size={6} wrap>
                  <Text strong>{item.title}</Text>
                  <Tag color="geekblue">v{item.version}</Tag>
                  {item.vectorStatus ? (
                    <Tag color={getVectorStatusColor(item.vectorStatus)}>
                      {item.vectorStatus}
                    </Tag>
                  ) : null}
                </Space>
              ),
              description: (
                <div>
                  {(() => {
                    const presentation = presentationByArtifactId[item.artifactId];
                    return (
                      <>
                  <div className={styles.evidenceMeta}>
                    <Tag color="blue">{item.sourceToolCode}</Tag>
                    <Tag>{item.anchorLabel}</Tag>
                    {typeof item.score === 'number' ? (
                      <Tag color="purple">{Math.round(item.score * 100)}%</Tag>
                    ) : null}
                  </div>
                  <div className={styles.evidenceSnippet}>{compactSnippet(item.snippet)}</div>
                  <Space size={10} wrap style={{ marginTop: 8 }}>
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      style={{ paddingInline: 0 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenArtifact(item);
                      }}
                    >
                      查看完整 Markdown
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      icon={<ShareAltOutlined />}
                      loading={isPresentationRunning(presentation?.status)}
                      disabled={isPresentationRunning(presentation?.status)}
                      style={{ paddingInline: 0 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (presentation?.status === 'succeeded' && presentation.pptArtifact?.downloadPath) {
                          window.open(presentation.pptArtifact.downloadPath, '_blank', 'noopener,noreferrer');
                          return;
                        }
                        onGeneratePresentation(item);
                      }}
                    >
                      {getPresentationButtonLabel(presentation)}
                    </Button>
                  </Space>
                  {presentation?.status === 'failed' && presentation.errorMessage ? (
                    <div className={styles.evidenceErrorText}>{presentation.errorMessage}</div>
                  ) : null}
                      </>
                    );
                  })()}
                </div>
              ),
            }))}
            onItemClick={(event) => {
              const item = evidenceByKey.get(event.data.key);
              if (item) {
                onOpenArtifact(item);
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function mapPlanStepStatus(status?: string): ThoughtChainItemProps['status'] | undefined {
  if (status === 'succeeded') {
    return 'success';
  }
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'running') {
    return 'loading';
  }
  if (status === 'skipped') {
    return 'abort';
  }
  return undefined;
}

function buildThoughtItems(info: any): ThoughtChainItemType[] {
  const executionStatus = info.extraInfo?.agentTrace?.executionState?.status;
  const planSteps = info.extraInfo?.agentTrace?.taskPlan?.steps;
  if (Array.isArray(planSteps) && planSteps.length > 0) {
    return planSteps.map((step: any, index: number) => {
      const status = mapPlanStepStatus(step.status);
      return {
        key: step.key ?? `step-${index}`,
        title: step.title ?? `步骤 ${index + 1}`,
        description: Array.isArray(step.toolRefs) ? step.toolRefs.join(' / ') : undefined,
        status,
        blink: status === 'loading',
      };
    });
  }

  const isRunning = executionStatus === 'running' || info.status === 'loading' || info.status === 'updating';
  return [
    {
      key: 'intent',
      title: '理解用户目标',
      description: '将输入提交到真实智能体接口，等待后端生成意图帧',
      status: isRunning ? 'success' : undefined,
    },
    {
      key: 'plan',
      title: '编排执行计划',
      description: '后端按场景决定是否调用工具、检索或生成资产',
      status: isRunning ? 'loading' : undefined,
      blink: isRunning,
    },
    {
      key: 'result',
      title: '整理结果与证据',
      description: '仅在真实接口返回后展示回答、Markdown 和证据卡',
    },
  ];
}

function AgentThinkingPanel({
  info,
  styles,
}: {
  info: any;
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  const executionStatus = info.extraInfo?.agentTrace?.executionState?.status;
  const visible = info.status === 'loading' || info.status === 'updating' || executionStatus === 'running';
  if (!visible) {
    return null;
  }

  const running = info.status === 'loading' || info.status === 'updating' || executionStatus === 'running';
  return (
    <div className={styles.thinkingPanel}>
      <Think
        title={running ? '智能体正在处理' : '思考完成'}
        loading={running}
        defaultExpanded
        blink={running}
      >
        <Text type="secondary">
          复杂任务可能包含检索、外部技能和资产生成。这里展示可观测执行步骤，不暴露模型内部隐式推理。
        </Text>
      </Think>
      <ThoughtChain
        line="dashed"
        items={buildThoughtItems(info)}
        className={styles.thoughtChain}
      />
    </div>
  );
}

function buildSceneEntryPrompts() {
  return [
    {
      key: 'scene-entry',
      label: '销售主链路',
      children: sceneOrder
        .filter((item) =>
          [
            'customer-analysis',
            'conversation-understanding',
            'needs-todo-analysis',
            'problem-statement',
            'value-positioning',
            'solution-matching',
          ].includes(item.key),
        )
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

function buildFixedSceneConversations(): ConversationSession[] {
  return sceneOrder
    .filter((item) => item.key !== 'chat')
    .map((item) => ({
      key: `scene-${item.key}`,
      label: item.title,
      route: item.route,
      group: '场景入口',
      lastMessage: item.subtitle,
      updatedAt: '固定入口',
      scene: item.key,
    }));
}

function buildSenderPrompts(scene = assistantScenes.chat) {
  return scene.prompts.slice(0, 4).map((item, index) => ({
    key: item.key,
    description: item.label,
    icon: senderShortcutIcons[index] ?? <CompassOutlined />,
  })) satisfies GetProp<typeof Prompts, 'items'>;
}

function getSceneSlashCommand(sceneKey: string) {
  switch (sceneKey) {
    case 'customer-analysis':
      return '/客户分析';
    case 'conversation-understanding':
      return '/拜访会话理解';
    case 'needs-todo-analysis':
      return '/客户需求工作待办分析';
    case 'problem-statement':
      return '/问题陈述';
    case 'value-positioning':
      return '/客户价值定位';
    case 'solution-matching':
      return '/方案匹配';
    case 'tasks':
      return '/我的任务';
    default:
      return '/';
  }
}

function getSlashCommandFromInput(text: string) {
  const normalized = text.trimStart();

  return slashCommands.find(
    (item) => normalized === item.command || normalized.startsWith(`${item.command} `),
  );
}

function getSlashCommandByRoute(route: string) {
  return slashCommands.find((item) => item.route === route && item.key !== 'plan');
}

function resolveWritebackResume(
  text: string,
  agentTrace?: NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']>,
) {
  const pending = agentTrace?.pendingConfirmation;
  if (!pending || pending.status !== 'pending') {
    return undefined;
  }

  const normalized = text.replace(/\s+/g, '').toLowerCase();
  const approve = /^(确认|确认写回|同意|同意写回|批准|批准写回|执行|提交|提交写回|approve|yes|ok)$/.test(normalized);
  const reject = /^(取消|取消写回|拒绝|拒绝写回|不要|不写回|reject|no)$/.test(normalized);

  if (!approve && !reject) {
    return undefined;
  }

  return {
    runId: pending.runId,
    action: 'confirm_writeback' as const,
    decision: approve ? 'approve' as const : 'reject' as const,
    confirmationId: pending.confirmationId,
  };
}

function getSceneSourceTags(sceneKey: string) {
  if (sceneKey === 'customer-analysis') {
    return ['客户主数据', '联系人', '商机盘点', '公司研究供给'];
  }
  if (sceneKey === 'conversation-understanding') {
    return ['录音转写', '拜访纪要', '跟进记录', '风险信号'];
  }
  if (sceneKey === 'needs-todo-analysis') {
    return ['会话理解结果', '需求清单', '客户侧待办', '我方待办'];
  }
  if (sceneKey === 'problem-statement') {
    return ['问题背景', '约束条件', '影响范围', '优先级'];
  }
  if (sceneKey === 'value-positioning') {
    return ['客户问题', '价值主张', '推进话术', '下一步建议'];
  }
  if (sceneKey === 'solution-matching') {
    return ['客户诉求', '候选方案', '匹配案例', '推进建议'];
  }
  if (sceneKey === 'tasks') {
    return ['追踪编号', '任务编号', '资产结果', '写回状态'];
  }
  return ['slash 命令', '计划模板', 'shadow.* 对象能力', 'ext.* 外部技能'];
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
  onOpenArtifact: OpenArtifactHandler,
  onGeneratePresentation: GeneratePresentationHandler,
  onOpenRecord: OpenRecordHandler,
  onSubmitQuestionCard: MetaQuestionSubmitHandler,
  presentationByArtifactId: Record<string, ArtifactPresentationPayload>,
): BubbleListProps['role'] {
  return {
    assistant: {
      placement: 'start',
      variant: 'borderless',
      shape: 'default',
      styles: {
        content: {
          background: 'transparent',
          padding: 0,
          maxWidth: '100%',
        },
      },
      avatar: (
        <Avatar
          size={30}
          style={{ backgroundColor: '#1677ff' }}
        >
          YZ
        </Avatar>
      ),
      header: (_, { status, extraInfo }) => {
        const executionStatus = extraInfo?.agentTrace?.executionState?.status;
        const config = executionStatus === 'running'
          ? { title: '公司研究任务仍在运行', status: 'loading' }
          : statusConfig[status as keyof typeof statusConfig];
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
        <AssistantMessageContent
          content={content}
          info={info}
          styles={styles}
          markdownClassName={markdownClassName}
          onOpenArtifact={onOpenArtifact}
          onGeneratePresentation={onGeneratePresentation}
          onOpenRecord={onOpenRecord}
          onSubmitQuestionCard={onSubmitQuestionCard}
          presentationByArtifactId={presentationByArtifactId}
        />
      ),
    },
    user: {
      placement: 'end',
      shape: 'round',
      variant: 'filled',
    },
  };
}

function ArtifactMarkdownDrawer({
  state,
  markdownClassName,
  styles,
  presentation,
  onGeneratePresentation,
  onClose,
}: {
  state: ArtifactViewerState;
  markdownClassName: string;
  styles: ReturnType<typeof useStyles>['styles'];
  presentation?: ArtifactPresentationPayload;
  onGeneratePresentation: GeneratePresentationHandler;
  onClose: () => void;
}) {
  return (
    <Drawer
      title={
        <Space orientation="vertical" size={2}>
          <Text strong>{state.title || '公司研究 Markdown'}</Text>
          {state.artifact ? (
            <Text type="secondary">
              {state.artifact.sourceToolCode} · v{state.artifact.version} · {state.artifact.chunkCount} chunks
            </Text>
          ) : null}
        </Space>
      }
      width="min(960px, 92vw)"
      open={state.open}
      onClose={onClose}
      destroyOnClose={false}
      className={styles.markdownDrawerBody}
      extra={
        state.markdown ? (
          <Space>
            {state.artifact ? (
              <Button
                icon={<ShareAltOutlined />}
                loading={isPresentationRunning(presentation?.status)}
                disabled={isPresentationRunning(presentation?.status)}
                onClick={() => {
                  if (presentation?.status === 'succeeded' && presentation.pptArtifact?.downloadPath) {
                    window.open(presentation.pptArtifact.downloadPath, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  onGeneratePresentation({
                    artifactId: state.artifact!.artifactId,
                    versionId: state.artifact!.versionId,
                    title: state.artifact!.title,
                  });
                }}
              >
                {getPresentationButtonLabel(presentation)}
              </Button>
            ) : null}
            <Actions.Copy text={state.markdown} icon={<CopyOutlined />} />
          </Space>
        ) : null
      }
    >
      <div className={styles.markdownViewer}>
        {state.loading ? (
          <Card className={styles.markdownViewerCard}>
            <Skeleton active paragraph={{ rows: 10 }} />
          </Card>
        ) : state.error ? (
          <Alert
            type="error"
            showIcon
            message="Markdown 加载失败"
            description={state.error}
          />
        ) : (
          <Card className={styles.markdownViewerCard}>
            {state.artifact ? (
              <>
                <Space wrap>
                  <Tag color="geekblue">v{state.artifact.version}</Tag>
                  <Tag color={getVectorStatusColor(state.artifact.vectorStatus)}>
                    {state.artifact.vectorStatus}
                  </Tag>
                  <Tag>{state.artifact.updatedAt}</Tag>
                </Space>
                <Divider />
              </>
            ) : null}
            <XMarkdown paragraphTag="div" className={markdownClassName}>
              {state.markdown || '暂无 Markdown 内容。'}
            </XMarkdown>
          </Card>
        )}
      </div>
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
  const [runInsightOpen, setRunInsightOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [artifactViewer, setArtifactViewer] = useState<ArtifactViewerState>({
    open: false,
    loading: false,
    title: '',
    markdown: '',
    error: null,
  });
  const [presentationByArtifactId, setPresentationByArtifactId] = useState<
    Record<string, ArtifactPresentationPayload>
  >({});
  const [blankConversationKeys, setBlankConversationKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingBlankConversationSubmitRef = useRef<Record<string, string>>({});
  const [selectedComposerCommand, setSelectedComposerCommand] = useState<SlashCommand | null>(
    null,
  );
  const homeConversation = useMemo(
    () => ({
      key: HOME_CONVERSATION_KEY,
      label: 'AI 销售工作台',
      route: '/chat',
      group: '固定会话',
      lastMessage: '从这里描述目标生成计划，或按销售主链路逐步推进。',
      updatedAt: '刚刚',
      scene: 'chat',
    }),
    [],
  );
  const baseConversations = useMemo(
    () => [homeConversation, ...buildFixedSceneConversations()],
    [homeConversation],
  );
  const defaultConversations = useMemo(
    () => mergePersistedConversations(baseConversations),
    [baseConversations],
  );
  const getConversationKeyByRoute = React.useCallback(
    (route: string) =>
      baseConversations.find((item) => item.route === route)?.key ?? HOME_CONVERSATION_KEY,
    [baseConversations],
  );
  const promptGroups = useMemo(() => buildPromptGroups(scene), [scene]);
  const sceneEntryPrompts = useMemo(() => buildSceneEntryPrompts(), []);
  const senderPrompts = useMemo(() => buildSenderPrompts(scene), [scene]);
  const slashInput = inputValue.trimStart();
  const slashQuery = slashInput.startsWith('/') ? slashInput.slice(1).trim() : '';
  const filteredSlashCommands = useMemo(() => {
    if (!slashInput.startsWith('/')) {
      return [];
    }

    if (!slashQuery) {
      return slashCommands;
    }

    return slashCommands.filter((item) => {
      const commandText = item.command.slice(1);
      return (
        item.command.includes(slashQuery)
        || commandText.includes(slashQuery)
        || item.description.includes(slashQuery)
        || item.key.includes(slashQuery)
      );
    });
  }, [slashInput, slashQuery]);
  const showSlashMenu = !attachmentsOpen && slashInput.startsWith('/') && slashMenuOpen;

  useEffect(() => {
    applyDocumentBranding(brandTitle, brandLogo);
  }, [location.pathname]);

  useEffect(() => {
    clearLegacyAssistantStorage();
  }, []);

  useEffect(() => {
    const routeCommand = getSlashCommandByRoute(location.pathname);
    if (routeCommand) {
      setSelectedComposerCommand(routeCommand);
    }
  }, [location.pathname]);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    setConversation,
  } = useXConversations({
    defaultConversations,
    defaultActiveConversationKey:
      getStoredActiveConversationKey(defaultConversations.map((item) => item.key))
      ?? getConversationKeyByRoute(location.pathname),
  });
  const activeConversation = conversations.find(
    (item) => item.key === activeConversationKey,
  ) as ConversationSession | undefined;
  const isActiveConversationBlank = Boolean(
    blankConversationKeys.has(activeConversationKey)
    || isBlankUserConversation(activeConversation),
  );

  useEffect(() => {
    if (activeConversation?.route === location.pathname) {
      return;
    }

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

  const { onRequest, messages, isRequesting, abort, onReload, setMessage, isDefaultMessagesRequesting } =
    useXChat<AssistantChatMessage>({
      provider: providerFactory(activeConversationKey) as any,
      conversationKey: activeConversationKey,
      defaultMessages: (info?: { conversationKey?: string }) => {
        const key = String(info?.conversationKey ?? activeConversationKey);
        const conversation = conversations.find((item) => item.key === key) as
          | ConversationSession
          | undefined;
        if (isBlankUserConversation(conversation)) {
          return [];
        }
        return loadPersistedMessages(key) ?? [];
      },
      requestPlaceholder: (requestParams) => {
        const sceneKey = requestParams.sceneKey || scene.key;
        return {
          role: 'assistant',
          content:
            '智能体正在处理请求。复杂研究、检索和资产生成可能需要几十秒到数分钟；本页只展示真实接口返回的结果，不生成本地替代答案。',
          extraInfo: {
            feedback: 'default',
            sceneKey,
            headline: '智能体正在执行，请稍候',
            references: ['POST /api/agent/chat'],
          },
        };
      },
      requestFallback: (_, { error, messageInfo }) => {
        if (error.name === 'AbortError') {
          return {
            role: 'assistant',
            content: messageInfo?.message?.content || '请求已中止。',
          };
        }

        return {
          role: 'assistant',
          content: `## 智能体接口当前不可用

本次没有生成本地替代结果。请确认 \`admin-api\` 与相关技能运行时已启动后重试，或到管理员后台检查智能体追踪 / 服务健康。

- 请求入口：\`POST /api/agent/chat\`
- 错误信息：${error instanceof Error ? error.message : '未知错误'}`,
          extraInfo: {
            feedback: 'default',
            sceneKey: scene.key,
            headline: '智能体接口请求失败',
            references: ['POST /api/agent/chat', 'admin-api', 'skill-runtime'],
          },
        };
      },
    });

  const messageList = messages ?? [];
  const displayMessageList = isActiveConversationBlank ? [] : messageList;
  const latestAgentMessage = [...displayMessageList]
    .reverse()
    .find((item) => item.message.role === 'assistant' && item.message.extraInfo?.agentTrace);
  const latestAgentTrace = latestAgentMessage?.message.extraInfo?.agentTrace;
  const latestEvidence = latestAgentMessage?.message.extraInfo?.evidence ?? [];
  const safeScrollToBottom = React.useCallback(() => {
    const bubbleList = listRef.current;
    if (!bubbleList?.scrollBoxNativeElement) {
      return;
    }

    bubbleList.scrollTo({ top: 'bottom' });
  }, []);

  useEffect(() => {
    if (displayMessageList.length) {
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    }
  }, [activeConversationKey, displayMessageList.length, safeScrollToBottom]);

  useEffect(() => {
    const expectedQuery = pendingBlankConversationSubmitRef.current[activeConversationKey];
    if (!expectedQuery) {
      return;
    }

    const hasSubmittedMessage = messageList.some(
      (item) => item.message.role === 'user' && item.message.content === expectedQuery,
    );
    if (!hasSubmittedMessage) {
      return;
    }

    delete pendingBlankConversationSubmitRef.current[activeConversationKey];
    setBlankConversationKeys((current) => {
      const next = new Set(current);
      next.delete(activeConversationKey);
      return next;
    });
  }, [activeConversationKey, messageList]);

  useEffect(() => {
    persistActiveConversationKey(activeConversationKey);
  }, [activeConversationKey]);

  useEffect(() => {
    persistCustomConversations(conversations as ConversationSession[], baseConversations);
  }, [baseConversations, conversations]);

  useEffect(() => {
    if (isDefaultMessagesRequesting || isActiveConversationBlank) {
      return;
    }
    persistMessages(activeConversationKey, messageList);
  }, [activeConversationKey, isActiveConversationBlank, isDefaultMessagesRequesting, messageList]);

  const fetchPresentationStatus = React.useCallback(async (artifactId: string) => {
    const response = await fetch(
      `/api/artifacts/${encodeURIComponent(artifactId)}/presentation`,
    );
    if (!response.ok) {
      throw new Error(`PPT 状态接口返回 ${response.status}`);
    }
    const payload = (await response.json()) as ArtifactPresentationPayload;
    setPresentationByArtifactId((current) => ({
      ...current,
      [artifactId]: payload,
    }));
    return payload;
  }, []);

  useEffect(() => {
    const runningArtifacts = Object.values(presentationByArtifactId)
      .filter((item) => isPresentationRunning(item.status))
      .map((item) => item.artifactId);

    if (!runningArtifacts.length) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      runningArtifacts.forEach((artifactId) => {
        void fetchPresentationStatus(artifactId).catch(() => {
          // Keep the last visible state; manual retry remains available.
        });
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [fetchPresentationStatus, presentationByArtifactId]);

  const handleGeneratePresentation = React.useCallback(
    async (evidence: PresentationTarget) => {
      const existing = presentationByArtifactId[evidence.artifactId];
      if (existing?.status === 'succeeded' && existing.pptArtifact?.downloadPath) {
        window.open(existing.pptArtifact.downloadPath, '_blank', 'noopener,noreferrer');
        return;
      }
      if (isPresentationRunning(existing?.status)) {
        return;
      }

      setPresentationByArtifactId((current) => ({
        ...current,
        [evidence.artifactId]: {
          artifactId: evidence.artifactId,
          versionId: evidence.versionId,
          title: evidence.title,
          status: 'queued',
        },
      }));

      try {
        const response = await fetch(
          `/api/artifacts/${encodeURIComponent(evidence.artifactId)}/presentation`,
          { method: 'POST' },
        );
        if (!response.ok) {
          throw new Error(`PPT 生成接口返回 ${response.status}`);
        }

        const payload = (await response.json()) as ArtifactPresentationPayload;
        setPresentationByArtifactId((current) => ({
          ...current,
          [evidence.artifactId]: payload,
        }));

        if (payload.status === 'succeeded') {
          messageApi.success('PPT 已生成');
        } else if (payload.status === 'failed') {
          messageApi.error(payload.errorMessage || 'PPT 生成失败，可重新生成');
        } else {
          messageApi.info('PPT 生成已提交，请稍候');
        }
      } catch (error) {
        setPresentationByArtifactId((current) => ({
          ...current,
          [evidence.artifactId]: {
            artifactId: evidence.artifactId,
            versionId: evidence.versionId,
            title: evidence.title,
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'PPT 生成失败',
          },
        }));
        messageApi.error(error instanceof Error ? error.message : 'PPT 生成失败');
      }
    },
    [messageApi, presentationByArtifactId],
  );

  const handleSubmitQuestionCard = React.useCallback<MetaQuestionSubmitHandler>(
    ({ runId, interactionId, answers, queryText }) => {
      onRequest({
        query: queryText,
        sceneKey: scene.key,
        conversationKey: activeConversationKey,
        resume: {
          runId,
          action: 'provide_input',
          interactionId,
          answers,
        },
      });
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    },
    [activeConversationKey, onRequest, safeScrollToBottom, scene.key],
  );

  const handleOpenRecord = React.useCallback<OpenRecordHandler>(
    ({ objectKey, formInstId }) => {
      const queryText = `打开${mapRecordObjectLabel(objectKey)} formInstId=${formInstId}`;
      onRequest({
        query: queryText,
        sceneKey: scene.key,
        conversationKey: activeConversationKey,
      });
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    },
    [activeConversationKey, onRequest, safeScrollToBottom, scene.key],
  );

  const role = useMemo(
    () => buildRole(styles, markdownClassName, async (evidence) => {
      setArtifactViewer({
        open: true,
        loading: true,
        title: evidence.title,
        artifactId: evidence.artifactId,
        markdown: '',
        error: null,
      });

      try {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(evidence.artifactId)}`);
        if (!response.ok) {
          throw new Error(`Artifact API 返回 ${response.status}`);
        }
        const payload = (await response.json()) as ArtifactDetailPayload;
        setArtifactViewer({
          open: true,
          loading: false,
          title: payload.artifact.title,
          artifactId: payload.artifact.artifactId,
          markdown: payload.markdown,
          error: null,
          artifact: payload.artifact,
        });
        void fetchPresentationStatus(payload.artifact.artifactId).catch(() => {
          // PPT status is optional for Markdown viewing.
        });
      } catch (error) {
        setArtifactViewer({
          open: true,
          loading: false,
          title: evidence.title,
          artifactId: evidence.artifactId,
          markdown: '',
          error: error instanceof Error ? error.message : '无法读取 Artifact Markdown',
        });
      }
    }, handleGeneratePresentation, handleOpenRecord, handleSubmitQuestionCard, presentationByArtifactId),
    [
      fetchPresentationStatus,
      handleGeneratePresentation,
      handleOpenRecord,
      handleSubmitQuestionCard,
      markdownClassName,
      presentationByArtifactId,
      styles,
    ],
  );

  const navigateToScene = React.useCallback((route: string) => {
    setActiveConversationKey(getConversationKeyByRoute(route));
    navigate(route);
    setRunInsightOpen(false);
  }, [getConversationKeyByRoute, navigate, setActiveConversationKey]);

  const clearSelectedComposerCommand = React.useCallback(() => {
    setSelectedComposerCommand(null);
    if (location.pathname !== '/chat') {
      navigateToScene('/chat');
    }
  }, [location.pathname, navigateToScene]);

  const selectSlashCommand = (command: SlashCommand) => {
    navigateToScene(command.route);
    setAttachmentsOpen(false);
    setSlashMenuOpen(false);
    setSelectedComposerCommand(command);
    setInputValue('');
  };

  const handleInputChange = (value: string) => {
    const previousSlashInput = inputValue.trimStart();
    const nextSlashInput = value.trimStart();

    setInputValue(value);
    if (!nextSlashInput.startsWith('/')) {
      setSlashMenuOpen(false);
      return;
    }

    setSelectedComposerCommand(null);
    if (!previousSlashInput.startsWith('/') || nextSlashInput === '/') {
      setSlashMenuOpen(true);
    }
  };

  const onSubmit = (text: string) => {
    const normalizedText = text.trim();
    const queryText = selectedComposerCommand && !getSlashCommandFromInput(normalizedText)
      ? `${selectedComposerCommand.command}${normalizedText ? ` ${normalizedText}` : ''}`
      : normalizedText;

    if (!queryText.trim()) {
      return;
    }

    const matchedSlashCommand = getSlashCommandFromInput(queryText);
    if (matchedSlashCommand && matchedSlashCommand.route !== location.pathname) {
      navigateToScene(matchedSlashCommand.route);
      setSelectedComposerCommand(matchedSlashCommand);
      setInputValue(normalizedText.replace(matchedSlashCommand.command, '').trimStart());
      setAttachmentsOpen(false);
      setSlashMenuOpen(false);
      return;
    }

    if (activeConversation && isUserCreatedConversationKey(activeConversation.key)) {
      setConversation(activeConversation.key, {
        ...activeConversation,
        label: isBlankUserConversation(activeConversation)
          ? buildConversationTitleFromQuery(queryText)
          : activeConversation.label,
        lastMessage: queryText,
        updatedAt: '刚刚',
        scene: scene.key,
        route: location.pathname,
      });
    }

    if (isActiveConversationBlank) {
      pendingBlankConversationSubmitRef.current[activeConversationKey] = queryText;
    }

    onRequest({
      query: queryText,
      sceneKey: scene.key,
      conversationKey: activeConversationKey,
      attachments: (attachedFiles ?? []).map((file) => ({
        name: file.name,
        url: '#attachment',
        type: file.type || 'file',
        size: file.size,
      })),
      resume: resolveWritebackResume(queryText, latestAgentTrace),
    });
    setInputValue('');
    setAttachedFiles([]);
    setAttachmentsOpen(false);
    setSlashMenuOpen(false);
    window.requestAnimationFrame(() => {
      safeScrollToBottom();
    });
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
    const now = new Date();
    const conversationKey = `conv-user-${now.getTime()}`;
    const newConversation: ConversationSession = {
      key: conversationKey,
      label: NEW_CONVERSATION_LABEL,
      route: '/chat',
      group: '最近会话',
      lastMessage: NEW_CONVERSATION_LAST_MESSAGE,
      updatedAt: '刚刚',
      scene: 'chat',
    };

    pendingBlankConversationSubmitRef.current[conversationKey] = '';
    setBlankConversationKeys((current) => new Set(current).add(conversationKey));
    persistMessages(conversationKey, []);
    addConversation(newConversation, 'prepend');
    setActiveConversationKey(conversationKey);
    setInputValue('');
    setAttachedFiles([]);
    setAttachmentsOpen(false);
    setSlashMenuOpen(false);
    setSelectedComposerCommand(null);
    setRunInsightOpen(false);
    navigate('/chat');
  };

  const chatSide = (
    <div className={styles.side}>
      <div className={styles.logo}>
        <span className={styles.logoMark}>
          <img src={brandLogo} alt={brandTitle} />
        </span>
        <div className={styles.logoText}>
          <span>{brandTitle}</span>
        </div>
      </div>
      <Conversations
        creation={{ onClick: onCreateConversation, label: '新会话' }}
        items={conversations.map(({ key, label, ...other }) => ({
          key,
          label,
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
        styles={{ item: { padding: '0 8px' } }}
        menu={() => undefined}
      />

      <div className={styles.sideFooter}>
        <Space size={10}>
          <Avatar size={24} style={{ backgroundColor: '#1677ff' }}>
            {runtimeTenantContext.owner.slice(0, 1)}
          </Avatar>
          <Space orientation="vertical" size={0} className={styles.sideFooterInfo}>
            <Text strong ellipsis>
              {runtimeTenantContext.owner}
            </Text>
            <Text type="secondary" ellipsis>
              {runtimeTenantContext.tenantName}
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
      <Button icon={<EyeOutlined />} onClick={() => setRunInsightOpen(true)} />
    </Space>
  );

  const isPlanMode = selectedComposerCommand?.key === 'plan';
  const selectedSenderSkill = selectedComposerCommand && !isPlanMode
    ? {
        value: selectedComposerCommand.command,
        title: (
          <Space size={4}>
            {selectedComposerCommand.icon}
            <span>{selectedComposerCommand.command.slice(1)}</span>
          </Space>
        ),
        closable: {
          onClose: clearSelectedComposerCommand,
        },
      }
    : undefined;

  const senderFooter: NodeRender = (_, { components }) => {
    const { LoadingButton, SendButton, SpeechButton } = components;

    return (
      <div className={styles.composerFooter}>
        <div className={styles.composerFooterLeft}>
          <Button
            type="text"
            aria-label="上传附件"
            className={styles.composerIconButton}
            icon={<PlusOutlined />}
            onClick={() => setAttachmentsOpen(!attachmentsOpen)}
          />
          {isPlanMode && selectedComposerCommand ? (
            <span className={styles.composerPlanPill}>
              {selectedComposerCommand.icon}
              <span>{selectedComposerCommand.command.slice(1)}</span>
              <button
                type="button"
                aria-label="关闭计划模式"
                className={styles.composerPlanClose}
                onClick={clearSelectedComposerCommand}
              >
                <CloseOutlined />
              </button>
            </span>
          ) : null}
          {attachedFiles?.slice(0, 2).map((file) => (
            <span key={file.uid || file.name} className={styles.composerAttachmentPill}>
              <CloudUploadOutlined />
              <span>{file.name}</span>
            </span>
          ))}
        </div>
        <div className={styles.composerFooterActions}>
          <SpeechButton />
          {isRequesting ? <LoadingButton /> : <SendButton />}
        </div>
      </div>
    );
  };

  const chatList = (
    <div className={styles.chatList}>
      {displayMessageList.length ? (
        <Bubble.List
          ref={listRef}
          className={styles.bubbleList}
          role={role}
          styles={{ root: { maxWidth: 940 } }}
          items={displayMessageList.map((item) => ({
            ...item.message,
            key: item.id,
            status: item.status,
            loading: item.status === 'loading',
            extraInfo: item.message.extraInfo ?? item.extraInfo,
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
      {showSlashMenu ? (
        <div className={styles.slashMenu}>
          {filteredSlashCommands.length ? (
            filteredSlashCommands.map((item) => (
              <button
                key={item.key}
                type="button"
                className={styles.slashMenuItem}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSlashCommand(item)}
              >
                <span className={styles.slashMenuIcon}>{item.icon}</span>
                <span className={styles.slashCommand}>{item.command}</span>
                <span className={styles.slashDescription}>{item.description}</span>
              </button>
            ))
          ) : (
            <div className={styles.slashEmpty}>没有匹配的命令</div>
          )}
        </div>
      ) : null}
      {!attachmentsOpen && !showSlashMenu && !selectedComposerCommand ? (
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
        onChange={handleInputChange}
        onCancel={() => {
          abort();
        }}
        prefix={false}
        suffix={false}
        footer={senderFooter}
        skill={selectedSenderSkill}
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
              {scene.key !== 'chat' ? (
                <>
                  <Tag color="blue">{scene.title}</Tag>
                  <Tag color="purple">命中 {getSceneSlashCommand(scene.key)}</Tag>
                </>
              ) : (
                <Tag color="cyan">slash 命令入口</Tag>
              )}
              <Button
                type="text"
                icon={<EyeOutlined />}
                onClick={() => setRunInsightOpen(true)}
              >
                运行洞察
              </Button>
            </div>
            {chatList}
            {chatSender}
          </div>
        </div>
        <RunInsightDrawer
          open={runInsightOpen}
          onClose={() => setRunInsightOpen(false)}
          scene={scene}
          sourceTags={getSceneSourceTags(scene.key)}
          slashCommand={scene.key === 'chat' ? 'slash 命令入口' : getSceneSlashCommand(scene.key)}
          tenantContext={runtimeTenantContext}
          agentTrace={latestAgentTrace}
          evidence={latestEvidence}
          adminBaseUrl={ADMIN_BASE_URL}
        />
        <ArtifactMarkdownDrawer
          state={artifactViewer}
          markdownClassName={markdownClassName}
          styles={styles}
          presentation={
            artifactViewer.artifactId
              ? presentationByArtifactId[artifactViewer.artifactId]
              : undefined
          }
          onGeneratePresentation={handleGeneratePresentation}
          onClose={() => setArtifactViewer((current) => ({ ...current, open: false }))}
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
      <Route path="/chat/customer-analysis" element={<AssistantWorkspace />} />
      <Route path="/chat/conversation-understanding" element={<AssistantWorkspace />} />
      <Route path="/chat/needs-todo-analysis" element={<AssistantWorkspace />} />
      <Route path="/chat/problem-statement" element={<AssistantWorkspace />} />
      <Route path="/chat/value-positioning" element={<AssistantWorkspace />} />
      <Route path="/chat/solution-matching" element={<AssistantWorkspace />} />
      <Route path="/chat/tasks" element={<AssistantWorkspace />} />
    </Routes>
  );
}

export default App;
