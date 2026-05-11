# 0.10.20 复用资料生成链路修复拜访准备

## 目标

- 修复 `trace-agent-083d6fc3` 拜访准备 Markdown 生成图片和报告失败问题。
- 拜访准备生成后沉淀为 `analysis_material` 资料对象，图片和报告按钮复用公司研究的 artifact 链路。
- 移除前端拜访准备场景对 `/api/markdown/image`、`/api/markdown/report` 的临时调用。
- 修复 `trace-agent-1f7f671b` 无锚点录音卡片恢复到会话顶部显示。

## 范围

- `apps/admin-api`
- `apps/assistant-web`
- `apps/skill-runtime`
- 相关单元测试

## 关键实现

- `ext.yunzhijia_visit_prep` 的 `assetMaterialization` 改为启用，产物类型为 `analysis_material`。
- `/拜访准备` 成功后创建标题为“客户名 客户拜访准备”的资料，evidence 携带 `artifactId/versionId/title/sourceToolCode`。
- 前端报告按钮判断扩展为公司研究或 `sourceToolCode=ext.yunzhijia_visit_prep` 的拜访准备资料。
- `ArtifactReportService` 允许公司研究和拜访准备资料生成持久报告，继续拒绝其他分析资料。
- 录音时间线中，无锚点或锚点失效的录音任务排在消息组之前；有效锚点仍插入对应消息后。

## 验收结果

- 本地验证通过：
  - `pnpm --filter @yzj-ai-crm/assistant-web test`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`
  - `pnpm --filter @yzj-ai-crm/skill-runtime build`
  - `assistant-web build` 仅出现 Vite chunk size warning，无构建失败。
- 待生产验收：
  - `trace-agent-083d6fc3` 拜访准备图片生成成功，状态与公司研究一致。
  - `trace-agent-083d6fc3` 拜访准备报告生成成功，状态与公司研究一致。
  - 线上日志不再出现该场景 `/api/markdown/image`、`/api/markdown/report` 请求。
  - `trace-agent-1f7f671b` 录音卡片在会话顶部可见。

## 未完成项

- 生产部署与验收后补充最终结果。
