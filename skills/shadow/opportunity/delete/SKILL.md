---
name: shadow.opportunity_delete
description: 按formInstIds预演或执行商机批量删除请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机 Delete

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
4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Input Rules

- Required params: form_inst_ids
- Optional params: (none)
- Confirmation policy: `required_before_write`
- This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.

- `form_inst_ids` is mandatory and must contain exact LightCloud `formInstId` values gathered from a prior search/get result. Do not guess, fuzzily derive, or silently expand this list.








## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/opportunity/preview/delete`
- Internal live API: `POST /api/shadow/objects/opportunity/execute/delete`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchDelete?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchDelete?accessToken={accessToken}`
- This bundle is generated for phase `0.2.20`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
