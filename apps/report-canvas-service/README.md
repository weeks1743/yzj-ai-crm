# Report Canvas Service

内置报告生成服务，来自 `tesla-report-canvas` 的源码拷贝。它接收 Markdown，生成可通过 `/embed/:sessionId` 打开的互动报告页。

## Scripts

```bash
pnpm --filter @yzj-ai-crm/report-canvas-service dev
pnpm --filter @yzj-ai-crm/report-canvas-service build
```

默认端口为 `3020`，可通过 `REPORT_CANVAS_SERVICE_PORT` 调整。

## Integration

- 服务端调用：`REPORT_CANVAS_SERVICE_BASE_URL`
- 用户打开：`REPORT_CANVAS_PUBLIC_BASE_URL`
- 展示方式：新页面打开报告 URL，不使用 iframe 嵌入。

详见 [INTEGRATION.md](./INTEGRATION.md)。
