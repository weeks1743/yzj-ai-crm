# 0.5.1 业务无关上下文承接与记录写入修复

## 版本目标

- 修复公司研究后无法承接“录入这个客户”等短指代写入的问题。
- 保持主 Agent 内核业务无关，不把 CRM 场景写入 `agent-core` 或 `agent-runtime`。
- 不修改已有记录系统 Skill；只在主 Agent 运行层补齐上下文、工具元数据、写前守卫和可观测提示。

## 范围

- 新增通用 `ContextFrame` 与 `ReferenceResolver`，从同一会话最近 run、IntentFrame 和 Evidence Card 中恢复当前主体。
- `agentTrace` 增加 `resolvedContext`，用于解释本轮是否使用了上下文承接。
- record 工具增加通用能力元数据：`subjectBinding`、`identityFields`、`duplicateCheckPolicy`、`previewInputPolicy`。
- CRM 业务包只负责把 4 个记录对象映射到通用 record 元数据。
- record create 支持写前查重：有候选记录则进入 `waiting_selection`，不创建重复记录；无候选再进入 preview + confirmation。
- preview 未就绪时展示 `blockedReadonlyParams`，避免“缺少项都是无但仍未就绪”的误导。
- 用户 AI 端消息标题优先使用当前 message 的 `extraInfo`，避免成功响应沿用旧错误标题。

## 关键能力

- “研究某家公司”完成后，同一会话输入“录入这个客户”可解析到上一轮公司主体。
- `record.customer.preview_create` 根据工具元数据只写 `customer_name`，不向记录系统 Skill 传入 `_S_TITLE` 等只读系统字段。
- `record.customer.preview_create` 前先调用 `record.customer.search` 做重复记录检查。
- 所有写回仍必须 preview + 用户确认，不直接写轻云。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`，71 个 admin-api 测试全部通过。
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`。

## 未完成项

- `waiting_selection` 暂以文本候选说明返回，后续可接入正式候选选择卡。
- 当前只对配置了 `duplicateCheckPolicy` 的 record create 启用写前查重；更多对象可通过业务包元数据扩展。

## 下一步计划

- 在治理页展示 Tool Registry record 元数据和 `resolvedContext`。
- 在用户 AI 端增加正式候选选择卡和写回确认卡。
