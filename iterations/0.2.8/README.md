# 0.2.8 版本说明

## 版本目标

继续收口客户影子技能的字段行为，优先解决“能不能稳定调用”和“技能契约是否清晰”：

- 人员字段统一按云之家人员 `open_id` 输入
- 附件字段暂不进入客户影子技能可写链路
- 缺少 `referId` 的省 / 市 / 区公共选项字段暂只保留在 references 中，不阻塞技能执行
- 补充更贴近真实客户模板的测试，覆盖日期、单选、人员、公共选项与忽略字段

## 范围

- 重构 `ShadowMetadataService` 的字段忽略与归一化逻辑
- 扩展语义槽位，补齐 `service_rep_open_id`、`customer_type`、`last_followup_date`
- 更新 `SKILL.md` 生成文案，明确 `open_id` 与忽略字段规则
- 扩展 `admin-api` service / HTTP 测试覆盖

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- 客户技能合同中不再暴露附件与缺少 `referId` 的省 / 市 / 区字段
- `service_rep_open_id` 能稳定归一化为轻云要求的人员数组值
