---
name: shadow.contact_create
description: 按联系人模板预演轻云新建请求，并引用当前模板快照与公共选项资源。
---

# Shadow 联系人 Create

Use this bundle only for the `contact` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `a3ccc61c75c34cb28a7113a311418080`
- `source_version`: `2026-04-23T16:35:58.394Z`
- `schema_hash`: `89270c89212d60836c0e9a5c2cad66a1366c71dde9bcf8cbbd7337f3321594c9`
- `field_count`: `29`
- `resolved_public_option_fields`: `0`
- `pending_public_option_fields`: `3`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: (none)
- Optional params: linked_customer_form_inst_id, Ta_1, Ta_0, At_0, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, phone, Te_1, Ra_0, Ra_1, _S_NAME, Da_0
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.


- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.
- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.
- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.
- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.



- `publicOptBoxWidget` fields without `referId` stay in template references for context only until a usable dictionary source is available. Do not invent enum payloads.

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/contact/preview/upsert`
- Internal live API: `POST /api/shadow/objects/contact/execute/upsert`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
