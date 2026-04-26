# 0.4.1 版本说明

## 版本目标

- 将外部技能市场正式映射到独立 `apps/skill-runtime`
- 把 5 个 PM 类 `3rdSkill` 纳入外部技能目录，并支持后台统一调试
- 保持 `ext.image_generate` 的专属试运行台，同时新增 `implementationType=skill` 的统一 Job 调试器

## 范围

- `apps/skill-runtime`
- `apps/admin-api`
- `apps/admin-pro`
- `packages/shared`
- `README.md`
- `.env.example`
- `iterations/0.4.1/README.md`

## 关键能力

### 1. 外部技能市场接入 skill-runtime

- `admin-api` 新增 `SKILL_RUNTIME_BASE_URL`
- 外部技能目录改为“静态 ext.* 元数据 + skill-runtime 实时 catalog / models”聚合输出
- 新增后台调试代理接口：
  - `POST /api/external-skills/:skillCode/jobs`
  - `GET /api/external-skills/jobs/:jobId`
  - `GET /api/external-skills/jobs/:jobId/artifacts/:artifactId`

### 2. 新增可调试的 PM 外部技能

- 正式纳入目录并开放后台调试：
  - `ext.company_research_pm`
  - `ext.customer_journey_map_pm`
  - `ext.jobs_to_be_done_pm`
  - `ext.problem_statement_pm`
  - `ext.saas_revenue_growth_metrics_pm`
- 本轮按你的要求忽略：
  - `discovery-interview-prep`

### 3. skill-runtime 扩展文本类 skill 执行

- 除 `company-research` 之外，新增 4 个 PM 文本类 skill 的统一执行模式
- 统一工具集固定为：
  - `read_skill_file`
  - `read_source_file`
  - `write_text_artifact`
- 统一输出 markdown artifact，并在必要时自动回填 `finalText`
- `customer-journey-map`
- `jobs-to-be-done`
- `problem-statement`
- `saas-revenue-growth-metrics`
  已从 `unsupported_yet` 提升为可执行

### 4. 管理后台统一调试台

- `ext.image_generate` 保留原有专属试运行表单
- `implementationType=skill` 的外部技能统一改为 Job 调试器：
  - 请求内容
  - 模型选择
  - 附件路径
  - 工作目录
  - Job 状态轮询
  - 事件时间线
  - `finalText`
  - artifact 下载

## 验收结果

- 已完成外部技能目录到 `skill-runtime` 的真实映射
- 已完成 5 个 PM 类外部技能的后台可调试接入
- 已补齐 `admin-api` 聚合层与 artifact 下载代理
- 已补齐 `skill-runtime` 通用文本类 skill 执行链
- 已保持图片生成链路不回退

## 未完成项

- `discovery-interview-prep` 本轮未纳入目录，也未开放调试
- `ext.presentation_generate` 与 `ext.audio_transcribe` 仍保持占位
- 用户 AI 端和场景编排层本轮不直接改造

## 验证要求

- `pnpm --filter @yzj-ai-crm/skill-runtime test`
- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- `pnpm --filter @yzj-ai-crm/skill-runtime build`
- `pnpm --filter @yzj-ai-crm/admin-pro build`
- `pnpm build`
