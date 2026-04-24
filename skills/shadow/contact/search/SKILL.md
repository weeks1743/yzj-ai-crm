---
name: shadow.contact_search
description: 按联系人模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 联系人 Search

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
4. Prefer the live API defined in `references/execution.json`; fall back to preview only when you need a dry-run.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: (none)
- Optional params: linked_customer_form_inst_id, _S_ORDER, _S_SERIAL, _S_DATE, Ta_1, Ta_0, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, Te_2, Te_1, Ra_0, Ra_1, _S_NAME, _S_APPLY, Da_0, customer_status, _S_DEPT, Nu_0
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.





- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.
- Current verified contact-search sample `operatorOpenId` is `66160cfde4b014e237ba75ca`; this operator can query contact list data in live validation.

- `publicOptBoxWidget` fields without `referId` stay in template references for context only until a usable dictionary source is available. Do not invent enum payloads.

## Search Coverage
- Base searchable params (20): `_S_ORDER`, `_S_SERIAL`, `_S_DATE`, `Ta_1`, `Ta_0`, `_S_ENCODE`, `_S_TITLE`, `Te_5`, `Te_4`, `Te_3`, `Te_2`, `Te_1`, `Ra_0`, `Ra_1`, `_S_NAME`, `_S_APPLY`, `Da_0`, `customer_status`, `_S_DEPT`, `Nu_0`
- Relation searchable params (1): `linked_customer_form_inst_id -> Bd_0 (displayCol: _S_NAME, formCodeId: e2cfd2aef9bf4576a760aa1c6a557170)`
- Not auto-generated for search: `附件(At_0, attachmentWidget)`, `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `说明文字(De_3, describeWidget)`, `区(Pw_2, publicOptBoxWidget, missing_referId)`, `省(Pw_0, publicOptBoxWidget, missing_referId)`, `市(Pw_1, publicOptBoxWidget, missing_referId)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/contact/preview/search`
- Internal live API: `POST /api/shadow/objects/contact/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.2.17`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
