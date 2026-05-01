# 0.7.8 记录列表关联对象展示补强

## 版本目标

- 修复联系人查询列表缺少关联客户的问题。
- 将关联对象作为记录列表中的关键展示内容，覆盖联系人、商机、跟进/拜访记录等带关系字段的对象。
- 保持主 Agent 核心业务无关，改动限定在 CRM 业务包结果视图和用户 AI 端记录结果组件。

## 范围

- 后端 `crm-agent-pack` 结果视图模型补强关联字段候选、`relationFields` 和摘要。
- 用户 AI 端 `RecordResultList` 增加“关联对象”列。
- 新增确定性回归测试，验证关联客户、关联联系人、关联商机能进入 A2UI 结果模型。

## 关键改动

- 抽出 CRM 关联字段标题候选，兼容 `关联客户`、`客户编号`、`联系人`、`商机` 等不同元数据标题。
- 记录结果主字段优先包含关联字段，联系人 subtitle 也带上关联客户，避免只展示地区造成关键信息缺失。
- A2UI 记录结果新增 `relationFields`，前端优先使用服务端明确给出的关联字段，字段名兜底只用于兼容历史结果。
- 关联对象值支持 `showName`、`displayName`、`_S_TITLE`、`_S_NAME` 等关系对象常见显示字段。
- 前端列表按对象类型展示“关联对象”列：
  - 联系人：展示关联客户。
  - 商机：展示关联客户、关联联系人。
  - 跟进/拜访记录：展示关联客户、关联商机、关联联系人。

## 验收

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-runtime.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 客户对象本身暂无父级关联字段，列表继续展示联系人、负责人、地区等关键字段。
