import type { AssistantChatMessage } from './agent-api-provider';

const VISIT_PREP_TOOL_CODES = new Set([
  'external.yunzhijia_visit_prep',
  'ext.yunzhijia_visit_prep',
]);

export interface MarkdownImageSourceAttachment {
  name?: string;
  url?: string;
  type?: string;
}

export interface VisitPrepMarkdownImageTarget {
  key: string;
  title: string;
  markdown?: string;
  attachment?: {
    name: string;
    url: string;
    type?: string;
  };
}

export function isVisitPrepMarkdownAttachment(attachment: MarkdownImageSourceAttachment): boolean {
  return /^yunzhijia-visit-prep.*\.m(?:arkdown|d)$/i.test((attachment.name ?? '').trim());
}

export function isMarkdownAttachment(attachment: MarkdownImageSourceAttachment): boolean {
  const type = attachment.type?.toLowerCase() ?? '';
  const name = attachment.name?.toLowerCase() ?? '';
  const url = attachment.url?.toLowerCase() ?? '';
  return type.includes('markdown')
    || name.endsWith('.md')
    || name.endsWith('.markdown')
    || url.includes('.md');
}

export function buildAttachmentImageKey(attachment: Pick<Required<MarkdownImageSourceAttachment>, 'name' | 'url'>): string {
  return `attachment:${attachment.name}:${attachment.url}`;
}

export function resolveVisitPrepMarkdownImageTarget(input: {
  content: string;
  info: {
    key?: string | number;
    id?: string | number;
    message?: Pick<AssistantChatMessage, 'attachments'>;
    originMessage?: Pick<AssistantChatMessage, 'attachments'>;
    attachments?: MarkdownImageSourceAttachment[];
    extraInfo?: AssistantChatMessage['extraInfo'];
  };
}): VisitPrepMarkdownImageTarget | null {
  const attachments = getVisibleMessageAttachments(input.info);
  const visitPrepAttachment = attachments.find((attachment) => (
    isVisitPrepMarkdownAttachment(attachment)
    && typeof attachment.url === 'string'
    && attachment.url
    && attachment.url !== '#attachment'
  ));
  const isVisitPrepMessage = isVisitPrepTrace(input.info.extraInfo)
    || Boolean(visitPrepAttachment);

  if (!isVisitPrepMessage) {
    return null;
  }

  const traceId = input.info.extraInfo?.agentTrace?.traceId;
  const messageKey = String(input.info.key ?? input.info.id ?? traceId ?? 'message');

  if (visitPrepAttachment?.name && visitPrepAttachment.url) {
    return {
      key: `visit-prep:${traceId ?? messageKey}:${visitPrepAttachment.url}`,
      title: visitPrepAttachment.name,
      attachment: {
        name: visitPrepAttachment.name,
        url: visitPrepAttachment.url,
        type: visitPrepAttachment.type,
      },
    };
  }

  const markdown = input.content.trim();
  if (!markdown) {
    return null;
  }

  return {
    key: `visit-prep:${traceId ?? messageKey}:content`,
    title: '客户拜访准备.md',
    markdown,
  };
}

export function getVisibleMessageAttachments(info: {
  message?: Pick<AssistantChatMessage, 'attachments'>;
  originMessage?: Pick<AssistantChatMessage, 'attachments'>;
  attachments?: MarkdownImageSourceAttachment[];
}): MarkdownImageSourceAttachment[] {
  return (
    info.message?.attachments
    ?? info.originMessage?.attachments
    ?? info.attachments
    ?? []
  ).filter((attachment) => Boolean(attachment?.name));
}

function isVisitPrepTrace(extraInfo?: AssistantChatMessage['extraInfo']): boolean {
  const selectedToolCode = extraInfo?.agentTrace?.selectedTool?.toolCode;
  if (selectedToolCode && VISIT_PREP_TOOL_CODES.has(selectedToolCode)) {
    return true;
  }

  return (extraInfo?.agentTrace?.toolCalls ?? []).some((toolCall) => (
    VISIT_PREP_TOOL_CODES.has(toolCall.toolCode)
  ));
}
