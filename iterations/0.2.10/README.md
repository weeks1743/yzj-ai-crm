# 0.2.10 版本说明

## 版本目标

基于用户在影子系统中的真实保存结果，反查并收口 `basicDataWidget` 的最小可用写入格式，让联系人与客户的关联字段能稳定进入影子技能链路：

- 反查客户 `Bd_1` 与联系人 `Bd_0` 的真实 `rawValue` 结构
- 将 `basicDataWidget` 从“仅保留模板上下文”升级为正式可写关系字段
- 联系人对象补回 `_S_NAME / _S_TITLE / _S_ENCODE` 的可写能力，支持联系人创建链路继续收口
- 更新技能说明与测试，固定最小对象形态，避免继续依赖手写全量原始请求

## 范围

- `admin-api` 新增 `basicDataWidget` 关系字段解析与关联记录自动展开
- `shadow` 元数据中补充关系绑定信息，技能契约暴露 `linked_customer_form_inst_id` / `linked_contact_form_inst_id`
- 联系人技能恢复系统字段写入能力：`_S_NAME`、`_S_TITLE`、`_S_ENCODE`
- 增补 HTTP / service / 真实联调用例

## 已验证结论

- 客户 `Bd_1` 的真实最小可用格式已确认：
  - `id`
  - `formCodeId`
  - `formDefId`
  - `flowInstId`
  - `showName`
  - `_S_NAME`
  - `_name_`
  - `_S_TITLE`
  - `_S_ENCODE`（若存在则作为显示值）
- 当 `_S_ENCODE` 存在时，客户详情页的 `Bd_1.value` 显示 `_S_ENCODE`
- 当 `_S_ENCODE` 缺失时，可退回 `showName / _S_TITLE` 作为展示兜底
- `_S_ENCODE` 只能作为显示列补充，不能替代 `showName / _S_TITLE / _S_NAME / _name_`；若调用方只传 `id/formCodeId/formDefId/_S_ENCODE`，服务端会回查关联记录后再构造完整轻云对象
- 用户在系统中保存后的客户 `Bd_1` 回读格式已用于校准：外层保留 `codeId/rawValue/value`，写入时 `widgetValue.Bd_1` 使用 `rawValue` 内的对象数组形态

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test` 通过
- `pnpm --filter @yzj-ai-crm/admin-api build` 通过
- 使用真实客户 `69e89245d096b40001ae1b97` 与真实联系人 `69ea4a6fdf79ea0001e30a92` 验证 `shadow.customer_update` 可写入 `Bd_1`
- 回读确认客户 `Bd_1.rawValue[0]` 包含联系人 `id/formCodeId/formDefId/flowInstId/showName/_S_NAME/_name_/_S_TITLE/_S_ENCODE`，且 `value` 显示联系人编码

## 下一步

- 将联系人创建与客户关联整理成单条可复用 shadow 技能路径
- 继续补充 `basicDataWidget` 反查失败、关联记录不存在、编码重复等边界测试
