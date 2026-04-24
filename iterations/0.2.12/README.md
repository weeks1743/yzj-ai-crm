# 0.2.12 版本说明

## 版本目标

围绕影子系统查询技能继续对齐真实 `search2Gen`：

- 按 `search2Gen` 样例修订 `basicDataWidget` 精确查询形态
- 审计并补强“基础类型字段 / 引用类型字段”的查询覆盖
- 检查客户模板中 `Bd_1` 展示字段改为“联系人编号”后，技能与测试是否同步

## 范围

- `admin-api` 搜索参数标准化
- `skills/shadow/*/search` 技能 bundle
- `admin-api` service / http 测试与覆盖审计

## 本轮结论

- 查询技能已按两类覆盖审计：
  - 基础类型字段：覆盖 `text/textArea/number/radio/date/person/switch/serial` 等可直接进入 `search2Gen` 的字段。
  - 引用类型字段：覆盖 `basicDataWidget`，并按 `search2Gen` 规范在精确查询时生成 `[{_id_,_name_}]`。
- 当多个字段共享同一语义槽位时，查询契约不再折叠成单一别名，而是按字段级参数暴露，避免 `phone` / `customer_status` 这类场景丢失字段覆盖。
- 客户模板中的 `Bd_1` 已按真实模板切换到“联系人编号”展示列，当前 `displayCol = _S_SERIAL`，因此客户侧搜索技能、示例与测试都需要以 `_S_SERIAL` 为准。
- 自动搜索参数仍明确排除：附件字段、未解析码表的公共选项字段、明细控件与说明类控件。
- 真实联调新增发现：
  - `contact` 的 `searchList` 真实返回主键在 `formInstId`，已补充兼容，联系人搜索可按真实返回正确识别命中记录。
  - `customer` 的真实查询仍返回空列表，当前已确认不是 `formInstId` 映射问题，后续需继续排查 `search2Gen` 包体与客户对象视图配置差异。
