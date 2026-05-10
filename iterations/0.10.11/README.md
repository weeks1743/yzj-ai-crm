# 0.10.11 彻底移除 70 秒运行中交互

## 版本目标

- `/公司研究`、`/拜访准备` 以及 Agent 主链路内外部技能不再返回 70 秒运行中占位。
- 公司研究长耗时任务必须等待 `ext.company_research_pm` 成功或失败后再给用户最终回复。
- 公司研究资料卡直接提供“生成报告 / 打开报告”，复用 `ext.report_generation` 报告生成链路。

## 范围

- `apps/admin-api`
  - 移除公司研究 `70_000ms -> running -> background backfill` 分支。
  - 公司研究和拜访准备复用通用 Skill Job 最终态等待逻辑。
  - 公司研究 Evidence 补充 `kind=company_research`，便于前端稳定识别资料动作。

- `apps/assistant-web`
  - 移除 Agent 消息头中“公司研究任务仍在运行”的运行中专用文案。
  - 公司研究关联资料卡新增报告入口，未生成显示“生成报告”，成功后显示“打开报告”。
  - 历史未带 `kind` 的公司研究资料卡按 `sourceToolCode` 兼容识别。

- `docs`
  - 更新项目公约和 Agent 治理文档，明确 0.10.11 起主对话链路不再把长耗时技能持久化为运行中占位回复。

## 验收结果

- [x] `/公司研究 <公司全称>` 在 Skill Job 先 `running` 后 `succeeded` 时，最终返回 `completed` 和公司研究资料卡。
- [x] 公司研究失败时返回 `tool_unavailable`，不生成降级资料。
- [x] 用户端公司研究资料卡显示报告动作，并调用 `/api/artifacts/:artifactId/report`。
- [x] 源码和测试中不再保留用户可见的 70 秒运行中占位文案。

## 验证

- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-service.test.ts tests/agent-runtime.test.ts tests/repair-visit-prep-stuck-runs.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web test -- evidence-card-utils.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] `pnpm --filter @yzj-ai-crm/admin-api test`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web test`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web build`：通过，保留既有 Vite 大 chunk 提示。

## 未完成项

- 如线上 Cloudflare 或反代仍限制长连接窗口，需要由部署层同步调大请求超时；本版本不再通过 70 秒运行中占位规避网关超时。
