# 0.5.2 表单模板必填规则修复

## 版本目标

- 修复记录系统字段快照中“必填”属性来源过窄的问题。
- 保留主 Agent 内核业务无关，只在影子系统模板标准化层补齐云之家模板元数据解析。

## 范围

- `apps/admin-api`
- `apps/admin-pro`
- `packages/shared`
- `iterations/0.5.2/README.md`

## 关键修复

- 调用客户 `formCodeId=e2cfd2aef9bf4576a760aa1c6a557170` 的获取表单模板接口并核对真实响应。
- 模板标准化不再只读取 `widget.required`。
- 识别 `displaylinkageVos` 中的条件必填规则，并在字段快照中保留来源说明。
- 修正表单模板响应中 `formDefId` 可能位于 `basicInfo.formDefId` 的情况。

## 接口核对结果

- `formDefId`: `69ead33a9566a900010e50cb`
- `widgetCount`: `49`
- 静态 `required: true`: `0`
- 条件必填：`Ps_0 / 销售负责人`，来源 `Ra_1 / 客户是否分配`，条件为 `已分配`

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 暂不把条件必填自动提升为创建技能的硬性 `requiredParams`，避免把条件规则误判成全局必填。
