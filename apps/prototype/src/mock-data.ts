import type { ReactNode } from 'react';

export type ChatMessage = {
  key: string;
  role: 'assistant' | 'user';
  content: ReactNode;
  footer?: ReactNode;
};

export type TaskItem = {
  key: string;
  title: string;
  scene: string;
  status: '进行中' | '待确认' | '已完成' | '异常回退';
  nextAction: string;
  traceId: string;
  targetPath: string;
  entity: string;
};

export type StepItem = {
  title: string;
  status: 'wait' | 'process' | 'finish' | 'error';
  description: string;
};

export type AudioBranch = {
  key: string;
  title: string;
  summary: string;
  nextRequiredAction: string;
  context: string[];
  steps: StepItem[];
  result: string[];
};

export type RecordField = {
  label: string;
  fieldCode: string;
  type: string;
  aiAccess: string;
  required: string;
};

export type RecordDataset = {
  title: string;
  subtitle: string;
  templateId: string;
  codeId: string;
  sourceVersion: string;
  rows: Array<Record<string, string>>;
  fields: RecordField[];
};

export type SettingsItem = {
  name: string;
  key: string;
  description: string;
  value: string;
};

export type SettingsSection = {
  title: string;
  summary: string;
  designNotes: string[];
  items: SettingsItem[];
};

export const mainIntents = [
  '录入客户 / 联系人 / 商机 / 跟进记录',
  '查询客户 / 商机 / 历史跟进',
  '导入录音并生成跟进记录',
  '分析目标公司',
  '准备拜访材料',
];

export const conversations = [
  {
    key: 'conv-1',
    label: '华东大区晨会：拜访准备',
    group: '今天',
  },
  {
    key: 'conv-2',
    label: '博远集团：录音导入补录',
    group: '今天',
  },
  {
    key: 'conv-3',
    label: '联创医疗：公司分析',
    group: '本周',
  },
  {
    key: 'conv-4',
    label: '客户池巡检与跟进摘要',
    group: '本周',
  },
];

export const starterMessages: ChatMessage[] = [
  {
    key: 'm1',
    role: 'assistant',
    content:
      '我是 AI销售助手。你可以直接对我说“帮我录入一个客户”“把这段录音导入”“分析一下这家公司”或“帮我准备明天的拜访材料”。',
    footer: 'Main Agent 已加载：shadow.* / scene.* / ext.*',
  },
  {
    key: 'm2',
    role: 'assistant',
    content:
      '当前工作台优先围绕五类主意图设计：录入、查询、录音导入、公司分析、准备拜访材料。记录系统只负责主数据真值与确认后写回。',
    footer: '当前上下文：eid=EID-HZ-001 · appId=AICRM-01 · userId=sales.lead',
  },
];

export const promptItems = [
  {
    key: 'prompt-create',
    label: '补录客户与商机',
    description: '通过对话触发记录系统技能并走确认卡片',
  },
  {
    key: 'prompt-audio',
    label: '导入录音并生成跟进记录',
    description: '先补上下文，再创建跟进记录，最后异步分析',
  },
  {
    key: 'prompt-research',
    label: '分析一下博远集团',
    description: '按外部技能入口执行公司分析，不直接写主数据',
  },
  {
    key: 'prompt-visit',
    label: '帮我准备明天拜访材料',
    description: '组合影子系统主数据、研究快照和录音分析',
  },
];

export const tasks: TaskItem[] = [
  {
    key: 'task-1',
    title: '博远集团录音导入与拜访分析',
    scene: 'scene.audio_import',
    status: '进行中',
    nextAction: '待确认创建商机跟进记录',
    traceId: 'trc-audio-20260423-091',
    targetPath: '/assistant/audio-import',
    entity: '客户：博远集团 / 商机：HIS 替换',
  },
  {
    key: 'task-2',
    title: '华南生物拜访材料生成',
    scene: 'scene.visit_prepare',
    status: '已完成',
    nextAction: '可回看摘要并跳转相关主数据',
    traceId: 'trc-visit-20260423-047',
    targetPath: '/assistant/visit-prepare',
    entity: '客户：华南生物 / 商机：数字病区',
  },
  {
    key: 'task-3',
    title: '联创医疗公司分析',
    scene: 'ext.company_research_pm',
    status: '待确认',
    nextAction: '确认是否保存为轻量研究快照建议',
    traceId: 'trc-research-20260423-019',
    targetPath: '/assistant/company-research',
    entity: '公司：联创医疗',
  },
  {
    key: 'task-4',
    title: '联系人批量补录建议',
    scene: 'shadow.contact_create',
    status: '异常回退',
    nextAction: '模板缺少手机号必填项，已回退到人工补充',
    traceId: 'trc-shadow-20260423-011',
    targetPath: '/records/contacts',
    entity: '客户：博远集团',
  },
];

