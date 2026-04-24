# 0.2.11 版本说明

## 版本目标

围绕影子系统 `searchList` 技能继续收口轻云 `8.按条件批量查询单据`：

- 让 `shadow.*_search` 与轻云官方 `searchList` 语义保持一致
- 补齐 `basicDataWidget` 关系字段的查询能力
- 强化搜索技能示例、输入约束与测试覆盖

## 范围

- `admin-api` 搜索预演 / 真实搜索链路
- `skills/shadow/*/search` 技能包与引用资源
- `admin-api` service / http 测试

## 已完成

- `shadow.customer_search` / `shadow.contact_search` 已正式暴露关系查询参数：
  - 客户：`linked_contact_form_inst_id`
  - 联系人：`linked_customer_form_inst_id`
- 搜索预演与真实搜索均支持：
  - 文本字段
  - 人员字段 `open_id`
  - 已解析公共选项
  - `basicDataWidget` 关系字段
- `basicDataWidget` 搜索规则已收口：
  - 模糊查询：传展示文本，省略 `operator` 或使用 `like`
  - 精确查询：带 `operator`
  - 若传 `formInstId/id` 或完整关系对象，服务端会优先归一化为关系对象数组
  - 若传字符串并带 `operator`，优先尝试按关系记录解析，失败时回退为字符串条件透传
- 生成的 `SKILL.md` 与 `references/execution.json` 已补齐：
  - 关系查询示例
  - `searchItems` 示例
  - `pageSize 1..100` 约束说明

## 测试与验证

- `pnpm --filter @yzj-ai-crm/admin-api test` 通过
- `pnpm --filter @yzj-ai-crm/admin-api build` 通过
- 新增 / 补强测试覆盖：
  - 搜索技能契约包含关系字段参数
  - `preview/search` 关系字段精确查询归一化
  - `preview/search` 关系字段模糊查询字符串透传
  - 搜索分页边界校验
  - HTTP 层 `preview/search` / `execute/search` 关系查询链路

## 真实联调结论

- 已使用真实环境验证 `searchList` 请求可以按新的技能契约发出
- 联系人按关联客户标题做关系字段模糊查询已返回结果
- 客户按关联联系人字段做模糊查询、以及当前尝试的 `operator=eq` 关系精确查询，尚未拿到稳定命中结果
- 这说明真实平台对 `basicDataWidget` 精确查询的最终入参语义，还需要继续结合列表页 `search2Gen` 抓包反查

## 下一步

- 继续反查真实列表页 `search2Gen`，确认 `basicDataWidget + operator` 的最终可命中结构
- 基于真实抓包结果补齐关系字段精确查询的 live 用例
- 视需要再决定是否为 `searchList` 增加 `resultItems` 的技能暴露

## 验收目标

- `shadow.customer_search` / `shadow.contact_search` 暴露正式可用的关系查询参数
- `preview/search` 与 `execute/search` 能正确处理文本、人员、枚举、关系字段查询
- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
