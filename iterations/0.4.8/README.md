# 0.4.8 用户侧工作台去 Mock 化

## 版本目标

- 用户 AI 工作台保留 Ant Design X 官方工作台壳体与销售主链路入口。
- 移除用户侧示例会话、示例回答、示例任务、示例资产和本地业务降级生成。
- 用户侧只调用真实 Agent API；API 不可用时展示明确错误态。

## 范围

- `assistant-web` Provider 改为真实 `POST /api/agent/chat` 调用。
- 左侧会话和本地消息缓存升级到 v2，避免历史 mock 内容继续显示。
- 调试区保留壳体，只展示真实 Agent trace；无真实数据时展示空态。
- 不删除 `packages/shared/mock-data.ts`，避免影响管理端和历史迭代内容。

## 验收项

- 首次进入工作台不出现 mock 历史消息。
- 点击“新会话”后右侧为空态，不串旧数据。
- API 不可用时展示明确错误态，不生成本地伪造公司研究。
- 真实公司研究返回后仍可查看 Markdown、证据卡和生成 PPT。
- 调试区无 trace 时为空态，有真实 `agentTrace` 时正常展示。

## 验证结果

- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`。

## 未完成项

- 场景入口仍为前端静态配置，后续可改为后端动态场景配置。
- 调试区暂不读取真实 Agent run 列表，只展示当前会话最新 trace。
