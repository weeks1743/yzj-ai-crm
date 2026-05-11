# 0.10.19 线上录音与回写热修

## 目标

- 修复录音下游“客户价值定位”因 `read_skill_file` 参数为空导致失败。
- 优化录音卡片与洞察中的 Skill 产物显示，不直接暴露内部 Markdown 文件名。
- 调整录音卡片在聊天时间线中的位置，避免旧录音任务恢复后固定在最上方遮挡阅读。
- 修复记录写回确认重复触发时“实际成功但提示失败”的误报。
- 让写回确认与完成文案不向用户暴露确认 ID、内部工具名和内部记录 ID。
- 修复录音来源拜访记录标题，按“客户的商机跟进记录”生成；没有商机名称时不写入商机名称。
- 录音下游 Skill 请求文本不再注入客户、商机、跟进记录内部 ID，仅保留正式绑定状态，避免模型在 Markdown 正文中复述内部 ID。

## 范围

- `apps/skill-runtime`
- `apps/assistant-web`
- `apps/admin-api`
- 相关单元测试

## 验收结果

- 本地验证通过：
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`
  - `pnpm --filter @yzj-ai-crm/skill-runtime build`
  - `pnpm --filter @yzj-ai-crm/assistant-web test`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-api test -- --test-name-pattern "record writeback|recording material after confirmed|metadata-driven opportunity update|personSelectWidget fields|does not derive opportunity or followup titles|normalizes opportunity and followup"`
  - `pnpm --filter @yzj-ai-crm/admin-api test -- --test-name-pattern "createSkillJob sends structured|rerunCompletedSkillJobs waits|ensureCoreAnalysisMaterials reruns|pending archive|archived recording repair"`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
- 生产部署完成：
  - GitHub `main` 已部署到生产 HEAD `12c146b`。
  - 生产已重建并启动 `admin-api`、`skill-runtime`、`web`。
  - `https://huaguopm.com/api/health` 返回 `status: ok`。
  - `/recording-viewer-loading?target=/api/recording-audio-tasks/recording-task-7b84c7af/meeting-viewer` 返回 200，不再 404。
- 生产录音任务 `recording-task-7b84c7af` 验收：
  - 任务状态为 `succeeded`，录音资料包已生成。
  - 重新触发 `ext.customer_value_positioning_pm`，job `da8c7d29-9643-49b4-acff-92c3043404cb` 已 `succeeded`，不再出现 `relativePath` 为空错误。
  - 重新触发 `ext.customer_needs_todo_analysis`，job `a6d78ece-ccb7-47ec-96dd-fb823c3709ba` 已 `succeeded`。
  - 重新触发 `ext.visit_conversation_understanding`，job `25e914aa-563f-4c8d-8b01-b4979e872690` 已 `succeeded`。
  - 日志未再出现 `暂不支持读取该附件类型: .../inputs/profile-analysis`。
- 生产日志检查：
  - 未再发现 `relativePath`、`暂不支持读取该附件类型` 相关错误。
  - 写回确认重复触发路径已通过持久化 confirmation 状态恢复，避免“实际成功但提示失败”。

## 未完成项

- 需将“录音下游 Skill 请求文本不注入内部 ID”的补充修复提交并部署，使后续新生成的下游 Markdown 不再从提示词继承内部 ID。
