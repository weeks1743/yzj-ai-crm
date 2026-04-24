# 0.2.17 版本说明

## 版本目标

- 为影子系统补齐 `4.批量删除（有流程、无流程）单据` 技能
- 让删除能力沿用现有影子技能生成体系，同时具备 `preview`、`execute`、`SKILL.md` 与 `references/execution.json`
- 保持删除操作为显式确认后的真实写入能力，不引入额外复杂配置

## 范围

- `apps/admin-api` 删除契约、预演、执行与 HTTP 路由
- `skills/shadow/*/delete` 技能 bundle 生成
- `admin-api` service / http / lightcloud-client 测试

## 验收结果

- 新增对象级删除技能：
  - `shadow.customer_delete`
  - `shadow.contact_delete`
- 删除技能已生成标准技能包结构：
  - `SKILL.md`
  - `agents/openai.yaml`
  - `references/skill-bundle.json`
  - `references/template-summary.json`
  - `references/template-raw.json`
  - `references/dictionaries.json`
  - `references/execution.json`
- `admin-api` 已新增：
  - `POST /api/shadow/objects/:objectKey/preview/delete`
  - `POST /api/shadow/objects/:objectKey/execute/delete`
- 删除请求体已按轻云官方 `batchDelete` 语义输出：
  - `eid`
  - `formCodeId`
  - `oid`
  - `formInstIds`
- 删除技能明确要求 `form_inst_ids` 必须来自先前的搜索或详情读取结果，不能猜测或模糊推导

## 未完成项

- 本轮未对真实业务数据执行线上删除联调
- 仍需在后续按业务确认选择真实删除样本后再做 live destructive validation

## 下一步计划

- 结合真实对象继续补 delete 的联调样本与误删保护说明
- 如有需要，再补“按条件先搜索再删除”的组合调用范式示例
