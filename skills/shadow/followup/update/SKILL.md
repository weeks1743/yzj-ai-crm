---
name: shadow.followup_update
description: 按商机跟进记录模板预演轻云更新请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机跟进记录 Update

Use this bundle only for the `followup` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `0a618c5d806545b997f60e8461b3f504`
- `source_version`: `2026-04-28T10:37:10.888Z`
- `schema_hash`: `52e8c079bd1f567f8b31c0b1d092880264eadf215a694fdf03dadc97ddee5a9b`
- `field_count`: `23`
- `resolved_public_option_fields`: `0`
- `pending_public_option_fields`: `0`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Interaction Strategy

### Recommended Flow
- 先解析用户要改哪一条记录，以及要改哪些字段。
- 如果缺少 `form_inst_id`，先用名称、编码、关联线索或日期条件 search，拿到唯一目标后再更新。
- 只收集用户明确想改的字段；未提及字段保持原值不动。
- 变更值归一化后先生成 preview，得到明确确认后再执行 live write。

### Parameter Collection
- 追问时优先使用业务标签和变更目标，不要求用户先给字段码。
- 如果用户像“把松井客户类型改成 VIP 客户”这样表达，先提取目标线索与变更意图，再通过 search 解析目标记录。
- 如果已经有上一跳 search / get 结果，优先复用其中的 `formInstId`。
- 当更新关系字段时，优先把用户口语化描述解析成关联对象，再回填精确关系值。
- 附件更新仍应先完成上传，再把上传结果对象作为变更值写入。

### Clarification Rules
- 当 目标记录尚未唯一解析 时：先返回候选并要求用户选择唯一记录，再进入 update。
- 当 没有提取到任何有效变更字段 时：请用户明确说明希望修改哪些字段和值，而不是直接发起空更新。
- 当 新值是歧义的人员、关联对象或公共选项 时：要求补充精确标识、候选选择或完整 `{title,dicId}`，不要自动猜测。

### Disambiguation Rules
- 关系字段若命中多个候选，必须停下来澄清，不允许直接覆盖已有关联。
- 人员字段同名或无法唯一识别时，只接受精确 `open_id` 或唯一候选。

### Target Resolution
- update 的硬前置是唯一目标；可以通过 search 获得 `formInstId`，但不能直接按模糊名称更新。

### Execution Guardrails
- 只发送 `form_inst_id` 加本次变更字段，不清空未提及字段。
- 先 preview，再确认，再 live write。
- 当前模板中的未支持字段（如 地理位置(Lo_0, locationWidget) 当前未纳入影子技能写入支持）必须拒绝写入，不能用近似结构替代。
- 如果当前上下文能拿到旧值，应在确认摘要中显式展示旧值 / 新值，避免误覆盖关键字段。

## Input Rules

- Required params: form_inst_id
- Optional params: Ra_2, Ra_0, followup_method, Bd_4, linked_opportunity_form_inst_id, linked_customer_form_inst_id, Da_0, Da_1, owner_open_id, followup_record, At_0
- Derived params: _S_TITLE
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.

- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.
- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.
- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.
- Relation field `Bd_4` maps to `Bd_4`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `eea919bb0e69418698ff457e74cc1c2b`.
- Relation field `linked_opportunity_form_inst_id` maps to `Bd_3`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `b1869173654e49fbac0b1fc6ad37e761`.
- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_ENCODE` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.

## Field Audit

- 模板必填（需用户补齐）: `followup_method` -> 跟进方式(`Ra_1`, radioWidget, source=internal_get_form_by_code_id), `linked_customer_form_inst_id` -> 客户编号(`Bd_0`, basicDataWidget, source=internal_get_form_by_code_id), `owner_open_id` -> 跟进负责人(`Ps_0`, personSelectWidget, source=internal_get_form_by_code_id), `followup_record` -> 跟进记录(`Ta_0`, textAreaWidget, source=internal_get_form_by_code_id)
- 条件必填（preview 触发校验）: (none)
- 自动派生（preview/live 自动生成）: `_S_TITLE` -> 标题(`_S_TITLE`, textWidget, source=internal_get_form_by_code_id)
- 只读不暴露（用户输入会被阻断）: `Te_4` -> 商机名称(`Te_4`, textWidget, source=internal_get_form_by_code_id), `Te_1` -> 联系人姓名(`Te_1`, textWidget, source=internal_get_form_by_code_id), `Te_0` -> 客户名称(`Te_0`, textWidget, source=internal_get_form_by_code_id), `_S_APPLY` -> 提交人(`_S_APPLY`, personSelectWidget, source=internal_get_form_by_code_id), `Lo_0` -> 地理位置(`Lo_0`, locationWidget, source=internal_get_form_by_code_id), `De_0` -> 说明文字(`De_0`, describeWidget, source=internal_get_form_by_code_id), `De_1` -> 说明文字(`De_1`, describeWidget, source=internal_get_form_by_code_id), `De_2` -> 说明文字(`De_2`, describeWidget, source=internal_get_form_by_code_id), `_S_SERIAL` -> 跟进记录编号(`_S_SERIAL`, serialNumWidget, source=internal_get_form_by_code_id), `_S_DATE` -> 申请日期(`_S_DATE`, dateWidget, source=internal_get_form_by_code_id), `_S_DEPT` -> 所属部门(`_S_DEPT`, departmentSelectWidget, source=internal_get_form_by_code_id)

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/followup/preview/upsert`
- Internal live API: `POST /api/shadow/objects/followup/execute/upsert`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- This bundle is generated for phase `0.6.0`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
