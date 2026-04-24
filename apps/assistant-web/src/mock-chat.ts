import type { ActionsFeedbackProps } from '@ant-design/x';
import {
  AbstractChatProvider,
  type DefaultMessageInfo,
  XRequest,
  type XRequestOptions,
} from '@ant-design/x-sdk';
import {
  assistantScenes,
  audioImportTasks,
  conversationSessions,
  recordPages,
  researchSnapshots,
  sceneTasks,
  tenantContext,
  visitBriefs,
} from '@shared';

export interface AssistantAttachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: AssistantAttachment[];
  extraInfo?: {
    feedback: ActionsFeedbackProps['value'];
    sceneKey: string;
    headline: string;
    references: string[];
  };
}

export interface AssistantRequestInput {
  query: string;
  sceneKey: string;
  conversationKey: string;
  attachments?: AssistantAttachment[];
}

interface AssistantResponseOutput {
  success: boolean;
  data: {
    content: string;
    attachments?: AssistantAttachment[];
    extraInfo?: AssistantChatMessage['extraInfo'];
  };
}

class AssistantProvider extends AbstractChatProvider<
  AssistantChatMessage,
  AssistantRequestInput,
  AssistantResponseOutput
> {
  transformParams(
    requestParams: Partial<AssistantRequestInput>,
    options: XRequestOptions<
      AssistantRequestInput,
      AssistantResponseOutput,
      AssistantChatMessage
    >,
  ): AssistantRequestInput {
    return {
      ...(options.params ?? {}),
      ...(requestParams ?? {}),
    } as AssistantRequestInput;
  }

  transformLocalMessage(
    requestParams: Partial<AssistantRequestInput>,
  ): AssistantChatMessage {
    return {
      role: 'user',
      content: requestParams.query ?? '',
      attachments: requestParams.attachments,
    };
  }

  transformMessage(info: any): AssistantChatMessage {
    const chunk =
      (info?.chunk as AssistantResponseOutput | undefined) ??
      (Array.isArray(info?.chunks)
        ? (info.chunks[info.chunks.length - 1] as AssistantResponseOutput | undefined)
        : undefined);

    if (!chunk?.data) {
      return (
        info?.originMessage ?? {
          role: 'assistant',
          content: '本次响应为空，请稍后重试。',
        }
      );
    }

    return {
      role: 'assistant',
      content: chunk.data.content,
      attachments: chunk.data.attachments,
      extraInfo: chunk.data.extraInfo,
    };
  }
}

function buildTable(headers: string[], rows: string[][]) {
  const head = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return `${head}\n${separator}\n${body}`;
}

