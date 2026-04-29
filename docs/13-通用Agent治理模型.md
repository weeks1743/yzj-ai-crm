# 通用 Agent 治理模型

## 目标

本篇定义管理员后台“Agent 治理”的产品口径。

Agent 治理不是业务流程配置器，而是治理：

- 工具
- 对象
- 计划模板
- 策略
- 确认
- 运行观测

## 信息架构

```text
Agent 治理
  - 工具与对象
  - 计划模板
  - 策略与确认
  - 运行观测
```

## 工具与对象

展示 Tool Registry。

工具类型固定为：

- `record`
- `external`
- `meta`
- `artifact`

管理员可查看：

- 工具编码
- Provider
- 输入摘要
- 输出摘要
- 风险等级
- 确认策略
- 健康状态
- 负责人

## 计划模板

计划模板用于辅助 `TaskPlan` 生成。

它不是固定工作流，也不是技能。

管理员可查看：

- 适用意图
- 示例输入
- 推荐步骤
- 涉及工具
- 可跳过步骤
- 确认点
- 输出结果
- 治理说明

## 策略与确认

策略是确定性守卫。

典型策略包括：

- 写主数据必须确认
- 禁用工具降级
- 没有证据不得输出确定结论
- 跨租户引用阻断

外部工具失败时必须真实呈现失败状态。例如公司研究 Skill 因模型额度、依赖缺失或 skill-runtime 不可用而失败时，Agent 返回 `tool_unavailable`，保留失败 tool call 和策略决策，不生成降级 Artifact。

策略动作包括：

- block
- require_confirmation
- clarify
- downgrade_to_draft
- audit

## 运行观测

运行观测用于回答：

- 用户输入被识别成什么 IntentFrame
- 生成了什么 TaskPlan
- 当前 ExecutionState 是什么
- 实际调用了哪些工具
- 使用了哪些证据
- 结果为什么成功、失败、挂起或等待确认

0.4.7 起，用户 AI 工作台的正常路径会生成真实 Agent run。运行态先落 admin-api 现有 SQLite：

- `agent_runs`：保存用户输入、IntentFrame、TaskPlan、ExecutionState、证据引用和状态。
- `agent_messages`：保存用户消息和助手消息。
- `agent_tool_calls`：保存实际工具调用、状态、输入摘要、输出摘要和错误。
- `agent_confirmations`：保存写回预览、确认状态、确认输入和决策时间。

对于真实联网公司研究这类长耗时工具，`ExecutionState.status` 可以保持为 `running`：

- `currentStepKey` 指向仍在执行的计划步骤。
- 对应 `agent_tool_calls.status` 保持 `running`，不应被误写成 `tool_unavailable`。
- 前端应展示“任务仍在运行 / 可稍后查看产物”，而不是按失败处理。

后续“运行观测”页面应优先读取这些真实 run 数据，而不是只展示静态样例。

0.4.6 起，运行观测还需要能看到 Artifact 检索链路：

- 用户输入
- IntentFrame
- TaskPlan
- sourceToolCode
- artifactId / versionId
- Mongo 写入状态
- Qdrant collection 与 filter
- embedding 模型与向量状态
- evidence refs

## Artifact 治理

Artifact 是外部工具或 Agent 生成的非结构化资产，不是业务主数据。

管理员可查看或治理：

- Artifact 类型：公司研究、录音分析、网页快照、文档摘要等。
- 来源工具：例如 `ext.company_research`。
- 存储状态：MongoDB 是否写入成功。
- 向量状态：`pending_embedding`、`pending_config`、`indexed`、`embedding_failed`。
- 锚点：`customer`、`opportunity`、`contact`、`followup`、`company`、`source_file`。
- 租户隔离：所有检索必须带 `eid + appId`。
- 消费记录：哪些对话回答引用了哪些 Artifact chunk。

当前第一条真实工具链：

```text
IntentFrame(analyze/company)
  -> TaskPlan(tool_execution)
  -> external.company_research
  -> ext.company_research_pm
  -> skill-runtime company-research
  -> Markdown Artifact
  -> MongoDB + Qdrant
  -> Evidence Card
```

管理员不应配置“固定场景技能流程”。管理员治理的是工具、模板、策略、证据与可观测性，运行时由 `IntentFrame -> TaskPlan -> Tool Selection` 动态决定。

## 0.5.0 主 Agent 分层边界

0.5.0 起，治理模型默认以业务无关主 Agent 为核心：

- `agent-core` 只治理通用契约，不承载 CRM 对象类型。
- `agent-runtime` 使用 LangGraph / LangChain JS 管理状态图、checkpoint、interrupt、resume、trace 和审计写入。
- `tool-registry` 只允许 `record / external / meta / artifact` 工具编码，不允许注册 `scene.*`。
- `crm-agent-pack` 是第一个业务包，把客户、联系人、商机、跟进记录映射为 record 工具，把公司研究映射为 external 工具。
- `apps/admin-api` 是组合入口，不写 Agent 决策逻辑。
- `ContextFrame` 和 `ReferenceResolver` 负责业务无关的会话主体承接，只输出 `subject.kind/type/name`、来源 run 和证据引用，不承载 CRM 字段。
- record 工具通过 `subjectBinding`、`identityFields`、`duplicateCheckPolicy`、`previewInputPolicy` 暴露能力；主 Agent 根据这些元数据构造查询、预览和写前守卫输入。

管理员治理的是工具能力、计划模板、策略确认、证据和运行观测。CRM 只能作为业务工具包、slash 入口、验收场景和计划模板存在，不能成为主 Agent 内核边界。

写回治理的固定规则：

- 不注册 `delete` 写回工具。
- 创建和更新必须先 preview。
- preview ready 后持久化 confirmation 并进入 `waiting_confirmation`。
- 对配置了查重策略的创建操作，先 search；命中候选则进入 `waiting_selection`，不直接创建重复记录。
- approve 后恢复运行并执行真实写回。
- reject 后标记 cancelled，不写轻云。
- 缺少 `operatorOpenId` 时进入澄清或等待输入。

## 与系统设置的边界

系统设置只保留基础接入：

- 租户 / 应用
- 云之家接入
- 组织同步
- 企业 PPT 模板

以下内容归入 Agent 治理：

- 模型 / Provider / 存储健康
- 可观测性
- 安全与运营
- 写回确认
- 证据和审计策略

## 本篇结论

Agent 治理的职责是管边界、管工具、管策略、看运行，而不是配置业务流程。
