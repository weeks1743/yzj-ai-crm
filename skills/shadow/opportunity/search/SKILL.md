---
name: shadow.opportunity_search
description: 按商机模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机 Search

Use this bundle only for the `opportunity` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `b1869173654e49fbac0b1fc6ad37e761`
- `source_version`: `2026-04-24T06:51:23.818Z`
- `schema_hash`: `9ced7ef94b18fb9c048b536899bb649e43148a50d0c2c2afd34d0be3d25120d6`
- `field_count`: `35`
- `resolved_public_option_fields`: `0`
- `pending_public_option_fields`: `0`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Prefer the live API defined in `references/execution.json`; fall back to preview only when you need a dry-run.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: (none)
- Optional params: Te_11, Te_10, linked_contact_form_inst_id, linked_customer_form_inst_id, _S_SERIAL, _S_DATE, Ta_1, Ta_0, Te_17, Te_16, _S_TITLE, Ra_6, Te_5, Ra_5, Te_1, Te_0, Ra_0, Ra_1, _S_APPLY, Te_9, Te_8, Da_0, Te_7, Te_6, owner_open_id, Nu_1, _S_DEPT, Nu_0
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.





- Relation field `linked_contact_form_inst_id` maps to `Bd_2`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `a3ccc61c75c34cb28a7113a311418080`.
- Relation field `linked_customer_form_inst_id` maps to `Bd_1`; exact search uses `_S_ENCODE` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.




## Search Coverage
- Base searchable params (26): `Te_11`, `Te_10`, `_S_SERIAL`, `_S_DATE`, `Ta_1`, `Ta_0`, `Te_17`, `Te_16`, `_S_TITLE`, `Ra_6`, `Te_5`, `Ra_5`, `Te_1`, `Te_0`, `Ra_0`, `Ra_1`, `_S_APPLY`, `Te_9`, `Te_8`, `Da_0`, `Te_7`, `Te_6`, `owner_open_id`, `Nu_1`, `_S_DEPT`, `Nu_0`
- Relation searchable params (2): `linked_contact_form_inst_id -> Bd_2 (displayCol: _S_NAME, formCodeId: a3ccc61c75c34cb28a7113a311418080)`, `linked_customer_form_inst_id -> Bd_1 (displayCol: _S_ENCODE, formCodeId: e2cfd2aef9bf4576a760aa1c6a557170)`
- Not auto-generated for search: `附件(At_0, attachmentWidget)`, `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `说明文字(De_3, describeWidget)`, `说明文字(De_5, describeWidget)`, `说明文字(De_6, describeWidget)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/opportunity/preview/search`
- Internal live API: `POST /api/shadow/objects/opportunity/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
