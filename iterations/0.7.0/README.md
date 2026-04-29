# 0.7.0 用户运行洞察与后台智能体观测闭环

## 版本目标

- 将用户 AI 端“调试区”升级为面向业务用户可读的“运行洞察”。
- 补齐后台智能体运行观测与确认审计的真实只读接口和 Pro 页面。
- 建立用户端追踪与后台排查之间的正式跳转闭环。

## 范围说明

- 用户 AI 端继续基于 `@ant-design/x` 独立工作台范式。
- 管理员后台继续基于 `@umijs/max + @ant-design/pro-components`。
- 智能体编排继续沿用现有 LangGraph 主框架。
- 本轮不改主智能体业务无关原则，不新增 `scene.*` 运行时技能，不触碰 `apps/prototype`。

## 关键页面或能力

- 用户 AI 端运行洞察：
  - 计划、执行状态、工具调用、证据、确认/等待态和策略说明。
  - 原始追踪数据收敛到二级页签。
  - 支持按追踪编号跳转后台运行观测页。
- 后台智能体运行观测：
  - `GET /api/agent/runs`
  - `GET /api/agent/runs/:runId`
  - `GET /api/agent/confirmations`
  - `Agent 治理 > 运行观测` 接入真实运行记录。
  - `Dashboard > 运行监控` 复用真实运行记录。

## 依赖框架

- `@ant-design/x`
- `@ant-design/x-sdk`
- `@ant-design/x-markdown`
- `@umijs/max`
- `@ant-design/pro-components`
- LangGraph / LangChain JS
- SQLite

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`

## 未完成项与下一步计划

- 工具治理配置可编辑化留到后续迭代。
- 计划模板可编辑化留到后续迭代。
- 告警中心和依赖健康治理留到后续迭代。