export const audioBranches: AudioBranch[] = [
  {
    key: 'branch-1',
    title: '无客户无商机',
    summary: '上传录音后先进入待补上下文状态，必须先创建客户、再创建商机、再创建商机跟进记录。',
    nextRequiredAction: 'create_customer',
    context: ['audioFile', 'visitDate', 'threadId'],
    steps: [
      {
        title: '创建文件资产与导入任务',
        status: 'finish',
        description: '已生成 audio_import_task 与 audio_asset，任务状态为 pending_context。',
      },
      {
        title: '确认客户实体',
        status: 'process',
        description: '从录音和线程上下文提取候选客户，等待人工确认客户名称与行业。',
      },
      {
        title: '创建商机',
        status: 'wait',
        description: '客户确认后创建商机，再把跟进记录挂接到商机上。',
      },
      {
        title: '创建商机跟进记录',
        status: 'wait',
        description: '只有绑定商机后，才允许正式创建跟进记录。',
      },
      {
        title: '异步启动录音分析',
        status: 'wait',
        description: '跟进记录创建成功后，再调用通义 Agent 执行转写与分析。',
      },
    ],
    result: [
      '任务状态：pending_customer_create',
      'followup_record_id：尚未生成',
      'analysis_status：not_started',
    ],
  },
  {
    key: 'branch-2',
    title: '有客户无商机',
    summary: '复用已有客户，默认建议创建商机，商机创建完成后再落跟进记录。',
    nextRequiredAction: 'create_opportunity',
    context: ['audioFile', 'customerId', 'visitDate'],
    steps: [
      {
        title: '复用现有客户',
        status: 'finish',
        description: '已命中唯一客户实体，自动带入归属人与租户上下文。',
      },
      {
        title: '建议创建商机',
        status: 'process',
        description: '当前客户下尚无可挂接商机，等待确认创建本次拜访对应商机。',
      },
      {
        title: '创建商机跟进记录',
        status: 'wait',
        description: '商机创建后立即落跟进记录，并回填 followup_record_id。',
      },
      {
        title: '通义录音分析',
        status: 'wait',
        description: '分析结果进入 AI 原生资产层，供后续问答与拜访准备复用。',
      },
    ],
    result: [
      '任务状态：pending_opportunity_create',
      'customer_id：cust_0091',
      'analysis_status：not_started',
    ],
  },
  {
    key: 'branch-3',
    title: '有客户有商机',
    summary: '优先绑定已有商机；若命中多个商机，必须人工选择，未选定前不能正式写回。',
    nextRequiredAction: 'select_opportunity',
    context: ['audioFile', 'customerId', 'opportunityCandidates[]'],
    steps: [
      {
        title: '识别客户与商机候选',
        status: 'finish',
        description: '已命中客户与 2 个可用商机，系统预填最近活跃商机作为建议项。',
      },
      {
        title: '确认商机',
        status: 'process',
        description: '存在多个商机，必须要求用户选择后才能继续。',
      },
      {
        title: '创建商机跟进记录',
        status: 'wait',
        description: '跟进记录创建后回填到 audio_asset 与后续分析资产。',
      },
      {
        title: '异步分析并生成联系人候选',
        status: 'wait',
        description: '分析完成后可继续进入联系人补充，但不影响 followup_record_id。',
      },
    ],
    result: [
      '任务状态：pending_followup_create',
      'opportunity_candidate：opp_3002 / opp_3007',
      'analysis_status：queued',
    ],
  },
];

