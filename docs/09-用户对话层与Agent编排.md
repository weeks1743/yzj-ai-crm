# 用户对话层与 Agent 编排

## 本篇回答什么问题

本篇回答以下问题：

- 用户自然语言如何落到可执行计划
- Main Agent、Tool Registry、Meta Tools、Policy Guard 分别负责什么
- 为什么不再把 `scene.*` 作为运行时技能类型
- `/计划`、普通 slash 技能入口和自然语言入口如何协同

## 0.5.0 核心链路

用户意图统一落到：

```text
UserInput -> IntentFrame -> TaskPlan -> Tool Selection -> ExecutionState
```

这条链路不绑定 CRM。CRM 只提供一组业务对象、工具和样例话术。

0.5.1 起，链路在 IntentFrame 后增加业务无关的上下文承接：

```text
UserInput -> IntentFrame -> ContextFrame / ReferenceResolver -> TaskPlan -> Tool Selection -> ExecutionState
```

`ContextFrame` 只描述当前会话主体，不承载 CRM 字段：`subject.kind`、`subject.type`、`subject.name`、`sourceRunId`、`evidenceRefs`。当用户说“这个”“该客户”“上面这个”时，`ReferenceResolver` 可用最近 run、IntentFrame 和 Evidence Card 补齐目标名称，并通过 `agentTrace.resolvedContext` 解释解析来源。

0.5.0 起，主 Agent 按业务无关分层落地：

- `agent-core`：只定义 `IntentFrame`、`TaskPlan`、`ExecutionState`、`ToolDefinition`、`PolicyDecision`、`ConfirmationRequest`、`EvidenceRef` 等通用契约，不出现客户、联系人、商机、跟进记录等业务类型。
- `agent-runtime`：基于 LangGraph / LangChain JS 编排状态图，负责解析意图、生成计划、选择工具、执行工具、策略守卫、挂起、确认、恢复和审计。
- `tool-registry`：只认识 `record / external / meta / artifact` 四类工具，通过 schema、riskLevel、confirmationPolicy、provider、displayCardType 暴露能力。
- `crm-agent-pack`：CRM 业务适配层，把轻云客户、联系人、商机、跟进记录注册为 record 工具，把公司研究注册为 external 工具，把 Artifact 检索注册为 artifact 工具。
- `apps/admin-api`：组合入口层，只负责注入 config、SQLite、ShadowMetadataService、ExternalSkillService、ArtifactService 和 Agent Runtime，不承载 Agent 决策逻辑。

### IntentFrame

负责表达：

- 用户目标
- 动作类型：query / analyze / write / plan / export
- 目标对象
- 输入材料
- 约束
- 缺失信息
- 置信度

### TaskPlan

负责表达：

- 推荐步骤
- 步骤依赖
- 可跳过步骤
- 需确认步骤
- 暂停点
- 输出卡片
- 证据要求

### Tool Selection

只从 Tool Registry 选择工具：

- `record`：结构化记录对象工具
- `external`：外部研究、分析、生成、导出工具
- `meta`：澄清、候选选择、计划生成、确认写回工具
- `artifact`：检索和消费已有非结构化证据资产

不再选择 `scene.*`。

## Artifact 消费链路

0.9.1 起，跨会话拜访需求类问题进入 `meta.context_summary` 的综合资料摘要；0.9.4 起，“拜访重点 / 沟通重点 / 客户关注点”等问法也归入同一拜访资料摘要链路：

