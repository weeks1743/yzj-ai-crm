# 0.2.6 版本说明

## 版本目标

按照奥坎剃刀原则精简 shadow skill 相关持久化设计，去掉“可由快照重建”的冗余表依赖：

- skill 契约不再单独落库，统一由当前快照实时生成并落地 bundle
- 字典绑定不再拆成“绑定表 + 元素表”双表设计，统一收敛到对象快照
- 运行时以“对象注册表 + 对象快照”作为最小必要数据结构

## 范围

- 重构 `admin-api` SQLite schema 与初始化逻辑
- 重构 `ShadowMetadataRepository` 的 snapshot 读写模型
- 重构 `ShadowMetadataService` 的 skill / dictionary 读取链路
- 更新文档与测试，确认客户影子 skill 仍可正常生成与调用

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- shadow runtime 不再依赖 `shadow_skill_contracts`、`shadow_dictionary_entries`
