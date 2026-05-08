# 0.10.2 公司研究后台收口与运行洞察提速

## Summary

- 修复公司研究外部任务超出同步等待窗口后，后台补偿只保存资料、不回写 Agent 运行态的问题。
- 优化管理员后台“运行洞察”页面加载链路，避免确认审计慢查询阻塞 trace 详情首屏。
- 本轮仍归属云之家 SAAS 正式集成后的线上验证收口，不改变 0.10.0 的租户与双应用配置策略。

## Scope

- `admin-api`
  - 公司研究后台补偿完成后，回写 `agent_runs`、`agent_tool_calls`、证据引用与助手消息。
  - 长耗时公司研究在完成后可从运行观测看到 `completed`，不再长期停留在 `running`。
- `admin-pro`
  - 运行记录、trace 详情、确认审计拆分加载。
  - 从用户 AI 端带 `traceId` 打开后台时，优先展示目标运行与详情。

## Acceptance

- `trace-agent-b2a87713` 对应公司研究完成后，应显示为已完成并带公司研究资料证据。
- 打开 `https://admin.xiami66.com/` 的运行洞察路径时，不再因为确认审计接口较慢而长期转圈。
- 公司研究同步完成路径、复用资料路径、失败路径保持现有行为。

## Verification

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`

## Follow-up

- 后续可增加后台手动“刷新外部任务状态”操作，用于历史异常任务的一键修复。
- 后续可给运行观测确认审计增加按 trace/run 过滤与分页加载。