- “贝斯美上次拜访客户主要提了什么需求”这类问题会被识别为 `visit_needs`，优先输出“客户主要需求”，不再套用泛化客户旅程模板，也不在正文重复证据来源和资料背景。
- “贝斯美 拜访重点有哪些”“最近沟通重点是什么”“客户主要关注点有哪些”等问法会直接进入 `meta.context_summary`，不再返回“目标对象或任务类型”澄清。
- 0.10.2 起，拜访需求/拜访重点/下次拜访建议不再只靠固定短语路由，而是在 CRM 业务包内做语义维度分析：识别拜访/沟通场景、客户诉求/关注点、下一步建议和经营判断，再映射到 `visit_needs`、`next_step` 或 `journey`。普通“查询客户”“客户情况”“公司研究后问风险”等仍保留原记录查询或 Artifact 检索路径。
- 摘要执行前会通过 `record.customer.get` 重新读取真实客户名称，避免会话上下文退化成内部 `formInstId` 后污染外部资料锚点。
- 外部信息检索拆分锚点：`company_research` 只使用公司全称和用户问句中的简称锚点；`recording_material` 与 `analysis_material` 同时使用正式客户锚点和公司锚点。
- AI 销售系统与记录系统使用不同 appId 时，Agent 运行态、Artifact 检索、录音任务和向量过滤统一归一到记录系统 `config.yzj.lightCloud.appId`。`config.yzj.appId` 只作为 AI 轻应用 SSO/ticket 凭证；若历史资料误落入 AI 轻应用 appId，只允许通过明确 legacy appId 做只读兼容或修复脚本迁移，不允许无锚点跨系统泛查。
- 拜访需求取材优先级为 `完整客户需求工作待办分析 > 拜访会话理解 > 拜访录音 > 跟进记录`，公司研究和客户价值定位只作为背景，不进入“客户主要需求”主清单。
- 命中 `客户需求工作待办分析` 后，会通过 `artifact.get` 回读完整 Markdown，并优先解析 `一、客户核心需求` 下的 `需求 N` 结构，保留标题、背景、目标、关注点等信息，避免向量只命中单个 chunk 时只回答局部需求。
- 需求摘要会扩大 `analysis_material` 候选并按下游分析技能做多样性选择，保留 `客户需求工作待办分析`、`拜访会话理解`、`客户价值定位` 等互补证据，避免同一技能的多个 chunk 挤掉关键材料。
- 需求条目优先抽取明确客户需求、痛点和问题信号，过滤“项目/场景背景”“待补充材料/证据”“建议下一步”“补充省市区”等分析模板或销售维护噪声；当资料片段不足时，可从完整分析 Markdown、系统内跟进记录等业务文本继续提炼，但不会把内部维护建议当作客户需求。
- 若完整 Artifact 读取失败，摘要会回退到已有 snippet 抽取逻辑，并在 trace 中保留 `artifact.get` 失败状态。
- 若尚未检索到正式分析资料但已有录音资料包，摘要会优先从录音资料包中含业务信号的片段提炼需求和重点；资料状态和证据来源保留在 trace / 下方资料卡，不进入用户正文。
- 对用户问句中的简称主语做确定性提取，例如从“贝斯美上次拜访客户主要提了什么需求”提取 `贝斯美`，与记录系统全称共同参与公司研究资料检索。

0.4.7 起，对话侧通过 `POST /api/agent/chat` 进入后端 Agent Runtime，而不是在前端 mock 中自行判断意图。第一条真实 MVP 闭环是公司分析 Artifact：

```text
UserInput
  -> IntentFrame(analyze / query)
  -> TaskPlan(tool_execution)
  -> artifact.company_research.lookup
  -> existing Markdown Artifact?
  -> external.company_research
  -> ext.company_research_pm
  -> Markdown Artifact
  -> MongoDB
  -> text-embedding-v4
  -> Qdrant
  -> Evidence Card
```

当用户输入 `/公司研究 星海精工股份` 或“研究星海精工股份公司”：

- Main Agent 优先调用 DeepSeek 生成 IntentFrame；模型不可用或 JSON 非法时，已知意图走确定性 fallback，并在 trace 标记。
- TaskPlan 选择公司研究外部工具，但执行前先查已有公司研究 Artifact。
- 如果同一家公司已有有效 Markdown，直接返回 Evidence Card，不调用外部 Skill。
- `ext.company_research_pm` 调用 skill-runtime 的 `company-research` Skill。
- Skill 输出 Markdown。
- Artifact Repository 写入 `artifacts` 与 `artifact_versions`。
- Embedding Service 使用阿里 `text-embedding-v4` 生成向量。
- Vector Service 写入 Qdrant `yzj_artifact_chunks`。
- 对话侧展示证据卡，而不是只返回一次性文本。