export const visitPrepareCombos = [
  {
    key: 'base',
    name: '仅主数据',
    readiness: '基础可生成',
    summary:
      '当前仅从影子系统读取客户、联系人、商机和历史跟进，可输出基础版拜访摘要，但缺少外部背景与真实语音信号。',
    sources: [
      '客户：华南生物，华东大区重点客户',
      '联系人：CIO、信息科主任、采购专员',
      '商机：数字病区二期，阶段为方案澄清',
      '历史跟进：近 3 次跟进记录',
    ],
    outputs: {
      brief: '本次拜访重点围绕数字病区二期的预算释放与决策路径确认。',
      questions: ['确认预算释放时间点', '核对集成边界是否已冻结', '明确最终拍板人'],
      risks: ['缺少最新外部动态', '无法判断上次拜访承诺项是否有变化'],
      actions: ['生成简版沟通提纲', '建议补充公司分析或录音分析'],
    },
  },
  {
    key: 'research',
    name: '主数据 + 公司分析',
    readiness: '适合管理层拜访',
    summary:
      '增加外部研究快照后，可补充行业定位、近期动态和潜在切入点，更适合会前准备管理层信息。',
    sources: [
      '影子系统主数据',
      '研究快照：snapshot_research_20260422',
      '近期动态：新院区建设、预算审议、信息化招采窗口',
    ],
    outputs: {
      brief: '客户正处于信息化投资窗口期，拜访时应把项目价值和院内样板案例绑定讲清。',
      questions: ['新院区规划会如何影响项目节奏', '管理层更重视效率还是成本', '近期是否新增竞争厂商'],
      risks: ['缺少上次会谈中的异议与承诺', '联系人关系热度未知'],
      actions: ['会前补录录音分析', '重点准备行业 benchmark 页面'],
    },
  },
  {
    key: 'audio',
    name: '主数据 + 录音分析',
    readiness: '适合推进型拜访',
    summary:
      '加入录音分析后，可以准确消费上次承诺、异议、客户真实关注点，更适合推进商机阶段。',
    sources: [
      '影子系统主数据',
      '录音分析：followup_record_9021',
      '联系人记忆：CIO 关注集成排期，主任关注培训成本',
    ],
    outputs: {
      brief: '客户近期最关注的是 HIS 对接风险与培训成本，本次拜访应围绕实施排期和分期上线方案展开。',
      questions: ['上次承诺的接口清单是否已对齐', '培训成本是否可分阶段拆分', '谁来牵头内部协同资源'],
      risks: ['缺少外部研究快照，行业变化判断不足', '竞争对手动向仍不明确'],
      actions: ['补齐公司分析快照', '准备接口排期图和培训计划摘要'],
    },
  },
];

export const companyResearchSummary = {
  role: '外部技能入口',
  provider: 'ext.company_research_pm -> mock_provider',
  description:
    '当前 v1 中“公司分析”按外部技能接入，核心输入为 companyName。它为 AI销售助手 提供外部研究能力，但不直接承担场景级写回。',
  snapshots: [
    {
      key: 'snapshot-1',
      company: '联创医疗',
      freshness: '24 小时内',
      sourceCount: '8',
      status: '已生成轻量研究快照建议',
    },
    {
      key: 'snapshot-2',
      company: '华南生物',
      freshness: '3 天前',
      sourceCount: '11',
      status: '可被准备拜访材料复用',
    },
    {
      key: 'snapshot-3',
      company: '博远集团',
      freshness: '过期',
      sourceCount: '5',
      status: '建议增量刷新',
    },
  ],
};

