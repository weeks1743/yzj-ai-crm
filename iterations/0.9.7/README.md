# 0.9.7 录音后关联下游分析正式归档修复

## 版本目标

- 修复“先生成下游分析 Markdown，后新增/关联拜访记录”时，`问题陈述` 等分析没有正式落库的问题。
- 修复录音资料包已归档后再次确认同一跟进记录关联会提前返回，跳过下游分析补归档的问题。
- 兼容本地开发和 Docker 部署：admin-api 不依赖读取 skill-runtime 本地目录才能发现历史 Job。

## 范围

- `apps/admin-api`：补齐已归档录音的后关联分析补归档触发。
- `apps/skill-runtime`：提供只读 Job 列表查询，供 admin-api 按录音任务、文件名、MD5、客户/商机/跟进锚点搜索历史下游分析 Job。
- `apps/*/tests`：补充后关联与远程 Job 查询回归测试。

## 验收结果

- [x] 已归档录音再次调用 `requestArchiveTask` 且跟进记录相同时，仍会补跑并归档历史下游分析。
- [x] admin-api 可通过 skill-runtime HTTP 查询历史 completed job，不依赖共享 `.local/skill-runtime-artifacts`。
- [x] `问题陈述` 在后关联场景会用正式客户/商机/跟进锚点重跑并保存为 `analysis_material`。
- [x] `pnpm --filter @yzj-ai-crm/admin-api test`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] `pnpm --filter @yzj-ai-crm/skill-runtime test`
- [x] `pnpm --filter @yzj-ai-crm/skill-runtime build`

## 关键结论

- 用户“等任务完成生成 md 后才录入拜访记录并关联”的流程是正确流程，系统必须支持。
- 本质缺口不是用户没关联，而是后关联时系统把“录音资料包已归档”当作整个录音分析链路已完成，提前返回，跳过了下游 `问题陈述` 等历史 Job 的正式补归档。
- Docker 部署中 admin-api 不应假设能读取 skill-runtime 的 `.local` 目录；历史 Job 发现必须优先走 skill-runtime HTTP/数据库服务边界。

## 实现说明

- `requestArchiveTask` 对已归档且同 followup 的录音不再直接返回，会先触发 `ensureLinkedAnalysisMaterials`。
- `ensureLinkedAnalysisMaterials` 先重跑历史下游 Job；若历史 Job 不可发现，再兜底补跑核心分析资料。
- skill-runtime 新增 `GET /api/jobs` 只读查询，支持按 `skillName`、`status`、`query`、分页检索。
- admin-api 的 `ExternalSkillService.listSkillJobs` 使用上述接口发现历史 completed Job，适配本地和 Docker。

## 未完成项

- 本轮不修改外部 Skill 语义。
- 本轮不把旧的“未关联客户/商机”Markdown 直接保存为正式资料。