如果公司研究外部 Skill 失败，主 Agent 返回真实失败状态和原因，不生成降级 Artifact，也不返回伪造 Evidence Card。

当用户后续问“这个客户最近有什么值得关注”：

- Main Agent 识别为 `query artifact`。
- 检索必须带 `eid + appId`。
- 如能识别公司、客户、商机等对象，再叠加锚点过滤。
- 回答必须引用 Artifact 证据卡；无证据时提示先生成公司分析。

0.8.3 起，公司研究的产品口径收敛为“有效结果优先复用”：

- 已有有效公司研究时，聊天优先复用已有结果，不重新触发外部研究。
- 同一家公司默认维护一份可用研究资料，后续有效研究作为历史版本保留。
- 研究完成但没有形成有效资料时，只保留任务记录，不进入聊天可引用资料，也不要求管理员手动标记。
- 聊天组合消费时先读取记录系统事实，再补充公司研究资料，回答中必须区分“系统内资料”“公司研究”“建议判断”。
- 普通管理员配置只放在现有外部技能详情的“使用配置”Tab 里，和普通技能信息分开展示，使用业务语言表达，不暴露 Artifact、向量、锚点等技术概念。

0.8.4 起，AI 销售工作台 MVP 的可见入口进一步收敛：

- 工作台只展示 `/公司研究` 一个 slash 命令，其他录音拆解、需求待办、价值定位、方案匹配和任务入口暂不在用户端暴露。
- 左侧只保留工作台首页和真实用户会话，不再加载“我的任务”等固定示例会话。
- 测试路径固定为 `/公司研究 上海松井机械有限公司`。
- 普通用户回复统一使用“公司研究资料”“公司研究服务”等产品语言，不展示 Artifact、工具码、向量状态、chunks、preview 等技术元信息；这些信息仅允许出现在运行洞察或后端追踪里。
- 对话侧只保留一张“公司研究资料”卡，卡片内承接“查看完整研究”“生成图片”，不再额外展示 Markdown 附件块造成重复；PPT 不再作为普通用户侧概念暴露。
- 已有有效公司研究时直接复用，失败或无 Markdown 的运行结果只保留运行记录，不进入聊天可引用资料。
- `/公司研究` 入口只激活技能标签并等待用户输入公司全称；占位公司名不会触发已有资料查询、外部服务调用或资料保存。
- 公司研究服务完成后，主 Agent 会基于真实返回的 Markdown / finalText 做落库前判定：必须确认目标公司主体，并包含公司概览、业务定位、风险、来源等有效研究信息；未检索到有效公开资料或无法确认主体时，只保留运行记录和工具调用，不返回 Evidence Card。

0.8.5 起，AI 销售工作台新增个人 SOUL 设置：

- SOUL 定位为租户用户级销售上下文配置，用于表达“我是谁、我卖什么、站在什么销售立场看客户”，不是 Memory，也不是运行时场景技能。
- SOUL 按 `eid + operatorOpenId` 保存，记录 `appId` 作为应用实例维度；当前测试用户 `69e75eb5e4b0e65b61c014da` 在用户端展示为 `陈伟棠`。
- 本轮只完成 SOUL 的设置页、默认提示词、读取和保存，不把 SOUL 注入 `/公司研究` 执行链路，不新增销售速览或拜访问题清单生成。
- 后续若消费 SOUL，应作为工具输入上下文传入公司研究后的派生生成能力，不能把金蝶云之家销售语义写进 `agent-core` 或新增 `scene.soul` 运行时技能。

0.8.6 起，公司研究资料卡的“生成图片”会消费个人 SOUL：

- 生成图片仍然是公司研究后的派生动作，只调用图片生成外部能力，不重新触发公司研究，不改写公司研究 Artifact。
- 用户端把当前个人 SOUL 拼入图片生成 prompt，用于约束图片的销售视角、行业重点和价值主张。
- SOUL 只作为图片生成输入上下文，不进入 `agent-core`，不新增运行时技能，也不影响已有研究资料复用策略。

0.8.7 起，公司研究资料卡的“生成图片”取消消费个人 SOUL：

