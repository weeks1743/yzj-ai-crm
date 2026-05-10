# 0.10.13 报告持久化存储方案

## 版本目标

- 将报告生成期临时会话和长期访问入口解耦。
- 生成完成后的报告源码复用 skill-runtime `.jsx` artifact 持久化存储。
- 报告服务重启、session TTL 过期后，资料卡仍可再次打开已生成报告。

## 修复范围

- `skill-runtime`：
  - `report_ready` 事件新增 `codeArtifactId`、`metadataArtifactId`、`transientSessionId`。
  - 报告 metadata 保留临时 `rpt_xxx` session，用于排查生成过程。
- `admin-api`：
  - `artifact_report_generations` 增加持久 artifact 字段。
  - 报告成功后保存 `.jsx` artifact id，并返回持久 `openUrl`。
  - 新增持久报告源码接口，后续打开不依赖 report-canvas-service 内存 session。
- `assistant-web`：
  - 继续使用 `openUrl` 打开报告。
  - 补充持久报告状态字段类型和更明确的错误提示。
- `report-canvas-service`：
  - 保留生成期 API 和 `/embed/:sessionId` 临时预览。
  - 新增持久报告渲染入口，从 admin-api code endpoint 加载报告源码。
  - 修复持久报告空白：确认浏览器停在 `正在打开报告...` 时没有发出 `report/code` 请求，根因是持久页 React hydration 未继续执行。
  - `/persistent-report` 改为 route handler：服务端从持久 artifact 读取源码，创建 24 小时渲染 session，并用标准 HTTP `302` 跳转 `/embed/:sessionId`，不再使用 Next server component `redirect()`。
  - `/embed/:sessionId` 对齐源项目的纯客户端进入方式，不再把完整 code 注入服务端首屏，浏览器端通过 `/api/report/status/:sessionId` 与 `/api/report/result/:sessionId` 获取 code。
  - 修复 `localhost` 与 `127.0.0.1` 打开同一临时报告时表现不一致的问题：两个 host 均使用相对 API、`no-store` 拉取状态和结果，结果读取超时/失败时显示明确错误，不再无限停留在“正在打开报告...”。
  - Sandpack 预览统一改为浏览器端 mount 后再挂载，对齐源项目“客户端拿到 code 后再启动预览”的本质时序。
  - 隐藏报告页 Sandpack 悬浮图标，包括刷新、重启、Open in CodeSandbox 和启动 cube 操作层。
  - 恢复 `/embed/:path*` frame headers，并为 `/persistent-report` 同步设置长期打开/嵌入所需 headers。

## 验收结果

- 已执行：`pnpm --filter @yzj-ai-crm/skill-runtime test`，33/33 通过。
- 已执行：`pnpm --filter @yzj-ai-crm/admin-api test`，249/250 通过，1 个既有 live 公司研究用例按密钥条件跳过。
- 已执行：`pnpm --filter @yzj-ai-crm/assistant-web build`，通过；Vite 仅提示既有 chunk size warning。
- 已执行：`pnpm --filter @yzj-ai-crm/report-canvas-service build`，通过。
- 已执行：贝斯美持久报告 URL curl 复验，`/persistent-report` 返回标准 `302` 到 `/embed/rpt_xxx`，响应体为空，不再出现 `NEXT_REDIRECT`；admin-api `report/code` 返回 200 且源码长度大于 0，未打印源码内容。
- 已执行：`http://localhost:3020/embed/rpt_f32cc3aff120` 与 `http://127.0.0.1:3020/embed/rpt_f32cc3aff120` 接口复验，`/api/report/result/rpt_f32cc3aff120` 均返回 `complete`，`codeLength=21093`，且首屏 HTML 不再包含报告正文。

## 未完成项

- 本轮不引入 Redis 或对象存储。
- 本轮不迁移历史只保存 `/embed/rpt_xxx` 的旧报告；旧报告会提示重新生成。
