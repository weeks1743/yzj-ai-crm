# 0.10.22 多意图运行洞察与诊断流程图优化

## 目标

- 将用户端运行洞察和后台运行观测从“最后一个 Agent Trace”升级为“会话级多意图诊断”。
- 面向新手展示白话问题定位，帮助快速判断问题卡在意图、上下文、工具、输入、策略还是最终状态。
- 本轮只优化观测与展示，不修改 Agent 决策、上下文承接、工具选择、写回或 Skill 语义。

## 范围

- `apps/admin-api`
- `apps/assistant-web`
- `apps/admin-pro`
- `packages/shared`

## 关键实现

- `GET /api/agent/conversations/:conversationKey/process` 新增 `diagnostics` 投影，按会话顺序返回每个意图处理单元的诊断步骤、问题摘要、工具调用和确认审计。
- 用户 AI 端运行洞察默认展示“问题定位”，打开时读取会话完整过程；失败时回退当前消息的本地 Trace。
- 用户 AI 端诊断流程图展示同会话所有意图，不再只展示最后一个意图。
- 管理后台运行观测详情首屏切换为“会话诊断”，支持查看同一会话前后意图链路；完整过程表格继续保留。

## 验收结果

- 已通过：
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-observability-service.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web test -- RunInsightDrawer.diagnostics.test.ts`
- `assistant-web build` 仅出现 Vite chunk size warning，无构建失败。
- `admin-pro build` 仅出现 Umi 本地存储路径 warning，无构建失败。

## 未完成项

- 不处理截图中暴露的具体业务问题，后续另行按 trace 复盘和修复。
- 暂不引入 LLM 自动诊断，问题定位只使用确定性运行信号。