- 生成图片 prompt 恢复为只使用公司名、资料标题、研究摘要和固定画面要求。
- 个人 SOUL 设置、保存和左下角用户身份展示继续保留，但不再影响图片生成。
- 本轮不调整图片生成超时、存储、重试或 prompt 截断策略。

0.9.2 起，公司研究资料卡的“生成图片”改为完整资料输入：

- 前端资料卡只提交生成动作、尺寸和质量，不再使用卡片上的代表片段或向量命中 snippet 组装图片 prompt。
- 后端 Artifact 图片服务读取完整公司研究 Markdown，并基于完整正文构造图片生成 prompt，确保图片生成绑定完整 Artifact。
- 图片生成前会剔除研究日期、数据截至、研究目的、来源引用表和免责声明等非画面核心信息，并将 Markdown 正文控制在 3800 字以内。
- 图片 provider 请求超时调整为 150 秒，避免完整资料输入后在 60 秒窗口内过早失败。
- 资料卡图片预览按原图比例完整展示，不再使用固定比例 `cover` 裁切。

0.8.8 起，`/公司研究` 恢复为纯公司研究资料能力：

- 外层调用公司研究 Skill 时只要求输出公司概览、业务定位、成长驱动、核心风险和来源引用，不再要求生成“销售切入点”。
- 资料落库前的有效性判定不再把销售切入或切入点作为公司研究必要信号。
- 销售视角、拜访建议、切入点等内容应作为公司研究后的派生问答或后续销售速览能力处理，不写入公司研究 Skill 的基础执行要求。
- 公司研究后的追问不再依赖业务关键词白名单；主 Agent 仅基于“会话已有上下文资料 + 用户输入是问句 + 没有显式新任务/写入/记录查询/重新研究意图”路由到 `artifact.search`。

0.8.9 起，公司研究资料卡生成图片具备 MVP 持久化能力：

- 图片二进制保存到本地 `tmp/artifact-images/<eid>/<artifactId>/`，数据库只保存元数据索引和 prompt 追溯信息。
- `artifact_image_generations` 记录 `artifactId/versionId`、prompt、模型、provider、尺寸、质量、MIME、文件路径、生成时间和状态，不保存 base64 或二进制大对象。
- 用户端生成图片后展示服务端图片 URL；刷新后可通过 `GET /api/artifacts/:artifactId/image` 重新读取并展示已保存图片。
- 后续接对象存储时，将元数据中的本地文件路径替换或映射为对象存储 URL，不改变资料卡的消费模型。

0.8.10 起，会话消费统一采用业务无关的数据源口径：

- `外部信息` 表示系统外资料集合，当前包括公司研究资料，后续官网、新闻、行业报告、企业查询等来源也进入同一类。
- `系统内记录` 表示记录系统内的客户、联系人、商机、跟进等结构化数据。
- 主 Agent 使用通用 `dataSourceScope`：`auto | external_info | internal_records | combined`，不在 Agent core 中新增 CRM 场景分支，也不注册 `scene.*` 运行时技能。
- 公司研究后的 `介绍业务`、`有什么业务`、`公司信息`、`优势是什么` 等追问默认消费 `外部信息`，不再进入“目标对象或任务类型”澄清卡。
- `商机进展`、`联系人`、`跟进记录`、`客户状态` 等经营过程问题默认消费 `系统内记录`；用户可通过 `只看外部信息`、`只看系统内记录` 显式限定来源。
- 融合类问题按 `系统内记录`、`外部信息`、`判断建议` 三段输出；缺失某一类数据时明确说明缺失来源，不用另一类数据伪装替代。

0.8.11 起，外部信息检索支持简称匹配和数据库兜底：

- `artifact.search` 仍优先使用向量检索和精确 anchor 过滤；当向量无结果、embedding 未配置或 embedding 失败时，回退到 MongoDB Artifact 元数据匹配。
- 元数据匹配限定在同 `eid + appId` 内，匹配 `anchors.id`、`anchors.name`、`title` 和 `anchorIdentity`，例如 `江苏友升` 可命中 `江苏友升汽车科技有限公司 公司研究`。
- MongoDB 中已保存的 Artifact 是外部信息事实来源；Qdrant 无结果不等于外部信息不存在。
- 兜底 evidence 从当前版本 markdown 摘要片段生成，不重新触发 `/公司研究`。

