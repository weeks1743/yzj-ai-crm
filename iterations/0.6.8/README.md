# 0.6.8 记录更新身份承接与内部 ID 隐藏

## Summary

- 修复记录创建成功后，用户继续说“这是安徽客户，请修改省市区信息”时，系统要求普通用户填写 `form_inst_id` 的问题。
- 本质原因是 `record.*.preview_update/get` 没有复用当前 `ContextFrame.subject.id`，而是只从用户文本里提取轻云内部记录 ID。
- 本轮保持主 Agent core/runtime 业务无关；修复放在 record 工具输入构造、CRM 工具元数据解释和通用预览守卫展示层。

## Changes

- `record.*.preview_update/get` 优先从当前记录上下文绑定 `formInstId`。
- update 预览不再默认把上下文记录名称作为待更新字段，避免用户只想补省市区时误更新客户名称。
- 基于字段 options 从自然语言中补充枚举/字典字段，例如“安徽客户”可映射到 `province=安徽`。
- 如果确实没有可更新的记录上下文，系统提示“需要先确定要修改的记录”，不再把 `form_inst_id` 暴露给普通用户。
- 写回成功正文不再展示内部表单实例 ID；调试信息仍可在 trace/debugPayload 中查看。

## Validation

- 新增用例覆盖：
  - 刚写入/查询后的上下文记录可直接进入 update preview。
  - update 无上下文时不调用 preview，也不展示 `form_inst_id`。
  - “安徽客户”能被字段元数据映射为省份字段。

## Notes

- 未修改记录系统 Skill 语义。
- 未新增 `scene.*`。
- 后续可继续增强为“无上下文时自动 search -> 单候选绑定 / 多候选选择”的完整候选流程。
