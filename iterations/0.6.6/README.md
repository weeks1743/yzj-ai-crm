# 0.6.6 工具失败调试信息增强

## 目标

- 修复写回失败时只显示“写入轻云单据失败”，看不到轻云上游具体返回的问题。
- 开发调试阶段在正文和右上角调试区展示安全的错误诊断信息。
- 保持主 Agent 业务无关错误处理，不绕过确认、不生成本地替代结果。

## 范围

- 后端通用错误诊断：从 `AppError/YzjApiError.details` 中提取 HTTP 状态、上游 code/message、`hasException`、`exceptions`、参数校验信息等。
- `AgentToolCall` 增加可选 `errorDetails`，用于 trace 和前端调试区查看结构化错误。
- runtime 的 `tool_unavailable` 正文增加“调试信息”区块。
- 前端调试区工具调用卡展示 `errorDetails` JSON。
- 写前查重在同一等待态内缓存“无重复候选”的成功结果，后续补字段不重复调用轻云 `searchList`。
- 识别轻云 `10000429 / 请求过于频繁`，不做紧贴着的自动重试，并在提示中显示 `message=请求过于频繁`。

## 验收标准

- 写入轻云失败时，回复正文能看到上游异常摘要，例如 `exception[0]=...`。
- 右上角调试区的工具调用中能看到 `errorMessage`、`outputSummary` 和 `errorDetails`。
- 同一个记录创建等待态补字段时，不重复触发已成功过的写前查重。
- 轻云限流时显示上游 `message`，并保留已填字段等待稍后重试。
- 仍然不降级、不伪造成功、不跳过 preview + confirm。
- Tool Registry 仍不包含 `scene.*` 和 delete。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，91/91。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
