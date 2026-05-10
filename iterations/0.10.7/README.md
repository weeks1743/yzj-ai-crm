# 0.10.7 报告生成内置服务与公司研究 Markdown 出口

## 版本目标

- 新增 `报告生成` SKILL，通过内置 `report-canvas-service` 将公司研究 Markdown 转成可视化互动报告。
- 将 `tesla-report-canvas` 代码拷贝进本仓库，作为类似录音处理服务的系统内置服务，而不是外部引用。
- 在用户 AI 端公司研究 Markdown Drawer 上增加报告生成入口。
- 报告展示不使用 iframe 嵌入，统一新开页面打开报告。

## 实施范围

- `apps/report-canvas-service`
  - 拷贝 `tesla-report-canvas` 源码到 monorepo 内置应用。
  - 服务端口默认 `3020`，通过 `REPORT_CANVAS_SERVICE_PORT` 调整。
  - 保留原项目 `INTEGRATION.md` 作为服务 API 与集成依据。

- `3rdSkill/report-generation`
  - 新增 `report-generation` SKILL 元数据。
  - 输入契约为单个 `.md` 附件，输出报告 metadata、生成代码 artifact 与 `report_ready` 事件。

- `skill-runtime`
  - 注册 `report-generation` 为可执行 SKILL。
  - 新增 `ReportCanvasClient` 调用 `/api/report/generate`、`/api/report/status/:sessionId`、`/api/report/result/:sessionId`。
  - 生成完成后写入 metadata/code/source artifacts，并发出 `report_ready` 事件。

- `admin-api`
  - 外部技能目录新增 `ext.report_generation`。
  - 新增 `/api/artifacts/:artifactId/report` GET/POST。
  - 新增报告生成记录表，按 artifact version 幂等复用，失败后允许重试。

- `assistant-web`
  - 公司研究 Markdown Drawer 新增“生成报告”和“打开报告”。
  - 生成中轮询状态，成功后通过 `window.open(openUrl, '_blank')` 新开页。
  - 不 iframe 嵌入报告。

- `admin-pro`
  - 外部技能调试页支持展示 `report_ready` 事件，并可新页面打开报告。

## 配置项

- `REPORT_CANVAS_SERVICE_BASE_URL`
- `REPORT_CANVAS_PUBLIC_BASE_URL`
- `REPORT_CANVAS_SERVICE_PORT`
- `REPORT_CANVAS_TIMEOUT_MS`
- `REPORT_CANVAS_POLL_INTERVAL_MS`
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `AI_MODEL`
- `AI_THINKING_MODEL`

## 验收结果

- 公司研究 Markdown 可以触发报告生成。
- 报告生成通过 `ext.report_generation -> report-generation -> report-canvas-service` 链路执行。
- 生成完成后返回 `openUrl`，用户端和后台调试页均通过新页面打开报告。
- 同一 artifact version 已有成功报告时复用现有结果；失败状态允许重试。
- 本轮基于 `main` 的 `0.10.6` 之后实现，保留 `super-ppt` 下线与 `problem-statement` 移除结果。

## 验证

- 已通过：`pnpm install`（存在既有 pnpm build-script approval 提示，不阻断安装）
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime test -- http.test.ts skill-catalog-service.test.ts`（实际执行完整 skill-runtime 测试集，33 通过）
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test -- artifact-report-service.test.ts database.test.ts external-skill-service.test.ts`（实际执行完整 admin-api 测试集，247 通过，1 个 live 测试跳过）
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm --filter @yzj-ai-crm/report-canvas-service build`
- 已通过：`pnpm build`

## 未完成项

- `report-canvas-service` 当前沿用源项目内存会话存储，服务重启后历史报告页面会失效；生产化可后续接 Redis 或持久化存储。
- 本轮只在公司研究 Markdown 上开放报告生成入口，其他 Markdown 资料暂不开放。
