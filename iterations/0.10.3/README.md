# 0.10.3 录音上传中断状态修复

## Summary

- 修复线上录音上传请求被客户端中断后，用户 AI 端残留 `pending-*` 临时任务卡片的问题。
- 明确 `pending-*` 仅为前端上传占位，不代表服务端录音任务已经创建。
- 上传失败时将卡片标记为失败并提示可重新选择文件上传；刷新后不再持久化假任务。

## Scope

- `assistant-web`
  - 录音上传失败、网络中断、HTTP 非 2xx 时，pending 卡片进入 failed 状态并展示错误。
  - 持久化录音任务时过滤 `pending-*` 临时卡片，避免刷新后继续显示不存在的服务端任务。
  - 保留成功路径：上传成功后用后端 `recording-task-*` 替换 pending 卡片，并继续轮询/生成资料包。

## Acceptance

- 上传被中断或接口失败时，页面不再长期显示“正在生成”。
- 服务端未创建任务时，用户能看到“上传未完成，请重新上传录音文件”的失败状态。
- 重新上传同一录音文件可以重新走正式 `/api/recording-audio-tasks` 创建任务链路。

## Verification

- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web test`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## Follow-up

- 后续可增加上传进度条、AbortController 超时控制和更清晰的大文件网络提示。
