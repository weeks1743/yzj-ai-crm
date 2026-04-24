---
name: shadow.followup_delete
description: 按formInstIds预演或执行商机跟进记录批量删除请求，并引用当前模板快照与公共选项资源。
---

# Shadow 商机跟进记录 Delete

Use this bundle only for the `followup` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `0a618c5d806545b997f60e8461b3f504`
- `source_version`: `2026-04-24T08:59:16.696Z`
- `schema_hash`: `d55c4662f9ef053014f3e657f68f8028775db7ab1e4052fa09ec1aae0731f05a`
- `field_count`: `23`
- `resolved_public_option_fields`: `0`
- `pending_public_option_fields`: `0`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Interaction Strategy

### Recommended Flow
- 先通过 search 或 get 确认待删除记录。
- 汇总精确 `form_inst_ids` 与对象摘要，再请求用户做明确删除确认。
- 确认后再调用 delete，不把模糊条件直接升级为删除请求。

### Parameter Collection
- 如果用户只给名称、关键词或模糊范围，不直接删，先回到 search 缩小范围。

### Clarification Rules
- 当 缺少 `form_inst_ids` 时：先走 search / get，拿到精确记录 id 后再继续 delete。
- 当 候选记录多于一条 时：逐条展示候选，请用户明确选择要删除的记录集合。

### Disambiguation Rules
- delete 只接受精确记录 id，不接受按名称、编码或模糊条件自动扩展删除范围。

### Target Resolution
- `form_inst_ids` 必须来自用户显式提供，或来自上一跳 search / get 的确定结果。

### Execution Guardrails
- delete 是破坏性操作，必须先展示目标摘要，再等待明确确认。
- 禁止静默补全、猜测或扩大删除列表。

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

- Internal preview API: `POST /api/shadow/objects/followup/preview/delete`
- Internal live API: `POST /api/shadow/objects/followup/execute/delete`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchDelete?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/batchDelete?accessToken={accessToken}`
- This bundle is generated for phase `0.2.21`; live write is enabled and should only be used after explicit user confirmation.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
