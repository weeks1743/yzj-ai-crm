# 0.8.1 AI 工作台测试 OPENID 会话收敛

## 版本目标

- 修复不同浏览器打开 AI 工作台时，测试会话内容和上下文不一致的问题。
- 测试期统一使用同一个 `operatorOpenId=69e75eb5e4b0e65b61c014da`，后续真实云之家集成时再由登录态动态注入。

## 关键变更

- `assistant-web` 统一从 `ASSISTANT_OPERATOR_OPEN_ID` 读取测试 OPENID。
- AI 工作台的首页会话、场景会话和用户新建会话 key 均按当前 OPENID 派生，避免不同浏览器落到不同后端 `conversationKey`。
- 本地会话缓存升级到 v4，并按 OPENID 分区，避免旧浏览器缓存继续影响当前测试身份。
- 默认消息加载优先读取 `admin-api` 已持久化的 Agent 运行记录与消息；后端不可用时回退到当前浏览器本地缓存。

## 影响范围

- 仅修改用户 AI 工作台前端身份、会话 key 和消息恢复逻辑。
- 不修改 MongoDB artifact 存储逻辑。
- 不修改 Qdrant 向量检索逻辑。
- 不修改 Agent 核心层业务无关契约。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 真实登录集成后，`ASSISTANT_OPERATOR_OPEN_ID` 应从云之家登录态或后端会话动态注入，而不是继续使用测试兜底值。
