---
name: shadow.followup_get
description: 按formInstId执行或预演商机跟进记录详情读取请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机跟进记录 Get

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

- Required params: form_inst_id
- Optional params: (none)
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.
- `form_inst_id` is mandatory. Do not guess it from customer names or fuzzy search results.




- Relation field `Bd_4` maps to `Bd_4`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `eea919bb0e69418698ff457e74cc1c2b`.
- Relation field `linked_opportunity_form_inst_id` maps to `Bd_3`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `b1869173654e49fbac0b1fc6ad37e761`.
- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_ENCODE` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.





## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/followup/preview/get`
- Internal live API: `POST /api/shadow/objects/followup/execute/get`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/list?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/list?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
