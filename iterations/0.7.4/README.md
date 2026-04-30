# 0.7.4 集合查询上下文隔离与调试可视化修复

## 版本目标

- 修复 `trace-agent-2ed9c7bf` 暴露的集合查询误承接问题：`查询联系人`、`查询客户`、`查询商机`、`查询拜访记录` 不应自动绑定上一轮具体记录。
- 保持主 Agent 核心业务无关，通过工具元数据、通用语义解析和业务包搜索入参构建协同解决，不新增 `scene.*`。
- 调试区需要直观看到上下文使用状态、跳过原因和搜索过滤来源。

## 关键改动

- `agent-semantic-reference-resolver` 增加集合查询跳过承接机制：对象级列表查询只记录候选，不把历史候选提升为 `resolvedContext.subject`。
- `crm-agent-pack` 在 `RecordToolCapability` 元数据中声明对象标签，避免把对象标签当成实体名；裸集合查询不再用当前记录名或 ID 作为搜索 fallback。
- 记录查询输入增加 `agentControl.searchExtraction.filterSources`，标明过滤来自用户显式条件、关系上下文绑定或名称 fallback。
- `RunInsightDrawer` 的诊断流程图区分“已使用上下文”“未使用上下文：集合查询”“仅记录候选”，工具输入区展示过滤来源。
- 二次根治 `trace-agent-279a3af1`：当 LLM 在裸集合查询里输出未出现在用户原文中的旧 ID/旧记录名时，写入 `agentControl.targetSanitization` 并忽略该 target。
- 记录搜索的记忆写入改为唯一命中才沉淀 record context；空结果、多结果集合查询不再把旧上下文复制成最新 run。
- 测试方案重审后补强“LLM 异常输出 + 最终工具入参 + 记忆持久化 + 调试展示”链路，不再只断言工具路由和运行状态。
- 显式名称查询优先信任用户原文：例如 `查询安徽的客户` 遇到旧 LLM target 时保留用户条件，忽略未落地 target。

## 验收场景

- 打开联系人 `李玲玲` 后输入 `查询联系人`，应执行 `record.contact.search`，但不带联系人 ID/name 过滤。
- 打开客户、商机、拜访记录后输入对应集合查询，不应回查旧记录。
- `查询这个客户的联系人` 仍按当前客户生成关系过滤。
- `更新这个联系人手机号...` 仍绑定当前联系人更新。
- 联系人上下文后输入 `查询安徽的客户`，应作为客户名称查询，不受联系人上下文污染。
- `查询客户` 即使 LLM target 被污染成旧联系人 ID，也应执行无过滤列表查询，并在调试区显示已忽略未落地 target。
- `查询客户`、`查询联系人`、`查询商机`、`查询拜访记录` 遇到旧 ID 或旧记录名 target 时，最终 `filters` 不包含旧值，当前 run 不生成新上下文候选。
- 空结果、多结果搜索的当前 run `contextSubject` 为空；唯一命中搜索仍正常沉淀 record context。
- 调试区函数级验收覆盖“未使用上下文：集合查询”“已忽略未落在用户输入中的 LLM target”“过滤来源：无/用户显式条件/关系上下文绑定/名称 fallback”。

## 验证结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`（132/132）
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web exec tsx --test src/RunInsightDrawer.diagnostics.test.ts`（3/3；Node 环境提示 Ant Design X Notification API warning，不影响断言）
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- live 测试不作为本轮必跑项；如需真实接口巡检，再执行 `pnpm --filter @yzj-ai-crm/admin-api test:live-agent-sales`。