function buildAudioResponse(input: AssistantRequestInput) {
  const matchedTask = input.query.includes('无客户')
    ? audioImportTasks[2]
    : input.query.includes('远澜')
      ? audioImportTasks[1]
      : audioImportTasks[0];

  const rows = matchedTask.steps.map((step) => [
    step.title,
    step.status,
    step.description,
  ]);

  return {
    content: `<think>
1. 识别为录音导入场景，并先校验客户 / 商机上下文。
2. 当前命中的分支是 ${matchedTask.branch}，所以不会直接先生成总结报告。
3. 正式顺序保持为：补齐上下文 -> 创建跟进记录草稿 -> 异步分析录音。
</think>

## 当前分支判断
- 分支类型：**${matchedTask.branch}**
- 客户：${matchedTask.customerName ?? '未命中，需要先创建客户'}
- 商机：${matchedTask.opportunityName ?? '未命中，需要先补齐商机'}
- 上传附件：${input.attachments?.length ? input.attachments.map((item) => item.name).join('、') : '本次按无附件模拟'}

## 正式处理时序
${buildTable(['步骤', '状态', '说明'], rows)}

## 当前建议动作
1. ${matchedTask.steps[0]?.description}
2. ${matchedTask.branch === '无客户无商机' ? '先创建客户并补齐商机上下文' : '确认关键字段后回写'}
3. 如金额、阶段或客户归属置信度不足，进入确认卡片而不是直接回写。
`,
    attachments: [
      {
        name: `${matchedTask.title}-分析纪要.md`,
        url: '#audio-summary',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '录音导入链路已按正式时序规划',
      references: ['traceId / taskId', '跟进记录草稿', '异步分析资产'],
    },
  };
}

function buildResearchResponse(input: AssistantRequestInput) {
  const snapshot = input.query.includes('星海')
    ? researchSnapshots[0]
    : researchSnapshots[1];

  return {
    content: `<think>
1. 当前入口按外部技能处理，不直接越过确认链写回主数据。
2. 已先生成研究快照，再等待后续场景消费，例如拜访材料或风险分析。
3. 如果来源不足，会标记“待补源”，而不是伪造完整结论。
</think>

## 公司研究快照
- 公司：**${snapshot.companyName}**
- 研究意图：${snapshot.intent}
- 来源数量：${snapshot.sourceCount}
- 新鲜度：${snapshot.freshness}

## 研究摘要
${snapshot.summary}

## 风险提示
${snapshot.risks.map((item) => `- ${item}`).join('\n')}

## 机会判断
${snapshot.opportunities.map((item) => `- ${item}`).join('\n')}

## 引用来源
${snapshot.citations.map((item) => `- ${item.title}（${item.source}）`).join('\n')}
`,
    attachments: [
      {
        name: `${snapshot.companyName}-研究快照.md`,
        url: '#research-snapshot',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '公司分析已沉淀为可复用研究快照',
      references: snapshot.citations.map((item) => item.title),
    },
  };
}

function buildVisitResponse(input: AssistantRequestInput) {
  const brief = input.query.includes('远澜') ? visitBriefs[1] : visitBriefs[0];

  return {
    content: `<think>
1. 已按“主数据 + 公司分析 + 录音分析 + AI 记忆”的顺序检查可用输入源。
2. 结果固定输出为拜访摘要卡、问题清单、风险提示、建议动作四块，方便直接使用。
3. 当前版本仍是原型，但交互语义已经为真实联调预留位置。
</think>

## 拜访摘要卡
${brief.summary.map((item) => `- ${item}`).join('\n')}

## 问题清单
${brief.questions.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## 风险提示
${brief.risks.map((item) => `- ${item}`).join('\n')}

## 建议动作
${brief.actions.map((item) => `- ${item}`).join('\n')}

## 数据输入
${buildTable(
  ['输入源', '状态', '说明'],
  brief.sourceMix.map((source) => [source, '已命中', `${source} 已参与本次拜访材料生成`]),
)}
`,
    attachments: [
      {
        name: `${brief.customerName}-拜访材料.pdf`,
        url: '#visit-brief',
        type: 'pdf',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '拜访材料已按固定四段式输出',
      references: brief.sourceMix,
    },
  };
}

function buildTasksResponse(input: AssistantRequestInput) {
  return {
    content: `<think>
1. 我先把当前个人任务和会话触发的场景任务拉出来。
2. 再把 traceId / taskId / 下一步动作串起来，方便你反查后台。
3. 最后优先突出待确认写回和高优先级任务。
</think>

## 今日任务总览
${buildTable(
  ['任务', '状态', '下一步', 'traceId'],
  sceneTasks.map((item) => [
    item.title,
    item.status,
    item.nextAction,
    item.traceId,
  ]),
)}

## 当前结论
- 当前高优任务：${sceneTasks[0].title}
- 待补源任务：${sceneTasks[1].title}
- 已闭环任务：${sceneTasks[2].title}

## 建议动作
1. 先处理待确认写回，避免金额和阶段停留草稿。
2. 对需要排障的任务，直接带 traceId 去管理员后台的可观测性页。
`,
    attachments: [],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '任务中心已汇总会话、任务与 trace 关系',
      references: sceneTasks.map((item) => item.traceId),
    },
  };
}

function buildHomeResponse(input: AssistantRequestInput) {
  const customer = recordPages.customers.records[0];
  const opportunity = recordPages.opportunities.records[0];

  return {
    content: `<think>
1. 我先把你的自然语言意图归到“查询 / 录入 / 场景技能”三类之一。
2. 如果命中结构化对象，我会优先调 shadow.* 对象能力；如果命中场景，就切到场景技能编排。
3. 关键字段最终仍然要经过确认与审计后再写回。
</think>

## 已理解的请求
- 原始请求：${input.query}
- 当前租户：${tenantContext.tenantName}
- 推荐主链路：查询客户、查看商机、定位最近跟进

## 快速结果
${buildTable(
  ['模块', '命中对象', '当前状态', '推荐动作'],
  [
    ['客户', customer.name, customer.status, '打开客户对象治理页核对标签'],
    ['商机', opportunity.name, opportunity.status, '转到拜访材料或录音导入'],
    ['任务', sceneTasks[0].title, sceneTasks[0].status, '跟踪 traceId'],
  ],
)}

## 下一步建议
1. 如果你要直接推进销售动作，可以进入“准备拜访材料”。
2. 如果你手上有新录音，优先走“录音导入与拜访分析”。
3. 如果要补背景信息，先做“公司分析”并沉淀研究快照。
`,
    attachments: [
      {
        name: `${customer.name}-客户摘要.md`,
        url: '#customer-summary',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: assistantScenes.chat.headline,
      references: ['客户对象治理页', '商机对象治理页', '任务中心'],
    },
  };
}

function buildResponse(input: AssistantRequestInput) {
  if (input.sceneKey === 'audio-import') {
    return buildAudioResponse(input);
  }
  if (input.sceneKey === 'company-research') {
    return buildResearchResponse(input);
  }
  if (input.sceneKey === 'visit-prepare') {
    return buildVisitResponse(input);
  }
  if (input.sceneKey === 'tasks') {
    return buildTasksResponse(input);
  }
  return buildHomeResponse(input);
}

async function mockFetch(
  _baseURL: Parameters<typeof fetch>[0],
  options: XRequestOptions<AssistantRequestInput, AssistantResponseOutput>,
) {
  const params = options.params as AssistantRequestInput;
  const payload = buildResponse(params);

  await new Promise((resolve) => {
    window.setTimeout(resolve, 680);
  });

  return new Response(
    JSON.stringify({
      success: true,
      data: payload,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

const providerCache = new Map<string, AssistantProvider>();

export function providerFactory(conversationKey: string) {
  if (!providerCache.has(conversationKey)) {
    providerCache.set(
      conversationKey,
      new AssistantProvider({
        request: XRequest<AssistantRequestInput, AssistantResponseOutput>(
          'https://mock.yzj-ai-crm.local/assistant',
          {
            manual: true,
            fetch: mockFetch,
          },
        ),
      }),
    );
  }

  return providerCache.get(conversationKey)!;
}

export const historyMessages: Record<string, DefaultMessageInfo<AssistantChatMessage>[]> =
  {
    'conv-001': [
      {
        message: {
          role: 'user',
          content: '我上传了一段星海精工的拜访录音，帮我按正式流程处理。',
        },
        status: 'local',
      },
      {
        message: {
          role: 'assistant',
          ...buildAudioResponse({
            query: '我上传了一段星海精工的拜访录音，帮我按正式流程处理。',
            sceneKey: 'audio-import',
            conversationKey: 'conv-001',
          }),
        },
        status: 'success',
      },
    ],
    'conv-002': [
      {
        message: {
          role: 'user',
          content: '帮我准备远澜生物的初访拜访材料。',
        },
        status: 'local',
      },
      {
        message: {
          role: 'assistant',
          ...buildVisitResponse({
            query: '帮我准备远澜生物的初访拜访材料。',
            sceneKey: 'visit-prepare',
            conversationKey: 'conv-002',
          }),
        },
        status: 'success',
      },
    ],
    'conv-003': [
      {
        message: {
          role: 'user',
          content: '帮我分析远澜生物科技，生成研究快照。',
        },
        status: 'local',
      },
      {
        message: {
          role: 'assistant',
          ...buildResearchResponse({
            query: '帮我分析远澜生物科技，生成研究快照。',
            sceneKey: 'company-research',
            conversationKey: 'conv-003',
          }),
        },
        status: 'success',
      },
    ],
  };

export function historyMessageFactory(conversationKey: string) {
  return historyMessages[conversationKey] ?? [];
}

export const defaultConversationItems = conversationSessions;
