---
name: shadow.customer_update
description: 按客户模板预演轻云更新请求，并引用当前模板快照与公共选项资源。
---

# Shadow 客户 Update

Use this bundle only for the `customer` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `e2cfd2aef9bf4576a760aa1c6a557170`
- `source_version`: `2026-04-24T08:38:15.214Z`
- `schema_hash`: `2b3dbf9bf600e5e3f832c77ac7df6333131255a3634c235b7e8349b5be991027`
- `field_count`: `49`
- `resolved_public_option_fields`: `3`
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
- 公共选项 / 省市区字段在标题重复时，只接受完整 `{title,dicId}`，不能 title-only 自动猜。

### Target Resolution
- update 的硬前置是唯一目标；可以通过 search 获得 `formInstId`，但不能直接按模糊名称更新。

### Execution Guardrails
- 只发送 `form_inst_id` 加本次变更字段，不清空未提及字段。
- 先 preview，再确认，再 live write。
- 如果当前上下文能拿到旧值，应在确认摘要中显式展示旧值 / 新值，避免误覆盖关键字段。

## Input Rules

- Required params: form_inst_id
- Optional params: linked_contact_form_inst_id, Te_5, Te_4, Te_3, Ta_4, Ta_3, Ta_2, Te_8, last_followup_date, phone, Da_1, Te_6, Da_2, owner_open_id, service_rep_open_id, district, province, Ra_10, city, Ta_1, Ta_0, At_0, Ra_6, Ra_7, Ra_4, Ra_5, customer_type, customer_status, Ra_1, industry, Ra_9
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.

- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.
- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.
- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.
- Relation field `linked_contact_form_inst_id` maps to `Bd_1`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `a3ccc61c75c34cb28a7113a311418080`.

- `province`, `city`, and `district` are backed by field-bound workbook dictionaries. Template `linkCodeId` metadata is preserved in references, but the current runtime still does not perform real province-city-district cascade filtering. Title-only mapping is allowed only when the title is unique; for repeated labels such as `城区`, pass a full `{title,dicId}` object.

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/customer/preview/upsert`
- Internal live API: `POST /api/shadow/objects/customer/execute/upsert`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- This bundle is generated for phase `0.2.21`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
