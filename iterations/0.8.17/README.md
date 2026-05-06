# 0.8.17 图片生成刷新后状态收口

## 目标

- 修复公司研究资料卡生成图片后刷新页面，旧任务长时间停留在“图片生成中”的问题。
- 让图片派生动作具备和 PPT 派生动作一致的前端状态恢复体验。
- 避免陈旧 `queued` 记录永久锁定“生成图片”按钮。

## 范围

- 用户 AI 端对 `queued` 图片状态进行轮询刷新，直到进入成功或失败终态。
- 图片服务读取状态时自动识别超出生成超时窗口的陈旧 `queued` 记录，并改为失败态。
- 后端保留图片生成作为公司研究资料后的派生能力，不重新触发公司研究，不改写公司研究 Artifact。

## 关键能力

- 刷新页面后，如果图片仍在生成中，资料卡继续轮询 `/api/artifacts/:artifactId/image`。
- 如果服务端任务已完成，轮询会恢复为图片预览和下载入口。
- 如果任务因刷新、服务重启、网络中断或 provider 超时遗留为陈旧 `queued`，状态接口会返回失败文案，用户可重新生成。

## 依赖框架

- 用户 AI 端继续基于 `@ant-design/x` 独立式工作台范式。
- 后端继续使用现有 Artifact 图片元数据表和外部图片生成 provider。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/artifact-image-service.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 说明：`pnpm --filter @yzj-ai-crm/admin-api test -- tests/artifact-image-service.test.ts` 按当前脚本会运行整套 `tests/**/*.test.ts`，其中既有 live 用例因本地未配置 `DEEPSEEK_API_KEY` 失败；本轮新增图片服务定向测试已单独通过。

## 未完成项与下一步计划

- 当前仍是同步请求式图片生成，尚未引入真正后台 job/worker。
- 后续如果图片生成耗时进一步变长，应把图片生成改为明确 job 模型，前端按 jobId 查询进度。
