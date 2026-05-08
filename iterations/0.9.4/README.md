# 0.9.4 拜访资料检索回归修复

## 版本目标

- 修复“贝斯美/斯美 拜访重点有哪些”进入通用澄清卡的问题。
- 修复拜访需求摘要在没有正式 `analysis_material` 时只命中录音资料包但抽不到业务重点的问题。
- 为已绑定客户、商机、跟进记录的录音任务提供核心拜访分析资料补跑路径。

## 范围

- `apps/admin-api`：扩展 `meta.context_summary` 拜访资料问法识别和录音 fallback 摘要抽取。
- `apps/admin-api`：新增录音任务核心分析资料补跑服务方法，覆盖“拜访会话理解”和“客户需求工作待办分析”。
- `apps/admin-api/tests`：补充两个 trace 对应的路由、fallback 和补跑回归测试。

## 关键能力

- “拜访重点 / 沟通重点 / 客户关注点”等问法会进入拜访摘要，不再要求补充“目标对象或任务类型”。
- 未检索到正式分析结果时，会优先从录音资料包中包含业务信号的片段提炼需求和重点，并提示需要补跑正式分析资料。
- `recordingTaskService.ensureCoreAnalysisMaterials(taskId)` 可用于对已正式归档的录音任务补跑核心分析资料。

## 验收结果

- [x] `贝斯美 拜访重点有哪些` 选择 `meta.context_summary`，状态为 `completed`。
- [x] `斯美上次拜访客户主要提了什么需求` 在 `analysis_material=0`、`recording_material>0` 时仍能输出录音中明确需求。
- [x] 已完成本地贝斯美录音任务 `recording-task-f4aed9d9` 的核心分析资料补跑，生成 `贝斯美拜访 - 拜访会话理解` 与 `贝斯美拜访 - 客户需求工作待办分析`。
- [x] 真实验证 `斯美上次拜访客户主要提了什么需求`：`analysis_material` 找到 10 条，`artifact.get` 成功回读完整客户需求工作待办分析 Markdown。
- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-runtime.test.ts tests/recording-task-service.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/admin-api test`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`

## 未完成项

- 本轮不新增用户端 HTTP API。
- 本轮不修改外部 Skill 语义。

## 下一步计划

- 评估是否在运行洞察中显示“分析资料缺失、已基于录音 fallback”的更细颗粒度诊断。