export const recordDatasets: Record<string, RecordDataset> = {
  customers: {
    title: '客户',
    subtitle: '影子系统中的一级业务实体，是联系人、商机与跟进记录的锚点对象。',
    templateId: 'tmpl_customer_hz_v3',
    codeId: 'code_customer_001',
    sourceVersion: '2026-04-22T18:00:00+08:00',
    rows: [
      { key: '1', customerName: '华南生物', status: '重点推进', owner: '李娜', industry: '医药', latestFollowup: '2026-04-22' },
      { key: '2', customerName: '联创医疗', status: '研究中', owner: '陈杰', industry: '医疗信息化', latestFollowup: '2026-04-21' },
      { key: '3', customerName: '博远集团', status: '待澄清', owner: '赵越', industry: '制造', latestFollowup: '2026-04-23' },
    ],
    fields: [
      { label: '客户名称', fieldCode: 'customer_name', type: 'text', aiAccess: '可写', required: '必填' },
      { label: '客户状态', fieldCode: 'customer_status', type: 'enum', aiAccess: '确认后可写', required: '可选' },
      { label: '归属人', fieldCode: 'owner_user', type: 'user', aiAccess: '受限只读', required: '平台规则' },
      { label: '行业', fieldCode: 'industry', type: 'enum', aiAccess: '可写', required: '可选' },
    ],
  },
  contacts: {
    title: '联系人',
    subtitle: '从属于客户，但在 AI-CRM 中可扩展为画像与关系边实体。',
    templateId: 'tmpl_contact_hz_v2',
    codeId: 'code_contact_007',
    sourceVersion: '2026-04-22T18:05:00+08:00',
    rows: [
      { key: '1', contactName: '周岚', customer: '华南生物', title: 'CIO', phone: '138****1221', status: '已确认' },
      { key: '2', contactName: '刘捷', customer: '博远集团', title: '信息主管', phone: '待补充', status: '待人工编辑' },
      { key: '3', contactName: '林薇', customer: '联创医疗', title: '采购经理', phone: '139****9032', status: '已确认' },
    ],
    fields: [
      { label: '姓名', fieldCode: 'contact_name', type: 'text', aiAccess: '可写', required: '必填' },
      { label: '所属客户', fieldCode: 'customer_ref', type: 'relation', aiAccess: '确认后可写', required: '必填' },
      { label: '手机号', fieldCode: 'mobile', type: 'text', aiAccess: '可写', required: '模板必填' },
      { label: '职务', fieldCode: 'job_title', type: 'text', aiAccess: '可写', required: '可选' },
    ],
  },
  opportunities: {
    title: '商机',
    subtitle: '销售推进主线对象，也是录音导入和拜访准备的重要锚点。',
    templateId: 'tmpl_opportunity_hz_v4',
    codeId: 'code_opportunity_021',
    sourceVersion: '2026-04-22T18:10:00+08:00',
    rows: [
      { key: '1', opportunityName: '数字病区二期', customer: '华南生物', stage: '方案澄清', amount: '180 万', owner: '李娜' },
      { key: '2', opportunityName: 'HIS 替换', customer: '博远集团', stage: '待创建跟进', amount: '320 万', owner: '赵越' },
      { key: '3', opportunityName: '移动护理扩容', customer: '联创医疗', stage: '内部立项', amount: '90 万', owner: '陈杰' },
    ],
    fields: [
      { label: '商机标题', fieldCode: 'opportunity_title', type: 'text', aiAccess: '可写', required: '必填' },
      { label: '客户关联', fieldCode: 'customer_ref', type: 'relation', aiAccess: '确认后可写', required: '必填' },
      { label: '商机阶段', fieldCode: 'stage', type: 'enum', aiAccess: '确认后可写', required: '可选' },
      { label: '预算金额', fieldCode: 'budget_amount', type: 'number', aiAccess: '受限只读', required: '业务策略' },
    ],
  },
  followups: {
    title: '商机跟进记录',
    subtitle: '录音导入场景的标准回写目标，也是后续问答和拜访准备的重要信号源。',
    templateId: 'tmpl_followup_hz_v6',
    codeId: 'code_followup_102',
    sourceVersion: '2026-04-22T18:13:00+08:00',
    rows: [
      { key: '1', title: '华南生物 4 月院内复盘', opportunity: '数字病区二期', method: '到访', owner: '李娜', visitDate: '2026-04-22' },
      { key: '2', title: '博远集团录音补录', opportunity: 'HIS 替换', method: '录音导入', owner: '赵越', visitDate: '2026-04-23' },
      { key: '3', title: '联创医疗预算沟通', opportunity: '移动护理扩容', method: '电话', owner: '陈杰', visitDate: '2026-04-21' },
    ],
    fields: [
      { label: '跟进标题', fieldCode: 'followup_title', type: 'text', aiAccess: '可写', required: '必填' },
      { label: '商机关联', fieldCode: 'opportunity_ref', type: 'relation', aiAccess: '确认后可写', required: '必填' },
      { label: '跟进方式', fieldCode: 'followup_method', type: 'enum', aiAccess: '可写', required: '可选' },
      { label: '跟进内容', fieldCode: 'followup_content', type: 'long_text', aiAccess: '确认后可写', required: '必填' },
    ],
  },
};

