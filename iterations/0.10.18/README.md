# 0.10.18 线上问题修复

## 版本目标

- 修复拜访准备 Markdown 缺少生成报告入口的问题。
- 修复更新字段卡片当前值文案多出“当前：”的问题。
- 修复录音查看页 `/recording-viewer-loading` 线上 404。
- 修复录音下游 Skill 读取 `inputs/profile-analysis` 子目录失败。

## 范围

- 新增 transient Markdown 报告生成接口，不写入资料资产和 artifact 报告表。
- 拜访准备 Markdown 卡片在“生成图片”旁增加报告按钮。
- `profile-analysis/*.md` 附件在 skill-runtime inputs 中保留子目录结构。
- `read_source_file` 支持读取 `inputsDir` 下的受支持文本目录。

## 验收

- 本地验证：
  - `pnpm --filter @yzj-ai-crm/assistant-web test`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`
  - `pnpm --filter @yzj-ai-crm/skill-runtime build`
- 生产部署：
  - 已推送 `main` 至 GitHub。
  - 已同步 gitignored 的 `deploy/Dockerfile.web`、`deploy/nginx.default.conf`、`deploy/docker-compose.prod.yml` 到服务器 `/opt/yzj-ai-crm/.deploy/`。
  - 服务器已 `git pull --ff-only origin main` 到 `034a4f9`。
  - 已重建并启动 `admin-api`、`skill-runtime`、`web`。
- 线上验收：
  - `https://huaguopm.com/api/health` 返回 200。
  - `/recording-viewer-loading?target=...` 返回 assistant-web HTML，不再 404。
  - `/api/recording-audio-tasks/recording-task-7b84c7af/meeting-viewer` 返回 302 到 `/audio-viewer/meeting-viewer/?task=06818e8718e7bd8284c780025a2c834f`。
  - `POST /api/markdown/report` 返回 `succeeded`，验收报告链接为 `https://huaguopm.com/embed/rpt_0dc993f2cac1`，该 embed 页面返回 200 且状态为 `complete`。
  - 重新触发 `recording-task-7b84c7af` 的三个下游 Skill 均成功：
    - `ext.visit_conversation_understanding`: `03d30370-e157-4dae-ab96-dc6ac2fdd986`
    - `ext.customer_needs_todo_analysis`: `a5a47b15-4773-4472-aa22-5d243ef608ca`
    - `ext.customer_value_positioning_pm`: `d5acca5c-9053-4738-ab45-a811515ed5ad`
  - 线上日志未再出现 `暂不支持读取该附件类型: .../inputs/profile-analysis`。
  - 线上 assistant-web bundle 包含“生成报告/打开报告”，未检出“当前：”文案。

## 未完成项

- 图片生成超时与 provider 稳定性不在本轮范围内。
