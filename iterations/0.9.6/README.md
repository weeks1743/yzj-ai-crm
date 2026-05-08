# 0.9.6 问题陈述分析资料归档回归修复

## 版本目标

- 修复录音下游 `问题陈述` 已完成但没有出现在拜访资料检索结果中的问题。
- 修复录音正式归档后后台重跑已完成下游分析时不等待 Job 完成，导致正式 `analysis_material` 未落库的问题。
- 将 `问题陈述` 纳入核心拜访分析补跑范围。

## 范围

- `apps/admin-api`：修复录音任务服务的下游分析重跑与核心分析补跑逻辑。
- `apps/admin-api/tests`：补充问题陈述归档、后台重跑等待和核心补跑回归测试。

## 关键结论

- skill-runtime 中的 `problem-statement-*.md` 只能证明外部技能产物已生成。
- 拜访资料列表读取的是正式归档的 `analysis_material` Artifact。
- 若旧产物仍包含“待绑定上下文/录音未关联客户商机”，不能直接保存为正式资料，必须用正式客户、商机、跟进记录锚点重跑后再落库。

## 验收结果

- [x] 归档后后台重跑已完成 `问题陈述` 会等待 Job 完成并保存正式 `analysis_material`。
- [x] `ensureCoreAnalysisMaterials(taskId)` 会补跑并归档 `拜访会话理解`、`客户需求工作待办分析`、`问题陈述`。
- [x] 本地贝斯美录音任务补齐正式 `问题陈述` 分析资料。
- [x] 拜访资料检索结果包含 `贝斯美拜访 - 问题陈述`。
- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/recording-task-service.test.ts tests/agent-runtime.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/admin-api test`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`

## 本地数据修复记录

- 对 `recording-task-f4aed9d9` 通过正式接口补跑 `ext.problem_statement_pm`，新 Job 为 `0776e73e-5614-4988-b549-b56eddc3e170`。
- Mongo 已生成正式 Artifact：`贝斯美拜访 - 问题陈述`，`sourceToolCode=ext.problem_statement_pm`，`artifactId=9904812e-4046-4177-a484-1aa9263dadca`，`vectorStatus=indexed`。
- 该资料头部已包含正式客户、商机、跟进记录锚点，不再包含“待绑定上下文 / 未关联客户商机”等旧上下文文案。
- 以客户锚点检索 `analysis_material` 时，结果已包含 `客户需求工作待办分析`、`问题陈述`、`拜访会话理解`。

## 兼容性说明

- 本轮修复走 `recording-task-service` 的正式服务路径，不依赖本地文件绝对路径或手工 Mongo 插入。
- 本地与 Docker 部署只要共享同一套 env key，并能访问 `admin-api -> skill-runtime -> Mongo/Qdrant/Postgres`，归档行为保持一致。
- UI 录音页展示的 skill job 完成态不能替代正式 Artifact；Agent 资料检索只消费正式 `analysis_material`。

## 未完成项

- 本轮不保存旧的未绑定上下文 `问题陈述` 为正式资料。
- 本轮不修改外部 Skill 语义。
