# 0.5.0 业务无关主 Agent 分层框架

## 版本目标

- 落地主 Agent 通用框架，而不是 CRM 专用路由器。
- 使用 LangGraph / LangChain JS 作为主流 Agent 运行框架。
- 取消运行时 `scene.*` 技能选择，场景只保留为 slash 入口、计划模板、测试样例和业务工具包。
- 第一套业务包落地 AI-CRM：4 个记录对象工具、公司研究外部工具、Artifact 检索和写回确认。

## 范围

- 新增 `agent-core`：业务无关类型、工具契约、策略决策、确认请求和运行输出。
- 新增 `agent-runtime`：基于 LangGraph 的状态图，覆盖解析意图、生成计划、选择工具、执行工具、确认中断和恢复。
- 新增 `tool-registry`：统一注册 `record / external / meta / artifact` 工具，并拒绝 `scene.*`。
- 新增 `crm-agent-pack`：把客户、联系人、商机、跟进记录映射为 record 工具，把公司研究映射为 external 工具。
- 改造 `apps/admin-api`：只做组合入口，注入 SQLite、ShadowMetadataService、ExternalSkillService、ArtifactService 和 Runtime。
- 扩展 `POST /api/agent/chat`：支持 `tenantContext.operatorOpenId` 和 `resume.confirm_writeback`。
- 用户 AI 工作台测试期注入固定 `operatorOpenId=69e75eb5e4b0e65b61c014da`，并支持输入“确认写回 / 取消写回”触发 `resume.confirm_writeback`。
- 新增 SQLite `agent_confirmations`，保存写回预览和确认决策。
- admin-api 启动时对 SQLite 设置 `busy_timeout`，并在旧 org sync running 状态收口遇到外部 sqlite 锁时降级为告警，避免 dev server 直接退出。
- 记录系统技能页的只读接口不再隐式同步 registry 写库；即使 SQLite 被 DB Browser 等外部客户端锁住，也直接读取已持久化 registry 或配置快照，避免 `/api/shadow/objects` 与 `/skills` 接口因等待写锁而慢 5 秒以上。
- 公司研究外部 Skill 失败时返回 `tool_unavailable` 和真实失败原因；不生成降级 Artifact，不污染后续 Evidence Card。

## 关键能力

- 通用工具契约：
  - `record.object.search`
  - `record.object.get`
  - `record.object.preview_create`
  - `record.object.preview_update`
  - `record.object.commit_create`
  - `record.object.commit_update`
  - `external.company_research`
  - `artifact.search`
  - `meta.clarify_card`
  - `meta.candidate_selection`
  - `meta.plan_builder`
  - `meta.confirm_writeback`
- CRM record 工具实例：
  - `record.customer.*`
  - `record.contact.*`
  - `record.opportunity.*`
  - `record.followup.*`
- 写回确认：
  - 先 preview，再进入 `waiting_confirmation`。
  - approve 后恢复 LangGraph checkpoint 并执行 `commit_create/update`。
  - reject 后标记 cancelled，不写轻云。
  - 不注册 delete，不注册 `scene.*`。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`。
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`。
- 已覆盖：公司研究依赖缺失 / 模型额度失败时不创建 Artifact，只保留失败 tool call 与策略决策。

## 未完成项

- 前端确认卡暂未落地，目前支持通过文本“确认写回 / 取消写回”完成测试期确认；后续再做正式确认卡。
- LangGraph checkpoint 当前使用 Runtime 内存检查点，确认记录和审计落 SQLite；后续可接入持久化 checkpoint 后端。
- 后续可继续扩展更多业务包和计划模板，但不得把业务对象放入主 Agent 核心层。

## 下一步计划

- 在 `assistant-web` 基于 Ant Design X 官方壳体增加写回确认卡。
- 增加 Agent 治理页对 Tool Registry、confirmations 和真实 run trace 的可视化。
- 引入持久化 checkpoint provider，支持进程重启后的确认恢复。
