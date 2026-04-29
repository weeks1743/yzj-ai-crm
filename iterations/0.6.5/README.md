# 0.6.5 Meta Question Card + 枚举选项提示

## 目标

- 将等待补充信息从 Markdown 提示升级为结构化 Meta Question Card。
- 枚举/字典字段在对话流中展示可选项，用户不需要猜启用状态、客户类型、客户状态等取值。
- 修复同一实体多来源候选相互竞争导致的上下文不承接问题。

## 范围

- 主 Agent core/runtime 只增加通用问题卡、字段选项和结构化补充输入契约。
- CRM 字段语义仍只放在 `crm-agent-pack` 工具元数据和 ShadowMetadata 中。
- 不新增 `scene.*`，不新增 delete，不绕过 preview + confirm writeback。

## 实施记录

- `PendingInteraction` 增加 `questionCard`，`RecordWritePreviewRow` 增加字段选项提示。
- `record.*.preview_create/update` 在 `waiting_input` 返回 Meta Question Card，已识别字段进入 `currentValues`，缺失字段进入 `questions`。
- 枚举选项从 ShadowMetadata 字段 `options` 读取；`switchWidget` 按通用控件语义提供启用/停用选项。
- `POST /api/agent/chat` 支持 `resume.provide_input`，由后端根据等待态和 Tool Registry 元数据合并结构化答案。
- `SemanticReferenceResolver` 合并同一实体的 context/evidence/artifact 候选，避免同名候选互相竞争导致不承接。
- `assistant-web` 在对话流第一屏渲染 Meta Question Card，支持选项按钮和文本/手机号输入。
- 运行问题修复：`record.*.preview_create` 的写前查重如果遇到轻云 `searchList` 短暂失败，会先做一次有限重试；仍失败时进入可恢复等待态，保留已填字段，不绕过查重、不生成确认、不伪造成功。
- 查重失败的 trace 增加 `record.duplicate_check_unavailable` 策略决策，并记录 `record.*.search` 失败 tool call，便于排查上游状态。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，88/88。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。

## 未完成项

- 第一版只做对话卡片，不做右侧完整表单。
- `multi_select` 和 `reference` 已保留类型，但当前 UI 先按文本/单选基础能力落地。
