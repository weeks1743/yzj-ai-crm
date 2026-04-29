# 0.6.4 通用语义承接 + 4 家公司真实销售对话压测

## 目标

- 使用 LangGraph 既有运行图，补齐基于 Embedding 的通用语义承接能力。
- 从公司分析进入真实销售多轮对话，覆盖 Artifact、记录查询、写入预览、确认写回和客户旅程。
- 新增 live Harness，按表驱动方式真实调用 `/api/agent/chat`，并输出本地报告。

## 范围

- 主 Agent core/runtime 只增加通用语义候选、语义解析结果和 trace 字段。
- CRM 字段、对象绑定关系、写入字段展示仍只在 `crm-agent-pack` 元数据中表达。
- 不新增 `scene.*`，不新增 delete，不绕过 preview + `confirm_writeback`。

## 实施记录

- 新增 `SemanticReferenceResolver`，通过 embedding 相似度、候选分差、工具元数据决定是否承接上下文。
- `agent-reference-resolver.ts` 不再保留短指代词面正则，仅委托通用语义 resolver。
- `AgentRunRepository` 新增最近上下文候选查询，候选来源包括 run 主体、IntentFrame 和 Evidence Card。
- `agentTrace` 新增 `semanticResolution`，用于观察候选、得分、命中原因和目标覆盖情况。
- `record` 工具能力元数据新增 `subjectBinding.identityFromSubject`，用于表达“上文主体可作为当前记录身份”的通用绑定策略。
- `record` commit 成功后会把真实写回记录设置为新的通用 `ContextFrame`，后续联系人、商机、跟进和客户旅程可以通过工具元数据承接客户主体。
- Artifact 追问优先使用当前上下文主体作为 anchor，并过滤非实体型 artifact anchor，避免历史错误研究标题污染后续对话。
- Live Harness 增加公司研究重试、真实确认写回、轻云摘要查询重试和轮次节流，报告固定写入仓库根目录 `.local/agent-live-reports/`。

## 验收计划

- 自动化单测覆盖语义承接、等待恢复、写回确认、Tool Registry 不包含 `scene.*` / delete。
- Live Harness 使用金蝶苏州销售员视角，对 4 家客户执行每家公司不少于 12 轮真实销售旅程。
- Live 报告写入 `.local/agent-live-reports/`，报告不提交。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，81/81。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api test:live-agent-sales`：通过。
- 最终 live 报告：`.local/agent-live-reports/agent-live-sales-2026-04-29T01-32-21-707Z.json`。
- 4 家公司均完成不少于 17 轮真实对话；每家公司覆盖公司研究、Artifact 追问、客户查询、客户更新确认、联系人创建、商机创建、跟进创建、三类关系查询、客户旅程和下一步建议。
- 写回均走 preview + confirmation；未触发 `scene.*`，未触发 delete。

## 未完成项

- Live Harness 已能暴露外部 Skill 瞬态失败并重试；后续可把重试策略做成可配置运行参数。
- 当前 live 过程会真实写入测试联系人、商机、跟进记录，后续需要补充测试数据清理/归档策略，但仍不新增 delete 工具到主 Agent。
