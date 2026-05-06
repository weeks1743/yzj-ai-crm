# 0.8.15 记录列表 live widgetValue 字段恢复

## 目标

- 修复 `trace-agent-ac9d8f87` 中 `查询客户` 列表状态、地区、负责人为空的问题。
- 保持记录系统 Skill 作为黑盒工具，修复轻云 live 返回结果到通用记录展示模型的适配层。
- 继续保证用户可见层不展示 `formInstId`、`openId` 等内部 ID。

## 范围

- 当轻云列表/详情返回 `fieldContent: []` 且 `important: {}` 时，从同记录的 `formInstance.widgetValue` 补齐标准字段。
- 字段标题、控件类型和枚举展示值来自当前对象元数据快照：
  - `radioWidget` 映射为业务选项标题。
  - `switchWidget` 映射为启用/停用。
  - `publicOptBoxWidget` 映射为地区等公共选项标题。
  - `personSelectWidget` 优先按组织员工表把 openId 映射为中文名，查不到时展示为 `已绑定人员`，避免泄露 openId。
- 对记录展示文本中嵌入的人员 openId 做脱敏。

## 验收

- `查询客户` 即使上游只返回 `formInstance.widgetValue`，列表仍可展示客户状态、客户类型、省、市、负责人等字段。
- 用户可见标题和字段不再直接显示人员 openId；能解析员工时展示中文名。
- 点击查看详情仍保留隐藏的 `formInstId` 动作上下文。

## 未完成项

- 未同步到组织员工表的 openId 仍只能显示为 `已绑定人员`。
- 本轮不调整记录系统 Skill 的查询语义和写入语义。
