# 0.2.20 版本说明

## 版本目标

- 将影子系统技能从“客户 / 联系人已联通”扩展到“商机 / 商机跟进记录可生成”
- 打通 `opportunity`、`followup` 两个对象的模板刷新与 `SKILL.md` 技能包生成链路
- 用最小但真实的回归测试锁定四对象统一治理能力，避免后续再次因配置开关导致对象失活

## 范围

- `apps/admin-api` 影子对象配置启用 `商机` 与 `商机跟进记录`
- `apps/admin-api` 测试基线、服务测试、HTTP 测试补齐这两个对象的刷新与技能生成覆盖
- `skills/shadow/opportunity`、`skills/shadow/followup` 通过真实刷新生成技能包

## 验收结果

- `opportunity`、`followup` 已从配置层正式激活，不再停留在 `pending`
- 后端刷新后可生成以下技能：
  - `shadow.opportunity_search`
  - `shadow.opportunity_get`
  - `shadow.opportunity_create`
  - `shadow.opportunity_update`
  - `shadow.opportunity_delete`
  - `shadow.followup_search`
  - `shadow.followup_get`
  - `shadow.followup_create`
  - `shadow.followup_update`
  - `shadow.followup_delete`
- 服务层与 HTTP 层测试已覆盖：
  - 两个对象的模板刷新
  - 五类技能合同生成
  - 技能包路径与对象名绑定正确
  - 关系字段在搜索技能中按对象正确暴露
- 新生成技能包阶段标识已更新为 `0.2.20`

## 未完成项

- 本轮仅补齐技能生成，不包含商机 / 跟进记录的真实增删改查联调样例
- 公共选项、附件、复杂关联场景仍需按对象继续增加真实案例验证
- 后续仍需补齐这两个对象的更丰富字段语义与真实写入测试

## 下一步计划

- 对商机、商机跟进记录补充真实 `search / get / create / update / delete` 联调
- 将新增对象技能同步纳入管理后台对象治理页的真实状态展示
- 继续扩展场景编排依赖，让 `scene.*` 能识别商机与跟进记录能力是否可用