export const settingsSections: Record<string, SettingsSection> = {
  'tenant-app': {
    title: '租户与应用识别',
    summary: '整套系统是否能租户隔离、对象归属、任务审计，都依赖 eid 与 appId 统一贯穿。',
    designNotes: ['所有配置、任务、文件路径、检索索引都必须继承 eid + appId。'],
    items: [
      { name: '租户标识', key: 'eid', description: '租户隔离主键', value: 'EID-HZ-001' },
      { name: '应用标识', key: 'appId', description: '应用实例隔离维度', value: 'AICRM-01' },
      { name: '租户名称', key: 'tenantName', description: '当前租户展示名称', value: '华东示范租户' },
      { name: '启用状态', key: 'enabled', description: '租户是否启用', value: 'true' },
    ],
  },
  'yzj-auth': {
    title: '云之家接入配置',
    summary: '用于获取 token、完成身份解析，并建立 AI销售助手 的真实用户上下文。',
    designNotes: ['认证链路属于基础设置层，不允许散落在业务页中。'],
    items: [
      { name: '服务地址', key: 'yzjServerBaseUrl', description: '云之家服务端 API 根地址', value: 'https://open.yunzhijia.com' },
      { name: 'OAuth Client ID', key: 'oauthClientId', description: '换取 token 的应用凭证', value: 'client_demo_hz' },
      { name: '重定向地址', key: 'oauthRedirectUri', description: 'OAuth 回调地址', value: 'https://crm.demo/auth/callback' },
      { name: '身份解析模式', key: 'identityResolveMode', description: '登录态解析策略', value: 'server_signed' },
    ],
  },
  'org-sync': {
    title: '组织同步配置',
    summary: '组织同步负责把组织、部门、成员映射到 AI销售助手 可用的身份体系。',
    designNotes: ['默认支持首次全量 + 后续增量，同步结果供负责人、权限与审计使用。'],
    items: [
      { name: '组织同步开关', key: 'orgSyncEnabled', description: '是否启用组织同步', value: 'true' },
      { name: '同步模式', key: 'orgSyncMode', description: '首次全量 + 增量', value: 'full_then_incremental' },
      { name: '同步频率', key: 'orgSyncCron', description: '定时同步表达式', value: '每日 02:00' },
      { name: '根部门 ID', key: 'orgRootDeptId', description: '同步根部门', value: 'dept_root_hz' },
    ],
  },
  'shadow-objects': {
    title: '影子系统配置',
    summary: '影子系统负责主数据真值与回写目标，对象与字段定义必须来自模板与 codeId。 ',
    designNotes: ['对象真值来源统一为模板接口与 codeId，不靠页面静态写死。'],
    items: [
      { name: '轻云应用 ID', key: 'lightCloudAppId', description: '轻云应用标识', value: 'light_app_0088' },
      { name: '空间 ID', key: 'lightCloudSpaceId', description: '轻云空间标识', value: 'space_hz_demo' },
      { name: '对象注册表', key: 'lightCloudObjectRegistry', description: '客户/联系人/商机/跟进记录对象注册', value: '4 个对象已启用' },
      { name: '技能刷新策略', key: 'lightCloudSkillRefreshPolicy', description: '模板变更后的动态技能刷新方式', value: 'metadata_versioned_refresh' },
    ],
  },
  models: {
    title: '模型与 AI 配置',
    summary: '用于控制大模型与向量模型 provider，同时约束 promptVersion 的治理方式。',
    designNotes: ['模型能力可租户化配置，但运行时允许回退到平台默认值。'],
    items: [
      { name: '主模型 Provider', key: 'llmProvider', description: '对话主模型供应商', value: 'platform_default' },
      { name: '主模型', key: 'llmModel', description: 'Main Agent 使用模型', value: 'gpt-5-class' },
      { name: '向量模型', key: 'embeddingModel', description: '研究快照与录音分析索引模型', value: 'text-embedding-large' },
      { name: 'Prompt 版本', key: 'promptVersion', description: '当前提示词版本', value: 'v0.0.1' },
    ],
  },
  audio: {
    title: '录音转写配置',
    summary: '录音导入是 v1 核心场景，因此转写、说话人分离和联系人候选都属于基础配置。',
    designNotes: ['录音链路必须先跑结构化主链路，再启动正式分析。'],
    items: [
      { name: '转写 Provider', key: 'transcriptionProvider', description: '录音分析供应商', value: 'tongyi_agent_provider' },
      { name: '说话人分离', key: 'speakerDiarizationEnabled', description: '是否启用说话人识别', value: 'true' },
      { name: '缓存开关', key: 'audioCacheEnabled', description: '相同音频内容去重缓存', value: 'true' },
      { name: '联系人候选能力', key: 'contactCandidateEnabled', description: '是否输出联系人候选', value: 'true' },
    ],
  },
  research: {
    title: '外部研究配置',
    summary: '公司分析当前按外部技能接入，用于为拜访准备和问答提供外部背景。',
    designNotes: ['公司分析是 ext.*，不是 v1 的主场景技能。'],
    items: [
      { name: '检索 Provider', key: 'researchSearchProvider', description: '外部检索能力', value: 'mock_provider' },
      { name: '抓取策略', key: 'researchFetchPolicy', description: '原始资料抓取策略', value: 'summary_first' },
      { name: '来源白名单', key: 'researchSourceWhitelist', description: '允许研究的来源范围', value: '新闻 / 官网 / 行业站点' },
      { name: '研究快照 TTL', key: 'researchSnapshotTTL', description: '研究结果默认有效期', value: '72h' },
    ],
  },
  storage: {
    title: '存储配置',
    summary: 'AI-CRM 只存 AI 原生资产，不复制影子系统主数据；当前推荐 PostgreSQL + pgvector 路线。',
    designNotes: ['录音分析、研究快照、任务状态与审计都要落在 AI-CRM 自身存储。'],
    items: [
      { name: '主数据库', key: 'primaryDbType', description: '主存储方案', value: 'PostgreSQL' },
      { name: '向量索引', key: 'vectorIndexType', description: '语义检索索引类型', value: 'pgvector' },
      { name: '对象存储', key: 'objectStorageProvider', description: '录音与研究文件存储', value: 'S3-compatible' },
      { name: 'Redis', key: 'redisEnabled', description: '任务与缓存加速', value: 'true' },
    ],
  },
  observability: {
    title: '可观测性配置',
    summary: '系统必须同时观测系统链路、AI 决策与业务结果，确保能回答“这次结果为什么是这样”。',
    designNotes: ['所有 trace、日志、审计、AI 观测都必须带 traceId / eid / appId / taskId。'],
    items: [
      { name: 'OTel 开关', key: 'otelEnabled', description: '是否启用 OpenTelemetry', value: 'true' },
      { name: 'OTel Endpoint', key: 'otelEndpoint', description: '链路追踪采集端点', value: 'https://otel.demo/collect' },
      { name: 'Langfuse 开关', key: 'langfuseEnabled', description: 'AI 观测能力开关', value: 'true' },
      { name: '采样率', key: 'traceSamplingRate', description: '追踪采样比例', value: '0.8' },
    ],
  },
  security: {
    title: '安全与运营配置',
    summary: '写回确认、危险技能策略、跨租户拦截和任务重试都是企业级可运营性的底线。',
    designNotes: ['外部技能不允许绕过确认直接写影子系统主数据。'],
    items: [
      { name: '写回确认策略', key: 'writeConfirmPolicy', description: '主数据写回确认方式', value: 'required_before_write' },
      { name: '危险技能策略', key: 'dangerousSkillPolicy', description: '高风险技能执行限制', value: 'disabled_for_v1' },
      { name: '跨租户拦截', key: 'crossTenantAccessPolicy', description: '租户越界访问策略', value: 'strict_deny' },
      { name: '任务重试策略', key: 'taskRetryPolicy', description: '后台任务失败重试策略', value: '3x exponential backoff' },
    ],
  },
};

