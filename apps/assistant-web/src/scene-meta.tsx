import React from 'react';
import type { AssistantScene } from '@shared/types';

export const assistantScenes: Record<AssistantScene['key'], AssistantScene> = {
  chat: {
    key: 'chat',
    route: '/chat',
    title: 'AI 销售工作台',
    subtitle: 'Plan 驱动工作台',
    headline: '先理解目标并生成建议 Plan，再由用户裁剪、确认和逐步推进。',
    description: '从这里描述销售目标、上传材料或选择场景入口。系统会调用真实 Agent API 编排任务，不再生成本地示例结果。',
    defaultInput: '描述你的销售目标，或输入 / 选择场景命令',
    prompts: [
      { key: 'p1', label: '上传拜访录音或纪要，生成处理 Plan', description: '让 Agent 识别材料、生成步骤，并在需要写回时等待确认。' },
      { key: 'p2', label: '输入客户或公司名称，开始客户分析', description: '调用真实客户分析与公司研究链路，返回可引用 Markdown 和证据。' },
      { key: 'p3', label: '围绕一次拜访提炼事实、承诺和风险', description: '进入会话理解场景，为后续需求待办和问题陈述提供输入。' },
      { key: 'p4', label: '把客户问题转成价值主张和方案输入', description: '串联问题陈述、价值定位和方案匹配。' },
    ],
    hotTopics: [
      { key: 'h1', title: '如何开始一个真实销售任务？', description: '描述目标、上传材料或使用 slash 命令，系统会走真实 Agent API。' },
      { key: 'h2', title: '客户分析需要什么输入？', description: '输入客户或公司名称，并补充你希望关注的关系人、商机或风险。' },
      { key: 'h3', title: '复杂任务为什么需要等待？', description: '公司研究、检索和 Markdown 生成会调用外部技能，完成后返回证据卡。' },
      { key: 'h4', title: '如何查看结果资产？', description: '真实 Artifact 返回后，可查看完整 Markdown，并按需生成 PPT。' },
    ],
    guides: [
      { key: 'g1', title: '真实 API', description: '所有助手回复都来自 /api/agent/chat；接口不可用时会显示错误态。' },
      { key: 'g2', title: '用户确认', description: '写入主数据仍保留 preview、确认和审计。' },
      { key: 'g3', title: '可观测', description: '真实 trace 返回后会展示 IntentFrame、Plan 和工具调用。' },
    ],
    taskCards: [],
  },
  'customer-analysis': {
    key: 'customer-analysis',
    route: '/chat/customer-analysis',
    title: '客户分析',
    subtitle: '聚合客户、联系人、商机和公司研究供给',
    headline: '客户分析入口会调用真实 Agent API，不提供本地示例卡片。',
    description: '输入客户或公司名称，系统会尝试读取客户上下文并调用公司研究等外部供给，输出可引用的客户分析结果。',
    defaultInput: '/客户分析 输入客户或公司名称',
    prompts: [
      { key: 'r1', label: '/客户分析 输入客户或公司名称', description: '生成客户画像、关系人和商机判断。' },
      { key: 'r2', label: '/客户分析 重点看关系人', description: '聚焦关键联系人和决策链。' },
      { key: 'r3', label: '/客户分析 重点看风险', description: '优先整理推进风险和待验证事项。' },
    ],
    hotTopics: [
      { key: 'rh1', title: '客户分析会消费哪些输入？', description: '客户、联系人、商机、历史跟进和公司研究供给。' },
      { key: 'rh2', title: '什么时候会生成 Markdown？', description: '当真实公司研究或 Artifact 生成成功时，会返回可查看的 Markdown 资产。' },
    ],
    guides: [
      { key: 'rg1', title: '主数据优先', description: '客户分析先对齐记录系统数据，再叠加外部研究。' },
      { key: 'rg2', title: '来源透明', description: '外部研究只做补强，所有引用都应带来源与 trace。' },
    ],
    taskCards: [],
  },
  'conversation-understanding': {
    key: 'conversation-understanding',
    route: '/chat/conversation-understanding',
    title: '拜访会话理解',
    subtitle: '把录音和纪要转成事实、承诺与风险',
    headline: '会话理解既能单独使用，也能被复合 Plan 动态加入。',
    description: '上传录音、转写或纪要，让 Agent 抽取关键事实、客户承诺事项和风险信号，供后续需求待办与问题陈述复用。',
    defaultInput: '/拜访会话理解 上传录音或粘贴纪要',
    prompts: [
      { key: 'v1', label: '/拜访会话理解 上传录音或粘贴纪要', description: '理解会话摘要、承诺事项和风险。' },
      { key: 'v2', label: '/拜访会话理解 重点看风险', description: '优先抽取阻塞推进的信号。' },
      { key: 'v3', label: '/拜访会话理解 重点看承诺事项', description: '整理客户侧和我方后续承诺。' },
    ],
    hotTopics: [
      { key: 'vh1', title: '会话理解要先做什么？', description: '先提供录音、转写或纪要，再补充客户和商机上下文。' },
      { key: 'vh2', title: '它和复合 Plan 的关系是什么？', description: '它可以作为录音处理 Plan 的分析节点，也可以被单独调用。' },
    ],
    guides: [
      { key: 'vg1', title: '先事实后判断', description: '先把客户说了什么讲清楚，再进入需求和问题拆解。' },
      { key: 'vg2', title: '输出可复用', description: '会话理解结果会被需求待办和问题陈述继续消费。' },
    ],
    taskCards: [],
  },
  'needs-todo-analysis': {
    key: 'needs-todo-analysis',
    route: '/chat/needs-todo-analysis',
    title: '客户需求工作待办分析',
    subtitle: '把需求和待办拆出来，推动从理解走向执行',
    headline: '需求待办分析是会话理解之后的执行中间层。',
    description: '基于会话理解或你粘贴的上下文，把客户需求、客户侧待办、我方待办和责任归属拆清楚。',
    defaultInput: '/客户需求工作待办分析 粘贴会话理解结果或需求上下文',
    prompts: [
      { key: 'n1', label: '/客户需求工作待办分析 粘贴需求上下文', description: '拆出需求、我方待办和客户侧待办。' },
      { key: 'n2', label: '/客户需求工作待办分析 重点看责任人', description: '优先确认谁来做什么。' },
      { key: 'n3', label: '/客户需求工作待办分析 重点看下一步', description: '生成后续推进动作。' },
    ],
    hotTopics: [
      { key: 'nh1', title: '需求待办分析的上游是什么？', description: '默认消费拜访会话理解结果，也可直接读取你提供的上下文。' },
      { key: 'nh2', title: '它会直接写任务吗？', description: '当前先生成分析结果，正式写回仍然要确认。' },
    ],
    guides: [
      { key: 'ng1', title: '先识别需求，再拆动作', description: '不要把客户问题和我方待办混在一起。' },
      { key: 'ng2', title: '责任归属明确', description: '客户侧和我方动作分别呈现，避免会后失焦。' },
    ],
    taskCards: [],
  },
  'problem-statement': {
    key: 'problem-statement',
    route: '/chat/problem-statement',
    title: '问题陈述',
    subtitle: '把需求、约束与影响范围整理成统一问题定义',
    headline: '问题陈述是从需求走向方案沟通前的关键整理节点。',
    description: '把需求待办、会话纪要或客户背景收敛为问题背景、约束条件、影响范围和优先级。',
    defaultInput: '/问题陈述 粘贴需求待办或客户背景',
    prompts: [
      { key: 'ps1', label: '/问题陈述 粘贴需求待办或客户背景', description: '形成统一问题定义。' },
      { key: 'ps2', label: '/问题陈述 重点看约束', description: '优先梳理预算、周期和系统约束。' },
      { key: 'ps3', label: '/问题陈述 重点看影响范围', description: '确认涉及的角色、流程和系统边界。' },
    ],
    hotTopics: [
      { key: 'ph1', title: '问题陈述和需求待办有什么区别？', description: '前者强调统一问题定义，后者强调执行动作。' },
      { key: 'ph2', title: '它适合什么阶段？', description: '适合需求澄清和客户价值定位前的口径统一。' },
    ],
    guides: [
      { key: 'pg1', title: '从动作回到问题', description: '先看客户到底想解决什么，再看我们怎么做。' },
      { key: 'pg2', title: '约束单独成块', description: '预算、周期、现有系统约束需要单独呈现。' },
    ],
    taskCards: [],
  },
  'value-positioning': {
    key: 'value-positioning',
    route: '/chat/value-positioning',
    title: '客户价值定位',
    subtitle: '把客户问题翻译成价值主张和推进话术',
    headline: '价值定位把分析结论转成可进入方案推进的表达。',
    description: '消费客户分析、问题陈述和商机上下文，把客户问题映射成价值表达、推进话术和方案推进输入建议。',
    defaultInput: '/客户价值定位 粘贴问题陈述或客户背景',
    prompts: [
      { key: 'vp1', label: '/客户价值定位 粘贴问题陈述或客户背景', description: '输出价值主张和推进话术。' },
      { key: 'vp2', label: '/客户价值定位 重点看 ROI', description: '优先形成 ROI 和交付相关表述。' },
      { key: 'vp3', label: '/客户价值定位 重点看推进话术', description: '生成面向客户沟通的表达。' },
    ],
    hotTopics: [
      { key: 'vh1', title: '价值定位需要哪些输入？', description: '客户问题、业务约束、商机阶段和已确认诉求。' },
      { key: 'vh2', title: '输出会用于哪里？', description: '可继续进入方案匹配，也可作为下一轮拜访开场材料。' },
    ],
    guides: [
      { key: 'vg1', title: '先对齐问题', description: '不要在问题未统一时直接输出方案。' },
      { key: 'vg2', title: '表达可复用', description: '价值主张应能进入方案材料、拜访纪要和内部评审。' },
    ],
    taskCards: [],
  },
  'solution-matching': {
    key: 'solution-matching',
    route: '/chat/solution-matching',
    title: '方案匹配',
    subtitle: '匹配内部方案、案例和推进建议',
    headline: '方案匹配承接问题陈述和价值定位，输出可讨论的方案路径。',
    description: '根据客户诉求、约束和价值主张，匹配内部方案、案例材料和下一步推进建议。',
    defaultInput: '/方案匹配 粘贴客户诉求和价值定位',
    prompts: [
      { key: 's1', label: '/方案匹配 粘贴客户诉求和价值定位', description: '匹配内部方案和可引用案例。' },
      { key: 's2', label: '/方案匹配 重点看案例', description: '优先查找可引用案例和相似项目。' },
      { key: 's3', label: '/方案匹配 重点看落地风险', description: '补充交付路径和风险控制建议。' },
    ],
    hotTopics: [
      { key: 'sh1', title: '方案匹配的上游是什么？', description: '客户诉求、问题陈述、价值定位和可用案例库。' },
      { key: 'sh2', title: '输出如何继续推进？', description: '可进入方案材料生成、内部评审或下一轮客户沟通。' },
    ],
    guides: [
      { key: 'sg1', title: '匹配不是拍脑袋', description: '优先使用真实上下文和可引用案例。' },
      { key: 'sg2', title: '方案要能落地', description: '输出应包含推进动作、风险和下一步材料建议。' },
    ],
    taskCards: [],
  },
  tasks: {
    key: 'tasks',
    route: '/chat/tasks',
    title: '我的任务',
    subtitle: '查看真实任务、资产、trace 和待确认写回',
    headline: '任务中心保留入口，但本轮不再展示本地示例任务。',
    description: '这里将承接真实 Agent run、Artifact 和待确认写回。当前没有真实数据时会展示空态，不会加载示例任务。',
    defaultInput: '/我的任务',
    prompts: [
      { key: 't1', label: '/我的任务', description: '查看真实任务与资产状态。' },
      { key: 't2', label: '查看当前会话 trace', description: '打开调试区查看真实 Agent trace。' },
      { key: 't3', label: '查看待确认写回', description: '后续接入真实写回预览后展示。' },
    ],
    hotTopics: [
      { key: 'th1', title: '当前有真实任务数据吗？', description: '有真实 Agent run 后会展示；无数据时保持空态。' },
      { key: 'th2', title: 'Trace 在哪里看？', description: '点击右上角调试区，查看当前会话最新真实 trace。' },
    ],
    guides: [
      { key: 'tg1', title: '不展示示例数据', description: '任务、资产和 trace 均只展示真实接口返回。' },
      { key: 'tg2', title: '后续接入', description: '后续可接入真实任务列表、Agent run 列表和写回确认。' },
    ],
    taskCards: [],
  },
};

