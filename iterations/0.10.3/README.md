# 0.10.3 客户拜访准备助手接入

## 版本目标

- 将已有 `3rdSkill/yunzhijia-visit-prep` 正式接入后台外部技能目录、skill-runtime 与用户 AI 侧显性调用入口。
- 增加 `/拜访准备` 能力，让销售可基于已沉淀公司研究 Markdown 和客户初步需求生成拜访材料。
- 明确调用策略属于 Agent/工具编排规则，不写入公司分析 Markdown 正文。

## 范围

- 后台外部技能目录：新增 `ext.yunzhijia_visit_prep`。
- skill-runtime：开放 `yunzhijia-visit-prep` 为可执行文本类 Skill。
- Agent 业务包：新增通用外部工具 `external.yunzhijia_visit_prep`，执行前先查有效公司研究资料。
- 用户 AI 端：新增 `/拜访准备` slash 命令、Welcome/Prompts 显性入口和 Composer 提示。
- 文档治理：更新场景技能编排、拜访材料场景设计和项目公约。

## 调用逻辑

- `/拜访准备` 最少需要 `companyName` 与 `customerNeed`，可选 `visitAudience`。
- 执行前优先查询 `company_research` 资料资产。
- 若存在有效公司研究 Markdown，则作为附件传给 `ext.yunzhijia_visit_prep`，由 Skill 结合自带 `product-knowledge.md` 与 `output-template.md` 输出 Markdown。
- 若缺少有效公司研究 Markdown，则返回等待输入/建议先执行 `/公司研究 公司全称`，不调用拜访准备 Skill，也不编造客户背景。
- 产出沉淀为 `analysis_material` 分析资产，`sourceToolCode` 使用 `ext.yunzhijia_visit_prep`，不直接写客户、联系人、商机或跟进记录主数据。

## 验收结果

- 已通过：
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`：41 passed
  - `pnpm --filter @yzj-ai-crm/admin-api test`：217 passed, 1 skipped
  - `pnpm --filter @yzj-ai-crm/admin-api build`：通过
  - `pnpm --filter @yzj-ai-crm/admin-pro build`：通过
  - `pnpm --filter @yzj-ai-crm/assistant-web build`：通过，保留 Vite 大 chunk 提示

## 未完成项

- 不改写 `3rdSkill/yunzhijia-visit-prep/SKILL.md` 语义。
- 不让 `/拜访准备` 自动联网补做公司研究。
- 不把下游调用规则追加到公司分析 Markdown 正文。

## 下一步计划

- 根据真实销售拜访反馈补充拜访对象、行业案例和演示脚本字段。
- 后续可在后台增加拜访准备产物的独立筛选和复用入口。
