# 0.4.4 场景技能 Plan Playbook 原型重构

## 版本目标

- 将后台“场景技能”从固定工作流表达调整为 `Plan Playbook` 治理视图。
- 在用户 AI 端体现“先生成建议 Plan，再由用户裁剪、确认、暂停或继续”的交互思路。
- 保持本轮为静态产品原型，不新增真实 Plan API、数据库表或运行态 Agent 编排服务。

## 范围

- 管理员后台：
  - 场景技能列表页改为展示推荐 Plan 模式、可选步骤、守卫规则和依赖健康。
  - 场景技能详情页改为 `Playbook 总览 / Plan 变体 / 技能供给 / 守卫与确认`。
  - 删除 `拜访后闭环` 作为独立场景技能入口，保留其作为复合 Plan 模板能力。
  - 将方案推进场景收敛为普通技能 `方案匹配`，只保留方案与案例匹配能力。
- 用户 AI 端：
  - 首页改为 Plan 驱动文案，不再提供 `/chat/post-visit-loop` 独立入口。
  - 工作台 Sender 增加类 Codex 的 slash 命令面板，支持 `/计划`、`/客户分析`、`/方案匹配` 等入口。
  - slash 命令选中后不再留在文本输入中：`/计划` 进入底部 Plan 状态，普通技能进入 Sender 内部技能胶囊态，语音与发送按钮固定在底部操作区。
  - 左侧栏取消“销售主链路 / 工作管理”等业务分类，预置能力以固定会话方式呈现。
  - mock 响应按用户意图生成不同 Plan 草案，而不是固定完整闭环。
  - 调试区展示 Playbook 变体、确认点和 trace 关系。
- 共享数据：
  - 增加 `ScenePlanPlaybook`、`ScenePlanVariant`、`ScenePlanStep`、`ScenePlanPolicy` 静态类型与数据。

## 验收结果

- 已完成：
  - `pnpm --filter @yzj-ai-crm/admin-pro build`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 未实现真实 Main Agent。
- 未实现 Plan Engine、Plan API 或 Plan 状态持久化。
- 未接入真实录音转写与通义分析链路。

## 下一步计划

- 将静态 Plan 草案升级为可保存的 `TaskPlan`。
- 增加 `IntentFrame -> TaskPlan -> ExecutionState` 的后端接口草案。
- 为录音处理复合 Plan 补齐真实 `next_required_action` 状态机。
