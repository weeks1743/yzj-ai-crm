# 0.10.16 report-canvas 跨容器附件热修

## 版本目标

- 修复线上报告生成时 `skill-runtime` 读不到 `admin-api` 生成的 Markdown 附件，导致 `附件不存在或不是文件` 的问题。
- 举一反三覆盖同类 `/拜访准备` 运行时 Skill 附件输入。
- 不处理图片生成 provider 超时问题。

## 修复范围

- `admin-api`：
  - 新增共享输入 helper，将传给 `skill-runtime` 的附件统一写入 `.local/skill-runtime-inputs/`。
  - 报告生成附件写入 `.local/skill-runtime-inputs/artifact-report-inputs/`。
  - `/拜访准备` 公司研究附件写入 `.local/skill-runtime-inputs/agent-runtime-attachments/<runId>/`。
- 生产 Compose：
  - 新增 `skill-runtime-inputs` 卷。
  - `admin-api` 以读写方式挂载该卷。
  - `skill-runtime` 以只读方式挂载该卷。
- 录音下游 Skill：
  - 保持现状不改，录音资料已通过 `audio-data` 卷以相同路径挂载到 `admin-api` 和 `skill-runtime`。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`。
- 待线上验证：资料 `7474fd4e-7339-4d72-8164-11408c8beaab` 重新生成报告不再报附件不存在。

## 未完成项

- 图片生成失败另行排查，不调整 `EXT_IMAGE_TIMEOUT_MS`、图片 prompt 或前端轮询。
- 不触碰 `0.10.15` 云之家 ticket 刷新修复相关改动。
