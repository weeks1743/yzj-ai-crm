---
name: shadow.contact_search
description: 按联系人模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 联系人 Search

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
- 先把用户口语化描述转成筛选条件，再决定是否继续进入详情读取或写操作。
- 优先使用最少但最有区分度的条件发起查询，结果仍不唯一时再逐步补条件。
- 如果用户下一步要查看详情、更新或删除，先从查询结果中拿到唯一 `formInstId`。

### Parameter Collection
- 优先使用业务标签、展示值和语义槽收集条件，不要反问用户原始 `codeId`。
- 如果当前条件过宽，只追问下一条最有区分度的筛选信息，不一次性索要全部字段。
- 关联字段在只有展示值时先走展示值查询；只有已经拿到关联记录 id / 对象时才走精确关系查询。
- 公共选项与省市区字段只有在标题唯一可解析时才允许 title-only；否则要求完整 `{title,dicId}`。

### Clarification Rules
- 当 没有提取到任何可用筛选条件 时：追问对象名、关键词、编码、日期或关联对象中的最小必要条件。
- 当 结果集为空且用户预期系统中应有数据 时：提示用户补充一个新的区分条件，并说明当前 `operatorOpenId` 视图可见性也可能影响结果。
- 当 结果有多个候选且用户要继续 get / update / delete 时：返回精简候选列表，请用户选定唯一记录后再继续后续技能。

### Disambiguation Rules
- 关联字段若命中多个候选，不自动猜测，返回候选并要求用户选定。

### Target Resolution
- 用户模糊提到某条记录时，优先走 search，而不是先要求 `formInstId`。
- 禁止根据名称、简称、上下文或猜测直接构造 `formInstId`、关联记录 id 或 `dicId`。

### Execution Guardrails
- search 保持只读；任何后续写入都必须经过独立 preview 与确认链路。
- 当前未纳入查询支持的字段（如 附件(At_0, attachmentWidget) 当前未纳入影子技能查询支持、说明文字(De_0, describeWidget) 当前未纳入影子技能查询支持、说明文字(De_1, describeWidget) 当前未纳入影子技能查询支持 等 5 项）不能被近似拼装为查询条件。

## Input Rules

- Required params: (none)
- Optional params: linked_customer_form_inst_id, _S_ORDER, _S_SERIAL, _S_DATE, Ta_1, Ta_0, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, Te_2, Te_1, Ra_0, Ra_1, _S_NAME, _S_APPLY, Da_0, _S_DISABLE, district, _S_DEPT, Nu_0, province, city
- Derived params: (none)
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.

- Relation field `linked_customer_form_inst_id` maps to `Bd_0`; exact search uses `_S_NAME` as `_name_`, target `formCodeId` is `e2cfd2aef9bf4576a760aa1c6a557170`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.
- Current verified contact-search sample `operatorOpenId` is `66160cfde4b014e237ba75ca`; this operator can query contact list data in live validation.

- `province`, `city`, and `district` are backed by field-bound workbook dictionaries. Template `linkCodeId` metadata is preserved in references, but the current runtime still does not perform real province-city-district cascade filtering. Title-only mapping is allowed only when the title is unique; for repeated labels such as `城区`, pass a full `{title,dicId}` object.

## Search Coverage
- Base searchable params (23): `_S_ORDER`, `_S_SERIAL`, `_S_DATE`, `Ta_1`, `Ta_0`, `_S_ENCODE`, `_S_TITLE`, `Te_5`, `Te_4`, `Te_3`, `Te_2`, `Te_1`, `Ra_0`, `Ra_1`, `_S_NAME`, `_S_APPLY`, `Da_0`, `_S_DISABLE`, `district`, `_S_DEPT`, `Nu_0`, `province`, `city`
- Relation searchable params (1): `linked_customer_form_inst_id -> Bd_0 (displayCol: _S_NAME, formCodeId: e2cfd2aef9bf4576a760aa1c6a557170)`
- Not auto-generated for search: `附件(At_0, attachmentWidget)`, `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `说明文字(De_3, describeWidget)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/contact/preview/search`
- Internal live API: `POST /api/shadow/objects/contact/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.6.0`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
