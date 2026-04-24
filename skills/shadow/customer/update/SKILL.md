---
name: shadow.customer_update
description: 按客户模板预演轻云更新请求，并引用当前模板快照与公共选项资源。
---

# Shadow 客户 Update

Use this bundle only for the `customer` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `e2cfd2aef9bf4576a760aa1c6a557170`
- `source_version`: `2026-04-24T03:10:49.533Z`
- `schema_hash`: `05297519a43d282a2cb53c3c2ce34045a192859bfc052cd9e2bcc62a66f9be48`
- `field_count`: `49`
- `resolved_public_option_fields`: `0`
- `pending_public_option_fields`: `3`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: form_inst_id
- Optional params: linked_contact_form_inst_id, Te_5, Te_4, Te_3, Ta_4, Ta_3, Ta_2, Te_8, last_followup_date, phone, Da_1, Te_6, Da_2, owner_open_id, service_rep_open_id, Ra_10, Ta_1, Ta_0, At_0, Ra_6, Ra_7, Ra_4, Ra_5, customer_type, customer_status, Ra_1, industry, Ra_9
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.


- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.
- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.
- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.
- Relation field `linked_contact_form_inst_id` maps to `Bd_1`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `a3ccc61c75c34cb28a7113a311418080`.



- `publicOptBoxWidget` fields without `referId` stay in template references for context only until a usable dictionary source is available. Do not invent enum payloads.

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/customer/preview/upsert`
- Internal live API: `POST /api/shadow/objects/customer/execute/upsert`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchSave?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