0.8.12 起，系统内记录查询补齐客户简称读请求：

- `查询江苏友升`、`查看江苏友升` 这类读请求默认进入 `record.customer.search`，不再因为缺少“客户/公司”对象词进入澄清卡。
- `江苏友升客户情况`、`江苏友升客户状态`、`江苏友升客户处于什么状态` 会先清洗出客户主体 `江苏友升`，再作为客户名称过滤值查询系统内记录。
- 该逻辑位于 CRM 业务包，不进入 Agent core，也不影响 `/公司研究` 与 `外部信息` 检索。

0.8.13 起，记录结果的用户可见展示不暴露内部 ID：

- `formInstId` 只作为隐藏 `clientAction` 参数保留，用于点击“查看详情”后读取记录详情。
- 记录卡标题、读取完成文案和打开详情用户消息优先展示业务名称；若真实记录缺少展示字段，则单条结果使用用户查询中的对象名兜底。
- 前端对旧卡片或异常返回中的内部 ID 做二次过滤，不再把内部 ID 拼入用户可见文本。

0.8.14 起，记录列表展示恢复消费轻云摘要字段：

- 轻云列表查询可能只返回 `important` 摘要字段而不返回完整 `fieldContent`；记录结果展示需同时读取 `fields`、`important` 与 `rawRecord.important`。
- 客户列表的客户名称、客户状态、客户类型、地区、负责人等字段均从统一展示字段读取逻辑生成，避免列表退化为“客户记录 / 空状态 / 空地区”。
- 内部 ID 仍只保留在隐藏动作中，不作为标题或字段值展示给用户。

0.8.15 起，记录列表展示补齐轻云 live `widgetValue` 兜底：

- 轻云 `searchList` 在部分租户模板下会返回 `fieldContent: []` 与 `important: {}`，但真实字段值仍在 `formInstance.widgetValue`；适配层必须基于当前对象元数据快照把 `widgetValue` 合成为标准 `fields`。
- 枚举、开关、公共选项、人员选择等控件在合成字段时转成用户可读值；人员字段优先按组织员工表解析中文名，查不到时展示为 `已绑定人员`，不把 openId 暴露给用户。
- 该修复属于系统内记录工具结果标准化，不改变 Agent core，也不改写记录系统 Skill 的业务语义。

0.8.16 起，外部信息证据展示按资料聚合：

- `artifact.search` 可以返回同一份 Artifact 的多个命中片段；这些片段用于回答依据和引用数量，但用户端资料区不能把每个片段渲染成一张重复资料卡。
- 用户端按 `artifactId + versionId` 聚合公司研究资料卡，标题区同时显示资料份数和引用内容片段数。
- 查看完整研究、生成图片等派生动作继续绑定到聚合后的 Artifact，而不是绑定到单个 chunk。

0.8.17 起，公司研究资料卡图片生成补齐刷新后的状态收口：

- 用户端读取到 `queued` 图片状态后，会按 Artifact 轮询图片状态接口，直到恢复为成功预览或失败可重试。
- 图片状态接口会把超过图片 provider 超时窗口仍停留在 `queued` 的旧记录标记为失败，避免刷新、服务重启或网络中断后永久锁定“生成图片”按钮。
- 该收口仍基于公司研究 Artifact 的派生动作，不引入 `scene.*` 运行时技能，不重新触发公司研究，也不改写公司研究 Markdown 资料。

0.10.2 起，公司研究资料卡、录音资料卡与 PPT 用户侧边界采用更清晰的产品口径：

