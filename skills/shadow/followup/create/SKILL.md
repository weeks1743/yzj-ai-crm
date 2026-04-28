---
name: shadow.followup_create
description: 按商机跟进记录模板预演轻云新建请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机跟进记录 Create

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
- 先把用户意图映射成业务语义参数，而不是要求其按模板字段码录单。
- 优先吸收当前对话里已经给出的值，再只追问缺失必填或高价值字段。
- 关系、人员、公共选项和附件先完成解析与校验，再生成 preview。
- 向用户展示将要写入的关键字段摘要，得到明确确认后才执行 live write。

### Parameter Collection
- 追问时使用业务标签，例如 followup_method (跟进方式)、linked_customer_form_inst_id (客户编号)、owner_open_id (跟进负责人) 等 4 项，不要直接暴露 `codeId`。
- 允许用户分多轮补充信息，不要一次性索要全部可选字段。
- 用户只给自然语言描述时，先保留原意图，再补齐必填和引用信息。
- 当用户只说“关联松井客户/挂到某联系人”这类口语化关系时，先 search 关联对象拿到精确记录，再回填。
- 人员字段默认收 `open_id`；若用户只给姓名且存在歧义，需要继续确认到具体人员。
- 附件字段先走上传技能或上传接口，拿到文件对象后再写入当前 skill。

### Clarification Rules
- 当 缺少必填字段 时：只追问当前创建必须补齐的字段，优先使用业务标签而不是参数名或字段码。
- 当 关联对象、人员或公共选项值无法唯一解析 时：返回候选或要求补充精确标识，不要自动猜测写入值。
- 当 用户要求写入当前未支持的字段 时：明确指出该字段当前未被影子技能支持，并建议留空或改走专门技能。

### Disambiguation Rules
- 关系字段如果命中多个记录，必须让用户选定唯一候选，不允许静默挑一个。

### Target Resolution
- create 不需要当前对象 `formInstId`，但所有关联对象都必须在写前解析成精确 id 或关系对象。

### Execution Guardrails
- 先 preview，再确认，再 live write。
- 不要为了凑齐 payload 发明默认值、`dicId`、关联记录或人员标识。
- 用户未提及的可选字段默认保持不写入，而不是自动补全。
- 当前模板中的未支持字段（如 地理位置(Lo_0, locationWidget) 当前未纳入影子技能写入支持）必须留空或走专门技能，不能近似写入。

## Input Rules

- Required params: followup_method, linked_customer_form_inst_id, owner_open_id, followup_record
- Optional params: Ra_2, Ra_0, Bd_4, linked_opportunity_form_inst_id, Da_0, Da_1, At_0
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
