# 0.6.1 记录写入体验与通用预览守卫

## 版本目标

- 基于 0.6.0 已修复的记录系统 SKILL 契约，补齐主 Agent 的业务无关写入体验。
- 写入预览先展示普通用户可读摘要，测试期调试 JSON 后置保留。
- 在 confirmation 保存前增加通用写前守卫，避免空 payload、只读阻断或缺少必填字段进入确认。
- 写入成功后根据工具元数据推荐用户继续补充字段。

## 实施范围

- 扩展 `RecordToolCapability` 的通用展示元数据：字段标签、展示顺序、必填字段、派生字段、推荐补充字段。
- 扩展 `ConfirmationRequest`：新增 `userPreview` 与 `debugPayload`，保留原 `preview` 与 `requestInput` 兼容确认恢复。
- `crm-agent-pack` 只作为业务包配置 4 个记录对象的字段标签与补充建议，不把 CRM 类型写入 Agent core/runtime。
- `record.*.preview_create/update` 增加通用 presenter 与 policy guard。
- `assistant-web` 优先展示 `pendingConfirmation.userPreview`，调试 JSON 放入调试区。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。

## 未完成项与下一步

- 本轮不改记录系统 SKILL 语义；如发现 SKILL preview 输出不一致，先形成诊断再决定是否进入 SKILL 修复。
- 测试期继续使用 `operatorOpenId=69e75eb5e4b0e65b61c014da`。
- 后续可把字段展示元数据从业务包常量逐步迁移到可配置的业务包 manifest。
