# Tesla Report Canvas 集成指南

## 概述

`tesla-report-canvas` 是一个 AI 报告生成服务，接收 Markdown 内容作为输入，自动生成可视化数据报告看板。本项目将它拷贝为内置 `apps/report-canvas-service` 服务，通过 HTTP API 生成报告，并通过新页面打开 `/embed/:sessionId` 查看报告。

## 架构

```
调用方项目
    │
    ├─ POST /api/report/generate     提交 MD 内容，获取 sessionId
    ├─ GET  /api/report/status/:id   轮询生成状态
    ├─ GET  /api/report/result/:id   获取生成结果（代码）
    │
    └─ window.open("/embed/:id")     新页面打开报告看板
```

---

## API 接口

### 1. 创建报告 — `POST /api/report/generate`

**请求：**

```json
{
  "markdown": "# 报告标题\n\n## 数据...",   // 必填，Markdown 内容（最大 200KB）
  "query": "生成专业分析报告",               // 可选，额外分析指令
  "ttlMinutes": 60                          // 可选，会话有效期（默认 60，最大 1440 分钟）
}
```

**响应 (202 Accepted)：**

```json
{
  "sessionId": "rpt_a1b2c3d4e5f6",
  "status": "pending",
  "embedUrl": "http://localhost:3020/embed/rpt_a1b2c3d4e5f6",
  "statusUrl": "/api/report/status/rpt_a1b2c3d4e5f6",
  "resultUrl": "/api/report/result/rpt_a1b2c3d4e5f6",
  "createdAt": "2026-05-09T12:00:00.000Z",
  "expiresAt": "2026-05-09T13:00:00.000Z"
}
```

### 2. 查询状态 — `GET /api/report/status/:sessionId`

**响应 (200)：**

```json
{
  "sessionId": "rpt_a1b2c3d4e5f6",
  "status": "generating",
  "stage": "code_gen",
  "progress": 75,
  "createdAt": "2026-05-09T12:00:00.000Z",
  "updatedAt": "2026-05-09T12:00:30.000Z",
  "expiresAt": "2026-05-09T13:00:00.000Z"
}
```

**status 取值：**

| 值 | 含义 |
|---|---|
| `pending` | 已创建，等待处理 |
| `generating` | 正在生成 |
| `complete` | 生成完毕 |
| `error` | 生成失败 |

**stage 取值（generating 状态下）：**

| 值 | 含义 | 进度区间 |
|---|---|---|
| `understand` | 理解需求 & 规划结构（含联网搜索） | 5-39% |
| `data_prep` | 准备结构化数据 | 40-59% |
| `code_gen` | 生成可视化代码 + 质检 | 60-98% |

**错误响应：**
- `404` — 会话不存在或已过期

### 3. 获取结果 — `GET /api/report/result/:sessionId`

**响应 (200，status=complete 时)：**

```json
{
  "sessionId": "rpt_a1b2c3d4e5f6",
  "status": "complete",
  "code": "import { useState } from 'react';\n...",
  "embedUrl": "http://localhost:3020/embed/rpt_a1b2c3d4e5f6",
  "metadata": {
    "codeLength": 4523,
    "generatedAt": "2026-05-09T12:01:00.000Z",
    "pipelineDurationMs": 60000
  }
}
```

**未完成时 (202)：** 返回当前状态，同 status 接口。

**错误响应：**
- `404` — 会话不存在
- `409` — 生成失败（包含 error 信息）

---

## 打开报告看板

### 新页面打开

```javascript
window.open("http://localhost:3020/embed/rpt_a1b2c3d4e5f6", "_blank", "noopener,noreferrer");
```

本项目用户端不使用 iframe 嵌入报告。`assistant-web` 收到 `openUrl` 后直接新开页打开，后台调试页使用普通链接 `target="_blank"` 打开。

### 页面就绪通知

embed 页面保留源项目的 `postMessage` 通知能力，但 `yzj-ai-crm` 当前不依赖父页面通信。

---

## 集成示例

### Node.js / TypeScript

```typescript
const REPORT_SERVICE_URL = "http://localhost:3020";

// 1. 提交报告生成请求
async function generateReport(markdown: string, query?: string) {
  const res = await fetch(`${REPORT_SERVICE_URL}/api/report/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, query }),
  });
  return await res.json(); // { sessionId, embedUrl, ... }
}

// 2. 轮询等待完成
async function waitForReport(sessionId: string, timeoutMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${REPORT_SERVICE_URL}/api/report/status/${sessionId}`);
    const data = await res.json();

    if (data.status === "complete") return data;
    if (data.status === "error") throw new Error(data.error?.message);

    await new Promise((r) => setTimeout(r, 2000)); // 每 2 秒轮询
  }
  throw new Error("报告生成超时");
}

// 3. 获取结果
async function getReportResult(sessionId: string) {
  const res = await fetch(`${REPORT_SERVICE_URL}/api/report/result/${sessionId}`);
  return await res.json(); // { code, embedUrl, metadata }
}

// 使用示例
const { sessionId } = await generateReport(
  "# 三星电子研究报告\n- 营收 236万亿韩元...",
  "生成专业的企业分析报告"
);
await waitForReport(sessionId);
const openUrl = `${REPORT_SERVICE_URL}/embed/${encodeURIComponent(sessionId)}`;
window.open(openUrl, "_blank", "noopener,noreferrer");
```

### 前端 React 组件集成示例

```tsx
function ReportViewer({ markdown, query }: { markdown: string; query?: string }) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    const res = await fetch("/api/report/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, query }),
    });
    const { sessionId } = await res.json();
    setLoading(false);
    window.open(`/embed/${encodeURIComponent(sessionId)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div>
      <button onClick={generate} disabled={loading}>
        {loading ? "生成中..." : "生成报告"}
      </button>
    </div>
  );
}
```

---

## 部署配置

### 环境变量（.env.local）

```bash
# AI 模型配置（必填）
DASHSCOPE_API_KEY=sk-xxxxxxxx
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen-plus
AI_THINKING_MODEL=qwen-plus-thinking

# 沙箱（可选，用于附件数据分析）
VEFAAS_SANDBOX_ENDPOINT=https://...
VEFAAS_FUNCTION_ID=xxx
VEFAAS_AK=xxx
VEFAAS_SK=xxx
```

### 启动服务

```bash
pnpm --filter @yzj-ai-crm/report-canvas-service dev
# 或
pnpm --filter @yzj-ai-crm/report-canvas-service build
```

---

## yzj-ai-crm 集成路径

本项目采用“拷贝进 monorepo”的集成方式，不引用外部项目，也不以 iframe 嵌入展示报告。

已落地路径：

1. `apps/report-canvas-service`：内置报告服务。
2. `3rdSkill/report-generation`：注册 `report-generation` SKILL。
3. `apps/skill-runtime/src/report-canvas-client.ts`：调用报告服务 API。
4. `apps/admin-api/src/external-skill-service.ts`：注册 `ext.report_generation`。
5. `apps/assistant-web/src/App.tsx`：公司研究 Markdown Drawer 新增报告生成入口，并新开页打开报告。

---

## 注意事项

- 报告生成通常耗时 1-3 分钟（取决于内容复杂度和 AI 服务响应速度）
- 会话默认 60 分钟过期，过期后无法访问
- 服务使用内存存储会话，重启后会话丢失（生产环境建议接入 Redis）
- Markdown 内容越详细（含具体数据），生成的报告质量越高
- 建议轮询间隔 2 秒，客户端超时设置 10 分钟
