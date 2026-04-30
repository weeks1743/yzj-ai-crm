# 0.7.6 集合查询范围词识别修复

## 问题

用户在已有客户上下文后输入 `查询所有客户`，结果没有像 `查询客户` 一样进入无过滤列表查询，而是继续受上一轮客户上下文影响。

根因是集合查询判定只覆盖了 `查询客户`、`查询客户列表` 这类“动词 + 对象”形态，没有把 `查询所有客户`、`查询全部客户`、`查询所有的客户` 中位于动词和对象之间的范围词稳定识别为集合查询。

## 修复

- 扩展通用对象识别语法：查询/查看/搜索等动词后允许出现 `所有/全部/全量/全体` 和可选 `的`，再匹配业务对象标签。
- 语义承接层先判断完整裸集合查询，再判断是否存在 `的...` 关系指代，避免 `查询所有的联系人` 被误判为关系查询。
- 保留显式条件查询能力：`查询所有安徽省客户` 仍应命中 `安徽` 过滤，不会被当成无条件列表。

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-runtime.test.ts tests/agent-semantic-reference-resolver.test.ts tests/agent-scenario-harness.test.ts`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，134/134。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