- 用户端公司研究资料卡只展示资料标题、派生动作和图片结果区，不展示版本、引用合并、摘要片段、artifactId、anchorId、chunkId、内部记录 ID 或向量分数等技术细节。
- 普通 Markdown 资料卡点击整卡可直接侧滑打开；图片生成成功后，点击资料卡内图片必须进入图片预览，图片组件自身提供下载按钮，图片区域和下载按钮不得冒泡触发 Markdown。
- PPT 生成因企业模板链路稳定性不足，0.10.2 起在普通用户侧屏蔽该概念；后端生成能力和后台模板记录保留给后续诊断与恢复。
- 只有录音资料包显示“打开录音分析”并跳转对应录音分析查看页；录音分析资料、公司研究资料等其他资料显示“查看完整研究”。录音资料包和录音分析资料都不提供生成图片或 PPT 派生动作。
- 录音分析查看页跳转前先进入用户侧过渡页，提示服务器准备查看页可能需要一点时间，避免慢加载时让用户误以为页面假死。
- 左侧会话使用官方 `Conversations` 菜单支持用户会话重命名；侧栏仅展示头像、姓名和设置入口，不展示角色/SOUL 调试文案，右上角不展示固定“公司研究入口”标签。

### Agent API

`POST /api/agent/chat` 输入：

- `conversationKey`
- `query`
- `sceneKey`
- `attachments`
- `tenantContext`
  - `operatorOpenId?: string`
- `resume?: { runId, action: 'confirm_writeback', decision: 'approve' | 'reject', confirmationId? }`

返回：

- assistant message
- `traceId`
- `IntentFrame`
- `TaskPlan`
- `ExecutionState`
- tool calls
- evidence cards
- `agentTrace.pendingConfirmation`
- `agentTrace.selectedTool`
- `agentTrace.policyDecisions`
- `agentTrace.resolvedContext`

### Agent Run Store

0.4.7 第一版运行态保存在 admin-api 现有 SQLite：

- `agent_runs`
- `agent_messages`
- `agent_tool_calls`
- `agent_confirmations`

这些数据服务于运行观测，不替代 MongoDB Artifact 主存，也不替代记录系统主数据。

写回记录系统时，运行时必须先调用 `record.<object>.preview_create` 或 `record.<object>.preview_update`，生成 `pendingConfirmation` 后进入 `waiting_confirmation`。用户 approve 后使用同一个 `runId` resume，恢复 LangGraph checkpoint 并调用 `record.<object>.commit_create/update`；用户 reject 后标记 cancelled，不写轻云。

0.10.2 起，更新记录的身份绑定在 `preview_update` 执行前做局部守卫：当用户说“更新客户 A，将字段改为 B”但当前没有记录上下文或 `formInstId` 时，运行时先按对象元数据和用户输入提取 A，并调用对应 `record.<object>.search` 定位记录。唯一命中才注入 `formInstId` 进入更新预览；多条命中进入 `waiting_selection`；未命中时要求用户换更完整名称或先查询。如果用户只补充客户名但没有给出可写字段，系统只保留已定位对象并展示 `update_field_picker` 更新字段选择卡，卡片使用目标可读名称、业务字段标签和元数据生成的问题列表，继续通过既有 `provide_input` 恢复机制提交，不新增业务 API。该卡片会优先读取当前记录详情填充 `currentValues` 和 `MetaQuestion.currentValue`，读取失败时回退搜索命中的记录摘要；枚举字段用真实 option key/value 预选，人员和基础资料字段只展示可读名或“已绑定人员 / 已关联记录”，不得暴露 `openId`、`formInstId` 等内部 ID。字段列表返回全部可提示写入字段并过滤内部、只读、系统和身份回显字段，前端按“常用字段 + 搜索 + 更多字段 + 已选择修改 + 当前展开编辑区”的卡内分步抽屉式交互呈现，提交时只发送用户已选择、非空且相对当前值已变更的字段。更新预览前会剥离等于目标名称的身份字段回显，并按字段语义区分手机号、办公电话、基础资料引用和负责人选择，避免把目标名或相邻字段误写入参数。取消补充/预览流程时保留 trace 的 `cancelled` 状态，但不再返回可渲染 `questionCard`，用户侧只显示普通取消回复。该守卫只在更新工具已被选中后生效；当前输入含明确客户名时优先按本轮输入重新定位，不复用上一轮“客户/联系人”等泛化上下文作为记录 ID，因此不改变录入、查询、Artifact 消费和综合资料摘要的工具路由。

