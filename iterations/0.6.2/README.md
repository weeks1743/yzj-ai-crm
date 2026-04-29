# 0.6.2 连续任务记忆 + Agent Scenario Harness

## 版本目标

- 用 LangGraph 原生 checkpoint / interrupt / resume 补齐 `waiting_input`、`waiting_selection`、`waiting_confirmation` 的连续对话能力。
- 将 `thread_id` 收敛为稳定 `conversationKey`，`runId` 保持为每次请求的审计 ID。
- 引入表驱动 Agent Scenario Harness，一次性批量执行 20 个多轮场景，减少人工逐条测试。
- Harness 只作为测试层，不新增 `scene.*`，不成为新的 Agent 框架。

## 实施范围

- `agent-core` 新增业务无关 `PendingInteraction` 与 `ContinuationResolution`。
- `agent-runtime` 使用同一 LangGraph thread 承接等待态，并在普通下一轮输入时自动尝试 resume。
- 新增 `ContinuationResolver`，只通过 Tool Registry 元数据合并补充输入或判断明确切换任务。
- `crm-agent-pack` 仅补充通用等待态信息，不改变记录系统 Skill 语义。
- `assistant-web` Trace 调试区展示等待态与承接解析。
- 新增 `apps/admin-api/tests/agent-scenario-harness.test.ts`，用同一个 runner 批量覆盖 20 个场景。
- 追加 20 个更复杂的金蝶苏州销售视角场景，覆盖多公司上下文、等待态切换任务、缺身份恢复、候选更新确认、联系人 / 商机 / 跟进写入等链路。
- 复杂场景发现并修复两处通用问题：长句短指代 target name 未被上下文覆盖；缺 `operatorOpenId` 时 pending interaction 错绑查重工具而非原写入预览工具。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，含基础 20 个 Harness 场景与复杂 20 个销售场景。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。

## 未完成项与下一步

- 本轮不做浏览器端 E2E，不新增多 Agent，不引入开放 DAG。
- 候选选择的 UI 仍可继续增强为结构化候选卡；本轮先保证 runtime 能恢复并进入 update / create preview。
- CRM 字段别名仍留在业务包工具元数据与 Harness 场景数据中，未进入 Agent core/runtime。