export const objectRegistryRows = [
  {
    key: '1',
    object: 'customer',
    templateId: 'tmpl_customer_hz_v3',
    codeId: 'code_customer_001',
    status: 'ready',
    sourceVersion: 'v2026.04.22',
    aiStatus: '已开放 create / get / search / update',
  },
  {
    key: '2',
    object: 'contact',
    templateId: 'tmpl_contact_hz_v2',
    codeId: 'code_contact_007',
    status: 'ready',
    sourceVersion: 'v2026.04.22',
    aiStatus: '已开放 create / search / list_related',
  },
  {
    key: '3',
    object: 'opportunity',
    templateId: 'tmpl_opportunity_hz_v4',
    codeId: 'code_opportunity_021',
    status: 'ready',
    sourceVersion: 'v2026.04.22',
    aiStatus: '已开放 create / get / update',
  },
  {
    key: '4',
    object: 'followup_record',
    templateId: 'tmpl_followup_hz_v6',
    codeId: 'code_followup_102',
    status: 'ready',
    sourceVersion: 'v2026.04.22',
    aiStatus: '已开放 append_record / search',
  },
];

export const skillRegistryRows = [
  {
    key: '1',
    skill: 'shadow.customer_create',
    category: '记录系统技能',
    source: 'customer',
    confirmationPolicy: 'required_before_write',
    provider: 'lightcloud_instance_create',
    version: 'skill-v0.0.1',
  },
  {
    key: '2',
    skill: 'scene.audio_import',
    category: '场景技能',
    source: 'audio_import_task',
    confirmationPolicy: 'confirm_customer_and_opportunity_first',
    provider: 'tongyi_agent_provider',
    version: 'scene-v0.0.1',
  },
  {
    key: '3',
    skill: 'scene.visit_prepare',
    category: '场景技能',
    source: 'multi_source_context',
    confirmationPolicy: 'preview_only',
    provider: 'planner + retrieval',
    version: 'scene-v0.0.1',
  },
  {
    key: '4',
    skill: 'ext.company_research_pm',
    category: '外部技能',
    source: 'companyName',
    confirmationPolicy: 'no_main_data_write',
    provider: 'mock_provider',
    version: 'ext-v0.0.1',
  },
];

