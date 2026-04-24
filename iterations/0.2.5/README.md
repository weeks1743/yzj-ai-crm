# 0.2.5 版本说明

## 版本目标

清理客户影子系统真实读链路中遗留的 `recordId` 兼容，统一收口为轻云原生参数 `formInstId`：

- `preview/get`、`execute/get` 只接受 `formInstId`
- `preview/upsert` 的更新模式只接受 `formInstId`
- live 响应中的记录主键字段统一输出为 `formInstId`
- 客户技能 bundle 文案与执行资源同步对齐 `formInstId`

## 范围

- 重构 `admin-api` 输入 / 输出契约
- 重构 `ShadowMetadataService` 内部 batch get 请求构造与 live record 映射
- 更新 `SKILL.md` 生成文案并重新生成客户技能 bundle
- 更新测试与版本说明

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- `skills/shadow/customer/get` 不再出现“按记录ID读取”或 `recordId` 兼容口径