export const sceneOrder = [
  assistantScenes.chat,
  assistantScenes['customer-analysis'],
  assistantScenes['conversation-understanding'],
  assistantScenes['needs-todo-analysis'],
  assistantScenes['problem-statement'],
  assistantScenes['value-positioning'],
  assistantScenes['solution-matching'],
  assistantScenes.tasks,
];

export function getSceneByPath(pathname: string) {
  return sceneOrder.find((scene) => scene.route === pathname) ?? assistantScenes.chat;
}

export function buildPromptGroups(scene = assistantScenes.chat) {
  const isHome = scene.key === 'chat';
  return {
    hotTopics: [
      {
        key: `${scene.key}-hot`,
        label: isHome ? '能力入口' : '使用说明',
        children: scene.hotTopics.map((item, index) => ({
          key: item.key,
          description: item.title,
          icon: (
            <span
              style={{
                color: index < 3 ? '#1677ff' : '#94a3b8',
                fontWeight: 700,
              }}
            >
              {index + 1}
            </span>
          ),
        })),
      },
    ],
    guides: [
      {
        key: `${scene.key}-guide`,
        label: isHome ? '工作台原则' : '场景指南',
        children: scene.guides.map((item) => ({
          key: item.key,
          label: item.title,
          description: item.description,
        })),
      },
    ],
  };
}
