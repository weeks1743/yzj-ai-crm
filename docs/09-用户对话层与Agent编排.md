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

0.4.7 起，对话侧通过 `POST /api/agent/chat` 进入后端 Agent Runtime，而不是在前端 mock 中自行判断意图。第一条真实 MVP 闭环是公司分析 Artifact：

```text
UserInput
  -> IntentFrame(analyze / query)
  -> TaskPlan(tool_execution)
  -> external.company_research
  -> ext.company_research_pm
  -> Markdown Artifact
  -> MongoDB
  -> text-embedding-v4
  -> Qdrant
  -> Evidence Card
```

当用户输入 `/客户分析 星海精工股份` 或“研究星海精工股份公司”：

- Main Agent 优先调用 DeepSeek 生成 IntentFrame；模型不可用或 JSON 非法时，已知意图走确定性 fallback，并在 trace 标记。
- TaskPlan 选择公司研究外部工具。
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

如 `/客户分析`、`/问题陈述`、`/方案匹配`。

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
