# 0.8.2 AI 工作台会话列表后端化

## 版本目标

- 让“最近会话 / 新建会话”列表在不同浏览器中按同一测试 `operatorOpenId` 保持一致。
- 保留 `localStorage` 作为前端离线兜底缓存，但会话列表的权威来源改为 `admin-api` PostgreSQL。

## 关键变更

- `admin_api` schema 新增 `agent_conversations` 表，用于持久化 AI 工作台会话列表元数据。
- `admin-api` 新增：
  - `GET /api/agent/conversations?operatorOpenId=...`
  - `POST /api/agent/conversations`
- `AgentRunRepository.saveRun` 在保存对话运行记录时同步刷新会话最近消息，避免非前端入口漏写列表。
- `assistant-web` 启动时优先读取后端会话列表，并在点击“新会话”和提交消息时写回后端。
- 同一测试 OPENID 下，不同浏览器看到的最近会话、新建空会话和消息后的会话标题会保持一致。

## 影响范围

- 修改 `admin-api` 的 PostgreSQL schema 初始化、Agent 会话 repository/service/HTTP wiring。
- 修改 `assistant-web` 的会话列表加载与写回逻辑。
- 更新 shared 类型中的会话列表 API 契约。
- 不修改 MongoDB artifact 流程。
- 不修改 Qdrant 向量检索逻辑。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-conversation-service.test.ts tests/database.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`

## 未完成项

- 真实登录集成后，前端仍需把 `ASSISTANT_OPERATOR_OPEN_ID` 替换为云之家登录态或后端会话动态提供的 operator open id。
