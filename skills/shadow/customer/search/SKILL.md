---
name: shadow.customer_search
description: 按客户模板执行或预演轻云条件查询请求，并引用当前模板快照与公共选项资源。
---

# Shadow 客户 Search

Use this bundle only for the `customer` object. It is generated from the current approval template snapshot and is intended for Codex-style `SKILL.md` consumption while remaining readable to other agents such as Claude.

## Snapshot

- `formCodeId`: `e2cfd2aef9bf4576a760aa1c6a557170`
- `source_version`: `2026-04-24T08:38:15.214Z`
- `schema_hash`: `2b3dbf9bf600e5e3f832c77ac7df6333131255a3634c235b7e8349b5be991027`
- `field_count`: `49`
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
- 当前未纳入查询支持的字段（如 说明文字(De_0, describeWidget) 当前未纳入影子技能查询支持、说明文字(De_1, describeWidget) 当前未纳入影子技能查询支持、说明文字(De_2, describeWidget) 当前未纳入影子技能查询支持 等 8 项）不能被近似拼装为查询条件。

## Input Rules

- Required params: (none)
- Optional params: linked_contact_form_inst_id, _S_ENCODE, _S_TITLE, Te_5, Te_4, Te_3, Ta_4, Ta_3, Ta_2, _S_APPLY, Te_8, last_followup_date, Te_7, Da_1, Te_6, Da_2, owner_open_id, service_rep_open_id, _S_DISABLE, district, _S_DEPT, province, Ra_10, city, _S_ORDER, _S_SERIAL, _S_DATE, Ta_1, Ta_0, Ra_6, Ra_7, Ra_4, Ra_5, customer_type, Ra_0, Ra_1, customer_name, industry, Ra_9, Nu_1, Nu_0
- Confirmation policy: `no_confirmation_required`
- This is a read / preview skill and does not require write confirmation.

- Relation field `linked_contact_form_inst_id` maps to `Bd_1`; exact search uses `_S_SERIAL` as `_name_`, target `formCodeId` is `a3ccc61c75c34cb28a7113a311418080`.
- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.
- Real validation shows customer `searchList` visibility depends on `operatorOpenId`. Use an operator account that can see customer list data. Current verified customer-search sample `operatorOpenId` is `69e75eb5e4b0e65b61c014da`; `66160cfde4b014e237ba75ca` may return empty results for customer search even when direct get still works.
- Customer search preview examples use the minimal linked-contact display value `CON-20260424-001` and date-range timestamps such as `[1777046400000,1777132799999]`.
- `province`, `city`, and `district` are backed by field-bound workbook dictionaries. Template `linkCodeId` metadata is preserved in references, but the current runtime still does not perform real province-city-district cascade filtering. Title-only mapping is allowed only when the title is unique; for repeated labels such as `城区`, pass a full `{title,dicId}` object.

## Search Coverage
- Base searchable params (40): `_S_ENCODE`, `_S_TITLE`, `Te_5`, `Te_4`, `Te_3`, `Ta_4`, `Ta_3`, `Ta_2`, `_S_APPLY`, `Te_8`, `last_followup_date`, `Te_7`, `Da_1`, `Te_6`, `Da_2`, `owner_open_id`, `service_rep_open_id`, `_S_DISABLE`, `district`, `_S_DEPT`, `province`, `Ra_10`, `city`, `_S_ORDER`, `_S_SERIAL`, `_S_DATE`, `Ta_1`, `Ta_0`, `Ra_6`, `Ra_7`, `Ra_4`, `Ra_5`, `customer_type`, `Ra_0`, `Ra_1`, `customer_name`, `industry`, `Ra_9`, `Nu_1`, `Nu_0`
- Relation searchable params (1): `linked_contact_form_inst_id -> Bd_1 (displayCol: _S_SERIAL, formCodeId: a3ccc61c75c34cb28a7113a311418080)`
- Not auto-generated for search: `说明文字(De_0, describeWidget)`, `说明文字(De_1, describeWidget)`, `说明文字(De_2, describeWidget)`, `说明文字(De_3, describeWidget)`, `说明文字(De_4, describeWidget)`, `说明文字(De_5, describeWidget)`, `说明文字(De_6, describeWidget)`, `附件(At_0, attachmentWidget)`

## Public Option Rules

- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.
- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.
- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.

## Execution

- Internal preview API: `POST /api/shadow/objects/customer/preview/search`
- Internal live API: `POST /api/shadow/objects/customer/execute/search`
- Upstream LightCloud preview target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- Upstream LightCloud live target: `POST https://www.yunzhijia.com/gateway/lightcloud/data/searchList?accessToken={accessToken}`
- This bundle is generated for phase `0.2.21`; read operations may execute against LightCloud, while writes remain preview-first.

## References

- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`
