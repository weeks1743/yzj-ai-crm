# 0.4.7 Agent Framework MVP：IntentFrame -> TaskPlan

## 版本目标

- 在 `admin-api` 落地第一版 Agent Runtime。
- 用户 AI 工作台通过 `POST /api/agent/chat` 调用后端，不再由前端自行判断公司研究意图。
- 第一条真实闭环为“研究这家公司 / /客户分析”：DeepSeek 生成 IntentFrame，TaskPlan 选择公司研究工具，skill-runtime 执行 `company-research`，Markdown 继续沉淀为 Artifact 并生成证据卡。
- Agent run、message、tool call 落现有 SQLite，便于后续运行观测。

## 已实现

- 新增 Agent 类型：`IntentFrame`、`TaskPlan`、`TaskPlanStep`、`ExecutionState`、`AgentToolCall`。
- 新增 `DeepSeekChatClient` 与 `IntentFrameService`。
- 新增 `AgentService`：
  - `company_research`
  - `artifact_search`
  - `audio_not_supported`
  - `unknown_clarify`
- 新增 `AgentRunRepository`，写入：
  - `agent_runs`
  - `agent_messages`
  - `agent_tool_calls`
- 新增接口：`POST /api/agent/chat`。
- `assistant-web` provider 正常路径调用 Agent API，API 不可用时保留本地降级。
- Debug Drawer 可显示最新 Agent trace、IntentFrame、TaskPlan、ExecutionState、tool calls。
- `company-research` 依赖缺失或 skill-runtime 不可达时，Agent 会明确返回缺失原因，并生成 MVP 降级 Artifact，保证 IntentFrame -> TaskPlan -> Artifact -> Evidence Card 链路仍可验证。
- IntentFrame 归一化增加确定性修复：当 LLM 将“研究这家公司 XX”误判为 query 或漏掉 targets 时，后端会从原始 query / inputMaterials 抽取公司名，并修正为 `analyze company`；同时兼容“研究这家公司：XX”这类冒号分隔输入。
- 公司研究 Skill 等待窗口从 30 秒调整为 420 秒，避免真实联网搜索仍在运行时被过早判定为工具失败。
- 如果超过同步等待窗口但 skill-runtime job 仍处于 `queued/running`，Agent 返回 `ExecutionState.status=running`、保留 `currentStepKey=run-company-research`，并提示可稍后查看产物，而不是包装成“工具不可用”。
- skill-runtime 的 company-research 执行约束收紧为最多 2 次 web_search、最多 2 次 web_fetch_extract，且写出 Markdown Artifact 后立即收口。
- 用户 AI 端消息内容区改为 Ant Design X `Bubble + FileCard + Prompts` 组合：公司研究结果以正式 Markdown 卡片展示，证据卡以可点击 Prompts 卡片呈现，并支持从证据卡打开完整 Markdown Artifact Drawer。
- 针对 UI 回归截图继续收口：后端不再把“分析这家公司”混入公司名；公司研究摘要改为按“公司概览 / 业务定位 / 成长驱动 / 核心风险 / 销售切入”抽取要点，避免把完整 Markdown 表格压缩成一段；前端引用上下文将 Skill Job UUID 显示为短标签。
- 公司研究长耗时期间增加 Ant Design X `Think + ThoughtChain` 等待交互：展示可观测执行步骤和说明，不暴露模型内部隐式推理。
- 用户 AI 端会话消息增加 localStorage 持久化：刷新页面后按 conversationKey 恢复历史消息、证据卡和 Artifact 查看入口；如果刷新前公司研究仍在等待中，会恢复为“运行中任务”可观测记录，避免长任务中途刷新后会话消失。
- 用户 AI 端左侧 Ant Design X `Conversations` 创建按钮从“返回工作台”修正为“新会话”：点击后新增独立最近会话并切换到该会话，同时持久化自定义会话列表。
- 修复新会话创建后的状态串线：空白新会话不再读取或持久化上一会话消息，右侧恢复为 Welcome 空白态；首条提问后会话标题自动改为提问摘要。
- 公司研究 Markdown Artifact 增加 `生成 PPT` 能力：证据卡“查看完整 Markdown”旁边和 Markdown Drawer 顶部均可触发 `super-ppt`；后端按 `versionId` 记录生成状态，保证同一份 Markdown 只生成一个 PPT，生成中展示等待态，失败后允许重新生成。

## 运行链路

```text
UserInput
  -> /api/agent/chat
  -> DeepSeek IntentFrame
  -> TaskPlan
  -> ext.company_research_pm
  -> skill-runtime company-research
  -> Markdown Artifact
  -> MongoDB + Qdrant
  -> Evidence Card
  -> SQLite Agent Run
```

## 验收项

- “研究这家公司 东港投资发展集团有限公司”返回真实 `traceId`、IntentFrame、TaskPlan 和证据卡。
- 后续“这个客户最近有什么值得关注”基于同一会话焦点检索 Artifact。
- skill-runtime 不可用或依赖缺失时，返回明确降级说明，并沉淀可追踪 MVP Artifact，而不是前端静默使用旧 mock 或只显示泛化错误。
- 录音类请求生成 `audio_not_supported` 计划，不触发转写。
- 写主数据仍不执行，只保留 preview + confirm 的后续边界。

## 验证结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/skill-runtime exec node --import tsx --test --test-name-pattern "company-research" tests/http.test.ts`：通过。
- `pnpm --filter @yzj-ai-crm/skill-runtime build`：通过。
- `pnpm --filter @yzj-ai-crm/admin-pro build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- `pnpm build`：通过。
- 本轮 UI 收口后再次执行 `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- 截图回归收口后再次执行 `pnpm --filter @yzj-ai-crm/admin-api test`、`pnpm --filter @yzj-ai-crm/admin-api build`、`pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- 增加等待态、会话持久化和刷新中断恢复后再次执行 `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- 修正“新会话”创建行为后再次执行 `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- 修复新会话标题与旧消息串线后再次执行 `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- 新增 Artifact -> super-ppt 幂等生成链路后执行 `pnpm --filter @yzj-ai-crm/admin-api test`、`pnpm --filter @yzj-ai-crm/admin-api build`、`pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- `pnpm --filter @yzj-ai-crm/skill-runtime test`：当前未全量通过，两个历史 `pptx` 用例因测试目录未加载 `pptx` skill 返回 `404 !== 202`，与本轮 company-research 链路无关。

## 未完成项

- 未实现 SSE 流式步骤进度。
- 未实现完整 Plan 编辑器。
- 未实现写回确认执行。
- 未将 Agent 治理运行观测页改成读取真实 SQLite run 数据。
- 未实现对象级权限和跨应用授权。
