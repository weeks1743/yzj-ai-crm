---
name: shadow.customer_search
description: 按客户模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 客户 Search

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
4. Prefer the live API defined in `references/execution.json`; fall back to preview only when you need a dry-run.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: (none)
- Optional params: linked_contact_form_inst_id, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, Ta_4, Ta_3, Ta_2, _S_APPLY, Te_8, last_followup_date, Te_7, Da_1, Te_6, Da_2, owner_open_id, service_rep_open_id, _S_DISABLE, _S_DEPT, Ra_10, _S_ORDER, _S_SERIAL, _S_DATE, Ta_1, Ta_0, Ra_6, Ra_7, Ra_4, Ra_5, customer_type, Ra_0, Ra_1, customer_name, industry, Ra_9, Nu_1, Nu_0
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.





- Relation field `linked_contact_form_inst_id` maps to `Bd_1`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `a3ccc61c75c34cb28a7113a311418080`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.
- Real validation shows customer `searchList` visibility depends on `operatorOpenId`. Use an operator account that can see customer list data. Current verified customer-search sample `operatorOpenId` is `69e75eb5e4b0e65b61c014da`; `66160cfde4b014e237ba75ca` may return empty results for customer search even when direct get still works.
- Customer search preview examples use the minimal linked-contact display value `CON-20260424-001` and date-range timestamps such as `[1777046400000,1777132799999]`.
- `publicOptBoxWidget` fields without `referId` stay in template references for context only until a usable dictionary source is available. Do not invent enum payloads.

## Search Coverage
- Base searchable params (37): `_S_ENCODE`, `_S_TITLE`, `Te_5`, `Te_4`, `Te_3`, `Ta_4`, `Ta_3`, `Ta_2`, `_S_APPLY`, `Te_8`, `last_followup_date`, `Te_7`, `Da_1`, `Te_6`, `Da_2`, `owner_open_id`, `service_rep_open_id`, `_S_DISABLE`, `_S_DEPT`, `Ra_10`, `_S_ORDER`, `_S_SERIAL`, `_S_DATE`, `Ta_1`, `Ta_0`, `Ra_6`, `Ra_7`, `Ra_4`, `Ra_5`, `customer_type`, `Ra_0`, `Ra_1`, `customer_name`, `industry`, `Ra_9`, `Nu_1`, `Nu_0`
- Relation searchable params (1): `linked_contact_form_inst_id -> Bd_1 (displayCol: _S_SERIAL, formCodeId: a3ccc61c75c34cb28a7113a311418080)`
- Not auto-generated for search: `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `说明文字(De_3, describeWidget)`, `说明文字(De_4, describeWidget)`, `说明文字(De_5, describeWidget)`, `说明文字(De_6, describeWidget)`, `区(Pw_2, publicOptBoxWidget, missing_referId)`, `省(Pw_0, publicOptBoxWidget, missing_referId)`, `市(Pw_1, publicOptBoxWidget, missing_referId)`, `附件(At_0, attachmentWidget)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/customer/preview/search`
- Internal live API: `POST /api/shadow/objects/customer/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.2.17`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
