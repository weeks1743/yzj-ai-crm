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

function pickAudioTask(query: string) {
  if (query.includes('陌生') || query.includes('渠道')) {
    return audioImportTasks[2];
  }
  if (query.includes('远澜')) {
    return audioImportTasks[1];
  }
  return audioImportTasks[0];
}

function pickSnapshot(query: string) {
  return query.includes('远澜') ? researchSnapshots[1] : researchSnapshots[0];
}

function buildPostVisitLoopResponse(input: AssistantRequestInput) {
  const task = pickAudioTask(input.query);
  const steps = buildTable(
    ['闭环步骤', '当前状态', '说明'],
    [
      ['识别客户 / 上下文', '已命中', task.customerName ?? '需先创建客户'],
      ['商机补齐或选择', task.opportunityName ? '已命中' : '待补齐', task.opportunityName ?? '当前未命中商机'],
      ['创建跟进记录', task.writebackStatus, '先把正式跟进锚点建立起来'],
      ['组装后续分析', task.analysisStatus, '串联会话理解、需求待办、问题陈述和价值定位'],
    ],
  );

  return {
    content: `<think>
1. 已命中复合场景技能：/拜访后闭环。
2. 这不是单纯生成录音总结，而是先补齐客户、商机和跟进，再继续组装后续分析场景。
3. 当前闭环会优先沉淀会话理解、需求待办、问题陈述和客户价值定位，后续还能继续进入方案推进场景。
</think>

## 命中命令
- ${input.query}

## 当前闭环状态
- 客户：**${task.customerName ?? '未命中，需补齐'}**
- 商机：**${task.opportunityName ?? '未命中，需补齐'}**
- 上传附件：${input.attachments?.length ? input.attachments.map((item) => item.name).join('、') : '本次按 slash 命令模拟'}

## 闭环链路
${steps}

## 下游场景编排
1. 拜访会话理解：沉淀事实、承诺事项和风险信号。
2. 客户需求工作待办分析：拆出客户侧与我方待办。
3. 问题陈述：把需求和约束整理成统一问题定义。
4. 客户价值定位：把问题映射成金蝶价值主张和推进话术。
5. 方案匹配与专家协同：围绕客户诉求匹配内部方案、案例和专家支持。
`,
    attachments: [
      {
        name: `${task.title}-闭环纪要.md`,
        url: '#post-visit-loop',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /拜访后闭环，已进入客户与跟进收口链路',
      references: ['mp3 录音', '客户锚定', '跟进记录', '下游分析场景'],
    },
  };
}

function buildCustomerAnalysisResponse(input: AssistantRequestInput) {
  const snapshot = pickSnapshot(input.query);

  return {
    content: `<think>
1. 已命中场景技能：/客户分析。
2. 我会先读取客户、联系人、商机和历史跟进，再补充公司研究供给结果。
3. 输出目标不是研究报告本身，而是销售可直接用于拜访前准备的客户分析卡片。
</think>

## 命中命令
- ${input.query}

## 客户分析卡片
- 客户：**${snapshot.companyName}**
- 研究意图：${snapshot.intent}
- 来源数量：${snapshot.sourceCount}
- 信息新鲜度：${snapshot.freshness}

## 分析结论
- 客户画像：${snapshot.summary}
- 机会判断：${snapshot.opportunities.join('；')}
- 风险提示：${snapshot.risks.join('；')}

## 推荐下一步
1. 若即将拜访，继续进入 /拜访会话理解 或 /客户价值定位。
2. 若要快速收口一段 mp3，直接改走 /拜访后闭环。
`,
    attachments: [
      {
        name: `${snapshot.companyName}-客户分析卡.md`,
        url: '#customer-analysis',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /客户分析，已组装主数据与公司研究供给',
      references: snapshot.citations.map((item) => item.title),
    },
  };
}

function buildConversationUnderstandingResponse(input: AssistantRequestInput) {
  const task = pickAudioTask(input.query);

  return {
    content: `<think>
1. 已命中场景技能：/拜访会话理解。
2. 当前先消费录音转写和跟进上下文，再抽取事实、承诺事项和风险信号。
3. 这层结果默认会被需求待办分析和问题陈述继续复用。
</think>

## 命中命令
- ${input.query}

## 会话理解结果
- 会话对象：**${task.customerName ?? '待补齐客户'}**
- 会话摘要：客户关注 ROI、交付周期和现有系统迁移风险。
- 关键事实：预算窗口明确，评估仍需采购与生产双线确认。
- 客户承诺事项：会后提供现有流程材料，并安排采购总监加入下轮沟通。
- 风险信号：竞争对手已提前进场，且停产窗口容忍度较低。

## 建议下一跳
1. /客户需求工作待办分析 ${task.customerName ?? '星海精工股份'}
2. /问题陈述 ${task.customerName ?? '星海精工股份'}
`,
    attachments: [
      {
        name: `${task.title}-会话理解.md`,
        url: '#conversation-understanding',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /拜访会话理解，已生成事实、承诺事项和风险信号',
      references: ['录音转写', '跟进记录', '风险信号'],
    },
  };
}

function buildNeedsTodoResponse(input: AssistantRequestInput) {
  const customerName = input.query.includes('远澜') ? '远澜生物科技' : '星海精工股份';

  return {
    content: `<think>
1. 已命中场景技能：/客户需求工作待办分析。
2. 当前默认消费拜访会话理解结果，并对齐商机阶段和联系人上下文。
3. 这一步关注的是“接下来谁做什么”，不是再次复述整场会话。
</think>

## 命中命令
- ${input.query}

## 需求清单
1. 明确交付周期对生产停线窗口的影响。
2. 评估与现有 MES 的集成改造范围。
3. 准备 ROI 对比口径，支撑采购评估。

## 工作待办
- 客户侧：补齐现有流程资料，确认采购与生产的联合评审时间。
- 我方：输出分阶段上线方案、ROI 对比表和风险回滚说明。
- 责任归属：销售牵头收口，方案同事补技术路径，交付同事补周期评估。

## 推荐下一跳
1. /问题陈述 ${customerName}
2. /客户价值定位 ${customerName}
`,
    attachments: [
      {
        name: `${customerName}-需求待办分析.md`,
        url: '#needs-todo',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /客户需求工作待办分析，已拆出需求与责任归属',
      references: ['会话理解结果', '客户侧待办', '我方待办'],
    },
  };
}

function buildProblemStatementResponse(input: AssistantRequestInput) {
  const customerName = input.query.includes('远澜') ? '远澜生物科技' : '星海精工股份';

  return {
    content: `<think>
1. 已命中场景技能：/问题陈述。
2. 当前会把需求待办分析结果收敛成问题背景、约束和影响范围。
3. 这样后续做价值定位或内部评审时，大家会使用同一套问题定义。
</think>

## 命中命令
- ${input.query}

## 问题陈述
- 背景：${customerName} 正在推动产线数字化升级，希望缩短跨部门协同与项目跟进成本。
- 核心问题：现有流程和系统衔接不顺，导致交付周期、ROI 和迁移风险难以同时被管理层接受。
- 约束条件：停产窗口短、采购与生产意见不完全一致、竞争对手已提前介入。
- 影响范围：采购评估、生产排程、项目交付计划和后续预算决策都会受影响。

## 推荐下一跳
1. /客户价值定位 ${customerName}
2. 把当前问题陈述发给方案同事做内部对齐
`,
    attachments: [
      {
        name: `${customerName}-问题陈述.md`,
        url: '#problem-statement',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /问题陈述，已形成统一的问题定义',
      references: ['需求待办分析', '约束条件', '影响范围'],
    },
  };
}

function buildValuePositioningResponse(input: AssistantRequestInput) {
  const customerName = input.query.includes('远澜') ? '远澜生物科技' : '星海精工股份';
  const brief = input.query.includes('远澜') ? visitBriefs[1] : visitBriefs[0];

  return {
    content: `<think>
1. 已命中场景技能：/客户价值定位。
2. 当前会消费客户分析、问题陈述和商机上下文，把问题翻译成金蝶价值主张。
3. 输出重点是形成可承接的话术和价值表达，为下一步方案推进提供输入。
</think>

## 命中命令
- ${input.query}

## 客户价值定位
- 价值主张：针对 ${customerName} 当前最关注的交付周期、ROI 和迁移风险，优先强调分阶段上线、业务可追踪和协同效率提升。
- 方案映射：从客户、联系人、商机、跟进记录四个核心对象统一拉通销售动作，让拜访后信息不再散落在录音和纪要里。
- 推进话术：先承认停产窗口和跨部门评估压力，再给出“低风险分阶段推进”的方案路径。

## 可带走的下一步
${brief.actions.map((item) => `- ${item}`).join('\n')}

## 建议下一跳
1. /方案匹配与专家协同 ${customerName}
`,
    attachments: [
      {
        name: `${customerName}-客户价值定位.md`,
        url: '#value-positioning',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /客户价值定位，已生成价值主张与推进话术',
      references: ['客户分析', '问题陈述', '下一步建议'],
    },
  };
}

function buildSolutionExpertEnablementResponse(input: AssistantRequestInput) {
  const customerName = input.query.includes('远澜') ? '远澜生物科技' : '星海精工股份';

  return {
    content: `<think>
1. 已命中场景技能：/方案匹配与专家协同。
2. 当前会承接问题陈述和客户价值定位，不再重复做拜访分析，而是组织内部可推进资源。
3. 输出重点是候选方案、可引用案例和可协同专家，方便销售推进下一轮方案动作。
</think>

## 命中命令
- ${input.query}

## 方案推进支持包
${buildTable(
  ['支持模块', '当前建议', '作用'],
  [
    ['候选方案', '制造业产线协同 + 项目过程管控组合方案', '贴合交付周期与跨部门协同诉求'],
    ['可复用案例', `${customerName} 同行业数字化升级案例 2 个`, '帮助销售快速建立客户信心'],
    ['建议专家', '制造方案顾问 1 名 + 交付专家 1 名', '支撑下一轮方案会与风险答疑'],
    ['推进动作', '组织内部方案预演并准备案例化材料', '提高下轮拜访命中率'],
  ],
)}

## 协同建议
1. 先拿客户价值定位里的 ROI、交付节奏和迁移风险表述做开场。
2. 从案例库中优先选“分阶段上线、低停产风险”的项目做对照。
3. 请交付或行业专家提前参与下一轮沟通，降低客户对落地风险的顾虑。
`,
    attachments: [
      {
        name: `${customerName}-方案推进支持包.md`,
        url: '#solution-expert-enablement',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '命中 /方案匹配与专家协同，已生成方案推进支持包',
      references: ['客户价值定位', '问题陈述', '方案知识库', '专家画像库'],
    },
  };
}

function buildTasksResponse(input: AssistantRequestInput) {
  return {
    content: `<think>
1. 我先把拜访后闭环和销售主链路里的任务拉出来。
2. 再把 traceId、taskId 和下一步动作串起来，方便你反查后台。
3. 当前优先突出待确认写回和仍在推进的闭环任务。
</think>

## 今日任务总览
${buildTable(
  ['任务', '状态', '下一步', 'traceId'],
  sceneTasks.map((item) => [item.title, item.status, item.nextAction, item.traceId]),
)}

## 当前结论
- 仍在推进：${sceneTasks[0].title}
- 已沉淀分析：${sceneTasks[1].title}
- 已准备进入价值定位：${sceneTasks[2].title}

## 建议动作
1. 优先处理拜访后闭环中的待确认写回。
2. 带 traceId 去管理员后台排查异常或确认供给链路。
`,
    attachments: [],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: '任务中心已汇总闭环任务、分析任务与 trace 关系',
      references: sceneTasks.map((item) => item.traceId),
    },
  };
}

function buildHomeResponse(input: AssistantRequestInput) {
  const customer = recordPages.customers.records[0];
  const opportunity = recordPages.opportunities.records[0];

  return {
    content: `<think>
1. AI 销售工作台现在同时支持“快速闭环入口”和“销售主链路入口”。
2. 如果你手上有 mp3 或拜访纪要，优先走 /拜访后闭环。
3. 如果你只想单点分析某个客户或某次拜访，可以直接使用对应 slash 命令。
</think>

## 当前工作台理解
- 原始请求：${input.query}
- 当前租户：${tenantContext.tenantName}
- 快速闭环入口：/拜访后闭环 星海精工股份拜访.mp3

## 双入口工作台
${buildTable(
  ['入口类型', '推荐命令', '目标', '下一步'],
  [
    ['快速闭环入口', '/拜访后闭环 星海精工股份拜访.mp3', '从 mp3 出发补齐客户、商机和跟进', '自动串联会话理解与问题分析'],
    ['分步分析入口', '/客户分析 星海精工股份', '先看客户画像与关系人', '继续进入会话理解或价值定位'],
    ['分步分析入口', '/拜访会话理解 星海精工股份', '先读清楚这次拜访说了什么', '继续拆需求待办和问题陈述'],
    ['方案推进入口', '/方案匹配与专家协同 星海精工股份', '匹配内部方案、案例和专家资源', '形成下一轮推进支持包'],
  ],
)}

## 当前对象命中
${buildTable(
  ['对象', '命中记录', '当前状态', '建议动作'],
  [
    ['客户', customer.name, customer.status, '进入 /客户分析 或 /拜访后闭环'],
    ['商机', opportunity.name, opportunity.status, '继续沉淀问题陈述与价值定位'],
    ['任务', sceneTasks[0].title, sceneTasks[0].status, '带 traceId 去后台排查'],
  ],
)}
`,
    attachments: [
      {
        name: `${customer.name}-工作台入口建议.md`,
        url: '#workspace-entry',
        type: 'markdown',
      },
    ],
    extraInfo: {
      feedback: 'default' as const,
      sceneKey: input.sceneKey,
      headline: assistantScenes.chat.headline,
      references: ['/拜访后闭环', '/客户分析', '/拜访会话理解'],
    },
  };
}

function buildResponse(input: AssistantRequestInput) {
  switch (input.sceneKey) {
    case 'post-visit-loop':
      return buildPostVisitLoopResponse(input);
    case 'customer-analysis':
      return buildCustomerAnalysisResponse(input);
    case 'conversation-understanding':
      return buildConversationUnderstandingResponse(input);
    case 'needs-todo-analysis':
      return buildNeedsTodoResponse(input);
    case 'problem-statement':
      return buildProblemStatementResponse(input);
    case 'value-positioning':
      return buildValuePositioningResponse(input);
    case 'solution-expert-enablement':
      return buildSolutionExpertEnablementResponse(input);
    case 'tasks':
      return buildTasksResponse(input);
    default:
      return buildHomeResponse(input);
  }
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

export const historyMessages: Record<string, DefaultMessageInfo<AssistantChatMessage>[]> = {
  'conv-loop': [
    {
      message: {
        role: 'user',
        content: '/拜访后闭环 星海精工股份拜访.mp3',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildPostVisitLoopResponse({
          query: '/拜访后闭环 星海精工股份拜访.mp3',
          sceneKey: 'post-visit-loop',
          conversationKey: 'conv-loop',
        }),
      },
      status: 'success',
    },
  ],
  'conv-customer-analysis': [
    {
      message: {
        role: 'user',
        content: '/客户分析 星海精工股份',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildCustomerAnalysisResponse({
          query: '/客户分析 星海精工股份',
          sceneKey: 'customer-analysis',
          conversationKey: 'conv-customer-analysis',
        }),
      },
      status: 'success',
    },
  ],
  'conv-conversation-understanding': [
    {
      message: {
        role: 'user',
        content: '/拜访会话理解 星海精工股份',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildConversationUnderstandingResponse({
          query: '/拜访会话理解 星海精工股份',
          sceneKey: 'conversation-understanding',
          conversationKey: 'conv-conversation-understanding',
        }),
      },
      status: 'success',
    },
  ],
  'conv-needs-todo': [
    {
      message: {
        role: 'user',
        content: '/客户需求工作待办分析 星海精工股份',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildNeedsTodoResponse({
          query: '/客户需求工作待办分析 星海精工股份',
          sceneKey: 'needs-todo-analysis',
          conversationKey: 'conv-needs-todo',
        }),
      },
      status: 'success',
    },
  ],
  'conv-problem-statement': [
    {
      message: {
        role: 'user',
        content: '/问题陈述 远澜生物科技',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildProblemStatementResponse({
          query: '/问题陈述 远澜生物科技',
          sceneKey: 'problem-statement',
          conversationKey: 'conv-problem-statement',
        }),
      },
      status: 'success',
    },
  ],
  'conv-value-positioning': [
    {
      message: {
        role: 'user',
        content: '/客户价值定位 星海精工股份',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildValuePositioningResponse({
          query: '/客户价值定位 星海精工股份',
          sceneKey: 'value-positioning',
          conversationKey: 'conv-value-positioning',
        }),
      },
      status: 'success',
    },
  ],
  'conv-solution-expert-enablement': [
    {
      message: {
        role: 'user',
        content: '/方案匹配与专家协同 星海精工股份',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildSolutionExpertEnablementResponse({
          query: '/方案匹配与专家协同 星海精工股份',
          sceneKey: 'solution-expert-enablement',
          conversationKey: 'conv-solution-expert-enablement',
        }),
      },
      status: 'success',
    },
  ],
  'conv-tasks': [
    {
      message: {
        role: 'user',
        content: '帮我汇总今天的拜访后闭环和主链路任务。',
      },
      status: 'local',
    },
    {
      message: {
        role: 'assistant',
        ...buildTasksResponse({
          query: '帮我汇总今天的拜访后闭环和主链路任务。',
          sceneKey: 'tasks',
          conversationKey: 'conv-tasks',
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
