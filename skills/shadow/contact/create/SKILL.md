---
name: shadow.contact_create
description: 按联系人模板预演轻云新建请求，并引用当前模板快照与公共选项资源。
---

# Shadow 联系人 Create

Use this bundle only for the `contact` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `a3ccc61c75c34cb28a7113a311418080`
- `source_version`: `2026-04-24T08:59:16.078Z`
- `schema_hash`: `7c459d4595458c31a6fe4dde23fa1ceb35d42e579beacf26a69be9260fc9985e`
- `field_count`: `29`
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
- 先把用户意图映射成业务语义参数，而不是要求其按模板字段码录单。
- 优先吸收当前对话里已经给出的值，再只追问缺失必填或高价值字段。
- 关系、人员、公共选项和附件先完成解析与校验，再生成 preview。
- 向用户展示将要写入的关键字段摘要，得到明确确认后才执行 live write。

### Parameter Collection
- 追问时使用业务标签，例如 联系人关键字段，不要直接暴露 `codeId`。
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
- 公共选项 / 省市区字段在标题重复时，只接受完整 `{title,dicId}`，不能 title-only 自动猜。

### Target Resolution
- create 不需要当前对象 `formInstId`，但所有关联对象都必须在写前解析成精确 id 或关系对象。

### Execution Guardrails
- 先 preview，再确认，再 live write。
- 不要为了凑齐 payload 发明默认值、`dicId`、关联记录或人员标识。
- 用户未提及的可选字段默认保持不写入，而不是自动补全。

## Input Rules

- Required params: (none)
- Optional params: linked_customer_form_inst_id, Ta_1, Ta_0, At_0, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, phone, Te_1, Ra_0, Ra_1, _S_NAME, Da_0, district, province, city
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.

- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.
- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.
- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.
- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.

- `province`, `city`, and `district` are backed by field-bound workbook dictionaries. Template `linkCodeId` metadata is preserved in references, but the current runtime still does not perform real province-city-district cascade filtering. Title-only mapping is allowed only when the title is unique; for repeated labels such as `城区`, pass a full `{title,dicId}` object.

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/contact/preview/upsert`
- Internal live API: `POST /api/shadow/objects/contact/execute/upsert`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- This bundle is generated for phase `0.2.21`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