字段选择卡的问题来源是工具白名单与轻云元数据可写字段的并集，因此像“备注”这类只存在于元数据、但未进入固定 `writableParams` 的字段也必须可搜索、可选择。字段展示顺序优先照顾用户负担：必填字段在前，其次是已有值字段，再按状态、阶段、类型、日期、电话、负责人、省市区、备注等语义排序；默认只展示首屏字段，“展开更多字段”每次增量展示 5 个，不一次性铺开所有字段。已选择修改区里的字段本身也作为编辑入口，点击或键盘激活都会切换当前展开编辑区，避免用户回到上方字段列表重复寻找。当前值只作为“当前”信息展示，不预填到文本、日期和远程搜索控件里，避免把已有值误当新值重复输入；枚举字段仍标记当前选项。日期字段使用 Ant Design `DatePicker`。省、市、区等 `publicOptBoxWidget` 公共选项字段不使用枚举按钮或一次性全量铺开，而是通过 `field_option` 远程搜索候选，卡片只在用户输入关键词后返回匹配项。

对配置了 `duplicateCheckPolicy` 的 record create，运行时必须先调用对应 search 工具做写前查重。0 条命中才继续 preview；存在候选记录时进入 `waiting_selection`，引用 `meta.candidate_selection`，不创建重复记录。

### ExecutionState

负责表达：

- draft
- running
- waiting_input
- waiting_selection
- waiting_confirmation
- paused
- completed
- failed
- cancelled

## Main Agent 边界

Main Agent 负责：

- 理解用户输入
- 生成 IntentFrame
- 生成或调整 TaskPlan
- 选择工具
- 解释步骤
- 收集澄清和确认
- 维护当前会话焦点

Main Agent 不负责：

- 绕过写回确认
- 自由调用未注册工具
- 编造没有证据的确定结论
- 把 CRM 场景硬编码成平台核心流程

## Tool Registry

Tool Registry 是运行时能力唯一来源。

工具契约至少包含：

- tool id / code
- tool type
- input schema
- output schema
- provider
- risk level
- confirmation policy
- timeout / retry policy
- evidence refs
- display card type

## Meta Tools

v1 固定保留：

- `meta.clarify_card`
- `meta.candidate_selection`
- `meta.plan_builder`
- `meta.confirm_writeback`

这些工具负责对话交互和计划控制，不承载具体业务场景。

## Policy Guard

确定性守卫负责兜底：

- 写操作确认
- 权限校验
- 字段白名单
- 跨租户引用拦截
- 证据要求
- 禁用能力降级
- 审计事件生成

## 对话入口

### 自然语言入口

用户可以直接说：

- “查一下这个客户”
- “这个客户现在卡在哪里”
- “这段录音先帮我整理下，客户信息能补就补”

系统先生成 IntentFrame，再决定是否需要 Plan。

### `/计划`

`/计划` 是复杂或不确定任务入口。

它表示：

- 先生成可裁剪计划
- 用户可跳过步骤
- 可暂停和继续
- 写入仍需确认

### 普通 slash 入口

如 `/客户分析`、`/客户价值定位`、`/方案匹配`。

它们是用户体验入口和 Plan 模板提示，不是运行时 `scene.*` 技能。
CRM 场景只能作为 slash 入口、计划模板、测试样例和业务工具包存在，不能回流成主 Agent 的核心分支。

## MVP 对录音的处理

`0.4.7` MVP 暂不做录音转写。

当用户只上传录音时：

- 系统可以保存附件资产元信息
- 返回“当前 MVP 不做转写，可补充文字纪要后继续整理”
- 不调用 `ext.audio_transcribe`

当用户提供文字纪要或已有跟进内容时：

- 可以调用外部会话理解工具
- 可以查询记录对象
- 可以生成补录预览
- 写入前必须确认

## 本篇结论

对话层的核心不是命中某个场景技能，而是：

1. 把用户输入结构化为 IntentFrame
2. 把意图转成可编辑 TaskPlan
3. 从 Tool Registry 动态选择工具
4. 用 Policy Guard 限制风险
5. 用 ExecutionState 支持中断、确认和恢复
