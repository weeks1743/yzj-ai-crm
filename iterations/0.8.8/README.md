# 0.8.8 公司研究 Skill 纯粹性恢复

## 版本目标

- 移除 `/公司研究` 外层调用中对“销售切入点”的要求。
- 保持原始公司研究 Skill 更偏公司资料、业务定位、成长驱动、风险和来源引用。

## 范围

- 修改公司研究外部 Skill 调用 prompt。
- 修改公司研究结果落库前的有效性判定。
- 修改用户端公司研究说明文案和对话层设计文档。
- 调整相关测试 mock，避免把销售切入点作为公司研究默认输出。

## 关键能力

- `/公司研究` 调用外部 Skill 时只要求输出公司概览、业务定位、成长驱动、核心风险和来源引用。
- 有效性判定不再依赖“销售切入”或“切入点”等销售语义。
- 销售切入点、拜访建议等内容留给公司研究后的派生问答或后续销售速览能力。
- 公司研究后的追问采用业务无关的上下文问句判定：当会话已有上下文资料，且用户输入是问句、没有显式写入/查询记录/重新研究意图时，路由到 `artifact.search`，不通过业务关键词白名单判断。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已执行：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-service.test.ts tests/agent-scenario-harness.test.ts`，新增上下文问句追问用例通过；命令整体仍被既有 live 风格用例缺少 `DEEPSEEK_API_KEY` 拦截。
- 已执行：`pnpm --filter @yzj-ai-crm/admin-api test`，149/150 通过；剩余 1 个为既有 live 风格用例缺少 `DEEPSEEK_API_KEY`：`AgentService rejects real company research result for nonexistent company without artifact`。

## 未完成项

- 本轮不删除 SOUL 设置能力。
- 本轮不新增销售速览卡。
- 本轮不修改原始 `3rdSkill/company-research` Skill 模板。
