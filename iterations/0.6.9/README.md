# 0.6.9 歧义意图先查客户再询问

## 版本目标

- 修复“给出 XXX 公司信息”这类表达直接触发外部公司研究的问题。
- 当用户意图在“查看已有客户信息”和“进行公司研究”之间有歧义时，先执行只读客户记录探测。
- 探测命中后用 Meta Question Card 让用户选择下一步，避免自动生成不必要的公司研究 Artifact。

## 范围

- 在 `crm-agent-pack` 中增加歧义公司信息查询的仲裁逻辑。
- 通过现有 `record.customer.search` 做 existence probe，不改记录系统 Skill 语义。
- 通过通用 `PendingInteraction` / `ContinuationResolver` 恢复用户选择，路由到 `record.customer.get` 或 `external.company_research`。
- 继续禁止 `scene.*` 和 delete 工具。

## 关键行为

- 明确研究意图，例如“研究/公司研究/客户分析/分析一下 XXX”，直接走 `external.company_research`。
- 明确记录查询意图，例如“查询/查看/打开 XXX 客户资料”，直接走 `record.customer.search`。
- 歧义表达，例如“给出/提供/展示 XXX 公司信息/客户信息”，先走 `record.customer.search`。
- 如果探测命中已有客户，返回结构化问题卡，选项为“查看客户信息 / 进行公司研究”。
- 如果探测未命中，不自动公司研究，仍返回问题卡建议用户选择研究或重新输入客户名称。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test -- tests/agent-runtime.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 本轮不改记录系统 Skill。
- 本轮不新增浏览器端 E2E；前端只沿用现有 Meta Question Card 渲染能力。