export const skillFieldRows = [
  {
    key: '1',
    field: 'customer_name',
    label: '客户名称',
    type: 'text',
    writable: '是',
    confirmation: '必须确认',
  },
  {
    key: '2',
    field: 'owner_user',
    label: '归属人',
    type: 'user',
    writable: '否',
    confirmation: '平台控制',
  },
  {
    key: '3',
    field: 'followup_content',
    label: '跟进内容',
    type: 'long_text',
    writable: '是',
    confirmation: '必须确认',
  },
  {
    key: '4',
    field: 'budget_amount',
    label: '预算金额',
    type: 'number',
    writable: '受限',
    confirmation: '业务规则',
  },
];

export const observabilityMetrics = [
  { label: '录音导入完成率', value: '84%', detail: 'scene.audio_import' },
  { label: '写回确认率', value: '91%', detail: 'required_before_write' },
  { label: '研究快照复用率', value: '67%', detail: 'visit_prepare / QA' },
  { label: '跨租户拦截次数', value: '3', detail: '最近 7 天' },
];

export const traceRows = [
  {
    key: '1',
    traceId: 'trc-audio-20260423-091',
    taskId: 'task_audio_0091',
    toolName: 'scene.audio_import',
    status: 'pending_followup_create',
    tenant: 'EID-HZ-001 / AICRM-01',
  },
  {
    key: '2',
    traceId: 'trc-visit-20260423-047',
    taskId: 'task_visit_0047',
    toolName: 'scene.visit_prepare',
    status: 'completed',
    tenant: 'EID-HZ-001 / AICRM-01',
  },
  {
    key: '3',
    traceId: 'trc-research-20260423-019',
    taskId: 'task_research_0019',
    toolName: 'ext.company_research_pm',
    status: 'snapshot_ready',
    tenant: 'EID-HZ-001 / AICRM-01',
  },
];

export const spanTimeline = [
  'Chat UI -> Main Agent：识别用户意图“导入录音并生成跟进记录”',
  'Main Agent -> Tool Registry：命中 scene.audio_import',
  'scene.audio_import -> 记录系统技能：补齐 customer/opportunity 上下文',
  'Deterministic Guards：写回前确认商机与跟进记录',
  'followup_record 创建成功后 -> tongyi_agent_provider：启动异步分析',
  'AI 原生资产落库 -> visit_prepare / QA 可复用',
];

export const writeBackAudit = [
  {
    key: '1',
    time: '2026-04-23 09:13',
    object: 'followup_record',
    action: 'append_record',
    result: 'success',
    detail: '已创建 followup_record_id=follow_9021',
  },
  {
    key: '2',
    time: '2026-04-23 09:14',
    object: 'contact',
    action: 'create',
    result: 'blocked',
    detail: '缺少 mobile 必填项，已回退人工补充',
  },
  {
    key: '3',
    time: '2026-04-23 09:15',
    object: 'customer',
    action: 'update',
    result: 'confirm_required',
    detail: '命中客户状态变更，需要人工确认后提交',
  },
];
