# 0.6.10 通用 Tool Semantic Arbitration

## 版本目标

- 将 0.6.9 的“公司信息先查客户再询问”升级为业务无关工具语义冲突仲裁。
- 主 Agent core/runtime 只表达通用工具语义、只读探测、结构化提问、`route_tool` 和 trace。
- CRM 包只声明 `subject_profile_lookup` 冲突组、工具语义元数据和业务词表。

## 关键改动

- 新增通用 `ToolSemanticArbitrator`，根据业务包声明的 `ToolArbitrationRule` 和工具 `semanticProfile` 输出直接工具或只读 probe 工具。
- `AgentToolDefinition` 增加 `semanticProfile`，`agentTrace` 增加 `toolArbitration`，用于记录 ruleCode、conflictGroup、候选工具、probe 结果和最终路由原因。
- CRM 包把 `record.customer.search/get`、`artifact.search`、`external.company_research` 注册到 `subject_profile_lookup`，不在主 Agent 内核写 CRM 分支。
- 0.6.9 的 `ambiguityProbe` 已迁移为通用 `toolArbitrationProbe` 控制信息。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test -- tests/agent-runtime.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 第一版仍采用 deterministic 规则匹配；embedding 语义匹配作为后续增强。
- 本轮不改记录系统 Skill 语义，不新增 `scene.*`。
