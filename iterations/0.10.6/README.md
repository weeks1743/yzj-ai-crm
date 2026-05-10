# 0.10.6 下线 super-ppt 与外部技能占位清理

## 目标

- 全量下线不稳定的 `super-ppt` / Docmee 特化能力。
- 删除外部技能列表中的【录音处理服务（内置）】占位数据对应的 `ext.audio_transcribe` 展示和依赖引用。
- 保留真实录音闭环：录音上传、通义录音处理服务、资料包归档、下游分析技能和设置页继续可用。

## 范围

- 删除 `3rdSkill/super-ppt`、`apps/super-ppt-editor` 和根脚本里的 super-ppt editor 入口。
- 移除后端 `ext.super_ppt` 注册、Docmee 客户端、企业 PPT 模板服务、Artifact PPT 生成服务、presentation session 代理和相关配置。
- 移除 skill-runtime 中 super-ppt model-free 分支、Docmee official flow、诊断脚本和 presentation session API。
- 移除管理端 super-ppt 编辑器跳转页、Docmee 静态资源、技能详情页 super-ppt 专属 UI、企业 PPT 模板设置页。
- 清理共享 mock/catalog 中 `ext.super_ppt` 与 `ext.audio_transcribe` 外部技能占位行及依赖引用。
- 保留通用 `pptx` 技能、PPTX 渲染、QA 和预览工具。

## 关键变更

- 外部技能目录不再返回 `ext.super_ppt` 或 `ext.audio_transcribe`。
- 场景组装和 Agent 工具治理不再将录音转写占位作为外部技能依赖。
- 录音处理入口继续走 `apps/tongyi-audio-service` 与 `admin-api` 的 `/api/recording-audio-tasks` 链路。
- 根 README 已更新到当前 `0.10.6` 能力基线，并移除 super-ppt editor 目录说明。

## 验收结果

- 已增加/保留断言：外部技能目录不包含 `ext.super_ppt` 与 `ext.audio_transcribe`。
- 已增加/保留断言：skill-runtime 技能目录不包含 `super-ppt`。
- 已保留录音处理 HTTP 测试，覆盖 meeting-viewer 跳转和下游分析技能创建。
- `pnpm install --lockfile-only` 已完成，lockfile 已移除 super-ppt editor 工作区引用。
- `pnpm --filter @yzj-ai-crm/admin-api test` 已通过：245 个测试，244 通过，1 个 live 测试按环境跳过。
- `pnpm --filter @yzj-ai-crm/skill-runtime test` 已通过：32 个测试全部通过。
- `pnpm build` 已通过；assistant-web 构建保留既有大 chunk 体积提醒。

## 未完成项

- 若本地仍有旧开发服务在运行，需要重启 `admin-api`、`skill-runtime`、`admin-pro` 后再刷新页面。

## 下一步

- 启动或重启本地服务后，在管理端外部技能列表和 Agent 工具治理页复查 `super-ppt` 与录音占位不再显示。
