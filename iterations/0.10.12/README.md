# 0.10.12 报告生成失败修复

## 版本目标

- 修复公司研究资料卡生成互动报告时出现“pipeline 返回空结果”的问题。
- 修复报告已生成完成但打开 `/embed/:sessionId` 后一直停留在加载转圈的问题。
- 将原报告服务项目的本地运行配置合并到本项目根 `.env`，让内置报告服务具备一致的模型配置。
- 让报告生成失败时返回真实配置或模型错误，而不是空结果兜底文案。

## 修复范围

- `apps/report-canvas-service`：
  - 启动/请求时向上查找并加载项目根 `.env`。
  - `DASHSCOPE_BASE_URL` 默认使用 DashScope 兼容模式地址。
  - `DASHSCOPE_API_KEY` 缺失时在创建报告会话前返回明确 `CONFIG_ERROR`。
  - pipeline 代码生成、代码提取和模型流式调用失败时抛出可读错误。
  - `/embed/:sessionId` 改为服务端读取 session 初始状态，已完成报告首屏直接注入报告代码，避免客户端 hydrate/fetch 异常时停在 0%。
  - embed 子布局移除嵌套 `<html>/<body>`，避免动态路由内产生非法嵌套文档结构。
  - embed 客户端在状态/结果接口非 2xx 时展示真实错误；`complete` 但未拿到代码时继续拉取结果。
- 本地环境：
  - 已将 `testSandbox/tesla-report-canvas/.env.local` 中的报告生成相关 key 合并到本项目 `.env`。
  - 同名 key 已覆盖，缺失 key 已追加；密钥不进入 Git。

## 验收结果

- 已执行：`.env` key 存在性检查，确认报告生成相关 8 个 key 均已配置；未打印密钥值。
- 已执行：`pnpm --filter @yzj-ai-crm/report-canvas-service build`，通过。
- 已执行：`curl /api/report/status/rpt_e217da486701`，确认 status 为 `complete`、progress 为 `100`。
- 已执行：`curl /api/report/result/rpt_e217da486701`，确认结果包含报告代码和 embedUrl；未打印密钥。
- 已执行：`curl /embed/rpt_e217da486701`，确认首屏 HTML 已包含 Sandpack 预览结构和报告代码，不再返回“报告生成中/正在打开报告”加载壳。
- 已执行：`pnpm --filter @yzj-ai-crm/skill-runtime test`，33/33 通过。
- 已执行：`pnpm --filter @yzj-ai-crm/admin-api test`，248/249 通过，1 个既有 live 公司研究用例因需要真实 `DEEPSEEK_API_KEY` / `ARK_API_KEY` 按条件跳过。
- 待手动验证：公司研究资料卡点击“重新生成报告”后完成生成并打开 `/embed/:sessionId`，浏览器端不再停留在转圈加载状态。

## 未完成项

- 本轮不引入备用模型或降级假报告。
- 本轮不修改 `testSandbox` 原项目。
