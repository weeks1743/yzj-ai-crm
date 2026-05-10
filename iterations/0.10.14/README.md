# 0.10.14 报告打开地址 localhost 归一化修复

## 版本目标

- 将用户浏览器打开的报告地址统一到 `http://localhost:3020`。
- 保留服务端内部调用 `report-canvas-service` 的 `127.0.0.1` 默认地址。
- 修复 `127.0.0.1` 与 `localhost` 混用导致报告页持续转圈的问题。

## 修复范围

- `admin-api`：
  - `REPORT_CANVAS_SERVICE_BASE_URL` 默认仍为 `http://127.0.0.1:3020`。
  - `REPORT_CANVAS_PUBLIC_BASE_URL` 缺省时改为 `http://localhost:3020`。
  - `/api/artifacts/:artifactId/report/open` 继续生成持久报告入口，但目标 host 使用 public base URL。
- `skill-runtime`：
  - 生成期 report_ready 中的 transient open URL 缺省使用 `http://localhost:3020`。
  - 内部调用 report-canvas-service 仍使用 service base URL。
- `report-canvas-service`：
  - `/embed/:sessionId` 与 `/persistent-report` 在 `127.0.0.1` host 下通过 Next redirects 307 到同 path/query 的 `localhost`。
  - `/embed/:sessionId` 客户端保留 host 自检兜底，避免旧 dev 进程或 redirects 未加载时继续停留在 `127.0.0.1`。
  - `/api/report/*` 不做 host 跳转，避免影响服务端轮询和结果读取。
- 环境配置：
  - 本地 `.env` 增加 `REPORT_CANVAS_PUBLIC_BASE_URL=http://localhost:3020`。
  - `.env.example` 同步说明浏览器公开入口优先使用 `localhost`。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`。
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime test`。
- 已通过：`pnpm --filter @yzj-ai-crm/report-canvas-service build`。
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`。
- 已通过：`pnpm build`。
- 已验证：`.env` 与 `.env.example` 均存在 `REPORT_CANVAS_PUBLIC_BASE_URL` key，不打印 value。
- 已验证：`/api/artifacts/9d0691df-4d27-4ea0-b276-4671b43a0bd7/report/open` 的 `Location` 以 `http://localhost:3020/persistent-report` 开头。
- 已验证：`127.0.0.1:3020/embed/...` 与 `127.0.0.1:3020/persistent-report?...` 返回 307，`Location` 指向 `http://localhost:3020/...`。
- 已验证：`127.0.0.1:3020/api/report/status/...` 不做 host 归一化跳转。
- 待用户手动确认：从资料卡和完整研究抽屉分别打开贝斯美报告，最终 URL 均为 `localhost:3020` 且页面不再转圈。

## 说明

- `rpt_xxx` 仍是临时渲染 session；不同入口打开持久报告时可能得到不同 `rpt_xxx`。
- 同一报告的长期数据源仍是 skill-runtime 保存的 `.jsx` artifact。
- Next redirects 的 host matcher 必须使用 `127.0.0.1`，不能带端口；带端口时不会命中。页面客户端仍保留 `location.replace` 兜底。
