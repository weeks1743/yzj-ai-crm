# 0.10.5 移除问题陈述外部技能

## Summary

- 移除问题陈述外部技能及其运行入口。
- 清理录音下游分析链路、外部技能目录、用户 AI 端入口、管理员后台展示和测试中的问题陈述引用。
- 保留需求待办、拜访会话理解、客户价值定位等现有能力，不再把问题陈述作为中间产物或下游输入。

## Scope

- `3rdSkill`：删除问题陈述 Skill 目录。
- `admin-api`：移除外部技能注册、录音下游允许列表、核心分析补跑和业务包候选资料引用。
- `assistant-web` / `admin-pro` / `shared`：移除问题陈述入口、页面展示和 mock 链路。
- `docs`：同步当前设计口径，删除现行流程中的问题陈述能力描述。

## Acceptance

- [x] 代码中不再注册或调用问题陈述外部技能。
- [x] 用户 AI 端不再展示 `/问题陈述` 或“生成问题陈述”入口。
- [x] 管理员后台不再展示问题陈述外部技能能力卡。
- [x] 录音下游分析不再自动补跑或允许触发问题陈述。

## Verification

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`

## Follow-up

- 若历史资料库中已存在问题陈述来源的资料资产，后续可单独做数据迁移或隐藏策略，本轮只移除新链路与当前产品引用。
