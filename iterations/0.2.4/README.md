# 0.2.4 版本说明

## 版本目标

修正客户读取 / 更新链路中的参数命名偏差，将对外输入从误导性的 `recordId` 对齐为轻云原生语义 `formInstId`：

- `customer_get` 技能与执行示例统一改为 `formInstId`
- `preview/get`、`execute/get` 接口支持 `formInstId`
- `preview/upsert` 的更新模式支持 `formInstId`
- 兼容旧字段 `recordId`，避免打断已存在的测试脚本

## 范围

- 更新 `admin-api` 输入类型与校验文案
- 更新技能 contract / `SKILL.md` / `references/execution.json`
- 重新生成客户技能 bundle
- 用真实 `oid + formInstId` 复测客户详情读取

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- 使用真实 `oid + formInstId` 至少成功读取一条客户详情
