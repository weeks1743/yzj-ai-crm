---
name: shadow.followup_search
description: 按商机跟进记录模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机跟进记录 Search

Use this bundle only for the `followup` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `0a618c5d806545b997f60e8461b3f504`
- `source_version`: `2026-04-24T06:51:23.851Z`
- `schema_hash`: `6ea01274538ebbae4a6204604f5d4c54be636e480edbad36bf4258371db407b6`
- `field_count`: `23`
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
- Optional params: Te_4, Ra_2, Te_1, Te_0, customer_status, Ra_1, Bd_4, linked_opportunity_form_inst_id, _S_APPLY, linked_customer_form_inst_id, Da_0, Da_1, owner_open_id, _S_SERIAL, _S_DATE, Ta_0, _S_DEPT, _S_TITLE
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.





- Relation field `Bd_4` maps to `Bd_4`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `eea919bb0e69418698ff457e74cc1c2b`.
- Relation field `linked_opportunity_form_inst_id` maps to `Bd_3`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `b1869173654e49fbac0b1fc6ad37e761`.
- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_ENCODE` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.




## Search Coverage
- Base searchable params (15): `Te_4`, `Ra_2`, `Te_1`, `Te_0`, `customer_status`, `Ra_1`, `_S_APPLY`, `Da_0`, `Da_1`, `owner_open_id`, `_S_SERIAL`, `_S_DATE`, `Ta_0`, `_S_DEPT`, `_S_TITLE`
- Relation searchable params (3): `Bd_4 -> Bd_4 (displayCol: _S_SERIAL, formCodeId: eea919bb0e69418698ff457e74cc1c2b)`, `linked_opportunity_form_inst_id -> Bd_3 (displayCol: _S_SERIAL, formCodeId: b1869173654e49fbac0b1fc6ad37e761)`, `linked_customer_form_inst_id -> Bd_0 (displayCol: _S_ENCODE, formCodeId: e2cfd2aef9bf4576a760aa1c6a557170)`
- Not auto-generated for search: `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `附件(At_0, attachmentWidget)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/followup/preview/search`
- Internal live API: `POST /api/shadow/objects/followup/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
