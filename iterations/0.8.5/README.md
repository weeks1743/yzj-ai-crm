# 0.8.5 个人 SOUL 设置与销售身份展示

## 版本目标

- AI 销售工作台新增个人设置页，用于维护用户级 SOUL 销售上下文。
- 左下角问号按钮替换为设置按钮，进入个人设置页。
- 当前测试 OpenID 展示为中文名 `陈伟棠`，不再展示“当前租户”。

## 范围

- 新增 `agent_personal_settings` 持久化表，按 `eid + operatorOpenId` 保存 SOUL，记录 `appId`。
- 新增个人设置读取与保存接口。
- 新增用户端个人设置页，支持查看、保存和恢复默认 SOUL。
- 本轮只保存 SOUL 配置，不改变 `/公司研究` 的生成链路，不新增销售速览卡。

## 关键页面 / 能力

- AI 销售工作台：
  - 左下角显示 `陈伟棠` 和金蝶云之家销售身份 / SOUL 状态。
  - 设置按钮进入 `/settings/personal`。
  - 个人设置页保留工作台侧栏，主区域展示 SOUL 文本配置。
- `admin-api`：
  - `GET /api/agent/personal-settings?operatorOpenId=...`
  - `PUT /api/agent/personal-settings`
  - 员工名优先从组织同步表解析，测试 OpenID 兜底为 `陈伟棠`。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-personal-settings-service.test.ts tests/database.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`
- 未通过：`pnpm --filter @yzj-ai-crm/admin-api test`
  - 失败用例：`AgentService rejects real company research result for nonexistent company without artifact`
  - 失败原因：当前环境缺少该现有真实公司研究用例要求的 `DEEPSEEK_API_KEY`，非本轮 SOUL 设置链路失败。

## 未完成项

- 本轮不把 SOUL 注入公司研究执行链路。
- 本轮不新增销售速览、拜访问题清单或后续跟进内容生成。
- 后续消费 SOUL 时，应作为工具输入上下文传入派生生成能力，不进入 Agent core，不新增 `scene.soul` 运行时技能。
