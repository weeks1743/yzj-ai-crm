---
name: shadow.contact_get
description: 按formInstId执行或预演联系人详情读取请求，并引用当前模板快照与公共选项资源。
---

# Shadow 联系人 Get

Use this bundle only for the `contact` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `a3ccc61c75c34cb28a7113a311418080`
- `source_version`: `2026-04-28T10:37:10.165Z`
- `schema_hash`: `100ee87c8e418ef11dcbdcada90a58602395208aec86b1374dfacf772cd3110a`
- `field_count`: `29`
- `resolved_public_option_fields`: `3`
- `pending_public_option_fields`: `0`

## Workflow

1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.
2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.
3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.
4. Prefer the live API defined in `references/execution.json`; fall back to preview only when you need a dry-run.
5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.

## Interaction Strategy

### Recommended Flow
- 仅在目标记录已经唯一确定时使用本技能。
- 优先消费用户显式提供的 `form_inst_id` 或上一跳 search 的结果。
- 如果用户仍是模糊描述，先退回对应对象的 search 技能完成目标定位。

### Parameter Collection
- get 阶段只补目标识别信息，不补问与当前详情读取无关的可写字段。

### Clarification Rules
- 当 缺少 `form_inst_id` 时：改走对应对象的 search，或请用户从候选结果中指定唯一记录。
- 当 用户给的是名称/编码，但还没有唯一定位 时：先做 search 缩小范围，再携带准确 `formInstId` 调用 get。

### Disambiguation Rules
- 不要根据名称、编码或自然语言描述直接猜测详情目标。

### Target Resolution
- 唯一 `form_inst_id` 是 get 的硬前置条件。

### Execution Guardrails
- get 是只读动作；若下一步要修改数据，应保留本次返回的 `formInstId` 再切到 update。

## Input Rules

- Required params: form_inst_id
- Optional params: (none)
- Derived params: (none)
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.
- `form_inst_id` is mandatory. Do not guess it from customer names or fuzzy search results.

- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.

- `province`, `city`, and `district` are backed by field-bound workbook dictionaries. Template `linkCodeId` metadata is preserved in references, but the current runtime still does not perform real province-city-district cascade filtering. Title-only mapping is allowed only when the title is unique; for repeated labels such as `城区`, pass a full `{title,dicId}` object.

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/contact/preview/get`
- Internal live API: `POST /api/shadow/objects/contact/execute/get`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/list?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/list?accessToken={accessToken}`
- This bundle is generated for phase `0.6.0`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
