import {
  CloudUploadOutlined,
  CompassOutlined,
  CopyOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  PictureOutlined,
  PlusOutlined,
  ProductOutlined,
  SettingOutlined,
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
  DatePicker,
  Drawer,
  Flex,
  Image,
  Space,
  Skeleton,
  Spin,
  Input,
  Modal,
  Pagination,
  Select,
  Tag,
  Table,
  Typography,
  message,
} from 'antd';
import type { GetProp } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type {
  AgentRecordResultViewModel,
  AgentRecordSearchPageQuery,
  AgentRecordSearchPageResponse,
  AgentConversationListResponse,
  AgentConversationUpsertRequest,
  AgentClientAction,
  AgentPersonalSettingsResponse,
  AgentPersonalSettingsUpdateRequest,
  AgentMetaQuestionOptionsResponse,
  AgentRunDetailResponse,
  AgentRunListResponse,
  AgentUiSurface,
  ArtifactImageGenerationRequest,
  ConversationSession,
  ExternalSkillJobResponse,
  ExternalSkillJobStatus,
  MarkdownImageGenerationRequest,
  MarkdownImageGenerationResponse,
  ShadowObjectKey,
  YzjAuthIdentityResponse,
} from '@shared/types';
import { brandTitle } from '@shared/brand';
import { applyDocumentBranding } from '@shared/dom-branding';
import {
  type AssistantChatMessage,
  type AssistantEvidenceCard,
  type AssistantFieldOptionHint,
  type AssistantMetaQuestion,
  type AssistantMetaQuestionCard,
  ASSISTANT_LOCAL_IDENTITY,
  buildAssistantConversationKey,
  providerFactory,
  resolveAssistantIdentity,
} from './agent-api-provider';
import { assistantScenes, buildPromptGroups, getSceneByPath } from './scene-meta';
import { RunInsightDrawer } from './RunInsightDrawer';
import { buildRecordingTimeline, getLatestTimelineMessageId } from './recording-timeline';
import {
  buildFailedPendingRecordingTask,
  isPendingRecordingTaskId,
  normalizePersistedRecordingTask,
  RECORDING_UPLOAD_INCOMPLETE_MESSAGE,
} from './recording-task-state';
import {
  readCachedAssistantIdentity,
  writeCachedAssistantIdentity,
  type BrowserStorageLike,
} from './assistant-auth-cache';
import {
  canGenerateEvidenceImage,
  getEvidenceCardTitle,
  isRecordingMaterialEvidenceCard,
  sanitizeEvidenceText,
} from './evidence-card-utils';
import {
  chooseConversationMessages,
  mergeAuthoritativeRemoteConversations,
  mergeOfflineCachedConversations,
  prunePersistedChatState as prunePersistedChatStateStores,
  resolveSyncedActiveConversationKey,
  type ConversationSyncPolicy,
  type RemoteMessagesResult,
} from './chat-sync';
import {
  DEFAULT_UPDATE_FIELD_VISIBLE_COUNT,
  UPDATE_FIELD_VISIBLE_COUNT_STEP,
  filterUpdateFieldQuestions,
  getMetaQuestionAnswerDisplay,
  getMetaQuestionCurrentDisplay,
  pickChangedMetaQuestionAnswers,
  shouldRenderMetaQuestionCard,
} from './meta-question-card-utils';
import {
  buildAttachmentImageKey,
  getVisibleMessageAttachments,
  isMarkdownAttachment,
  resolveVisitPrepMarkdownImageTarget,
  type VisitPrepMarkdownImageTarget,
} from './visit-prep-markdown-image-utils';
import { useMarkdownTheme } from './use-markdown-theme';
import brandLogo from '@shared/assets/logo.png';

const { Paragraph, Text } = Typography;

const ADMIN_BASE_URL = import.meta.env.VITE_ADMIN_BASE_URL?.trim() || 'http://127.0.0.1:8000';
const CHAT_STORAGE_VERSION = 4;
const CHAT_RECORDING_TASKS_UPDATED_EVENT = 'yzj-ai-crm.assistant.recordingTasksUpdated';
const LEGACY_CHAT_STORAGE_KEYS = [
  'yzj-ai-crm.assistant.messages.v3',
  'yzj-ai-crm.assistant.activeConversation.v3',
  'yzj-ai-crm.assistant.conversations.v3',
  'yzj-ai-crm.assistant.messages.v2',
  'yzj-ai-crm.assistant.activeConversation.v2',
  'yzj-ai-crm.assistant.conversations.v2',
  'yzj-ai-crm.assistant.messages.v1',
  'yzj-ai-crm.assistant.activeConversation.v1',
  'yzj-ai-crm.assistant.conversations.v1',
];
const NEW_CONVERSATION_LABEL = '新会话';
const NEW_CONVERSATION_LAST_MESSAGE = '输入客户名称，客户关注点可选。';
const DEPRECATED_WORKBENCH_SCENE_KEYS = new Set([
  'customer-analysis',
  'conversation-understanding',
  'needs-todo-analysis',
  'problem-statement',
  'value-positioning',
  'solution-matching',
  'tasks',
]);
const DEPRECATED_WORKBENCH_ROUTES = new Set([
  '/chat/customer-analysis',
  '/chat/conversation-understanding',
  '/chat/needs-todo-analysis',
  '/chat/problem-statement',
  '/chat/value-positioning',
  '/chat/solution-matching',
  '/chat/tasks',
]);
const RECORD_RESULT_A2UI_CATALOG_ID = 'local://yzj-crm/record-result/v1';
const RECORD_RESULT_TABLE_PAGE_SIZE = 5;
const REMOTE_CONVERSATION_RUN_PAGE_SIZE = 50;
const PERSONAL_SETTINGS_ROUTE = '/settings/personal';

function buildAssistantStorageKeys(identity: YzjAuthIdentityResponse) {
  const storageScope = buildAssistantConversationKey('storage', identity.operatorOpenId);
  return {
    messages: `yzj-ai-crm.assistant.${storageScope}.messages.v4`,
    activeConversation: `yzj-ai-crm.assistant.${storageScope}.activeConversation.v4`,
    conversations: `yzj-ai-crm.assistant.${storageScope}.conversations.v4`,
    recordingTasks: `yzj-ai-crm.assistant.${storageScope}.recordingTasks.v1`,
  };
}

function buildAssistantRuntimeScope(identity: YzjAuthIdentityResponse) {
  const homeConversationKey = buildAssistantConversationKey('home', identity.operatorOpenId);
  const userConversationKeyPrefix = `${buildAssistantConversationKey('user', identity.operatorOpenId)}-`;
  return {
    identity,
    homeConversationKey,
    userConversationKeyPrefix,
    storageKeys: buildAssistantStorageKeys(identity),
  };
}

type AssistantRuntimeScope = ReturnType<typeof buildAssistantRuntimeScope>;

function buildDefaultPersonalSettings(identity: YzjAuthIdentityResponse): AgentPersonalSettingsResponse {
  return {
    eid: identity.eid,
    appId: identity.appId,
    operatorOpenId: identity.operatorOpenId,
    displayName: identity.userName || '云之家用户',
    roleLabel: identity.source === 'ticket' ? '云之家销售' : '金蝶云之家销售',
    soulPrompt: '',
    isDefaultSoulPrompt: true,
    updatedAt: null,
  };
}

const DEFAULT_PERSONAL_SETTINGS: AgentPersonalSettingsResponse = {
  eid: '',
  appId: '',
  operatorOpenId: ASSISTANT_LOCAL_IDENTITY.operatorOpenId,
  displayName: ASSISTANT_LOCAL_IDENTITY.userName,
  roleLabel: '金蝶云之家销售',
  soulPrompt: '',
  isDefaultSoulPrompt: true,
  updatedAt: null,
};

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

const senderShortcutIcons = [
  <FileSearchOutlined />,
  <ProductOutlined />,
];

const slashCommands = [
  {
    key: 'company-research',
    command: '/公司研究',
    description: '研究公司并复用已有有效研究',
    icon: <FileSearchOutlined />,
    route: '/chat',
    draft: '/公司研究 ',
  },
  {
    key: 'yunzhijia-visit-prep',
    command: '/拜访准备',
    description: '选择客户并基于关联公司研究生成拜访讲解提纲',
    icon: <ProductOutlined />,
    route: '/chat',
    draft: '/拜访准备 ',
  },
];

type SlashCommand = (typeof slashCommands)[number];

const recordingSkillActions: Array<{
  skillCode: RecordingSkillCode;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    skillCode: 'ext.visit_conversation_understanding',
    label: '拜访会话理解',
    icon: <FileSearchOutlined />,
  },
  {
    skillCode: 'ext.customer_needs_todo_analysis',
    label: '客户需求工作待办分析',
    icon: <FileSearchOutlined />,
  },
  {
    skillCode: 'ext.problem_statement_pm',
    label: '问题陈述',
    icon: <CompassOutlined />,
  },
  {
    skillCode: 'ext.customer_value_positioning_pm',
    label: '客户价值定位',
    icon: <GlobalOutlined />,
  },
];

const recordingSkillLabels = Object.fromEntries(
  recordingSkillActions.map((item) => [item.skillCode, item.label]),
) as Record<RecordingSkillCode, string>;

