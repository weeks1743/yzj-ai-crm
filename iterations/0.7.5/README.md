# 0.7.5 QA-Agent 概率质检与完整交互用例扩展

## 版本目标

- 将线上 trace 问题转成可重复回放的完整交互用例，避免只靠人工肉眼复现。
- 新增 QA-agent 类确定性质检器，对每轮 trace 做风险概率评分和硬失败检查。
- 扩展 48 条完整多轮会话用例，覆盖 trace 回放、元数据字段写入、上下文隔离、LLM target 污染、补槽/确认/取消等高风险路径。
- 修复 `trace-agent-f66b5851` 暴露的联系人备注更新问题：`更新备注，喜欢喝茶` 不能再因为 `params={}` 被空 payload 守卫阻断。

## 范围

- 后端 Agent 通用语义层和 CRM 业务包测试。
- 不新增 `scene.*`。
- 不改前端 UI。
- 不把苏州、安徽、客户名、联系人名写入 Agent 核心逻辑。

## 关键实现

- `crm-agent-pack` 写入参数提取改为使用静态工具契约与 Shadow 元数据 promptable 字段的并集。
- 支持销售口语中的逗号式字段赋值，例如 `更新备注，喜欢喝茶`。
- 字段语义别名清洗新增泛化防护，避免 `客户信息` 裁剪出的 `信息` 抢占 `信息化负责人` 这类真实字段值。
- Scenario harness 新增 `TraceQualityReport`：
  - `bugProbability`
  - `riskFactors`
  - `hardFailures`
  - `recommendedFixArea`
- QA 质检硬性不变量：
  - 写入意图有字段和值但 `params={}` 必须失败。
  - 裸集合查询不得使用历史上下文。
  - 未落在用户原文中的 LLM target 不得进入 filters。
  - 关系字段不得在待确认写回时直接写入普通中文文本。
  - 裸集合查询不得把旧主体沉淀成当前上下文。

## 新增测试

- 新增 48 条 QA-agent 完整交互场景，当前为 176 轮以上对话。
- 新增类别：
  - Trace 回放类：8 条。
  - 元数据字段写入类：16 条。
  - 上下文/记忆隔离类：8 条。
  - LLM target 污染类：8 条。
  - 恢复/补槽/确认类：8 条。
- 调整后完整交互场景总量约 128 条，覆盖 428 轮以上多轮对话。

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-scenario-harness.test.ts`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api test`：通过，133/133。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。

## 未完成项

- 真实 LLM judge 暂不纳入阻塞 CI，本轮使用固定规则和固定阈值保持确定性。
- 后续每个线上 trace 问题继续遵循：先 fixture replay，再修复，再补抽象不变量。
