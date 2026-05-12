# 0.10.21 用户端精简与后台观测迭代

## 目标

- 删除用户 AI 端个人设置功能，避免继续暴露 SOUL 配置入口。
- 将助手输出头像从 `YZ` 文本替换为系统 logo。
- 将用户端附件上传收敛为录音处理入口，仅支持 `wav`、`mp3`。
- 优化后台运行观测详情，支持查看同一会话完整过程。
- 将确认审计列表并入运行观测页面页签。
- 移除后台多余说明提示，保持正式后台页面观感。
- 在分析运营看板明确标记当前为 DEMO 静态页面。

## 范围

- `apps/assistant-web`
- `apps/admin-pro`
- `apps/admin-api`
- `packages/shared`

## 关键实现

- 用户 AI 端移除 `/settings/personal` 页面、侧栏设置入口和个人设置接口调用；历史 `agent_personal_settings` 表保留为 legacy 数据，不自动删除。
- Assistant Bubble avatar 复用 `@shared/assets/logo.png`，不再显示 `YZ` 文本。
- 附件上传增加 `accept` 与 `onChange` 双层过滤，只保留 `wav`、`mp3` 文件，并同步调整上传文案。
- 后端新增只读接口 `GET /api/agent/conversations/:conversationKey/process`，按会话聚合运行、消息、工具调用和确认审计。
- 管理端运行观测主区域改为“运行记录 / 确认审计”页签；运行观测详情新增“完整过程”页签。
- 移除运行观测和系统设置页的说明型 Alert，仅保留错误、告警和加载反馈。
- 分析运营看板标题展示 `DEMO 静态页面` 标签。

## 验收结果

- 已通过：
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-observability-service.test.ts tests/http.test.ts`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-pro build`
- `assistant-web build` 仅出现 Vite chunk size warning，无构建失败。
- `admin-pro build` 出现 Umi 本地存储路径 warning，无构建失败。

## 未完成项

- 待生产环境确认历史个人设置接口调用方已全部下线。
- 待真实会话数据验收“完整过程”页签对多轮会话排查是否足够高效。
