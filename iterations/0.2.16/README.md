# 0.2.16 版本说明

## 版本目标

- 修正影子系统查询技能在 `basicDataWidget` 与日期字段上的真实联调偏差
- 明确 `operatorOpenId` 对客户与联系人查询可见性的差异
- 让生成的 `SKILL.md` 与 `references/execution.json` 对齐当前可用的真实查询语义

## 范围

- `apps/admin-api` 查询参数标准化
- `skills/shadow/*/search` 技能 bundle 与示例
- `admin-api` service / http 测试与真实联调验证

## 验收结果

- `basicDataWidget` 搜索已收敛为两条稳定路径：
  - 精确输入走 `operator=contains + [{_id_,_name_}]`
  - 展示文本输入走最小字符串查询，不再把纯字符串透传给 `contains`
- `dateWidget` 搜索已按真实 `search2Gen` 语义统一为 `range + [startTs,endTs] + lightFieldMap.plusDay=false`
- 客户搜索技能已明确标注可见 `operatorOpenId` 样例为 `69e75eb5e4b0e65b61c014da`
- 联系人搜索技能已明确标注可见 `operatorOpenId` 样例为 `66160cfde4b014e237ba75ca`
- 客户搜索示例已更新为“联系人编号最小展示值 + 日期区间时间戳”组合

## 未完成项

- 仍未为查询链路引入复杂的视图元数据缓存或对象级默认 `operatorOpenId`
- 省 / 市 / 区公共选项字段仍等待完整码表后再进入自动搜索参数

## 下一步计划

- 继续用真实对象补齐更多搜索用例，尤其是人员、多选、公共选项的组合条件
- 在后续迭代中评估是否需要把常用联调 `operatorOpenId` 收敛到独立文档或管理侧配置