type OpenArtifactHandler = (evidence: AssistantEvidenceCard) => void;
type OpenRecordingEvidenceHandler = (evidence: AssistantEvidenceCard) => void;
type ArtifactActionTarget = Pick<AssistantEvidenceCard, 'artifactId' | 'versionId' | 'title' | 'kind' | 'sourceToolCode'>;
type GenerateImageHandler = (target: ArtifactActionTarget) => void;
type GenerateMarkdownImageHandler = (target: VisitPrepMarkdownImageTarget) => void;
type MetaQuestionSubmitHandler = (input: {
  runId: string;
  interactionId: string;
  answers: Record<string, unknown>;
  queryText: string;
}) => void;
type MetaQuestionCancelHandler = (input: {
  runId: string;
  interactionId: string;
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
  relationFields?: RecordResultFieldView[];
  primaryFields?: RecordResultFieldView[];
  secondaryFields?: RecordResultFieldView[];
}

type RecordResultViewModel = Omit<AgentRecordResultViewModel, 'records' | 'record'> & {
  records: RecordResultRecordView[];
  record?: RecordResultRecordView;
};

type ArtifactImageStatus = 'not_started' | 'queued' | 'succeeded' | 'failed';

type GroupedEvidenceCard = AssistantEvidenceCard & {
  matchCount: number;
};

interface ArtifactImagePayload {
  artifactId: string;
  versionId: string;
  title: string;
  status: ArtifactImageStatus;
  generationId?: string;
  prompt?: string;
  previewDataUrl?: string;
  previewUrl?: string;
  downloadPath?: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  model?: string;
  provider?: string;
  size?: string;
  quality?: string;
  latencyMs?: number;
  errorMessage?: string | null;
  generatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

type MarkdownImageStatus = 'not_started' | 'queued' | 'succeeded' | 'failed';

interface MarkdownImagePayload extends Partial<MarkdownImageGenerationResponse> {
  key: string;
  title: string;
  status: MarkdownImageStatus;
  errorMessage?: string | null;
}

interface ArtifactDetailPayload {
  artifact: {
    artifactId: string;
    versionId: string;
    version: number;
    kind?: 'company_research' | 'recording_material' | 'analysis_material';
    title: string;
    sourceToolCode: string;
    vectorStatus: string;
    anchors?: Array<{
      type: string;
      id: string;
      name?: string;
      role?: string;
      bindingStatus?: 'bound' | 'unbound' | 'suggested';
    }>;
    chunkCount: number;
    updatedAt: string;
  };
  markdown: string;
  summary?: string;
  metadata?: Record<string, unknown>;
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

type RecordingTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface RecordingTaskPayload {
  taskId: string;
  status: RecordingTaskStatus;
  serviceTaskId: string;
  providerDataId?: string | null;
  fixtureTaskId?: string | null;
  file: {
    fileName: string;
    mimeType: string;
    size: number;
    md5: string;
  };
  anchors: {
    customer?: string;
    opportunity?: string;
    followup?: string;
  };
  stages: Array<{
    key: string;
    label: string;
    status: string;
  }>;
  material?: {
    available: boolean;
    artifactId?: string;
    path?: string | null;
    source?: string | null;
    markdown?: string;
    excludedProcessFiles?: string[];
  };
  archive?: {
    status: 'unarchived' | 'pending' | 'archived';
    artifactId?: string;
    followupId?: string;
    customerId?: string;
    opportunityId?: string;
    sourceFileMd5?: string;
  };
  playback?: {
    available: boolean;
    path?: string | null;
  };
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

type RecordingSkillCode =
  | 'ext.visit_conversation_understanding'
  | 'ext.customer_needs_todo_analysis'
  | 'ext.problem_statement_pm'
  | 'ext.customer_value_positioning_pm';

interface RecordingSkillJobState {
  skillCode: RecordingSkillCode;
  label: string;
  status: ExternalSkillJobStatus;
  jobId?: string;
  finalText?: string | null;
  artifacts?: ExternalSkillJobResponse['artifacts'];
  errorMessage?: string | null;
  updatedAt?: string;
}

type RecordingTaskCardState = RecordingTaskPayload & {
  localStatusText?: string;
  sourceFile?: File;
  timelineAnchorMessageId?: string | null;
  skillJobs?: Partial<Record<RecordingSkillCode, RecordingSkillJobState>>;
};

type RecordingSkillArtifactTarget = NonNullable<RecordingSkillJobState['artifacts']>[number];

type RecordingAnchorState = RecordingTaskPayload['anchors'];

interface PersistedMessageStore {
  version: typeof CHAT_STORAGE_VERSION;
  messages: Record<string, MessageInfo<AssistantChatMessage>[]>;
}

interface PersistedConversationStore {
  version: typeof CHAT_STORAGE_VERSION;
  conversations: ConversationSession[];
}

interface PersistedRecordingTaskStore {
  version: typeof CHAT_STORAGE_VERSION;
  tasks: Record<string, RecordingTaskCardState[]>;
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
  authGate: css`
    width: 100%;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${token.colorBgLayout};
    padding: 24px;
    box-sizing: border-box;
  `,
  authGatePanel: css`
    width: min(520px, 100%);
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 24px;
    box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08);
  `,
  side: css`
    background: ${token.colorBgLayout}80;
    width: 280px;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 0 12px 12px;
    box-sizing: border-box;
    flex-shrink: 0;
  `,
  logo: css`
    display: flex;
    align-items: center;
    justify-content: start;
    padding: 0 10px;
    box-sizing: border-box;
    gap: 10px;
    margin: 14px 0 12px;
  `,
  logoMark: css`
    width: 36px;
    height: 36px;
    border-radius: 8px;
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
      font-size: 17px;
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: 0;
    }
  `,
  conversations: css`
    overflow-y: auto;
    margin-top: 4px;
    padding: 0;
    flex: 1;

    .ant-conversations-list {
      padding-inline-start: 0;
    }
  `,
  sideFooter: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  `,
  sideFooterInfo: css`
    min-width: 0;
    flex: 1;
  `,
  sideFooterButton: css`
    flex: none;
  `,
  settingsPage: css`
    height: 100%;
    width: calc(100% - 280px);
    min-width: 0;
    overflow-y: auto;
    background: ${token.colorBgContainer};
    padding: 32px 40px;
    box-sizing: border-box;
  `,
  settingsInner: css`
    max-width: 920px;
    margin: 0 auto;
  `,
  settingsHeader: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  `,
  settingsTitle: css`
    margin: 0;
    color: ${token.colorText};
    font-size: 24px;
    line-height: 1.25;
    font-weight: 700;
  `,
  settingsDescription: css`
    margin-top: 8px;
    color: ${token.colorTextSecondary};
    line-height: 1.7;
  `,
  settingsPanel: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    box-shadow: 0 14px 38px rgba(15, 23, 42, 0.06);
  `,
  settingsPanelBody: css`
    padding: 20px;
  `,
  settingsTextarea: css`
    width: 100%;
    margin-top: 14px;
    font-family:
      AlibabaPuHuiTi,
      "Alibaba Sans",
      ${token.fontFamily},
      sans-serif;
    line-height: 1.75;
  `,
  settingsActions: css`
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 14px;
  `,
  settingsMeta: css`
    margin-top: 12px;
    color: ${token.colorTextTertiary};
    font-size: 12px;
    line-height: 1.6;
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
  recordingPrepCard: css`
    margin: 10px 12px 12px;
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
  `,
  recordingPrepTitle: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  `,
  recordingTaskStack: css`
    width: min(100%, 840px);
    margin-top: 12px;
    display: grid;
    gap: 12px;
  `,
  recordingTaskCard: css`
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
  `,
  recordingTaskCardInteractive: css`
    cursor: pointer;
    transition: border-color ${token.motionDurationMid}, box-shadow ${token.motionDurationMid};

    &:hover {
      border-color: ${token.colorPrimaryBorder};
      box-shadow: 0 12px 30px rgba(22, 119, 255, 0.1);
    }
  `,
  recordingTaskBody: css`
    padding: 14px 16px;
  `,
  recordingStageGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    gap: 8px;
    margin-top: 12px;
  `,
  recordingStage: css`
    min-height: 34px;
    border-radius: 6px;
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 12px;
  `,
  recordingActions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  `,
  recordingSkillJobs: css`
    margin-top: 10px;
    display: grid;
    gap: 8px;
  `,
  recordingSkillJob: css`
    min-height: 34px;
    border-radius: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillQuaternary};
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;

    .job-main {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .job-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  inlineRefs: css`
    margin-top: 14px;
  `,
  attachmentList: css`
    margin-top: 8px;
    display: grid;
    gap: 10px;
  `,
  attachmentItem: css`
    min-width: 0;
  `,
  markdownImageActions: css`
    margin-top: 14px;
    border-top: 1px solid ${token.colorBorderSecondary};
    padding-top: 10px;
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
    .ant-table {
      background: transparent;
    }

    .ant-table-thead > tr > th {
      color: ${token.colorTextSecondary};
      font-weight: 600;
      white-space: nowrap;
    }

    .ant-table-tbody > tr > td {
      vertical-align: top;
    }
  `,
  recordResultItem: css`
    min-width: 0;
  `,
  recordResultTitleText: css`
    display: -webkit-box;
    overflow: hidden;
    word-break: break-word;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  `,
  recordResultCellText: css`
    display: -webkit-box;
    overflow: hidden;
    word-break: break-word;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  `,
  recordResultPagination: css`
    display: flex;
    justify-content: center;
    margin-top: 12px;
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
  updateFieldPickerSearch: css`
    margin-top: 12px;
  `,
  updateFieldPickerList: css`
    display: grid;
    gap: 8px;
    margin-top: 12px;
  `,
  updateFieldPickerItem: css`
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
    cursor: pointer;
    display: grid;
    grid-template-columns: minmax(120px, 0.42fr) 1fr auto;
    align-items: center;
    gap: 10px;
    color: ${token.colorText};
    text-align: left;

    &:hover,
    &:focus-visible {
      border-color: ${token.colorPrimaryBorder};
      background: ${token.colorPrimaryBg};
      outline: none;
    }
  `,
  updateFieldPickerItemActive: css`
    border-color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  updateFieldPickerCurrent: css`
    min-width: 0;
    color: ${token.colorTextSecondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  updateFieldPickerSelectedList: css`
    display: grid;
    gap: 8px;
    margin-top: 8px;
  `,
  updateFieldPickerSelectedItem: css`
    display: grid;
    grid-template-columns: minmax(100px, 0.28fr) 1fr auto;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 6px 8px;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      border-color: ${token.colorPrimaryBorder};
      background: ${token.colorPrimaryBg};
      outline: none;
    }
  `,
  updateFieldPickerSelectedItemActive: css`
    border-color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  updateFieldPickerEditor: css`
    margin-top: 12px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 12px;
  `,
  evidenceGrid: css`
    margin-top: 8px;
    width: 100%;

    .ant-prompts-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
      overflow: visible;
    }

    .ant-prompts-item {
      border: 1px solid ${token.colorBorderSecondary};
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 255, 0.86)),
        ${token.colorFillQuaternary};
      min-width: 0;
      width: 100%;
      padding: 10px 12px;
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

      &:has(.ant-image) {
        grid-column: 1 / -1;
      }
    }

    .ant-prompts-label {
      width: 100%;
      line-height: 1.4;
    }

    .ant-prompts-desc {
      width: 100%;
    }

    .ant-typography {
      max-width: 100%;
    }
  `,
  evidenceCardActions: css`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 6px;
  `,
  evidenceErrorText: css`
    margin-top: 6px;
    color: ${token.colorErrorText};
    font-size: 12px;
    line-height: 1.5;
  `,
  evidenceImagePreview: css`
    margin-top: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    overflow: hidden;
    max-width: 520px;
    position: relative;

    .ant-image {
      display: block;
    }

    .ant-image-img {
      display: block;
      width: 100%;
      height: auto;
      background: ${token.colorFillQuaternary};
      cursor: zoom-in;
    }
  `,
  evidenceImageDownload: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
    z-index: 2;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
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

function getGroupedEvidenceKey(item: AssistantEvidenceCard) {
  return `${item.artifactId}-${item.versionId}`;
}

function groupEvidenceByArtifact(evidence: AssistantEvidenceCard[]): GroupedEvidenceCard[] {
  const grouped = new Map<string, GroupedEvidenceCard>();
  for (const item of evidence) {
    const key = getGroupedEvidenceKey(item);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, matchCount: 1 });
      continue;
    }

    existing.matchCount += 1;
    const currentScore = typeof existing.score === 'number' ? existing.score : -1;
    const nextScore = typeof item.score === 'number' ? item.score : -1;
    if (nextScore > currentScore) {
      existing.snippet = item.snippet;
      existing.score = item.score;
      existing.anchorLabel = item.anchorLabel || existing.anchorLabel;
    }
  }
  return [...grouped.values()];
}

function isAudioAttachment(file: NonNullable<GetProp<typeof Attachments, 'items'>>[number]) {
  const type = file.type || file.originFileObj?.type || '';
  return type.includes('audio') || /\.(mp3|m4a|wav|aac|flac|ogg)$/i.test(file.name || '');
}

function getUploadFile(file: NonNullable<GetProp<typeof Attachments, 'items'>>[number]): File | null {
  const originFile = file.originFileObj;
  return originFile instanceof File ? originFile : null;
}

function formatFileSize(size?: number) {
  if (!size) {
    return '0 B';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildSuggestedRecordingAnchors(
  agentTrace?: NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']> | null,
): RecordingAnchorState {
  const anchors: RecordingAnchorState = {};
  const subjects = [
    agentTrace?.resolvedContext?.subject,
    agentTrace?.pendingInteraction?.contextSubject,
    agentTrace?.semanticResolution?.selectedCandidate?.subject,
    agentTrace?.intentFrame?.targets?.[0],
  ];

  for (const subject of subjects) {
    if (!subject) {
      continue;
    }
    const subjectType = String(subject.type || subject.kind || '');
    if (subjectType !== 'customer' && subjectType !== 'opportunity' && subjectType !== 'followup') {
      continue;
    }
    const anchorValue = String(subject.id || subject.name || '').trim();
    if (anchorValue && !anchors[subjectType]) {
      anchors[subjectType] = anchorValue;
    }
  }

  return anchors;
}

function getRecordingStatusLabel(status: RecordingTaskStatus) {
  if (status === 'queued') {
    return '已上传';
  }
  if (status === 'running') {
    return '正在生成';
  }
  if (status === 'succeeded') {
    return '已完成';
  }
  return '处理失败';
}

function getRecordingTagColor(status: string) {
  if (status === 'succeeded') {
    return 'success';
  }
  if (status === 'running') {
    return 'processing';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'default';
}

function getRecordingSkillJobStatusLabel(status?: ExternalSkillJobStatus) {
  if (status === 'queued') {
    return '已提交';
  }
  if (status === 'running') {
    return '生成中';
  }
  if (status === 'succeeded') {
    return '已完成';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '未开始';
}

function isRecordingSkillJobRunning(status?: ExternalSkillJobStatus) {
  return status === 'queued' || status === 'running';
}

function toRecordingSkillJobState(
  skillCode: RecordingSkillCode,
  job: ExternalSkillJobResponse,
): RecordingSkillJobState {
  return {
    skillCode,
    label: recordingSkillLabels[skillCode],
    status: job.status,
    jobId: job.jobId,
    finalText: job.finalText,
    artifacts: job.artifacts,
    errorMessage: job.error?.message ?? null,
    updatedAt: job.updatedAt,
  };
}

function formatReferenceLabel(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) {
    return '';
  }
  if (value === 'ext.yunzhijia_visit_prep' || value === 'external.yunzhijia_visit_prep') {
    return '客户拜访准备资料';
  }
  if (
    value === 'company-research'
    || value === 'company-research-fallback'
    || value === 'external.company_research'
    || value === 'artifact.company_research.lookup'
  ) {
    return '公司研究资料';
  }
  if (value === 'ext.company_research_pm') {
    return '公司研究服务';
  }
  if (/^record\./.test(value) || /^artifact\./.test(value) || /^meta\./.test(value)) {
    return '';
  }
  return value;
}

function getVisibleReferenceLabels(references?: string[]) {
  return Array.from(new Set(
    (references ?? [])
      .map(formatReferenceLabel)
      .filter((item): item is string => Boolean(item)),
  ));
}

function isImageGenerating(status?: ArtifactImageStatus) {
  return status === 'queued';
}

function isMarkdownImageGenerating(status?: MarkdownImageStatus) {
  return status === 'queued';
}

function getImageButtonLabel(image?: ArtifactImagePayload) {
  if (!image || image.status === 'not_started') {
    return '生成图片';
  }
  if (isImageGenerating(image.status)) {
    return '图片生成中';
  }
  if (image.status === 'succeeded') {
    return '重新生成图片';
  }
  return '重新生成图片';
}

function getMarkdownImageButtonLabel(image?: MarkdownImagePayload) {
  if (!image || image.status === 'not_started') {
    return '生成图片';
  }
  if (isMarkdownImageGenerating(image.status)) {
    return '图片生成中';
  }
  return '重新生成图片';
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getRecordingViewerTargetPath(taskId: string): string {
  return `/api/recording-audio-tasks/${encodeURIComponent(taskId)}/meeting-viewer`;
}

function getRecordingViewerLoadingPath(taskId: string): string {
  return `/recording-viewer-loading?target=${encodeURIComponent(getRecordingViewerTargetPath(taskId))}`;
}

function openRecordingViewer(taskId: string): void {
  window.open(getRecordingViewerLoadingPath(taskId), '_blank', 'noopener,noreferrer');
}

function isSafeRecordingViewerTarget(target: string): boolean {
  return /^\/api\/recording-audio-tasks\/[^/?#]+\/meeting-viewer(?:[?#].*)?$/.test(target);
}

function getRecordingTaskIdFromArtifactDetail(payload: ArtifactDetailPayload): string {
  const direct = payload.metadata?.recordingTaskId;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  return '';
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

function getBrowserSessionStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage satisfies BrowserStorageLike;
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

function readPersistedMessageStore(scope: AssistantRuntimeScope): PersistedMessageStore {
  const storage = getBrowserStorage();
  if (!storage) {
    return { version: CHAT_STORAGE_VERSION, messages: {} };
  }

  try {
    const raw = storage.getItem(scope.storageKeys.messages);
    if (!raw) {
      return { version: CHAT_STORAGE_VERSION, messages: {} };
    }
    const parsed = JSON.parse(raw) as PersistedMessageStore;
    if (
      parsed?.version !== CHAT_STORAGE_VERSION
      || typeof parsed.messages !== 'object'
      || !parsed.messages
    ) {
      return { version: CHAT_STORAGE_VERSION, messages: {} };
    }
    return parsed;
  } catch {
    return { version: CHAT_STORAGE_VERSION, messages: {} };
  }
}

function writePersistedMessageStore(scope: AssistantRuntimeScope, store: PersistedMessageStore) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(scope.storageKeys.messages, JSON.stringify(store));
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
  scope: AssistantRuntimeScope,
  conversationKey?: string,
): DefaultMessageInfo<AssistantChatMessage>[] | null {
  if (!conversationKey) {
    return null;
  }
  const stored = readPersistedMessageStore(scope).messages[conversationKey];
  if (!Array.isArray(stored)) {
    return null;
  }
  const sanitized = stored
    .map(toPersistableMessageInfo)
    .filter((item): item is MessageInfo<AssistantChatMessage> => Boolean(item));
  return sanitized.length > 0 ? sanitized : null;
}

function toRemoteMessageInfo(
  message: AgentRunDetailResponse['messages'][number],
): MessageInfo<AssistantChatMessage> | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }
  const extraInfo = message.extraInfo && typeof message.extraInfo === 'object'
    ? message.extraInfo as AssistantChatMessage['extraInfo']
    : undefined;
  return {
    id: message.messageId,
    status: 'success',
    message: {
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      ...(extraInfo ? { extraInfo } : {}),
    },
    ...(extraInfo ? { extraInfo } : {}),
  };
}

function orderRemoteRunMessages(messages: AgentRunDetailResponse['messages']) {
  const roleOrder: Record<string, number> = {
    user: 0,
    assistant: 1,
  };
  return [...messages].sort((left, right) => {
    const timeOrder = left.createdAt.localeCompare(right.createdAt);
    if (timeOrder !== 0) {
      return timeOrder;
    }
    const leftRoleOrder = roleOrder[left.role] ?? 9;
    const rightRoleOrder = roleOrder[right.role] ?? 9;
    if (leftRoleOrder !== rightRoleOrder) {
      return leftRoleOrder - rightRoleOrder;
    }
    return left.messageId.localeCompare(right.messageId);
  });
}

async function loadRemoteMessagesResult(
  conversationKey: string,
): Promise<RemoteMessagesResult<DefaultMessageInfo<AssistantChatMessage>>> {
  try {
    const query = new URLSearchParams({
      conversationKey,
      page: '1',
      pageSize: String(REMOTE_CONVERSATION_RUN_PAGE_SIZE),
    });
    const runsResponse = await fetch(`/api/agent/runs?${query.toString()}`, {
      cache: 'no-store',
    });
    if (!runsResponse.ok) {
      return { status: 'unavailable' };
    }
    const runsPayload = await runsResponse.json() as AgentRunListResponse;
    if (!runsPayload.items.length) {
      return { status: 'available', messages: [] };
    }

    const details = await Promise.all(
      [...runsPayload.items]
        .reverse()
        .map(async (run) => {
          try {
            const detailResponse = await fetch(
              `/api/agent/runs/${encodeURIComponent(run.runId)}`,
              { cache: 'no-store' },
            );
            if (!detailResponse.ok) {
              return null;
            }
            return await detailResponse.json() as AgentRunDetailResponse;
          } catch {
            return null;
          }
        }),
    );

    const visited = new Set<string>();
    const messages = details.flatMap((detail) => {
      if (!detail) {
        return [];
      }
      return orderRemoteRunMessages(detail.messages)
        .map(toRemoteMessageInfo)
        .filter((item): item is MessageInfo<AssistantChatMessage> => {
          if (!item || visited.has(String(item.id))) {
            return false;
          }
          visited.add(String(item.id));
          return true;
        });
    });

    return { status: 'available', messages };
  } catch {
    return { status: 'unavailable' };
  }
}

async function loadDefaultConversationMessages(
  scope: AssistantRuntimeScope,
  conversationKey?: string,
): Promise<DefaultMessageInfo<AssistantChatMessage>[]> {
  if (!conversationKey) {
    return [];
  }
  const localMessages = loadPersistedMessages(scope, conversationKey);
  const remoteMessages = await loadRemoteMessagesResult(conversationKey);
  return chooseConversationMessages(remoteMessages, localMessages);
}

function persistMessages(
  scope: AssistantRuntimeScope,
  conversationKey: string,
  messages: MessageInfo<AssistantChatMessage>[],
) {
  const sanitized = messages
    .map(toPersistableMessageInfo)
    .filter((item): item is MessageInfo<AssistantChatMessage> => Boolean(item));
  const store = readPersistedMessageStore(scope);
  if (sanitized.length > 0) {
    store.messages[conversationKey] = sanitized;
  } else {
    delete store.messages[conversationKey];
  }
  writePersistedMessageStore(scope, store);
}

function readPersistedRecordingTaskStore(scope: AssistantRuntimeScope): PersistedRecordingTaskStore {
  const storage = getBrowserStorage();
  if (!storage) {
    return { version: CHAT_STORAGE_VERSION, tasks: {} };
  }

  try {
    const raw = storage.getItem(scope.storageKeys.recordingTasks);
    if (!raw) {
      return { version: CHAT_STORAGE_VERSION, tasks: {} };
    }
    const parsed = JSON.parse(raw) as PersistedRecordingTaskStore;
    if (
      parsed?.version !== CHAT_STORAGE_VERSION
      || typeof parsed.tasks !== 'object'
      || !parsed.tasks
    ) {
      return { version: CHAT_STORAGE_VERSION, tasks: {} };
    }
    return parsed;
  } catch {
    return { version: CHAT_STORAGE_VERSION, tasks: {} };
  }
}

function writePersistedRecordingTaskStore(
  scope: AssistantRuntimeScope,
  store: PersistedRecordingTaskStore,
) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(scope.storageKeys.recordingTasks, JSON.stringify(store));
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function notifyRecordingTasksUpdated(conversationKey: string) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(CHAT_RECORDING_TASKS_UPDATED_EVENT, {
    detail: { conversationKey },
  }));
}

function toPersistableRecordingTask(value: unknown): RecordingTaskCardState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as RecordingTaskCardState;
  if (
    typeof candidate.taskId !== 'string'
    || typeof candidate.status !== 'string'
    || !candidate.file
    || typeof candidate.file.fileName !== 'string'
    || !Array.isArray(candidate.stages)
  ) {
    return null;
  }

  const normalized = normalizePersistedRecordingTask(candidate);
  const { sourceFile: _sourceFile, material, skillJobs, ...rest } = normalized;
  const sanitizedSkillJobs = Object.fromEntries(
    Object.entries(skillJobs ?? {}).filter((entry): entry is [RecordingSkillCode, RecordingSkillJobState] => Boolean(entry[1])),
  ) as Partial<Record<RecordingSkillCode, RecordingSkillJobState>>;

  return {
    ...rest,
    ...(material
      ? {
          material: {
            ...material,
            markdown: undefined,
          },
        }
      : {}),
    ...(Object.keys(sanitizedSkillJobs).length ? { skillJobs: sanitizedSkillJobs } : {}),
  };
}

function loadPersistedRecordingTasks(
  scope: AssistantRuntimeScope,
  conversationKey: string,
): RecordingTaskCardState[] {
  const tasks = readPersistedRecordingTaskStore(scope).tasks[conversationKey];
  if (!Array.isArray(tasks)) {
    return [];
  }
  return tasks
    .map(toPersistableRecordingTask)
    .filter((item): item is RecordingTaskCardState => Boolean(item))
    .slice(0, 6);
}

function persistRecordingTasks(
  scope: AssistantRuntimeScope,
  conversationKey: string,
  tasks: RecordingTaskCardState[],
  notify = true,
) {
  const store = readPersistedRecordingTaskStore(scope);
  const sanitized = tasks
    .map(toPersistableRecordingTask)
    .filter((item): item is RecordingTaskCardState => Boolean(item))
    .slice(0, 6);
  if (sanitized.length > 0) {
    store.tasks[conversationKey] = sanitized;
  } else {
    delete store.tasks[conversationKey];
  }
  writePersistedRecordingTaskStore(scope, store);
  if (notify) {
    notifyRecordingTasksUpdated(conversationKey);
  }
}

function updatePersistedRecordingTasks(
  scope: AssistantRuntimeScope,
  conversationKey: string,
  updater: (tasks: RecordingTaskCardState[]) => RecordingTaskCardState[],
) {
  persistRecordingTasks(scope, conversationKey, updater(loadPersistedRecordingTasks(scope, conversationKey)));
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

function isUserCreatedConversationKey(scope: AssistantRuntimeScope, key?: string) {
  return Boolean(key?.startsWith(scope.userConversationKeyPrefix));
}

function isDeprecatedWorkbenchSceneConversation(
  scope: AssistantRuntimeScope,
  conversation: ConversationSession,
) {
  return (
    conversation.group === '场景入口'
    || DEPRECATED_WORKBENCH_SCENE_KEYS.has(conversation.scene)
    || DEPRECATED_WORKBENCH_ROUTES.has(conversation.route)
    || conversation.key.startsWith(buildAssistantConversationKey('scene-', scope.identity.operatorOpenId))
  );
}

function normalizeConversationTitle(title: string) {
  if (/^新会话\s+\d{1,2}:\d{2}$/.test(title.trim())) {
    return NEW_CONVERSATION_LABEL;
  }
  return title;
}

function normalizeConversationSession(
  scope: AssistantRuntimeScope,
  conversation: ConversationSession,
): ConversationSession {
  if (!isUserCreatedConversationKey(scope, conversation.key)) {
    return conversation;
  }

  return {
    ...conversation,
    label: normalizeConversationTitle(conversation.label),
  };
}

function isBlankUserConversation(scope: AssistantRuntimeScope, conversation?: ConversationSession) {
  if (!conversation || !isUserCreatedConversationKey(scope, conversation.key)) {
    return false;
  }

  return (
    normalizeConversationTitle(conversation.label) === NEW_CONVERSATION_LABEL
    && conversation.lastMessage === NEW_CONVERSATION_LAST_MESSAGE
  );
}

function keepSingleBlankConversation(
  scope: AssistantRuntimeScope,
  conversations: ConversationSession[],
): ConversationSession[] {
  let blankSeen = false;
  return conversations.filter((conversation) => {
    if (!isBlankUserConversation(scope, conversation)) {
      return true;
    }
    if (blankSeen) {
      return false;
    }
    blankSeen = true;
    return true;
  });
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

function buildConversationSyncPolicy(scope: AssistantRuntimeScope): ConversationSyncPolicy<ConversationSession> {
  return {
    isPersistableConversation,
    normalizeConversationSession: (conversation) => normalizeConversationSession(scope, conversation),
    isDeprecatedConversation: (conversation) => isDeprecatedWorkbenchSceneConversation(scope, conversation),
    keepSingleBlankConversations: (conversations) => keepSingleBlankConversation(scope, conversations),
  };
}

function readPersistedConversationStore(scope: AssistantRuntimeScope): PersistedConversationStore {
  const storage = getBrowserStorage();
  if (!storage) {
    return { version: CHAT_STORAGE_VERSION, conversations: [] };
  }

  try {
    const raw = storage.getItem(scope.storageKeys.conversations);
    if (!raw) {
      return { version: CHAT_STORAGE_VERSION, conversations: [] };
    }
    const parsed = JSON.parse(raw) as PersistedConversationStore;
    if (parsed?.version !== CHAT_STORAGE_VERSION || !Array.isArray(parsed.conversations)) {
      return { version: CHAT_STORAGE_VERSION, conversations: [] };
    }
    return {
      version: CHAT_STORAGE_VERSION,
      conversations: keepSingleBlankConversation(
        scope,
        parsed.conversations
          .filter(isPersistableConversation)
          .filter((item) => !isDeprecatedWorkbenchSceneConversation(scope, item))
          .map((item) => normalizeConversationSession(scope, item)),
      ),
    };
  } catch {
    return { version: CHAT_STORAGE_VERSION, conversations: [] };
  }
}

function writePersistedConversationStore(scope: AssistantRuntimeScope, store: PersistedConversationStore) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(scope.storageKeys.conversations, JSON.stringify(store));
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function mergePersistedConversations(
  scope: AssistantRuntimeScope,
  baseConversations: ConversationSession[],
) {
  return mergeOfflineCachedConversations(
    baseConversations,
    readPersistedConversationStore(scope).conversations,
    buildConversationSyncPolicy(scope),
  );
}

function persistCustomConversations(
  scope: AssistantRuntimeScope,
  conversations: ConversationSession[],
  baseConversations: ConversationSession[],
) {
  const fixedKeys = new Set(baseConversations.map((item) => item.key));
  writePersistedConversationStore(scope, {
    version: CHAT_STORAGE_VERSION,
    conversations: keepSingleBlankConversation(
      scope,
      conversations
        .filter((item) => !fixedKeys.has(item.key))
        .filter(isPersistableConversation)
        .filter((item) => !isDeprecatedWorkbenchSceneConversation(scope, item))
        .map((item) => normalizeConversationSession(scope, item)),
    ),
  });
}

function mergeRemoteConversations(
  scope: AssistantRuntimeScope,
  baseConversations: ConversationSession[],
  remoteConversations: ConversationSession[],
) {
  return mergeAuthoritativeRemoteConversations(
    baseConversations,
    remoteConversations,
    buildConversationSyncPolicy(scope),
  );
}

function prunePersistedChatState(scope: AssistantRuntimeScope, validConversationKeys: Iterable<string>) {
  const next = prunePersistedChatStateStores({
    messageStore: readPersistedMessageStore(scope),
    recordingTaskStore: readPersistedRecordingTaskStore(scope),
    validConversationKeys,
  });
  writePersistedMessageStore(scope, next.messageStore);
  writePersistedRecordingTaskStore(scope, next.recordingTaskStore);
}

async function fetchRemoteConversations(scope: AssistantRuntimeScope): Promise<ConversationSession[] | null> {
  try {
    const query = new URLSearchParams({
      operatorOpenId: scope.identity.operatorOpenId,
    });
    const response = await fetch(`/api/agent/conversations?${query.toString()}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as AgentConversationListResponse;
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return null;
  }
}

async function persistRemoteConversation(
  scope: AssistantRuntimeScope,
  conversation: ConversationSession,
): Promise<void> {
  const payload: AgentConversationUpsertRequest = {
    operatorOpenId: scope.identity.operatorOpenId,
    conversation: normalizeConversationSession(scope, conversation),
  };
  const response = await fetch('/api/agent/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }
}

async function fetchPersonalSettings(scope: AssistantRuntimeScope): Promise<AgentPersonalSettingsResponse> {
  const query = new URLSearchParams({
    operatorOpenId: scope.identity.operatorOpenId,
  });
  const response = await fetch(`/api/agent/personal-settings?${query.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }
  return response.json() as Promise<AgentPersonalSettingsResponse>;
}

async function updatePersonalSettings(
  scope: AssistantRuntimeScope,
  soulPrompt: string,
): Promise<AgentPersonalSettingsResponse> {
  const payload: AgentPersonalSettingsUpdateRequest = {
    operatorOpenId: scope.identity.operatorOpenId,
    soulPrompt,
  };
  const response = await fetch('/api/agent/personal-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }
  return response.json() as Promise<AgentPersonalSettingsResponse>;
}

function getStoredActiveConversationKey(scope: AssistantRuntimeScope, allowedKeys: string[]) {
  const storage = getBrowserStorage();
  const key = storage?.getItem(scope.storageKeys.activeConversation);
  return key && allowedKeys.includes(key) ? key : null;
}

function persistActiveConversationKey(scope: AssistantRuntimeScope, key: string) {
  const storage = getBrowserStorage();
  try {
    storage?.setItem(scope.storageKeys.activeConversation, key);
  } catch {
    // Ignore storage quota or private-mode failures.
  }
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
  identity,
  pendingInteraction,
  activeInteractionId,
  submittedInteractionIds,
  styles,
  onSubmit,
  onCancel,
}: {
  identity: YzjAuthIdentityResponse;
  pendingInteraction?: PendingInteractionView | null;
  activeInteractionId?: string;
  submittedInteractionIds?: Set<string>;
  styles: ReturnType<typeof useStyles>['styles'];
  onSubmit?: MetaQuestionSubmitHandler;
  onCancel?: MetaQuestionCancelHandler;
}) {
  const questionCard = pendingInteraction?.questionCard;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answerLabels, setAnswerLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswers({});
    setAnswerLabels({});
  }, [pendingInteraction?.interactionId]);

  if (!pendingInteraction || !questionCard || !shouldRenderMetaQuestionCard({
    status: pendingInteraction.status,
    questionCard,
  })) {
    return null;
  }

  if (questionCard.layout === 'update_field_picker') {
    return (
      <UpdateFieldPickerQuestionCardPanel
        identity={identity}
        pendingInteraction={pendingInteraction}
        questionCard={questionCard}
        activeInteractionId={activeInteractionId}
        submittedInteractionIds={submittedInteractionIds}
        styles={styles}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  const interactionId = pendingInteraction.interactionId;
  const isPending = pendingInteraction.status === 'pending';
  const isActive = Boolean(interactionId && activeInteractionId === interactionId);
  const isSubmitted = Boolean(interactionId && submittedInteractionIds?.has(interactionId));
  const canInteract = isPending && isActive && !isSubmitted;
  const currentValues = Object.entries(questionCard.currentValues ?? {});
  const questions = questionCard.questions ?? [];
  const answerCount = Object.values(answers).filter((value) => !isEmptyMetaAnswer(value)).length;
  const canSubmit = Boolean(onSubmit) && canInteract && answerCount > 0;
  const canCancel = Boolean(onCancel) && canInteract;
  const statusTag = canInteract
    ? <Tag color="blue">需要补充</Tag>
    : isSubmitted
      ? <Tag color="processing">已提交</Tag>
      : isPending
        ? <Tag>已过期</Tag>
        : <Tag color="green">已处理</Tag>;
  const helperText = isSubmitted
    ? '已提交，等待智能体生成预览。'
    : !isPending
      ? '这张补充卡已经处理完成，保留用于回看。'
      : !isActive
        ? '这张补充卡不是当前等待项，请使用最新卡片继续。'
        : '也可以继续直接输入自然语言补充。';

  return (
    <div className={styles.metaQuestionCard}>
      <Space align="center" wrap>
        <Text strong>{questionCard.title || pendingInteraction.title}</Text>
        {statusTag}
      </Space>
      {questionCard.targetSummary ? (
        <div className={styles.metaQuestionSection}>
          <Text type="secondary">{questionCard.targetSummary.label}</Text>
          <Space size={6} wrap style={{ marginTop: 8 }}>
            <Tag color="blue">{questionCard.targetSummary.value}</Tag>
          </Space>
        </div>
      ) : null}
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
              identity={identity}
              key={question.questionId}
              toolCode={questionCard.toolCode}
              question={question}
              value={answers[question.paramKey] ?? question.currentValue}
              styles={styles}
              disabled={!canInteract}
              onChange={(value, displayLabel) => {
                setAnswers((current) => ({
                  ...current,
                  [question.paramKey]: value,
                }));
                setAnswerLabels((current) => {
                  const next = { ...current };
                  if (displayLabel) {
                    next[question.paramKey] = displayLabel;
                  } else {
                    delete next[question.paramKey];
                  }
                  return next;
                });
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
              queryText: buildMetaQuestionSubmitText(questionCard, cleaned, answerLabels),
            });
          }}
        >
          {questionCard.submitLabel || '补充并继续'}
        </Button>
        <Button
          size="small"
          disabled={!canCancel}
          onClick={() => {
            if (!onCancel || !pendingInteraction) {
              return;
            }
            onCancel({
              runId: pendingInteraction.runId,
              interactionId: pendingInteraction.interactionId,
            });
          }}
        >
          取消本次录入
        </Button>
        <Text type="secondary">{helperText}</Text>
      </Space>
    </div>
  );
}

function UpdateFieldPickerQuestionCardPanel({
  identity,
  pendingInteraction,
  questionCard,
  activeInteractionId,
  submittedInteractionIds,
  styles,
  onSubmit,
  onCancel,
}: {
  identity: YzjAuthIdentityResponse;
  pendingInteraction: PendingInteractionView;
  questionCard: AssistantMetaQuestionCard;
  activeInteractionId?: string;
  submittedInteractionIds?: Set<string>;
  styles: ReturnType<typeof useStyles>['styles'];
  onSubmit?: MetaQuestionSubmitHandler;
  onCancel?: MetaQuestionCancelHandler;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answerLabels, setAnswerLabels] = useState<Record<string, string>>({});
  const [selectedParamKeys, setSelectedParamKeys] = useState<string[]>([]);
  const [activeParamKey, setActiveParamKey] = useState('');
  const [searchText, setSearchText] = useState('');
  const [visibleFieldCount, setVisibleFieldCount] = useState(DEFAULT_UPDATE_FIELD_VISIBLE_COUNT);

  useEffect(() => {
    setAnswers({});
    setAnswerLabels({});
    setSelectedParamKeys([]);
    setActiveParamKey('');
    setSearchText('');
    setVisibleFieldCount(DEFAULT_UPDATE_FIELD_VISIBLE_COUNT);
  }, [pendingInteraction.interactionId]);

  const interactionId = pendingInteraction.interactionId;
  const isPending = pendingInteraction.status === 'pending';
  const isActive = Boolean(interactionId && activeInteractionId === interactionId);
  const isSubmitted = Boolean(interactionId && submittedInteractionIds?.has(interactionId));
  const canInteract = isPending && isActive && !isSubmitted;
  const selectedParamKeySet = useMemo(() => new Set(selectedParamKeys), [selectedParamKeys]);
  const selectedQuestions = useMemo(
    () => selectedParamKeys
      .map((paramKey) => questionCard.questions.find((question) => question.paramKey === paramKey))
      .filter((question): question is AssistantMetaQuestion => Boolean(question)),
    [questionCard.questions, selectedParamKeys],
  );
  const { visibleQuestions, hiddenCount, hasSearch } = useMemo(
    () => filterUpdateFieldQuestions({
      questions: questionCard.questions ?? [],
      currentValues: questionCard.currentValues,
      searchText,
      visibleCount: visibleFieldCount,
    }),
    [questionCard.currentValues, questionCard.questions, searchText, visibleFieldCount],
  );
  const activeQuestion = useMemo(
    () => questionCard.questions.find((question) => question.paramKey === activeParamKey)
      ?? selectedQuestions[0],
    [activeParamKey, questionCard.questions, selectedQuestions],
  );
  const changedAnswers = useMemo(
    () => pickChangedMetaQuestionAnswers({
      questionCard,
      answers,
      selectedParamKeys,
    }),
    [answers, questionCard, selectedParamKeys],
  );
  const changedCount = Object.keys(changedAnswers).length;
  const canSubmit = Boolean(onSubmit) && canInteract && changedCount > 0;
  const canCancel = Boolean(onCancel) && canInteract;
  const statusTag = canInteract
    ? <Tag color="blue">选择要修改的字段</Tag>
    : isSubmitted
      ? <Tag color="processing">已提交</Tag>
      : isPending
        ? <Tag>已过期</Tag>
        : <Tag color="green">已处理</Tag>;
  const helperText = isSubmitted
    ? '已提交，等待智能体生成预览。'
    : !isPending
      ? '这张更新卡已经处理完成。'
      : !isActive
        ? '这张更新卡不是当前等待项，请使用最新卡片继续。'
        : '也可以继续直接输入自然语言补充。';

  const selectQuestion = (question: AssistantMetaQuestion) => {
    if (!canInteract) {
      return;
    }
    setSelectedParamKeys((current) => (
      current.includes(question.paramKey) ? current : [...current, question.paramKey]
    ));
    setActiveParamKey(question.paramKey);
  };

  const removeQuestion = (paramKey: string) => {
    setSelectedParamKeys((current) => current.filter((item) => item !== paramKey));
    setAnswers((current) => {
      const next = { ...current };
      delete next[paramKey];
      return next;
    });
    setAnswerLabels((current) => {
      const next = { ...current };
      delete next[paramKey];
      return next;
    });
    setActiveParamKey((current) => current === paramKey ? '' : current);
  };

  return (
    <div className={styles.metaQuestionCard}>
      <Space align="center" wrap>
        <Text strong>{questionCard.title || pendingInteraction.title}</Text>
        {statusTag}
      </Space>
      {questionCard.targetSummary ? (
        <div className={styles.metaQuestionSection}>
          <Text type="secondary">{questionCard.targetSummary.label}</Text>
          <Space size={6} wrap style={{ marginTop: 8 }}>
            <Tag color="blue">{questionCard.targetSummary.value}</Tag>
          </Space>
        </div>
      ) : null}

      <Input.Search
        allowClear
        size="small"
        className={styles.updateFieldPickerSearch}
        placeholder="搜索要修改的字段"
        value={searchText}
        disabled={!canInteract}
        onChange={(event) => {
          setSearchText(event.target.value);
          setVisibleFieldCount(DEFAULT_UPDATE_FIELD_VISIBLE_COUNT);
        }}
      />

      <div className={styles.updateFieldPickerList}>
        {visibleQuestions.map((question) => {
          const selected = selectedParamKeySet.has(question.paramKey);
          const current = getMetaQuestionCurrentDisplay(questionCard, question);
          return (
            <button
              type="button"
              key={question.questionId}
              className={`${styles.updateFieldPickerItem} ${activeQuestion?.paramKey === question.paramKey ? styles.updateFieldPickerItemActive : ''}`}
              disabled={!canInteract}
              onClick={() => selectQuestion(question)}
            >
              <Text strong>{question.label}</Text>
              <Text className={styles.updateFieldPickerCurrent}>
                当前：{current || '未填写'}
              </Text>
              {selected ? <Tag color="blue">已选择</Tag> : null}
            </button>
          );
        })}
      </div>
      {!visibleQuestions.length ? (
        <Text type="secondary">没有匹配字段。</Text>
      ) : null}
      {!hasSearch && hiddenCount > 0 ? (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0, marginTop: 8 }}
          disabled={!canInteract}
          onClick={() => setVisibleFieldCount((current) => current + UPDATE_FIELD_VISIBLE_COUNT_STEP)}
        >
          展开更多字段（再显示 {Math.min(UPDATE_FIELD_VISIBLE_COUNT_STEP, hiddenCount)} 个，剩余 {hiddenCount}）
        </Button>
      ) : null}
      {visibleFieldCount > DEFAULT_UPDATE_FIELD_VISIBLE_COUNT && !hasSearch ? (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0, marginTop: 8 }}
          disabled={!canInteract}
          onClick={() => setVisibleFieldCount(DEFAULT_UPDATE_FIELD_VISIBLE_COUNT)}
        >
          收起常用字段
        </Button>
      ) : null}

      {selectedQuestions.length ? (
        <div className={styles.metaQuestionSection}>
          <Text type="secondary">已选择修改</Text>
          <div className={styles.updateFieldPickerSelectedList}>
            {selectedQuestions.map((question) => {
              const current = getMetaQuestionCurrentDisplay(questionCard, question);
              const next = getMetaQuestionAnswerDisplay({
                question,
                value: answers[question.paramKey],
                answerLabels,
              });
              return (
                <div
                  key={question.paramKey}
                  className={`${styles.updateFieldPickerSelectedItem} ${activeQuestion?.paramKey === question.paramKey ? styles.updateFieldPickerSelectedItemActive : ''}`}
                  role="button"
                  tabIndex={canInteract ? 0 : -1}
                  onClick={() => {
                    if (canInteract) {
                      setActiveParamKey(question.paramKey);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!canInteract || !['Enter', ' '].includes(event.key)) {
                      return;
                    }
                    event.preventDefault();
                    setActiveParamKey(question.paramKey);
                  }}
                >
                  <Text strong>{question.label}</Text>
                  <Text type={next ? undefined : 'secondary'}>
                    {current || '未填写'} → {next || '待填写'}
                  </Text>
                  <Button
                    type="link"
                    size="small"
                    disabled={!canInteract}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeQuestion(question.paramKey);
                    }}
                  >
                    移除
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeQuestion ? (
        <div className={styles.updateFieldPickerEditor}>
          <MetaQuestionInput
            identity={identity}
            toolCode={questionCard.toolCode}
            question={activeQuestion}
            value={getUpdateFieldEditorValue(activeQuestion, answers)}
            styles={styles}
            disabled={!canInteract}
            showCurrentOptionTag
            onChange={(value, displayLabel) => {
              setSelectedParamKeys((current) => (
                current.includes(activeQuestion.paramKey) ? current : [...current, activeQuestion.paramKey]
              ));
              setAnswers((current) => ({
                ...current,
                [activeQuestion.paramKey]: value,
              }));
              setAnswerLabels((current) => {
                const next = { ...current };
                if (displayLabel) {
                  next[activeQuestion.paramKey] = displayLabel;
                } else {
                  delete next[activeQuestion.paramKey];
                }
                return next;
              });
            }}
          />
        </div>
      ) : (
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          请选择一个字段后填写新值。
        </Text>
      )}

      <Space size={8} wrap style={{ marginTop: 12 }}>
        <Button
          type="primary"
          size="small"
          disabled={!canSubmit}
          onClick={() => {
            if (!onSubmit) {
              return;
            }
            onSubmit({
              runId: pendingInteraction.runId,
              interactionId: pendingInteraction.interactionId,
              answers: changedAnswers,
              queryText: buildMetaQuestionSubmitText(questionCard, changedAnswers, answerLabels),
            });
          }}
        >
          {questionCard.submitLabel || '生成更新预览'}
        </Button>
        <Button
          size="small"
          disabled={!canCancel}
          onClick={() => {
            if (!onCancel) {
              return;
            }
            onCancel({
              runId: pendingInteraction.runId,
              interactionId: pendingInteraction.interactionId,
            });
          }}
        >
          取消本次录入
        </Button>
        <Text type="secondary">{helperText}</Text>
      </Space>
    </div>
  );
}

function getUpdateFieldEditorValue(
  question: AssistantMetaQuestion,
  answers: Record<string, unknown>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(answers, question.paramKey)) {
    return answers[question.paramKey];
  }
  return question.options?.length ? question.currentValue : undefined;
}

function parseMetaQuestionDateValue(value: unknown) {
  if (value === undefined || value === null || Array.isArray(value)) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed : null;
}

function MetaQuestionInput({
  identity,
  toolCode,
  question,
  value,
  styles,
  disabled,
  showCurrentOptionTag,
  onChange,
}: {
  identity: YzjAuthIdentityResponse;
  toolCode: string;
  question: AssistantMetaQuestion;
  value: unknown;
  styles: ReturnType<typeof useStyles>['styles'];
  disabled?: boolean;
  showCurrentOptionTag?: boolean;
  onChange: (value: unknown, displayLabel?: string) => void;
}) {
  return (
    <div className={styles.metaQuestionItem}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Text strong>{question.label}</Text>
          {question.required ? <Tag color="red">必填</Tag> : null}
        </Space>
        {question.lookup ? (
          <RemoteMetaQuestionSelect
            identity={identity}
            toolCode={toolCode}
            question={question}
            value={value}
            disabled={disabled}
            onChange={onChange}
          />
        ) : question.options?.length ? (
          <Space size={6} wrap>
            {question.options.map((option) => {
              const active = String(value ?? '') === String(option.value);
              const isCurrent = showCurrentOptionTag && String(question.currentValue ?? '') === String(option.value);
              return (
                <Button
                  key={String(option.key ?? option.value)}
                  size="small"
                  type={active ? 'primary' : 'default'}
                  disabled={disabled}
                  onClick={() => onChange(option.value, formatMetaOptionDisplay(option))}
                >
                  <Space size={4}>
                    <span>{option.label}</span>
                    {isCurrent ? <Tag color={active ? 'blue' : undefined}>当前</Tag> : null}
                  </Space>
                </Button>
              );
            })}
          </Space>
        ) : question.type === 'date' ? (
          <DatePicker
            size="small"
            value={parseMetaQuestionDateValue(value)}
            placeholder={question.placeholder || `请选择${question.label}`}
            format="YYYY-MM-DD"
            disabled={disabled}
            onChange={(_, dateString) => {
              onChange(typeof dateString === 'string' && dateString ? dateString : undefined);
            }}
            style={{ width: '100%' }}
          />
        ) : (
          <Input
            size="small"
            value={value === undefined || value === null || Array.isArray(value) ? '' : String(value)}
            placeholder={question.placeholder || `请输入${question.label}`}
            inputMode={question.type === 'phone' ? 'tel' : undefined}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {question.reason ? <Text type="secondary">{question.reason}</Text> : null}
      </Space>
    </div>
  );
}

function RemoteMetaQuestionSelect({
  identity,
  toolCode,
  question,
  value,
  disabled,
  onChange,
}: {
  identity: YzjAuthIdentityResponse;
  toolCode: string;
  question: AssistantMetaQuestion;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown, displayLabel?: string) => void;
}) {
  const lookup = question.lookup;
  const [options, setOptions] = useState<AssistantFieldOptionHint[]>(question.options ?? []);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    setOptions(question.options ?? []);
    setSearchText('');
    requestSeqRef.current += 1;
  }, [question.questionId, question.options]);

  useEffect(() => {
    if (!lookup) {
      return;
    }
    const keyword = searchText.trim();
    if (keyword.length < lookup.minKeywordLength) {
      if (!keyword) {
        setOptions(question.options ?? []);
      }
      return;
    }
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchMetaQuestionOptions({
        identity,
        endpoint: lookup.endpoint,
        toolCode,
        paramKey: question.paramKey,
        keyword,
        pageSize: lookup.pageSize,
        signal: controller.signal,
      })
        .then((nextOptions) => {
          if (requestSeqRef.current === requestSeq) {
            setOptions(nextOptions);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.warn('meta question options fetch failed', error);
            if (requestSeqRef.current === requestSeq) {
              setOptions([]);
            }
          }
        })
        .finally(() => {
          if (requestSeqRef.current === requestSeq) {
            setLoading(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [identity, lookup, question.options, question.paramKey, searchText, toolCode]);

  return (
    <Select
      size="small"
      showSearch
      allowClear
      disabled={disabled}
      value={value === undefined || value === null || Array.isArray(value) ? undefined : String(value)}
      placeholder={question.placeholder || `搜索并选择${question.label}`}
      filterOption={false}
      loading={loading}
      notFoundContent={loading ? '检索中...' : '无匹配候选'}
      onSearch={setSearchText}
      onClear={() => onChange(undefined)}
      onChange={(nextValue) => {
        const option = options.find((item) => String(item.value) === String(nextValue));
        onChange(nextValue, option ? formatMetaOptionDisplay(option) : undefined);
      }}
      options={options.map((option) => ({
        value: String(option.value),
        label: (
          <Space direction="vertical" size={0}>
            <Text>{option.label}</Text>
            {option.description ? <Text type="secondary">{option.description}</Text> : null}
          </Space>
        ),
      }))}
      style={{ width: '100%' }}
    />
  );
}

async function fetchMetaQuestionOptions(input: {
  identity: YzjAuthIdentityResponse;
  endpoint: string;
  toolCode: string;
  paramKey: string;
  keyword: string;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<AssistantFieldOptionHint[]> {
  const response = await fetch(input.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolCode: input.toolCode,
      paramKey: input.paramKey,
      keyword: input.keyword,
      pageSize: input.pageSize,
      tenantContext: {
        operatorOpenId: input.identity.operatorOpenId,
      },
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const reason = await readApiErrorMessage(response);
    throw new Error(`候选检索失败：${reason}`);
  }
  const payload = await response.json() as AgentMetaQuestionOptionsResponse;
  return payload.options as AssistantFieldOptionHint[];
}

function formatMetaOptionDisplay(option: Pick<AssistantFieldOptionHint, 'label' | 'description'>): string {
  return option.label || option.description || '';
}

function isEmptyMetaAnswer(value: unknown): boolean {
  return value === undefined
    || value === null
    || typeof value === 'string' && value.trim() === ''
    || Array.isArray(value) && value.length === 0;
}

function buildMetaQuestionSubmitText(
  questionCard: AssistantMetaQuestionCard,
  answers: Record<string, unknown>,
  answerLabels: Record<string, string> = {},
) {
  const labels = new Map(questionCard.questions.map((question) => [question.paramKey, question.label]));
  const parts = Object.entries(answers).map(([paramKey, value]) => {
    const question = questionCard.questions.find((item) => item.paramKey === paramKey);
    const option = question?.options?.find((item) => String(item.value) === String(value));
    const displayValue = answerLabels[paramKey] ?? (option ? formatMetaOptionDisplay(option) : String(value));
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
            key={surface.surfaceId}
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
            <A2UICard key={surface.surfaceId} id={surface.surfaceId} />
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
  const [pageResult, setPageResult] = useState<RecordResultViewModel | undefined>(result);
  const [localPage, setLocalPage] = useState(1);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const pageRequestSeqRef = useRef(0);
  const activeResult = pageResult ?? result;
  const records = activeResult?.records ?? [];
  const total = activeResult?.total ?? records.length;
  const currentServerPage = activeResult?.pageNumber ?? 1;
  const dynamicPageSize = activeResult?.pageSize && activeResult.pageSize > 0
    ? activeResult.pageSize
    : RECORD_RESULT_TABLE_PAGE_SIZE;
  const paginationQuery = activeResult?.pagination;
  const supportsDynamicPagination = Boolean(paginationQuery);
  const localTotalPages = Math.max(1, Math.ceil(records.length / RECORD_RESULT_TABLE_PAGE_SIZE));
  const displayPage = supportsDynamicPagination ? currentServerPage : localPage;
  const displayPageSize = supportsDynamicPagination ? dynamicPageSize : RECORD_RESULT_TABLE_PAGE_SIZE;
  const displayTotalPages = supportsDynamicPagination
    ? activeResult?.totalPages ?? Math.max(1, Math.ceil(total / displayPageSize))
    : localTotalPages;

  useEffect(() => {
    setPageResult(result);
    setLocalPage(1);
    setPageError(null);
    pageRequestSeqRef.current += 1;
  }, [result]);

  const displayRecords = supportsDynamicPagination
    ? records
    : records.slice(
        (localPage - 1) * RECORD_RESULT_TABLE_PAGE_SIZE,
        localPage * RECORD_RESULT_TABLE_PAGE_SIZE,
      );
  const shouldShowPagination = supportsDynamicPagination
    ? total > displayPageSize
    : records.length > RECORD_RESULT_TABLE_PAGE_SIZE;
  const shouldShowAssociationColumn = records
    .some((record) => (record.relationFields ?? []).some((field) => field.label && field.value))
    || getRecordAssociationFieldGroups(activeResult?.objectKey).length > 0;
  const tableScrollX = shouldShowAssociationColumn ? 1280 : 1060;
  const summaryText = shouldShowPagination
    ? supportsDynamicPagination
      ? `共 ${total} 条，当前第 ${displayPage}/${displayTotalPages} 页，每页 ${displayPageSize} 条，翻页实时查询。`
      : `共 ${total} 条，当前第 ${displayPage}/${displayTotalPages} 页，每页 ${displayPageSize} 条。`
    : `共 ${total} 条，以列表展示关键字段。`;
  const loadDynamicPage = async (page: number) => {
    if (!paginationQuery) {
      setLocalPage(page);
      return;
    }
    const requestSeq = pageRequestSeqRef.current + 1;
    pageRequestSeqRef.current = requestSeq;
    setLoadingPage(true);
    setPageError(null);
    try {
      const nextResult = await fetchRecordResultPage(paginationQuery, page, displayPageSize);
      if (pageRequestSeqRef.current !== requestSeq) {
        return;
      }
      setPageResult(nextResult);
    } catch (error) {
      if (pageRequestSeqRef.current !== requestSeq) {
        return;
      }
      setPageError(error instanceof Error ? error.message : '记录分页查询失败');
    } finally {
      if (pageRequestSeqRef.current === requestSeq) {
        setLoadingPage(false);
      }
    }
  };
  const columns: ColumnsType<RecordResultRecordView> = [
    {
      title: mapRecordObjectLabel(activeResult?.objectKey),
      dataIndex: 'title',
      width: 260,
      fixed: 'left',
      render: (_value, record) => (
        <div className={styles.recordResultItem}>
          <Text strong className={styles.recordResultTitleText}>{getRecordDisplayTitle(record, activeResult)}</Text>
          {record.subtitle ? <div className={styles.recordResultSummary}>{record.subtitle}</div> : null}
        </div>
      ),
    },
    {
      title: '状态',
      width: 190,
      render: (_value, record) => <RecordTags tags={record.tags} compact />,
    },
    ...(shouldShowAssociationColumn
      ? [
          {
            title: '关联对象',
            width: 220,
            render: (_value, record) => (
              <div className={styles.recordResultCellText}>
                {readRecordAssociationSummary(record, activeResult?.objectKey) || '-'}
              </div>
            ),
          } satisfies ColumnsType<RecordResultRecordView>[number],
        ]
      : []),
    {
      title: '地区',
      width: 160,
      render: (_value, record) => (
        <div className={styles.recordResultCellText}>
          {joinRecordFieldValues(record, ['省', '市', '区']) || '-'}
        </div>
      ),
    },
    {
      title: '联系人',
      width: 180,
      render: (_value, record) => (
        <div>
          <div>{readRecordFieldValue(record, ['联系人姓名', '联系人']) || '-'}</div>
          <div className={styles.recordResultSummary}>
            {formatRecordPhone(readRecordFieldValue(record, ['联系人手机', '手机', '公司电话', '办公电话']))}
          </div>
        </div>
      ),
    },
    {
      title: '负责人',
      width: 150,
      render: (_value, record) => readRecordFieldValue(record, ['负责人', '销售负责人', '售后服务代表']) || '-',
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_value, record) => record.formInstId ? (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => onAction?.('record.open', {
            objectKey: activeResult?.objectKey,
            formInstId: record.formInstId,
            title: getRecordDisplayTitle(record, activeResult),
          })}
        >
          查看详情
        </Button>
      ) : null,
    },
  ];

  return (
    <div className={styles.recordResultPanel}>
      <div className={styles.recordResultHeader}>
        <div>
          <Text strong>{activeResult?.title ?? '记录查询结果'}</Text>
          <div className={styles.recordResultSummary}>{summaryText}</div>
        </div>
        <Tag color="blue">{mapRecordObjectLabel(activeResult?.objectKey)}</Tag>
      </div>
      <div className={styles.recordResultList}>
        <Table<RecordResultRecordView>
          size="small"
          bordered
          loading={loadingPage}
          pagination={false}
          rowKey={(record) => record.formInstId || record.title}
          columns={columns}
          dataSource={displayRecords}
          scroll={{ x: tableScrollX }}
          tableLayout="fixed"
        />
        {pageError ? (
          <Alert
            type="error"
            showIcon
            message={pageError}
            style={{ marginTop: 8 }}
          />
        ) : null}
        {shouldShowPagination ? (
          <div className={styles.recordResultPagination}>
            <Pagination
              simple
              current={displayPage}
              pageSize={displayPageSize}
              total={supportsDynamicPagination ? total : records.length}
              showSizeChanger={false}
              showLessItems
              disabled={loadingPage}
              onChange={(page) => {
                void loadDynamicPage(page);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function fetchRecordResultPage(
  paginationQuery: AgentRecordSearchPageQuery,
  pageNumber: number,
  pageSize: number,
): Promise<RecordResultViewModel> {
  const request = paginationQuery.request;
  const response = await fetch(paginationQuery.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...request,
      searchInput: {
        ...request.searchInput,
        pageNumber,
        pageSize,
      },
    }),
  });

  if (!response.ok) {
    const reason = await readApiErrorMessage(response);
    throw new Error(`记录分页查询失败：${reason}`);
  }

  const payload = await response.json() as AgentRecordSearchPageResponse;
  return {
    ...payload.result,
    pagination: payload.result.pagination ?? paginationQuery,
  } as RecordResultViewModel;
}

async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (payload?.message) {
      return String(payload.message);
    }
  } catch {
    // Fall back to HTTP status text below.
  }
  return response.statusText || `HTTP ${response.status}`;
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
  const recordTitle = getRecordDisplayTitle(record, result);
  return (
    <div className={styles.recordResultPanel}>
      <div className={styles.recordResultHeader}>
        <div className={styles.recordResultCardTitle}>
          <Text strong>{recordTitle}</Text>
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
              title: recordTitle,
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

function RecordTags({ tags, compact = false }: { tags?: string[]; compact?: boolean }) {
  const visibleTags = (tags ?? []).filter(Boolean).slice(0, 4);
  if (!visibleTags.length) {
    return compact ? <Text type="secondary">-</Text> : null;
  }
  return (
    <Space size={6} wrap style={{ marginTop: compact ? 0 : 8 }}>
      {visibleTags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
    </Space>
  );
}

function getRecordFields(record: RecordResultRecordView): RecordResultFieldView[] {
  return [...(record.primaryFields ?? []), ...(record.secondaryFields ?? [])];
}

function findRecordField(record: RecordResultRecordView, labels: string[]): RecordResultFieldView | undefined {
  const fields = getRecordFields(record);
  const normalizedLabels = labels.map((label) => label.trim()).filter(Boolean);
  return fields.find((field) => normalizedLabels.includes(field.label) && sanitizeRecordDisplayValue(field.value));
}

function readRecordFieldValue(record: RecordResultRecordView, labels: string[]): string {
  const matched = findRecordField(record, labels);
  return sanitizeRecordDisplayValue(matched?.value);
}

function readRecordAssociationSummary(record: RecordResultRecordView, objectKey?: ShadowObjectKey): string {
  const seen = new Set<string>();
  const serverRelationFields = (record.relationFields ?? [])
    .map((field) => ({ ...field, value: sanitizeRecordDisplayValue(field.value) }))
    .filter((field) => field.label && field.value);
  const fallbackRelationFields = getRecordAssociationFieldGroups(objectKey)
    .map((labels) => findRecordField(record, labels))
    .map((field) => field ? { ...field, value: sanitizeRecordDisplayValue(field.value) } : undefined)
    .filter((field): field is RecordResultFieldView => Boolean(field?.label && field.value));
  const entries = (serverRelationFields.length ? serverRelationFields : fallbackRelationFields)
    .filter((field) => {
      const key = `${field.label}:${field.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((field) => `${field.label}：${field.value}`);

  return entries.join(' / ');
}

function getRecordAssociationFieldGroups(objectKey?: ShadowObjectKey): string[][] {
  const customerRelationLabels = ['关联客户', '客户编号', '客户名称', '所属客户', '绑定客户', '选择客户', '客户'];
  if (objectKey === 'contact') {
    return [customerRelationLabels];
  }
  if (objectKey === 'opportunity') {
    return [
      customerRelationLabels,
      ['关联联系人', '联系人', '联系人姓名', '联系人编号'],
    ];
  }
  if (objectKey === 'followup') {
    return [
      customerRelationLabels,
      ['关联商机', '商机', '商机名称', '商机编号'],
      ['关联联系人', '联系人', '联系人姓名', '联系人编号'],
    ];
  }
  return [];
}

function joinRecordFieldValues(record: RecordResultRecordView, labels: string[]): string {
  return labels
    .map((label) => readRecordFieldValue(record, [label]))
    .filter(Boolean)
    .join(' / ');
}

function formatRecordPhone(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '-';
  }
  return normalized.replace(/\.0+$/, '');
}

function RecordFieldGrid({
  fields,
  styles,
}: {
  fields: RecordResultFieldView[];
  styles: ReturnType<typeof useStyles>['styles'];
}) {
  const visibleFields = fields
    .map((field) => ({ ...field, value: sanitizeRecordDisplayValue(field.value) }))
    .filter((field) => field.label && field.value);
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

function getRecordDisplayTitle(record: RecordResultRecordView, result?: RecordResultViewModel): string {
  const rawTitle = sanitizeRecordDisplayValue(record.title);
  if (rawTitle && !isInternalRecordIdentifier(rawTitle, record.formInstId)) {
    return rawTitle;
  }
  return readRecordQueryTitleFallback(result?.queryText, result?.objectKey)
    || `${mapRecordObjectLabel(result?.objectKey)}记录`;
}

function readRecordQueryTitleFallback(query?: string, objectKey?: string): string {
  if (!query?.trim()) {
    return '';
  }
  const objectLabels = objectKey === 'contact'
    ? '(?:联系人|人员)'
    : objectKey === 'opportunity'
      ? '(?:商机|机会)'
      : objectKey === 'followup'
        ? '(?:跟进记录|拜访记录|回访记录|跟进|拜访|回访)'
        : '(?:客户|公司)';
  return query
    .trim()
    .replace(/^\/\S+\s*/, '')
    .replace(/^(?:查询|查一下|查|搜索|找一下|查看|看下|打开|帮我查|帮我搜)\s*/, '')
    .replace(new RegExp(`^${objectLabels}\\s*[：:,，]?\\s*`), '')
    .replace(/(?:客户情况|客户状态|客户处于什么状态|客户是什么状态|详情|信息|资料|列表|结果)$/g, '')
    .replace(/^[：:，。！？、\s]+/g, '')
    .replace(/[：:，。！？、\s]+$/g, '')
    .trim();
}

function isInternalRecordIdentifier(value?: string, formInstId?: string): boolean {
  const normalized = value?.replace(/\s+/g, '').trim() ?? '';
  if (!normalized) {
    return false;
  }
  if (formInstId && normalized === formInstId.replace(/\s+/g, '').trim()) {
    return true;
  }
  return /^[0-9a-f]{16,64}$/i.test(normalized)
    || /^[0-9a-f]{16,64}的(?:商机|机会|商机跟进记录|跟进记录|拜访记录|回访记录)$/i.test(normalized)
    || /^(?:customer|contact|opportunity|followup|form|record|dept|department)[-_][A-Za-z0-9_-]+$/i.test(normalized);
}

function sanitizeRecordDisplayValue(value?: string | null): string {
  const text = (value ?? '').trim();
  if (!text || isInternalRecordIdentifier(text)) {
    return '';
  }
  return text
    .replace(/((?:负责人|销售负责人|所有者|所属人|跟进人|跟进负责人|服务代表|售后服务代表|申请人|创建人|openId|open_id)\s*[：:]\s*)[0-9a-f]{16,64}/gi, '$1已绑定人员')
    .replace(/((?:所属部门|部门|组织|部门ID|deptId|departmentId)\s*[：:]\s*)[0-9a-f]{16,64}/gi, '$1已选择部门')
    .trim();
}

function isShadowObjectKey(value: string): value is ShadowObjectKey {
  return value === 'customer' || value === 'contact' || value === 'opportunity' || value === 'followup';
}

function AssistantMessageContent({
  identity,
  content,
  info,
  styles,
  markdownClassName,
  onOpenArtifact,
  onOpenRecordingEvidence,
  onGenerateImage,
  onGenerateMarkdownImage,
  onOpenRecord,
  onSubmitQuestionCard,
  onCancelQuestionCard,
  activeQuestionInteractionId,
  submittedQuestionInteractionIds,
  imageByArtifactId,
  imageByAttachmentKey,
}: {
  identity: YzjAuthIdentityResponse;
  content: string;
  info: any;
  styles: ReturnType<typeof useStyles>['styles'];
  markdownClassName: string;
  onOpenArtifact: OpenArtifactHandler;
  onOpenRecordingEvidence: OpenRecordingEvidenceHandler;
  onGenerateImage: GenerateImageHandler;
  onGenerateMarkdownImage: GenerateMarkdownImageHandler;
  onOpenRecord?: OpenRecordHandler;
  onSubmitQuestionCard?: MetaQuestionSubmitHandler;
  onCancelQuestionCard?: MetaQuestionCancelHandler;
  activeQuestionInteractionId?: string;
  submittedQuestionInteractionIds?: Set<string>;
  imageByArtifactId: Record<string, ArtifactImagePayload>;
  imageByAttachmentKey: Record<string, MarkdownImagePayload>;
}) {
  const evidence = (info.extraInfo?.evidence ?? []) as AssistantEvidenceCard[];
  const groupedEvidence = useMemo(() => groupEvidenceByArtifact(evidence), [evidence]);
  const uiSurfaces = (info.extraInfo?.uiSurfaces ?? []) as AgentUiSurface[];
  const pendingConfirmation = info.extraInfo?.agentTrace?.pendingConfirmation as PendingConfirmationView | null | undefined;
  const pendingInteraction = info.extraInfo?.agentTrace?.pendingInteraction as PendingInteractionView | null | undefined;
  const referenceLabels = getVisibleReferenceLabels(info.extraInfo?.references);
  const visibleAttachments = getVisibleMessageAttachments(info);
  const visitPrepMarkdownImageTarget = resolveVisitPrepMarkdownImageTarget({ content, info });
  const visitPrepMarkdownImage = visitPrepMarkdownImageTarget
    ? imageByAttachmentKey[visitPrepMarkdownImageTarget.key]
    : undefined;

  return (
    <div className={styles.assistantMessageShell}>
      <AgentThinkingPanel info={info} styles={styles} />
      <RecordWritePreviewPanel pending={pendingConfirmation} styles={styles} />
      <MetaQuestionCardPanel
        identity={identity}
        pendingInteraction={pendingInteraction}
        activeInteractionId={activeQuestionInteractionId}
        submittedInteractionIds={submittedQuestionInteractionIds}
        styles={styles}
        onSubmit={onSubmitQuestionCard}
        onCancel={onCancelQuestionCard}
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
          {visitPrepMarkdownImageTarget ? (
            <div className={styles.markdownImageActions}>
              <Button
                type="link"
                size="small"
                icon={<PictureOutlined />}
                loading={isMarkdownImageGenerating(visitPrepMarkdownImage?.status)}
                disabled={isMarkdownImageGenerating(visitPrepMarkdownImage?.status)}
                style={{ paddingInline: 0 }}
                onClick={() => onGenerateMarkdownImage(visitPrepMarkdownImageTarget)}
              >
                {getMarkdownImageButtonLabel(visitPrepMarkdownImage)}
              </Button>
              {visitPrepMarkdownImage?.status === 'failed' && visitPrepMarkdownImage.errorMessage ? (
                <div className={styles.evidenceErrorText}>{visitPrepMarkdownImage.errorMessage}</div>
              ) : null}
              {visitPrepMarkdownImage?.status === 'succeeded' && visitPrepMarkdownImage.previewDataUrl ? (
                <div className={styles.evidenceImagePreview}>
                  <Image
                    src={visitPrepMarkdownImage.previewDataUrl}
                    alt={`${visitPrepMarkdownImage.title || '客户拜访准备'} 配图`}
                    preview={{ mask: '预览图片' }}
                  />
                  {visitPrepMarkdownImage.downloadDataUrl ? (
                    <Button
                      className={styles.evidenceImageDownload}
                      type="primary"
                      shape="circle"
                      size="small"
                      icon={<DownloadOutlined />}
                      aria-label="下载图片"
                      title="下载图片"
                      onClick={() => downloadDataUrl(
                        visitPrepMarkdownImage.downloadDataUrl!,
                        visitPrepMarkdownImage.fileName || `${visitPrepMarkdownImage.title || '客户拜访准备'}.png`,
                      )}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {visibleAttachments.length ? (
        <div className={styles.inlineRefs}>
          <Text strong>关联附件</Text>
          <div className={styles.attachmentList}>
            {visibleAttachments.map((attachment: any) => {
              const canOpen = typeof attachment.url === 'string' && attachment.url && attachment.url !== '#attachment';
              const attachmentTarget: VisitPrepMarkdownImageTarget | null = canOpen && isMarkdownAttachment(attachment)
                ? {
                    key: buildAttachmentImageKey({ name: attachment.name, url: attachment.url }),
                    title: attachment.name,
                    attachment: {
                      name: attachment.name,
                      url: attachment.url,
                      type: attachment.type,
                    },
                  }
                : null;
              const markdownImage = attachmentTarget ? imageByAttachmentKey[attachmentTarget.key] : undefined;
              return canOpen ? (
                <div
                  key={`${attachment.name}:${attachment.url}`}
                  className={styles.attachmentItem}
                >
                  <div className={styles.evidenceCardActions}>
                    <Button
                      type="link"
                      size="small"
                      icon={<DownloadOutlined />}
                      style={{ paddingInline: 0 }}
                      onClick={() => window.open(attachment.url, '_blank', 'noopener,noreferrer')}
                    >
                      {attachment.name}
                    </Button>
                    {attachmentTarget ? (
                      <Button
                        type="link"
                        size="small"
                        icon={<PictureOutlined />}
                        loading={isMarkdownImageGenerating(markdownImage?.status)}
                        disabled={isMarkdownImageGenerating(markdownImage?.status)}
                        style={{ paddingInline: 0 }}
                        onClick={() => onGenerateMarkdownImage(attachmentTarget)}
                      >
                        {getMarkdownImageButtonLabel(markdownImage)}
                      </Button>
                    ) : null}
                  </div>
                  {markdownImage?.status === 'failed' && markdownImage.errorMessage ? (
                    <div className={styles.evidenceErrorText}>{markdownImage.errorMessage}</div>
                  ) : null}
                  {markdownImage?.status === 'succeeded' && markdownImage.previewDataUrl ? (
                    <div className={styles.evidenceImagePreview}>
                      <Image
                        src={markdownImage.previewDataUrl}
                        alt={`${markdownImage.title || attachment.name} 配图`}
                        preview={{ mask: '预览图片' }}
                      />
                      {markdownImage.downloadDataUrl ? (
                        <Button
                          className={styles.evidenceImageDownload}
                          type="primary"
                          shape="circle"
                          size="small"
                          icon={<DownloadOutlined />}
                          aria-label="下载图片"
                          title="下载图片"
                          onClick={() => downloadDataUrl(
                            markdownImage.downloadDataUrl!,
                            markdownImage.fileName || `${attachment.name}.png`,
                          )}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <Tag key={attachment.name} color="blue">
                  {attachment.name}
                </Tag>
              );
            })}
          </div>
        </div>
      ) : null}

      {referenceLabels.length ? (
        <div className={styles.inlineRefs}>
          <Text strong>引用上下文</Text>
          <div style={{ marginTop: 8 }}>
            {referenceLabels.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
        </div>
      ) : null}

      {groupedEvidence.length ? (
        <div className={styles.inlineRefs}>
          <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>关联资料</Text>
            <Text type="secondary">
              {groupedEvidence.length} 份资料
            </Text>
          </Space>
          <Prompts
            wrap
            className={styles.evidenceGrid}
            onItemClick={(info) => {
              const key = String(info.data.key ?? '');
              const item = groupedEvidence.find((candidate) => getGroupedEvidenceKey(candidate) === key);
              if (!item) {
                return;
              }
              if (isRecordingMaterialEvidenceCard(item)) {
                onOpenRecordingEvidence(item);
                return;
              }
              onOpenArtifact(item);
            }}
            items={groupedEvidence.map((item) => ({
              key: getGroupedEvidenceKey(item),
              icon: <FileSearchOutlined />,
              label: (
                <Space size={6} wrap>
                  <Text strong>{getEvidenceCardTitle(item)}</Text>
                </Space>
              ),
              description: (
                <div>
                  {(() => {
                    const recordingMaterialEvidence = isRecordingMaterialEvidenceCard(item);
                    const canGenerateImage = canGenerateEvidenceImage(item);
                    const image = canGenerateImage
                      ? imageByArtifactId[item.artifactId]
                      : undefined;
                    return (
                      <>
                        <div className={styles.evidenceCardActions}>
                          {recordingMaterialEvidence ? (
                            <Button
                              type="link"
                              size="small"
                              icon={<EyeOutlined />}
                              style={{ paddingInline: 0 }}
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenRecordingEvidence(item);
                              }}
                            >
                              打开录音分析
                            </Button>
                          ) : (
                            <>
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
                                {item.sourceToolCode === 'ext.yunzhijia_visit_prep' ? '查看拜访准备' : '查看完整研究'}
                              </Button>
                              {canGenerateImage ? (
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<PictureOutlined />}
                                  loading={isImageGenerating(image?.status)}
                                  disabled={isImageGenerating(image?.status)}
                                  style={{ paddingInline: 0 }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onGenerateImage(item);
                                  }}
                                >
                                  {getImageButtonLabel(image)}
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                        {image?.status === 'failed' && image.errorMessage ? (
                          <div className={styles.evidenceErrorText}>{image.errorMessage}</div>
                        ) : null}
                        {image?.status === 'succeeded' && (image.previewUrl || image.previewDataUrl) ? (
                          <div
                            className={styles.evidenceImagePreview}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <Image
                              src={image.previewUrl || image.previewDataUrl}
                              alt={`${sanitizeEvidenceText(item.anchorLabel) || getEvidenceCardTitle(item)} 配图`}
                              preview={{ mask: '预览图片' }}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            />
                            {image.downloadPath ? (
                              <Button
                                className={styles.evidenceImageDownload}
                                type="primary"
                                shape="circle"
                                size="small"
                                icon={<DownloadOutlined />}
                                aria-label="下载图片"
                                title="下载图片"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  window.open(image.downloadPath, '_blank', 'noopener,noreferrer');
                                }}
                                onMouseDown={(event) => {
                                  event.stopPropagation();
                                }}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ),
            }))}
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

function RecordingTaskCard({
  task,
  styles,
  onOpenViewer,
  onRetry,
  onRunSkill,
  onOpenSkillArtifact,
  onCreateFollowup,
  followupBusy,
}: {
  task: RecordingTaskCardState;
  styles: ReturnType<typeof useStyles>['styles'];
  onOpenViewer: (task: RecordingTaskCardState) => void;
  onRetry: (task: RecordingTaskCardState) => void;
  onRunSkill: (task: RecordingTaskCardState, skillCode: RecordingSkillCode) => void;
  onOpenSkillArtifact: (job: RecordingSkillJobState, artifact: RecordingSkillArtifactTarget) => void;
  onCreateFollowup: (task: RecordingTaskCardState) => void;
  followupBusy?: boolean;
}) {
  const completed = task.status === 'succeeded' && Boolean(task.material?.available || task.material?.path);
  const skillJobs = Object.values(task.skillJobs ?? {}).filter(Boolean) as RecordingSkillJobState[];
  const archived = task.archive?.status === 'archived' && Boolean(task.archive.followupId);
  const followupButtonLabel = archived
    ? '已新增拜访记录'
    : followupBusy
      ? '拜访记录补充中'
      : '新增拜访记录';
  return (
    <div
      className={`${styles.recordingTaskCard} ${completed ? styles.recordingTaskCardInteractive : ''}`}
      role={completed ? 'button' : undefined}
      tabIndex={completed ? 0 : undefined}
      aria-label={completed ? `打开 ${task.file.fileName} 录音查看页` : undefined}
      onClick={() => {
        if (completed) {
          onOpenViewer(task);
        }
      }}
      onKeyDown={(event) => {
        if (!completed) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenViewer(task);
        }
      }}
    >
      <div className={styles.recordingTaskBody}>
        <Flex justify="space-between" align="start" gap={12}>
          <Space direction="vertical" size={2}>
            <Space size={8} wrap>
              <CloudUploadOutlined />
              <Text strong>{task.file.fileName}</Text>
              <Tag color={getRecordingTagColor(task.status)}>{task.localStatusText || getRecordingStatusLabel(task.status)}</Tag>
            </Space>
            <Text type="secondary">
              {formatFileSize(task.file.size)} · {task.anchors.customer || task.anchors.opportunity ? '已带建议关联' : '可稍后关联客户/商机'}
            </Text>
          </Space>
        </Flex>
        <div className={styles.recordingStageGrid}>
          {task.stages.map((stage) => (
            <span key={stage.key} className={styles.recordingStage}>
              <Tag color={getRecordingTagColor(stage.status)} style={{ marginInlineEnd: 0 }}>
                {stage.status === 'running' ? '中' : stage.status === 'succeeded' ? '成' : stage.status === 'failed' ? '败' : '待'}
              </Tag>
              <span>{stage.label}</span>
            </span>
          ))}
        </div>
        {task.status === 'failed' ? (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            showIcon
            message={task.errorMessage || '录音处理失败'}
            action={task.sourceFile ? <Button size="small" onClick={(event) => {
              event.stopPropagation();
              onRetry(task);
            }}>重试处理</Button> : undefined}
          />
        ) : null}
        {task.archive?.status === 'pending' ? (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="拜访记录已写入，录音完成后自动归档"
          />
        ) : null}
        {completed ? (
          <div className={styles.recordingActions} onClick={(event) => event.stopPropagation()}>
            {recordingSkillActions.map((action) => {
              const job = task.skillJobs?.[action.skillCode];
              return (
                <Button
                  key={action.skillCode}
                  size="small"
                  icon={action.icon}
                  loading={isRecordingSkillJobRunning(job?.status)}
                  onClick={() => onRunSkill(task, action.skillCode)}
                >
                  {action.label}
                </Button>
              );
            })}
            <Button
              size="small"
              icon={archived ? <EyeOutlined /> : <PlusOutlined />}
              disabled={!archived && followupBusy}
              onClick={() => onCreateFollowup(task)}
            >
              {followupButtonLabel}
            </Button>
          </div>
        ) : task.status !== 'failed' ? (
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            正在生成摘要、章节、关键词、说话人与资料包；当前不展示逐字转写。
          </Text>
        ) : null}
        {skillJobs.length ? (
          <div className={styles.recordingSkillJobs} onClick={(event) => event.stopPropagation()}>
            {skillJobs.map((job) => (
              <div key={job.skillCode} className={styles.recordingSkillJob}>
                <span className="job-main">
                  <Tag color={getRecordingTagColor(job.status)} style={{ marginInlineEnd: 0 }}>
                    {getRecordingSkillJobStatusLabel(job.status)}
                  </Tag>
                  <span className="job-label">{job.label}</span>
                  {job.errorMessage ? <Text type="danger">{job.errorMessage}</Text> : null}
                </span>
                {job.status === 'succeeded' && job.artifacts?.length ? (
                  <Space size={4}>
                    {job.artifacts.slice(0, 2).map((artifact) => (
                      <Button
                        key={artifact.artifactId}
                        size="small"
                        type="link"
                        onClick={() => onOpenSkillArtifact(job, artifact)}
                      >
                        {artifact.fileName}
                      </Button>
                    ))}
                  </Space>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
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
      return '/公司研究';
    case 'conversation-understanding':
      return '/公司研究';
    case 'needs-todo-analysis':
      return '/公司研究';
    case 'problem-statement':
      return '/公司研究';
    case 'value-positioning':
      return '/公司研究';
    case 'solution-matching':
      return '/公司研究';
    case 'tasks':
      return '/公司研究';
    default:
      return '/公司研究';
  }
}

function getSlashCommandFromInput(text: string) {
  const normalized = text.trimStart();

  return slashCommands.find(
    (item) => normalized === item.command || normalized.startsWith(`${item.command} `),
  );
}

function getSlashCommandByRoute(route: string) {
  return slashCommands.find((item) => item.route === route && item.route !== '/chat');
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

function findLatestPendingConfirmationTrace(
  messages: MessageInfo<AssistantChatMessage>[],
) {
  return [...messages]
    .reverse()
    .find((item) => {
      const pending = item.message.extraInfo?.agentTrace?.pendingConfirmation;
      return item.message.role === 'assistant' && pending?.status === 'pending';
    })
    ?.message.extraInfo?.agentTrace;
}

function findLatestPendingQuestionInteractionId(
  messages: MessageInfo<AssistantChatMessage>[],
) {
  return [...messages]
    .reverse()
    .find((item) => {
      const pending = item.message.extraInfo?.agentTrace?.pendingInteraction;
      return item.message.role === 'assistant'
        && pending?.status === 'pending'
        && Boolean(pending.questionCard?.questions?.length);
    })
    ?.message.extraInfo?.agentTrace?.pendingInteraction?.interactionId;
}

function findPendingRecordingFollowupTaskIds(
  messages: MessageInfo<AssistantChatMessage>[],
) {
  const taskIds = new Set<string>();
  for (const item of messages) {
    if (item.message.role !== 'assistant') {
      continue;
    }
    const trace = item.message.extraInfo?.agentTrace;
    const pendingInteraction = trace?.pendingInteraction;
    const pendingConfirmation = trace?.pendingConfirmation;
    if (pendingInteraction?.status === 'pending') {
      const taskId = readRecordingSourceTaskId(pendingInteraction.partialInput);
      if (taskId) {
        taskIds.add(taskId);
      }
    }
    if (pendingConfirmation?.status === 'pending') {
      const taskId = readRecordingSourceTaskId(pendingConfirmation.requestInput);
      if (taskId) {
        taskIds.add(taskId);
      }
    }
  }
  return taskIds;
}

function extractArchivedRecordingTaskIds(
  agentTrace?: NonNullable<NonNullable<AssistantChatMessage['extraInfo']>['agentTrace']>,
) {
  const taskIds = new Set<string>();
  for (const call of agentTrace?.toolCalls ?? []) {
    if (call.toolCode !== 'artifact.recording_material.archive' || call.status !== 'succeeded') {
      continue;
    }
    const input = parseJsonObject(call.inputSummary);
    const taskId = typeof input.recordingTaskId === 'string' ? input.recordingTaskId.trim() : '';
    if (taskId) {
      taskIds.add(taskId);
    }
  }
  return Array.from(taskIds);
}

function readRecordingSourceTaskId(value: unknown): string {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const agentControl = root.agentControl && typeof root.agentControl === 'object' && !Array.isArray(root.agentControl)
    ? root.agentControl as Record<string, unknown>
    : {};
  const source = agentControl.source && typeof agentControl.source === 'object' && !Array.isArray(agentControl.source)
    ? agentControl.source as Record<string, unknown>
    : {};
  return source.kind === 'recording_material' && typeof source.recordingTaskId === 'string'
    ? source.recordingTaskId.trim()
    : '';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
  return ['公司名称', '已有研究', '公司研究服务', '公司研究资料'];
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
  identity: YzjAuthIdentityResponse,
  styles: ReturnType<typeof useStyles>['styles'],
  markdownClassName: string,
  onOpenArtifact: OpenArtifactHandler,
  onOpenRecordingEvidence: OpenRecordingEvidenceHandler,
  onGenerateImage: GenerateImageHandler,
  onGenerateMarkdownImage: GenerateMarkdownImageHandler,
  onOpenRecord: OpenRecordHandler,
  onSubmitQuestionCard: MetaQuestionSubmitHandler,
  onCancelQuestionCard: MetaQuestionCancelHandler,
  activeQuestionInteractionId: string | undefined,
  submittedQuestionInteractionIds: Set<string>,
  imageByArtifactId: Record<string, ArtifactImagePayload>,
  imageByAttachmentKey: Record<string, MarkdownImagePayload>,
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
          identity={identity}
          content={content}
          info={info}
          styles={styles}
          markdownClassName={markdownClassName}
          onOpenArtifact={onOpenArtifact}
          onOpenRecordingEvidence={onOpenRecordingEvidence}
          onGenerateImage={onGenerateImage}
          onGenerateMarkdownImage={onGenerateMarkdownImage}
          onOpenRecord={onOpenRecord}
          onSubmitQuestionCard={onSubmitQuestionCard}
          onCancelQuestionCard={onCancelQuestionCard}
          activeQuestionInteractionId={activeQuestionInteractionId}
          submittedQuestionInteractionIds={submittedQuestionInteractionIds}
          imageByArtifactId={imageByArtifactId}
          imageByAttachmentKey={imageByAttachmentKey}
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
  onClose,
}: {
  state: ArtifactViewerState;
  markdownClassName: string;
  styles: ReturnType<typeof useStyles>['styles'];
  onClose: () => void;
}) {
  const anchorTags = buildArtifactAnchorTags(state.artifact?.anchors);
  const staleWarning = Boolean(
    state.artifact
    && state.markdown
    && hasBoundBusinessArtifactAnchors(state.artifact.anchors)
    && hasStaleUnboundArtifactText(state.markdown),
  );
  return (
    <Drawer
      title={
        <Space orientation="vertical" size={2}>
              <Text strong>{state.title || 'Markdown 资料'}</Text>
          {state.artifact ? (
            <Text type="secondary">
              第 {state.artifact.version} 版 · 更新于 {state.artifact.updatedAt}
            </Text>
          ) : null}
        </Space>
      }
      size="large"
      open={state.open}
      onClose={onClose}
      destroyOnClose={false}
      className={styles.markdownDrawerBody}
      extra={
        state.markdown ? (
          <Space>
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
            message="资料加载失败"
            description={state.error}
          />
        ) : (
          <Card className={styles.markdownViewerCard}>
            {state.artifact ? (
              <>
                <Space wrap>
                  <Tag color="geekblue">第 {state.artifact.version} 版</Tag>
                  <Tag>{state.artifact.updatedAt}</Tag>
                  {anchorTags.map((anchor) => (
                    <Tag key={anchor.key} color={anchor.color}>{anchor.label}</Tag>
                  ))}
                </Space>
                {staleWarning ? (
                  <Alert
                    style={{ marginTop: 12, marginBottom: 12 }}
                    type="warning"
                    showIcon
                    message="正文生成早于正式关联，建议重跑分析"
                  />
                ) : null}
              </>
            ) : null}
            <XMarkdown paragraphTag="div" className={markdownClassName}>
              {state.markdown || '暂无资料内容。'}
            </XMarkdown>
          </Card>
        )}
      </div>
    </Drawer>
  );
}

function buildArtifactAnchorTags(anchors?: ArtifactDetailPayload['artifact']['anchors']) {
  const labels: Record<string, string> = {
    customer: '客户',
    opportunity: '商机',
    followup: '跟进记录',
    source_file: '来源文件',
  };
  const colors: Record<string, string> = {
    customer: 'blue',
    opportunity: 'green',
    followup: 'cyan',
    source_file: 'default',
  };
  return (anchors ?? [])
    .filter((anchor) => labels[anchor.type])
    .map((anchor) => ({
      key: `${anchor.type}:${anchor.id}`,
      label: `${labels[anchor.type]}：${anchor.name || anchor.id}`,
      color: colors[anchor.type] ?? 'default',
    }));
}

function hasBoundBusinessArtifactAnchors(anchors?: ArtifactDetailPayload['artifact']['anchors']) {
  return (anchors ?? []).some((anchor) => (
    (anchor.type === 'customer' || anchor.type === 'opportunity' || anchor.type === 'followup')
    && anchor.bindingStatus === 'bound'
  ));
}

function hasStaleUnboundArtifactText(markdown: string) {
  return /未关联客户\/商机|未关联客户|未关联商机|录音未绑定/.test(markdown.slice(0, 1200));
}

function AssistantConversationRuntime({
  runtimeScope,
  activeConversationKey,
  activeConversation,
  conversations,
  scene,
  locationPathname,
  styles,
  markdownClassName,
  messageApi,
  setConversation,
  prepareRecordingConversation,
  activateConversation,
  navigateToScene,
  blankConversationKeys,
  setBlankConversationKeys,
  pendingBlankConversationSubmitRef,
}: {
  runtimeScope: AssistantRuntimeScope;
  activeConversationKey: string;
  activeConversation?: ConversationSession;
  conversations: ConversationSession[];
  scene: ReturnType<typeof getSceneByPath>;
  locationPathname: string;
  styles: ReturnType<typeof useStyles>['styles'];
  markdownClassName: string;
  messageApi: ReturnType<typeof message.useMessage>[0];
  setConversation: (key: string, conversation: ConversationSession) => boolean;
  prepareRecordingConversation: (summary: string) => string;
  activateConversation: (key: string) => void;
  navigateToScene: (route: string) => void;
  blankConversationKeys: Set<string>;
  setBlankConversationKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  pendingBlankConversationSubmitRef: React.MutableRefObject<Record<string, string>>;
}) {
  const listRef = useRef<BubbleListRef>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
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
  const [imageByArtifactId, setImageByArtifactId] = useState<Record<string, ArtifactImagePayload>>({});
  const [imageByAttachmentKey, setImageByAttachmentKey] = useState<Record<string, MarkdownImagePayload>>({});
  const [recordingTasks, setRecordingTasks] = useState<RecordingTaskCardState[]>(
    () => loadPersistedRecordingTasks(runtimeScope, activeConversationKey),
  );
  const [submittedQuestionInteractionIds, setSubmittedQuestionInteractionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedComposerCommand, setSelectedComposerCommand] = useState<SlashCommand | null>(
    null,
  );
  const promptGroups = useMemo(() => buildPromptGroups(scene), [scene]);
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
  const runtimeConversationKeyRef = useRef(activeConversationKey);
  const defaultMessagesConversationKeyRef = useRef(activeConversationKey);

  useEffect(() => {
    const routeCommand = getSlashCommandByRoute(locationPathname);
    if (routeCommand) {
      setSelectedComposerCommand(routeCommand);
    }
  }, [locationPathname]);

  const isActiveConversationBlank = Boolean(
    blankConversationKeys.has(activeConversationKey)
    || isBlankUserConversation(runtimeScope, activeConversation),
  );

  const { onRequest, messages, isRequesting, abort, onReload, setMessage, isDefaultMessagesRequesting } =
    useXChat<AssistantChatMessage>({
      provider: providerFactory(activeConversationKey) as any,
      conversationKey: activeConversationKey,
      defaultMessages: async (info?: { conversationKey?: string }) => {
        const key = String(info?.conversationKey ?? activeConversationKey);
        defaultMessagesConversationKeyRef.current = key;
        const conversation = conversations.find((item) => item.key === key) as
          | ConversationSession
          | undefined;
        if (isBlankUserConversation(runtimeScope, conversation)) {
          return [];
        }
        return loadDefaultConversationMessages(runtimeScope, key);
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
  const hasRecordingTasks = recordingTasks.length > 0;
  const latestAgentMessage = [...displayMessageList]
    .reverse()
    .find((item) => item.message.role === 'assistant' && item.message.extraInfo?.agentTrace);
  const latestAgentTrace = latestAgentMessage?.message.extraInfo?.agentTrace;
  const suggestedRecordingAnchors = useMemo(
    () => buildSuggestedRecordingAnchors(latestAgentTrace),
    [latestAgentTrace],
  );
  const latestPendingConfirmationTrace = findLatestPendingConfirmationTrace(displayMessageList);
  const activeQuestionInteractionId = findLatestPendingQuestionInteractionId(displayMessageList);
  const pendingRecordingFollowupTaskIds = useMemo(
    () => findPendingRecordingFollowupTaskIds(displayMessageList),
    [displayMessageList],
  );
  const latestTimelineAnchorMessageId = useMemo(
    () => getLatestTimelineMessageId(displayMessageList),
    [displayMessageList],
  );
  const latestEvidence = latestAgentMessage?.message.extraInfo?.evidence ?? [];
  const visibleEvidenceCards = useMemo(
    () => displayMessageList.flatMap((item) => item.message.extraInfo?.evidence ?? []),
    [displayMessageList],
  );
  const safeScrollToBottom = React.useCallback(() => {
    const chatList = chatListRef.current;
    if (chatList) {
      chatList.scrollTo({ top: chatList.scrollHeight });
      return;
    }
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
    if (
      isDefaultMessagesRequesting
      || isActiveConversationBlank
      || activeConversation?.key !== activeConversationKey
      || runtimeConversationKeyRef.current !== activeConversationKey
      || defaultMessagesConversationKeyRef.current !== activeConversationKey
    ) {
      return;
    }
    persistMessages(runtimeScope, activeConversationKey, messageList);
  }, [
    activeConversation?.key,
    activeConversationKey,
    isActiveConversationBlank,
    isDefaultMessagesRequesting,
    messageList,
  ]);

  const fetchImageStatus = React.useCallback(async (artifactId: string) => {
    const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/image`);
    if (!response.ok) {
      throw new Error(`图片状态接口返回 ${response.status}`);
    }
    const payload = (await response.json()) as ArtifactImagePayload;
    setImageByArtifactId((current) => ({
      ...current,
      [artifactId]: payload,
    }));
    return payload;
  }, []);

  useEffect(() => {
    setRecordingTasks(loadPersistedRecordingTasks(runtimeScope, activeConversationKey));
  }, [activeConversationKey, runtimeScope]);

  useEffect(() => {
    const reloadRecordingTasks = () => {
      setRecordingTasks(loadPersistedRecordingTasks(runtimeScope, activeConversationKey));
    };
    const handleRecordingTasksUpdated = (event: Event) => {
      const conversationKey = (event as CustomEvent<{ conversationKey?: string }>).detail?.conversationKey;
      if (!conversationKey || conversationKey === activeConversationKey) {
        reloadRecordingTasks();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === runtimeScope.storageKeys.recordingTasks) {
        reloadRecordingTasks();
      }
    };

    window.addEventListener(CHAT_RECORDING_TASKS_UPDATED_EVENT, handleRecordingTasksUpdated);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHAT_RECORDING_TASKS_UPDATED_EVENT, handleRecordingTasksUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, [activeConversationKey, runtimeScope]);

  const updateRecordingTasksForConversation = React.useCallback((
    conversationKey: string,
    updater: (tasks: RecordingTaskCardState[]) => RecordingTaskCardState[],
  ) => {
    if (conversationKey !== activeConversationKey) {
      updatePersistedRecordingTasks(runtimeScope, conversationKey, updater);
      return;
    }

    setRecordingTasks((current) => {
      const next = updater(current);
      persistRecordingTasks(runtimeScope, conversationKey, next, false);
      return next;
    });
  }, [activeConversationKey, runtimeScope]);

  const upsertRecordingTask = React.useCallback((
    task: RecordingTaskCardState,
    conversationKey = activeConversationKey,
  ) => {
    updateRecordingTasksForConversation(conversationKey, (current) => {
      const existingIndex = current.findIndex((item) => item.taskId === task.taskId);
      if (existingIndex < 0) {
        return [task, ...current].slice(0, 6);
      }
      const next = [...current];
      next[existingIndex] = { ...next[existingIndex], ...task };
      return next;
    });
  }, [activeConversationKey, updateRecordingTasksForConversation]);

  const upsertRecordingSkillJob = React.useCallback((
    taskId: string,
    skillCode: RecordingSkillCode,
    job: RecordingSkillJobState,
    conversationKey = activeConversationKey,
  ) => {
    updateRecordingTasksForConversation(conversationKey, (current) => current.map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }
      return {
        ...task,
        skillJobs: {
          ...(task.skillJobs ?? {}),
          [skillCode]: job,
        },
      };
    }));
  }, [activeConversationKey, updateRecordingTasksForConversation]);

  const updateRecordingTaskTimelineAnchor = React.useCallback((
    taskId: string,
    timelineAnchorMessageId: string | null,
    conversationKey = activeConversationKey,
  ) => {
    updateRecordingTasksForConversation(conversationKey, (current) => current.map((task) => (
      task.taskId === taskId
        ? { ...task, timelineAnchorMessageId }
        : task
    )));
  }, [activeConversationKey, updateRecordingTasksForConversation]);

  const fetchRecordingTask = React.useCallback(async (taskId: string) => {
    const response = await fetch(`/api/recording-audio-tasks/${encodeURIComponent(taskId)}`);
    if (!response.ok) {
      throw new Error(`录音任务接口返回 ${response.status}`);
    }
    const payload = (await response.json()) as RecordingTaskPayload;
    upsertRecordingTask(payload);
    return payload;
  }, [upsertRecordingTask]);

  useEffect(() => {
    const archivedTaskIds = extractArchivedRecordingTaskIds(latestAgentTrace);
    if (!archivedTaskIds.length) {
      return;
    }
    for (const taskId of archivedTaskIds) {
      void fetchRecordingTask(taskId).catch(() => {
        // The card can still be refreshed by the next polling/user action.
      });
    }
  }, [fetchRecordingTask, latestAgentTrace]);

  const fetchRecordingSkillJob = React.useCallback(async (
    taskId: string,
    skillCode: RecordingSkillCode,
    jobId: string,
	  ) => {
	    const response = await fetch(
	      `/api/recording-audio-tasks/${encodeURIComponent(taskId)}/skill-jobs/${encodeURIComponent(skillCode)}/${encodeURIComponent(jobId)}`,
	    );
    if (!response.ok) {
      throw new Error(`外部技能 Job 接口返回 ${response.status}`);
    }
    const payload = (await response.json()) as ExternalSkillJobResponse;
    upsertRecordingSkillJob(taskId, skillCode, toRecordingSkillJobState(skillCode, payload));
    return payload;
  }, [upsertRecordingSkillJob]);

  const materializeRecordingTask = React.useCallback(async (
    taskId: string,
    conversationKey = activeConversationKey,
  ) => {
    const response = await fetch(`/api/recording-audio-tasks/${encodeURIComponent(taskId)}/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredSource: 'auto' }),
    });
    if (!response.ok) {
      throw new Error(`录音资料包接口返回 ${response.status}`);
    }
    const payload = (await response.json()) as RecordingTaskPayload;
    upsertRecordingTask(payload, conversationKey);
    return payload;
  }, [activeConversationKey, upsertRecordingTask]);

  const uploadRecordingFile = React.useCallback(async (
    file: File,
    conversationKey = activeConversationKey,
  ) => {
    const anchors = suggestedRecordingAnchors;
    const timelineAnchorMessageId = conversationKey === activeConversationKey
      ? latestTimelineAnchorMessageId
      : null;
    const pendingTask: RecordingTaskCardState = {
      taskId: `pending-${file.name}-${file.lastModified}`,
      status: 'queued',
      serviceTaskId: '',
      file: {
        fileName: file.name,
        mimeType: file.type || 'audio/*',
        size: file.size,
        md5: '',
      },
      anchors,
      stages: [
        { key: 'uploaded', label: '已上传', status: 'running' },
        { key: 'summary', label: '生成摘要', status: 'pending' },
        { key: 'chapters', label: '生成章节', status: 'pending' },
        { key: 'keywords', label: '提取关键词', status: 'pending' },
        { key: 'speakers', label: '识别说话人', status: 'pending' },
        { key: 'material', label: '生成资料包', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localStatusText: '录音处理准备',
      sourceFile: file,
      timelineAnchorMessageId,
    };
    upsertRecordingTask(pendingTask, conversationKey);

    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('createdBy', runtimeScope.identity.operatorOpenId);
    if (Object.keys(anchors).length) {
      formData.append('anchors', JSON.stringify(anchors));
    }
    try {
      const response = await fetch('/api/recording-audio-tasks', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.message || `录音上传接口返回 ${response.status}`);
      }
      const payload = (await response.json()) as RecordingTaskPayload;
      updateRecordingTasksForConversation(
        conversationKey,
        (current) => current.filter((item) => item.taskId !== pendingTask.taskId),
      );
      upsertRecordingTask({ ...payload, sourceFile: file, timelineAnchorMessageId }, conversationKey);
      if (payload.status === 'succeeded' && !payload.material?.available) {
        void materializeRecordingTask(payload.taskId, conversationKey).catch((error) => {
          messageApi.error(error instanceof Error ? error.message : '录音资料包生成失败');
        });
      }
      return payload;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : RECORDING_UPLOAD_INCOMPLETE_MESSAGE;
      updateRecordingTasksForConversation(
        conversationKey,
        (current) => current.map((item) => (
          item.taskId === pendingTask.taskId
            ? buildFailedPendingRecordingTask(item, errorMessage)
            : item
        )),
      );
      throw error instanceof Error
        ? error
        : new Error(errorMessage);
    }
  }, [
    activeConversationKey,
    latestTimelineAnchorMessageId,
    materializeRecordingTask,
    messageApi,
    runtimeScope.identity.operatorOpenId,
    suggestedRecordingAnchors,
    updateRecordingTasksForConversation,
    upsertRecordingTask,
  ]);

  const runRecordingSkillJob = React.useCallback(async (
    task: RecordingTaskCardState,
    skillCode: RecordingSkillCode,
  ) => {
    const existingJob = task.skillJobs?.[skillCode];
    if (isRecordingSkillJobRunning(existingJob?.status)) {
      return;
    }

    upsertRecordingSkillJob(task.taskId, skillCode, {
      skillCode,
      label: recordingSkillLabels[skillCode],
      status: 'queued',
      artifacts: [],
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      const response = await fetch(`/api/recording-audio-tasks/${encodeURIComponent(task.taskId)}/skill-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillCode }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.message || `外部技能 Job 创建接口返回 ${response.status}`);
      }
      const payload = (await response.json()) as ExternalSkillJobResponse;
      upsertRecordingSkillJob(task.taskId, skillCode, toRecordingSkillJobState(skillCode, payload));
      if (payload.status === 'succeeded') {
        messageApi.success(`${recordingSkillLabels[skillCode]} 已完成`);
      } else {
        messageApi.info(`${recordingSkillLabels[skillCode]} 已提交`);
      }
    } catch (error) {
      upsertRecordingSkillJob(task.taskId, skillCode, {
        skillCode,
        label: recordingSkillLabels[skillCode],
        status: 'failed',
        artifacts: [],
        errorMessage: error instanceof Error ? error.message : '外部技能调用失败',
        updatedAt: new Date().toISOString(),
      });
      messageApi.error(error instanceof Error ? error.message : '外部技能调用失败');
    }
  }, [messageApi, upsertRecordingSkillJob]);

  useEffect(() => {
    const pollingTasks = recordingTasks
      .filter((task) => !isPendingRecordingTaskId(task.taskId))
	      .filter((task) => task.status === 'queued' || task.status === 'running' || (task.status === 'succeeded' && !task.material?.available));

    if (!pollingTasks.length) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      pollingTasks.forEach((task) => {
        void fetchRecordingTask(task.taskId)
          .then((latest) => {
	            if (latest.status === 'succeeded' && !latest.material?.available) {
              return materializeRecordingTask(latest.taskId);
            }
            return latest;
          })
          .catch(() => {
            // Keep the current card; manual retry is still available.
          });
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [fetchRecordingTask, materializeRecordingTask, recordingTasks]);

  useEffect(() => {
    const runningJobs = recordingTasks.flatMap((task) => (
      Object.values(task.skillJobs ?? {})
        .filter((job): job is RecordingSkillJobState => Boolean(job?.jobId && isRecordingSkillJobRunning(job.status)))
        .map((job) => ({
          taskId: task.taskId,
          skillCode: job.skillCode,
          jobId: job.jobId!,
        }))
    ));

    if (!runningJobs.length) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      runningJobs.forEach((job) => {
        void fetchRecordingSkillJob(job.taskId, job.skillCode, job.jobId).catch((error) => {
          upsertRecordingSkillJob(job.taskId, job.skillCode, {
            skillCode: job.skillCode,
            label: recordingSkillLabels[job.skillCode],
            status: 'failed',
            artifacts: [],
            errorMessage: error instanceof Error ? error.message : '外部技能 Job 状态同步失败',
            updatedAt: new Date().toISOString(),
          });
        });
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [fetchRecordingSkillJob, recordingTasks, upsertRecordingSkillJob]);

  useEffect(() => {
    const missingArtifacts = Array.from(new Set(
      visibleEvidenceCards
        .filter((item) => canGenerateEvidenceImage(item) && item.artifactId && !imageByArtifactId[item.artifactId])
        .map((item) => item.artifactId),
    ));

    if (!missingArtifacts.length) {
      return;
    }

    missingArtifacts.forEach((artifactId) => {
      void fetchImageStatus(artifactId).catch(() => {
        // Keep the evidence card usable even if the stored image metadata is not available.
      });
    });
  }, [fetchImageStatus, imageByArtifactId, visibleEvidenceCards]);

  useEffect(() => {
    const generatingArtifacts = Object.values(imageByArtifactId)
      .filter((item) => isImageGenerating(item.status))
      .map((item) => item.artifactId);

    if (!generatingArtifacts.length) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      generatingArtifacts.forEach((artifactId) => {
        void fetchImageStatus(artifactId).catch(() => {
          // Keep the visible generating state; the next poll or manual retry can recover.
        });
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [fetchImageStatus, imageByArtifactId]);

  const handleGenerateImage = React.useCallback<GenerateImageHandler>(
    async (evidence) => {
      if (!canGenerateEvidenceImage(evidence)) {
        return;
      }
      const existing = imageByArtifactId[evidence.artifactId];
      if (isImageGenerating(existing?.status)) {
        return;
      }

      setImageByArtifactId((current) => ({
        ...current,
        [evidence.artifactId]: {
          artifactId: evidence.artifactId,
          versionId: evidence.versionId,
          title: evidence.title,
          status: 'queued',
        },
      }));

      try {
        const request: ArtifactImageGenerationRequest = {
          size: '1536x1024',
          quality: 'auto',
        };
        const response = await fetch(`/api/artifacts/${encodeURIComponent(evidence.artifactId)}/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response));
        }

        const payload = (await response.json()) as ArtifactImagePayload;
        setImageByArtifactId((current) => ({
          ...current,
          [evidence.artifactId]: {
            ...payload,
            prompt: payload.prompt,
          },
        }));
        if (payload.status === 'succeeded') {
          messageApi.success('图片已生成并保存');
        } else {
          messageApi.error(payload.errorMessage || '图片生成失败，可重新生成');
        }
        window.requestAnimationFrame(() => {
          safeScrollToBottom();
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '图片生成失败';
        setImageByArtifactId((current) => ({
          ...current,
          [evidence.artifactId]: {
            artifactId: evidence.artifactId,
            versionId: evidence.versionId,
            title: evidence.title,
            status: 'failed',
            errorMessage,
          },
        }));
        messageApi.error(errorMessage);
      }
    },
    [imageByArtifactId, messageApi, safeScrollToBottom],
  );

  const handleGenerateMarkdownImage = React.useCallback<GenerateMarkdownImageHandler>(
    async (target) => {
      const existing = imageByAttachmentKey[target.key];
      if (isMarkdownImageGenerating(existing?.status)) {
        return;
      }

      setImageByAttachmentKey((current) => ({
        ...current,
        [target.key]: {
          key: target.key,
          title: target.title,
          status: 'queued',
        },
      }));

      try {
        let markdown = target.markdown?.trim() ?? '';
        if (target.attachment) {
          const markdownResponse = await fetch(target.attachment.url);
          if (!markdownResponse.ok) {
            throw new Error(`Markdown 附件读取失败：${await readApiErrorMessage(markdownResponse)}`);
          }
          markdown = (await markdownResponse.text()).trim();
        }
        if (!markdown) {
          throw new Error('Markdown 内容为空，无法生成图片');
        }
        const request: MarkdownImageGenerationRequest = {
          title: target.title,
          markdown,
          size: '1536x1024',
          quality: 'auto',
        };
        const imageResponse = await fetch('/api/markdown/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
        if (!imageResponse.ok) {
          throw new Error(await readApiErrorMessage(imageResponse));
        }

        const payload = (await imageResponse.json()) as MarkdownImageGenerationResponse;
        setImageByAttachmentKey((current) => ({
          ...current,
          [target.key]: {
            ...payload,
            key: target.key,
            title: payload.title || target.title,
            status: 'succeeded',
          },
        }));
        messageApi.success('图片已生成');
        window.requestAnimationFrame(() => {
          safeScrollToBottom();
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '图片生成失败';
        setImageByAttachmentKey((current) => ({
          ...current,
          [target.key]: {
            key: target.key,
            title: target.title,
            status: 'failed',
            errorMessage,
          },
        }));
        messageApi.error(errorMessage);
      }
    },
    [imageByAttachmentKey, messageApi, safeScrollToBottom],
  );

  const handleSubmitQuestionCard = React.useCallback<MetaQuestionSubmitHandler>(
    ({ runId, interactionId, answers, queryText }) => {
      if (isRequesting) {
        messageApi.warning('当前请求仍在处理中，请等待完成后再继续。');
        return;
      }
      onRequest({
        query: queryText,
        sceneKey: scene.key,
        conversationKey: activeConversationKey,
        identity: runtimeScope.identity,
        resume: {
          runId,
          action: 'provide_input',
          interactionId,
          answers,
        },
      });
      setSubmittedQuestionInteractionIds((current) => {
        const next = new Set(current);
        next.add(interactionId);
        return next;
      });
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    },
    [activeConversationKey, isRequesting, messageApi, onRequest, runtimeScope.identity, safeScrollToBottom, scene.key],
  );

  const handleCancelQuestionCard = React.useCallback<MetaQuestionCancelHandler>(
    ({ runId, interactionId }) => {
      if (isRequesting) {
        messageApi.warning('当前请求仍在处理中，请等待完成后再取消。');
        return;
      }
      onRequest({
        query: '取消本次录入',
        sceneKey: scene.key,
        conversationKey: activeConversationKey,
        identity: runtimeScope.identity,
        resume: {
          runId,
          action: 'cancel_interaction',
          interactionId,
        },
      });
      setSubmittedQuestionInteractionIds((current) => {
        const next = new Set(current);
        next.add(interactionId);
        return next;
      });
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    },
    [activeConversationKey, isRequesting, messageApi, onRequest, runtimeScope.identity, safeScrollToBottom, scene.key],
  );

  const handleOpenRecord = React.useCallback<OpenRecordHandler>(
    ({ objectKey, formInstId, title }) => {
      if (isRequesting) {
        messageApi.warning('当前请求仍在处理中，请等待完成后再查看记录。');
        return;
      }
      const objectLabel = mapRecordObjectLabel(objectKey);
      const safeTitle = title?.trim() && !isInternalRecordIdentifier(title, formInstId)
        ? title.trim()
        : '';
      const queryText = safeTitle
        ? `打开${objectLabel}：${safeTitle}`
        : `打开${objectLabel}详情`;
      onRequest({
        query: queryText,
        sceneKey: scene.key,
        conversationKey: activeConversationKey,
        identity: runtimeScope.identity,
        ...(isShadowObjectKey(objectKey)
          ? {
              clientAction: {
                type: 'record.open' as const,
                objectKey,
                formInstId,
                ...(safeTitle ? { title: safeTitle } : {}),
              },
            }
          : {}),
      });
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
    },
    [activeConversationKey, isRequesting, messageApi, onRequest, runtimeScope.identity, safeScrollToBottom, scene.key],
  );

  const handleOpenArtifactCard = React.useCallback<OpenArtifactHandler>(async (evidence) => {
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
        throw new Error(`资料接口返回 ${response.status}`);
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
    } catch (error) {
      setArtifactViewer({
        open: true,
        loading: false,
        title: evidence.title,
        artifactId: evidence.artifactId,
        markdown: '',
        error: error instanceof Error ? error.message : '无法读取资料',
      });
    }
  }, []);

  const handleOpenRecordingEvidence = React.useCallback<OpenRecordingEvidenceHandler>(async (evidence) => {
    const knownTaskId = evidence.recordingTaskId?.trim();
    if (knownTaskId) {
      openRecordingViewer(knownTaskId);
      return;
    }

    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(evidence.artifactId)}`);
      if (!response.ok) {
        throw new Error(`录音资料接口返回 ${response.status}`);
      }
      const payload = (await response.json()) as ArtifactDetailPayload;
      const taskId = getRecordingTaskIdFromArtifactDetail(payload);
      if (!taskId) {
        messageApi.warning('暂时无法定位这份录音分析，请刷新后重试。');
        return;
      }
      openRecordingViewer(taskId);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '录音分析打开失败');
    }
  }, [messageApi]);

  const handleOpenRecordingViewer = React.useCallback((task: RecordingTaskCardState) => {
    if (task.status !== 'succeeded') {
      messageApi.warning('录音处理完成后才能打开查看页');
      return;
    }
    openRecordingViewer(task.taskId);
  }, [messageApi]);

  const handleOpenRecordingSkillArtifact = React.useCallback(async (
    job: RecordingSkillJobState,
    artifact: RecordingSkillArtifactTarget,
  ) => {
    setArtifactViewer({
      open: true,
      loading: true,
      title: artifact.fileName || job.label,
      markdown: '',
      error: null,
    });

    try {
      const response = await fetch(artifact.downloadPath);
      if (!response.ok) {
        throw new Error(`外部技能产物接口返回 ${response.status}`);
      }
      const markdown = await response.text();
      setArtifactViewer({
        open: true,
        loading: false,
        title: artifact.fileName || job.label,
        markdown,
        error: null,
      });
    } catch (error) {
      setArtifactViewer({
        open: true,
        loading: false,
        title: artifact.fileName || job.label,
        markdown: '',
        error: error instanceof Error ? error.message : '无法读取外部技能产物',
      });
    }
  }, []);

  const handleRetryRecordingTask = React.useCallback((task: RecordingTaskCardState) => {
    if (!task.sourceFile) {
      messageApi.warning('当前页面没有保留原始录音文件，请重新选择文件上传。');
      return;
    }
    void uploadRecordingFile(task.sourceFile).catch((error) => {
      messageApi.error(error instanceof Error ? error.message : '录音重试失败');
    });
  }, [messageApi, uploadRecordingFile]);

  const requestFromRecordingTask = React.useCallback((
    task: RecordingTaskCardState,
    query: string,
    clientAction?: AgentClientAction,
  ) => {
    if (isRequesting) {
      messageApi.warning('当前请求仍在处理中，请等待完成后再继续。');
      return;
    }
    if (!task.timelineAnchorMessageId && latestTimelineAnchorMessageId) {
      updateRecordingTaskTimelineAnchor(task.taskId, latestTimelineAnchorMessageId);
    }
    onRequest({
      query,
      sceneKey: scene.key,
      conversationKey: activeConversationKey,
      identity: runtimeScope.identity,
      ...(clientAction ? { clientAction } : {}),
    });
    window.requestAnimationFrame(() => {
      safeScrollToBottom();
    });
  }, [
    activeConversationKey,
    isRequesting,
    latestTimelineAnchorMessageId,
    messageApi,
    onRequest,
    runtimeScope.identity,
    safeScrollToBottom,
    scene.key,
    updateRecordingTaskTimelineAnchor,
  ]);

  const handleCreateRecordingFollowup = React.useCallback((task: RecordingTaskCardState) => {
    if (task.archive?.status === 'archived' && task.archive.followupId) {
      handleOpenRecord({
        objectKey: 'followup',
        formInstId: task.archive.followupId,
        title: `${task.file.fileName} 拜访记录`,
      });
      return;
    }
    requestFromRecordingTask(
      task,
      `基于录音资料包「${task.file.fileName}」新增拜访记录。正式写入前必须补齐客户和商机，并等待我确认后再写入。`,
      {
        type: 'record.preview_create',
        objectKey: 'followup',
	        source: {
	          kind: 'recording_material',
	          recordingTaskId: task.taskId,
	          artifactId: task.material?.artifactId,
	          fileName: task.file.fileName,
	          sourceFileMd5: task.file.md5,
	          anchors: task.anchors,
	        },
      },
    );
  }, [handleOpenRecord, requestFromRecordingTask]);

  const role = useMemo(
    () => buildRole(runtimeScope.identity, styles, markdownClassName, handleOpenArtifactCard, handleOpenRecordingEvidence, handleGenerateImage, handleGenerateMarkdownImage, handleOpenRecord, handleSubmitQuestionCard, handleCancelQuestionCard, activeQuestionInteractionId, submittedQuestionInteractionIds, imageByArtifactId, imageByAttachmentKey),
    [
      activeQuestionInteractionId,
      handleCancelQuestionCard,
      handleGenerateMarkdownImage,
      handleGenerateImage,
      handleOpenArtifactCard,
      handleOpenRecordingEvidence,
      handleOpenRecord,
      handleSubmitQuestionCard,
      imageByAttachmentKey,
      imageByArtifactId,
      markdownClassName,
      runtimeScope.identity,
      submittedQuestionInteractionIds,
      styles,
    ],
  );

  const handleNavigateToScene = React.useCallback((route: string) => {
    navigateToScene(route);
    setRunInsightOpen(false);
  }, [navigateToScene]);

  const clearSelectedComposerCommand = React.useCallback(() => {
    setSelectedComposerCommand(null);
    if (locationPathname !== '/chat') {
      handleNavigateToScene('/chat');
    }
  }, [handleNavigateToScene, locationPathname]);

  const selectSlashCommand = (command: SlashCommand) => {
    if (locationPathname !== command.route) {
      handleNavigateToScene(command.route);
    }
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

  const onSubmit = async (text: string) => {
    const normalizedText = text.trim();
    if (selectedComposerCommand?.key === 'company-research' && !normalizedText) {
      messageApi.warning('请输入公司全称');
      return;
    }
    if (selectedComposerCommand?.key === 'yunzhijia-visit-prep' && !normalizedText) {
      messageApi.warning('请输入客户名称');
      return;
    }

    const audioFiles = (attachedFiles ?? [])
      .filter(isAudioAttachment)
      .map(getUploadFile)
      .filter((file): file is File => Boolean(file));

    const queryText = selectedComposerCommand && !getSlashCommandFromInput(normalizedText)
      ? `${selectedComposerCommand.command}${normalizedText ? ` ${normalizedText}` : ''}`
      : normalizedText || (audioFiles.length ? '生成录音资料包' : '');

    if (!queryText.trim()) {
      return;
    }

    if (isRequesting) {
      messageApi.warning('当前请求仍在处理中，请等待完成后再继续。');
      return;
    }

    if (audioFiles.length) {
      const uploadSummary = audioFiles.length === 1
        ? `上传录音：${audioFiles[0]?.name ?? '录音文件'}`
        : `上传 ${audioFiles.length} 个录音文件`;
      const recordingConversationKey = prepareRecordingConversation(uploadSummary);
      setInputValue('');
      setSelectedComposerCommand(null);
      setAttachedFiles([]);
      setAttachmentsOpen(false);
      setSlashMenuOpen(false);
      const uploadPromises = audioFiles.map((file) => uploadRecordingFile(file, recordingConversationKey));
      activateConversation(recordingConversationKey);
      try {
        await Promise.all(uploadPromises);
        messageApi.success('录音任务已创建，完成后会生成录音资料卡。');
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : '录音任务创建失败');
      }
      window.requestAnimationFrame(() => {
        safeScrollToBottom();
      });
      return;
    }

    const matchedSlashCommand = getSlashCommandFromInput(queryText);
    if (matchedSlashCommand && matchedSlashCommand.route !== locationPathname) {
      handleNavigateToScene(matchedSlashCommand.route);
      setSelectedComposerCommand(matchedSlashCommand);
      setInputValue(normalizedText.replace(matchedSlashCommand.command, '').trimStart());
      setAttachmentsOpen(false);
      setSlashMenuOpen(false);
      return;
    }

    if (activeConversation && isUserCreatedConversationKey(runtimeScope, activeConversation.key)) {
      const nextConversation = {
        ...activeConversation,
        label: isBlankUserConversation(runtimeScope, activeConversation)
          ? buildConversationTitleFromQuery(queryText)
          : activeConversation.label,
        lastMessage: queryText,
        updatedAt: '刚刚',
        scene: scene.key,
        route: locationPathname,
      };
      setConversation(activeConversation.key, nextConversation);
      void persistRemoteConversation(runtimeScope, nextConversation).catch(() => {
        // Local state remains usable when admin-api is unavailable.
      });
    }

    if (isActiveConversationBlank) {
      pendingBlankConversationSubmitRef.current[activeConversationKey] = queryText;
    }

    onRequest({
      query: queryText,
      sceneKey: scene.key,
      conversationKey: activeConversationKey,
      identity: runtimeScope.identity,
      attachments: (attachedFiles ?? []).map((file) => ({
        name: file.name,
        url: '#attachment',
        type: file.type || 'file',
        size: file.size,
      })),
      resume: resolveWritebackResume(queryText, latestPendingConfirmationTrace ?? latestAgentTrace),
    });
    setInputValue('');
    setSelectedComposerCommand(null);
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

    const exactSlashCommand = slashCommands.find((item) => item.command === normalized);
    if (exactSlashCommand) {
      selectSlashCommand(exactSlashCommand);
      return;
    }

    onSubmit(normalized);
  };

  const audioAttachedFiles = (attachedFiles ?? []).filter(isAudioAttachment);

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
            ? { title: '把公司资料或临时材料拖到这里' }
            : {
                icon: <CloudUploadOutlined />,
                title: '上传公司材料',
                description: '支持研究资料和临时附件',
              }
        }
      />
      {audioAttachedFiles.length ? (
        <div className={styles.recordingPrepCard}>
          <div className={styles.recordingPrepTitle}>
            <Space size={8}>
              <CloudUploadOutlined />
              <Text strong>录音处理准备</Text>
            </Space>
            <Tag color="processing">生成录音资料包</Tag>
          </div>
          <Space direction="vertical" size={4}>
            {audioAttachedFiles.map((file) => (
              <Text key={file.uid || file.name} type="secondary">
                {file.name} · {formatFileSize(file.size)}
              </Text>
            ))}
            <Text type="secondary">可先处理，稍后再关联客户/商机；当前不展示逐字转写。</Text>
          </Space>
        </div>
      ) : null}
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
            items={promptGroups.guides}
            styles={promptGroupStyles}
            onItemClick={(info) => {
              submitPromptText((info.data.description || info.data.label) as string);
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
  const recordingTimeline = useMemo(
    () => buildRecordingTimeline(displayMessageList, recordingTasks),
    [displayMessageList, recordingTasks],
  );
  const hasTimelineEntries = recordingTimeline.length > 0;

  const senderFooter: NodeRender = (_, { components }) => {
    const { LoadingButton, SendButton } = components;

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
          {isRequesting ? <LoadingButton /> : <SendButton />}
        </div>
      </div>
    );
  };

  const chatList = (
    <div className={styles.chatList} ref={chatListRef}>
      {hasTimelineEntries ? (
        <>
          {recordingTimeline.map((entry) => {
            if (entry.kind === 'messages') {
              return (
                <Bubble.List
                  key={`${activeConversationKey}:${entry.key}`}
                  ref={listRef}
                  className={styles.bubbleList}
                  role={role}
                  styles={{ root: { maxWidth: 940 } }}
                  items={entry.messages.map((item) => ({
                    ...item.message,
                    key: `${activeConversationKey}:${item.id}`,
                    status: item.status,
                    loading: item.status === 'loading',
                    extraInfo: item.message.extraInfo ?? item.extraInfo,
                  }))}
                />
              );
            }

            return (
              <div key={`${activeConversationKey}:${entry.key}`} className={styles.recordingTaskStack}>
                <RecordingTaskCard
                  task={entry.task}
                  styles={styles}
                  onOpenViewer={handleOpenRecordingViewer}
                  onRetry={handleRetryRecordingTask}
                  onRunSkill={runRecordingSkillJob}
                  onOpenSkillArtifact={handleOpenRecordingSkillArtifact}
                  onCreateFollowup={handleCreateRecordingFollowup}
                  followupBusy={pendingRecordingFollowupTaskIds.has(entry.task.taskId)}
                />
              </div>
            );
          })}
        </>
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
      {!attachmentsOpen && !showSlashMenu && !selectedComposerCommand && !hasRecordingTasks ? (
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
        placeholder={
          selectedComposerCommand?.key === 'company-research'
            ? '请输入公司全称，例如：上海松井机械有限公司'
            : selectedComposerCommand?.key === 'yunzhijia-visit-prep'
              ? '输入客户名称，客户关注点可选'
            : scene.defaultInput
        }
      />
    </Flex>
  );

  return (
    <ChatContext.Provider value={{ onReload, setMessage }}>
      <div className={styles.chat}>
        <div className={styles.chatToolbar}>
          {hasRecordingTasks ? (
            <Tag color="blue">录音处理</Tag>
          ) : scene.key !== 'chat' ? (
            <>
              <Tag color="blue">{scene.title}</Tag>
              <Tag color="purple">命中 {getSceneSlashCommand(scene.key)}</Tag>
            </>
          ) : null}
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
      <RunInsightDrawer
        key={activeConversationKey}
        open={runInsightOpen}
        onClose={() => setRunInsightOpen(false)}
        scene={scene}
        sourceTags={getSceneSourceTags(scene.key)}
        slashCommand={scene.key === 'chat' ? 'slash 命令入口' : getSceneSlashCommand(scene.key)}
        tenantContext={{
          tenantName: runtimeScope.identity.userName || '云之家用户',
          eidLabel: runtimeScope.identity.displayEid || runtimeScope.identity.eid,
          appIdLabel: runtimeScope.identity.appId,
        }}
        agentTrace={latestAgentTrace}
        evidence={latestEvidence}
        recordingTasks={recordingTasks.map((task) => ({
          taskId: task.taskId,
          fileName: task.file.fileName,
          status: task.status,
          localStatusText: task.localStatusText,
          stages: task.stages.map((stage) => ({
            key: stage.key,
            label: stage.label,
            status: stage.status,
          })),
          skillJobs: Object.values(task.skillJobs ?? {})
            .filter((job): job is RecordingSkillJobState => Boolean(job))
            .map((job) => ({
              skillCode: job.skillCode,
              label: job.label,
              status: job.status,
              errorMessage: job.errorMessage,
              jobId: job.jobId,
              artifacts: job.artifacts?.map((artifact) => ({
                artifactId: artifact.artifactId,
                fileName: artifact.fileName,
              })),
            })),
        }))}
        adminBaseUrl={ADMIN_BASE_URL}
      />
      <ArtifactMarkdownDrawer
        state={artifactViewer}
        markdownClassName={markdownClassName}
        styles={styles}
        onClose={() => setArtifactViewer((current) => ({ ...current, open: false }))}
      />
    </ChatContext.Provider>
  );
}

function PersonalSettingsPage({
  runtimeScope,
  settings,
  loading,
  styles,
  messageApi,
  onSettingsChange,
}: {
  runtimeScope: AssistantRuntimeScope;
  settings: AgentPersonalSettingsResponse;
  loading: boolean;
  styles: ReturnType<typeof useStyles>['styles'];
  messageApi: ReturnType<typeof message.useMessage>[0];
  onSettingsChange: (settings: AgentPersonalSettingsResponse) => void;
}) {
  const [draft, setDraft] = useState(settings.soulPrompt);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings.soulPrompt);
  }, [settings.soulPrompt]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const next = await updatePersonalSettings(runtimeScope, draft);
      onSettingsChange(next);
      messageApi.success('SOUL 已保存');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'SOUL 保存失败');
    } finally {
      setSaving(false);
    }
  }, [draft, messageApi, onSettingsChange, runtimeScope]);

  const handleRestoreDefault = React.useCallback(async () => {
    setSaving(true);
    try {
      const next = await updatePersonalSettings(runtimeScope, '');
      onSettingsChange(next);
      setDraft(next.soulPrompt);
      messageApi.success('已恢复默认 SOUL');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '恢复默认 SOUL 失败');
    } finally {
      setSaving(false);
    }
  }, [messageApi, onSettingsChange, runtimeScope]);

  return (
    <main className={styles.settingsPage}>
      <div className={styles.settingsInner}>
        <div className={styles.settingsHeader}>
          <div>
            <h1 className={styles.settingsTitle}>个人设置</h1>
            <div className={styles.settingsDescription}>
              SOUL 是你的销售立场配置。本轮仅保存配置，后续销售速览和拜访建议可基于它生成更贴近金蝶云之家制造业方案的内容。
            </div>
          </div>
          <Space>
            <Tag color="blue">{settings.displayName}</Tag>
            <Tag color={settings.isDefaultSoulPrompt ? 'default' : 'green'}>
              {settings.isDefaultSoulPrompt ? 'SOUL 未配置' : 'SOUL 已配置'}
            </Tag>
          </Space>
        </div>
        <div className={styles.settingsPanel}>
          <div className={styles.settingsPanelBody}>
            {loading ? (
              <Skeleton active paragraph={{ rows: 10 }} />
            ) : (
              <>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Text strong>SOUL 提示词</Text>
                  <Text type="secondary">
                    当前按租户和用户保存，绑定 eid 与 operatorOpenId，不会影响其他销售。
                  </Text>
                </Space>
                <Input.TextArea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoSize={{ minRows: 16, maxRows: 26 }}
                  className={styles.settingsTextarea}
                  placeholder="请输入你的销售立场、主推方案和输出偏好。"
                />
                <div className={styles.settingsActions}>
                  <Button onClick={handleRestoreDefault} loading={saving}>
                    恢复默认
                  </Button>
                  <Button type="primary" onClick={handleSave} loading={saving}>
                    保存 SOUL
                  </Button>
                </div>
                <div className={styles.settingsMeta}>
                  {settings.updatedAt
                    ? `上次保存：${settings.updatedAt}`
                    : '当前使用系统默认 SOUL，保存后会生成你的个人配置。'}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function AssistantWorkspace({ runtimeScope }: { runtimeScope: AssistantRuntimeScope }) {
  const { styles } = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const [markdownClassName] = useMarkdownTheme();
  const [messageApi, contextHolder] = message.useMessage();
  const scene = getSceneByPath(location.pathname);
  const isPersonalSettingsRoute = location.pathname === PERSONAL_SETTINGS_ROUTE;
  const [personalSettings, setPersonalSettings] = useState<AgentPersonalSettingsResponse>(
    () => buildDefaultPersonalSettings(runtimeScope.identity),
  );
  const [personalSettingsLoading, setPersonalSettingsLoading] = useState(true);
  const [renamingConversation, setRenamingConversation] = useState<ConversationSession | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [blankConversationKeys, setBlankConversationKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingBlankConversationSubmitRef = useRef<Record<string, string>>({});
  const homeConversation = useMemo(
    () => ({
      key: runtimeScope.homeConversationKey,
      label: 'AI 销售工作台',
      route: '/chat',
      group: '固定会话',
      lastMessage: '输入客户名称，客户关注点可选。',
      updatedAt: '刚刚',
      scene: 'chat',
    }),
    [runtimeScope.homeConversationKey],
  );
  const baseConversations = useMemo(
    () => [homeConversation],
    [homeConversation],
  );
  const defaultConversations = useMemo(
    () => baseConversations,
    [baseConversations],
  );
  const getConversationKeyByRoute = React.useCallback(
    (route: string) =>
      baseConversations.find((item) => item.route === route)?.key ?? runtimeScope.homeConversationKey,
    [baseConversations, runtimeScope.homeConversationKey],
  );

  useEffect(() => {
    applyDocumentBranding(brandTitle, brandLogo);
  }, [location.pathname]);

  useEffect(() => {
    clearLegacyAssistantStorage();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPersonalSettingsLoading(true);
    void fetchPersonalSettings(runtimeScope)
      .then((settings) => {
        if (!cancelled) {
          setPersonalSettings(settings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersonalSettings(buildDefaultPersonalSettings(runtimeScope.identity));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPersonalSettingsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScope]);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    setConversation,
    setConversations,
  } = useXConversations({
    defaultConversations,
    defaultActiveConversationKey:
      getStoredActiveConversationKey(runtimeScope, defaultConversations.map((item) => item.key))
      ?? getConversationKeyByRoute(location.pathname),
  });
  const conversationsRef = useRef<ConversationSession[]>(defaultConversations);
  const activeConversationKeyRef = useRef(activeConversationKey);
  const locationPathnameRef = useRef(location.pathname);
  const conversationCacheWritableRef = useRef(false);
  const activeConversation = conversations.find(
    (item) => item.key === activeConversationKey,
  ) as ConversationSession | undefined;

  useEffect(() => {
    conversationsRef.current = conversations as ConversationSession[];
  }, [conversations]);

  useEffect(() => {
    activeConversationKeyRef.current = activeConversationKey;
  }, [activeConversationKey]);

  useEffect(() => {
    locationPathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;

    void fetchRemoteConversations(runtimeScope).then((remoteConversations) => {
      if (cancelled) {
        return;
      }

      const remoteAvailable = remoteConversations !== null;
      const currentActiveKey = activeConversationKeyRef.current;
      const currentPathname = locationPathnameRef.current;
      const remoteKeys = new Set(
        (remoteConversations ?? [])
          .map((item) => (item && typeof item === 'object' ? (item as { key?: unknown }).key : null))
          .filter((key): key is string => typeof key === 'string'),
      );
      const protectedLocalConversations = conversationsRef.current.filter((conversation) => (
        isUserCreatedConversationKey(runtimeScope, conversation.key)
        && (conversation.key === currentActiveKey || isBlankUserConversation(runtimeScope, conversation))
        && !remoteKeys.has(conversation.key)
      ));
      const nextConversations = remoteAvailable
        ? mergeRemoteConversations(runtimeScope, baseConversations, [
            ...protectedLocalConversations,
            ...remoteConversations,
          ])
        : mergePersistedConversations(runtimeScope, baseConversations);
      conversationCacheWritableRef.current = true;
      setConversations(nextConversations);
      persistCustomConversations(runtimeScope, nextConversations, baseConversations);
      if (remoteAvailable) {
        prunePersistedChatState(runtimeScope, nextConversations.map((item) => item.key));
      }

      const allowedKeys = nextConversations.map((item) => item.key);
      const nextActiveConversationKey = resolveSyncedActiveConversationKey({
        validConversationKeys: allowedKeys,
        currentActiveKey,
        storedActiveKey: getStoredActiveConversationKey(runtimeScope, allowedKeys),
        fallbackKey: getConversationKeyByRoute(currentPathname),
      });
      if (nextActiveConversationKey !== currentActiveKey) {
        setActiveConversationKey(nextActiveConversationKey);
      } else {
        persistActiveConversationKey(runtimeScope, nextActiveConversationKey);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    baseConversations,
    getConversationKeyByRoute,
    runtimeScope,
    setActiveConversationKey,
    setConversations,
  ]);

  useEffect(() => {
    if (location.pathname === '/chat' && isUserCreatedConversationKey(runtimeScope, activeConversationKey)) {
      return;
    }
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
    runtimeScope,
    setActiveConversationKey,
  ]);

  useEffect(() => {
    if (!conversationCacheWritableRef.current) {
      return;
    }
    persistActiveConversationKey(runtimeScope, activeConversationKey);
  }, [activeConversationKey, runtimeScope]);

  useEffect(() => {
    if (!conversationCacheWritableRef.current) {
      return;
    }
    persistCustomConversations(runtimeScope, conversations as ConversationSession[], baseConversations);
  }, [baseConversations, conversations, runtimeScope]);

  const navigateToScene = React.useCallback((route: string) => {
    setActiveConversationKey(getConversationKeyByRoute(route));
    navigate(route);
  }, [getConversationKeyByRoute, navigate, setActiveConversationKey]);

  const prepareRecordingConversation = React.useCallback((summary: string) => {
    const normalizedSummary = summary.trim() || '上传录音';
    const now = new Date();

    if (activeConversation && isUserCreatedConversationKey(runtimeScope, activeConversation.key)) {
      const nextConversation: ConversationSession = {
        ...activeConversation,
        label: isBlankUserConversation(runtimeScope, activeConversation)
          ? buildConversationTitleFromQuery(normalizedSummary)
          : activeConversation.label,
        lastMessage: normalizedSummary,
        updatedAt: '刚刚',
        scene: 'chat',
        route: '/chat',
      };
      setConversation(activeConversation.key, nextConversation);
      persistCustomConversations(
        runtimeScope,
        conversationsRef.current.map((item) => (
          item.key === activeConversation.key ? nextConversation : item
        )),
        baseConversations,
      );
      setBlankConversationKeys((current) => {
        const next = new Set(current);
        next.delete(activeConversation.key);
        return next;
      });
      delete pendingBlankConversationSubmitRef.current[activeConversation.key];
      void persistRemoteConversation(runtimeScope, nextConversation).catch(() => {
        // Local conversation remains available when admin-api is unavailable.
      });
      return activeConversation.key;
    }

    const conversationKey = `${runtimeScope.userConversationKeyPrefix}${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`;
    const newConversation: ConversationSession = {
      key: conversationKey,
      label: buildConversationTitleFromQuery(normalizedSummary),
      route: '/chat',
      group: '最近会话',
      lastMessage: normalizedSummary,
      updatedAt: '刚刚',
      scene: 'chat',
    };
    addConversation(newConversation, 'prepend');
    persistCustomConversations(runtimeScope, [newConversation, ...conversationsRef.current], baseConversations);
    persistMessages(runtimeScope, conversationKey, []);
    void persistRemoteConversation(runtimeScope, newConversation).catch(() => {
      // Local conversation remains available when admin-api is unavailable.
    });
    return conversationKey;
  }, [
    activeConversation,
    addConversation,
    baseConversations,
    pendingBlankConversationSubmitRef,
    runtimeScope,
    setBlankConversationKeys,
    setConversation,
  ]);

  const activateConversation = React.useCallback((conversationKey: string) => {
    if (activeConversationKey !== conversationKey) {
      setActiveConversationKey(conversationKey);
    }
    if (location.pathname !== '/chat') {
      navigate('/chat');
    }
  }, [activeConversationKey, location.pathname, navigate, setActiveConversationKey]);

  const openRenameConversation = React.useCallback((conversation: ConversationSession) => {
    setRenamingConversation(conversation);
    setRenameDraft(conversation.label);
  }, []);

  const closeRenameConversation = React.useCallback(() => {
    setRenamingConversation(null);
    setRenameDraft('');
  }, []);

  const handleRenameConversation = React.useCallback(async () => {
    if (!renamingConversation) {
      return;
    }
    const nextLabel = renameDraft.replace(/\s+/g, ' ').trim();
    if (!nextLabel) {
      messageApi.warning('请输入会话名称');
      return;
    }

    const nextConversation: ConversationSession = {
      ...renamingConversation,
      label: nextLabel.length > 40 ? `${nextLabel.slice(0, 40)}…` : nextLabel,
      updatedAt: '刚刚',
    };
    const nextConversations = conversationsRef.current.map((item) => (
      item.key === nextConversation.key ? nextConversation : item
    ));
    conversationsRef.current = nextConversations;
    setConversation(nextConversation.key, nextConversation);
    persistCustomConversations(runtimeScope, nextConversations, baseConversations);
    void persistRemoteConversation(runtimeScope, nextConversation).catch(() => {
      // The local rename is kept even when admin-api is not running.
    });
    messageApi.success('会话已重命名');
    closeRenameConversation();
  }, [
    baseConversations,
    closeRenameConversation,
    messageApi,
    renameDraft,
    renamingConversation,
    runtimeScope,
    setConversation,
  ]);

  const onCreateConversation = () => {
    const existingBlankConversation = conversations.find((item) => (
      isBlankUserConversation(runtimeScope, item as ConversationSession)
    )) as ConversationSession | undefined;
    if (existingBlankConversation) {
      setActiveConversationKey(existingBlankConversation.key);
      persistActiveConversationKey(runtimeScope, existingBlankConversation.key);
      navigate('/chat');
      return;
    }

    const now = new Date();
    const conversationKey = `${runtimeScope.userConversationKeyPrefix}${now.getTime()}`;
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
    persistMessages(runtimeScope, conversationKey, []);
    const nextConversations = [
      newConversation,
      ...conversationsRef.current.filter((item) => item.key !== conversationKey),
    ];
    conversationsRef.current = nextConversations;
    addConversation(newConversation, 'prepend');
    persistCustomConversations(runtimeScope, nextConversations, baseConversations);
    setActiveConversationKey(conversationKey);
    persistActiveConversationKey(runtimeScope, conversationKey);
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
        menu={(item) => {
          const conversation = conversations.find((candidate) => candidate.key === item.key) as
            | ConversationSession
            | undefined;
          if (!conversation || !isUserCreatedConversationKey(runtimeScope, conversation.key)) {
            return undefined;
          }
          return {
            items: [
              {
                key: 'rename',
                icon: <EditOutlined />,
                label: '重命名',
              },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'rename') {
                openRenameConversation(conversation);
              }
            },
          };
        }}
      />

      <div className={styles.sideFooter}>
        <Space size={8} className={styles.sideFooterInfo}>
          <Avatar size={24} style={{ backgroundColor: '#1677ff' }}>
            {(runtimeScope.identity.userName || personalSettings.displayName).slice(0, 1)}
          </Avatar>
          <Space orientation="vertical" size={0} className={styles.sideFooterInfo}>
            <Text strong ellipsis>
              {runtimeScope.identity.userName || personalSettings.displayName}
            </Text>
          </Space>
        </Space>
        <Button
          type="text"
          icon={<SettingOutlined />}
          className={styles.sideFooterButton}
          onClick={() => navigate(PERSONAL_SETTINGS_ROUTE)}
        />
      </div>
    </div>
  );

  const renameConversationModal = (
    <Modal
      title="重命名会话"
      open={Boolean(renamingConversation)}
      onCancel={closeRenameConversation}
      onOk={handleRenameConversation}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Input
        autoFocus
        maxLength={40}
        value={renameDraft}
        placeholder="请输入会话名称"
        onChange={(event) => setRenameDraft(event.target.value)}
        onPressEnter={() => {
          void handleRenameConversation();
        }}
      />
    </Modal>
  );

  const mainContent = isPersonalSettingsRoute ? (
    <PersonalSettingsPage
      runtimeScope={runtimeScope}
      settings={personalSettings}
      loading={personalSettingsLoading}
      styles={styles}
      messageApi={messageApi}
      onSettingsChange={setPersonalSettings}
    />
  ) : (
    <AssistantConversationRuntime
      key={activeConversationKey}
      runtimeScope={runtimeScope}
      activeConversationKey={activeConversationKey}
      activeConversation={activeConversation}
      conversations={conversations as ConversationSession[]}
      scene={scene}
      locationPathname={location.pathname}
      styles={styles}
      markdownClassName={markdownClassName}
      messageApi={messageApi}
      setConversation={(key, conversation) => setConversation(key, conversation)}
      prepareRecordingConversation={prepareRecordingConversation}
      activateConversation={activateConversation}
      navigateToScene={navigateToScene}
      blankConversationKeys={blankConversationKeys}
      setBlankConversationKeys={setBlankConversationKeys}
      pendingBlankConversationSubmitRef={pendingBlankConversationSubmitRef}
    />
  );

  return (
    <XProvider>
      {contextHolder}
      <div className={styles.layout}>
        {chatSide}
        {mainContent}
      </div>
      {renameConversationModal}
    </XProvider>
  );
}

function AssistantIdentityGate() {
  const { styles } = useStyles();
  const location = useLocation();
  const [state, setState] = useState<{
    loading: boolean;
    identity: YzjAuthIdentityResponse | null;
    error: string | null;
  }>({
    loading: true,
    identity: null,
    error: null,
  });

  const ticket = useMemo(
    () => new URLSearchParams(location.search).get('ticket')?.trim() || '',
    [location.search],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, identity: null, error: null });

    if (!ticket) {
      const cachedIdentity = readCachedAssistantIdentity(getBrowserSessionStorage());
      if (cachedIdentity) {
        setState({ loading: false, identity: cachedIdentity, error: null });
        return () => {
          cancelled = true;
        };
      }
    }

    void resolveAssistantIdentity(ticket)
      .then((identity) => {
        if (!cancelled) {
          writeCachedAssistantIdentity(getBrowserSessionStorage(), identity);
          setState({ loading: false, identity, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            identity: null,
            error: error instanceof Error ? error.message : '云之家身份解析失败',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ticket]);

  if (state.loading) {
    return (
      <div className={styles.authGate}>
        <div className={styles.authGatePanel}>
          <Skeleton active paragraph={{ rows: 4 }} title={{ width: 180 }} />
        </div>
      </div>
    );
  }

  if (state.error || !state.identity) {
    return (
      <div className={styles.authGate}>
        <div className={styles.authGatePanel}>
          <Alert
            type="error"
            showIcon
            message="云之家身份解析失败"
            description={state.error || '请从云之家轻应用入口重新进入。'}
          />
        </div>
      </div>
    );
  }

  return (
    <AssistantWorkspace
      key={`${state.identity.eid}:${state.identity.appId}:${state.identity.operatorOpenId}`}
      runtimeScope={buildAssistantRuntimeScope(state.identity)}
    />
  );
}

function RecordingViewerLoadingPage() {
  const { styles } = useStyles();
  const location = useLocation();
  const target = useMemo(
    () => new URLSearchParams(location.search).get('target')?.trim() || '',
    [location.search],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target || !isSafeRecordingViewerTarget(target)) {
      setError('录音分析地址无效，请返回对话后重新打开。');
      return undefined;
    }

    const timer = window.setTimeout(() => {
      window.location.replace(target);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <div className={styles.authGate}>
      <div className={styles.authGatePanel}>
        {error ? (
          <Alert
            type="error"
            showIcon
            message="录音分析打开失败"
            description={error}
          />
        ) : (
          <Flex vertical align="center" gap={14}>
            <Spin size="large" />
            <Text strong>录音分析正在打开，请稍候</Text>
            <Text type="secondary" style={{ textAlign: 'center' }}>
              服务器准备查看页可能需要一点时间，请不要关闭此页。
            </Text>
          </Flex>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/recording-viewer-loading" element={<RecordingViewerLoadingPage />} />
      <Route path="/chat" element={<AssistantIdentityGate />} />
      <Route path="/settings/personal" element={<AssistantIdentityGate />} />
      <Route path="/chat/company-research" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/customer-analysis" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/conversation-understanding" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/needs-todo-analysis" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/problem-statement" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/value-positioning" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/solution-matching" element={<Navigate to="/chat" replace />} />
      <Route path="/chat/tasks" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}

export default App;
