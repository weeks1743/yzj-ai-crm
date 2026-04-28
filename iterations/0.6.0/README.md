# 0.6.0 记录系统双源模板修复与 SKILL 重建

## 版本目标

- 为客户、联系人、商机、商机跟进记录建立“双源模板”链路。
- 以公开 `viewFormDef` 保留开放接口结构，以内部 `getFormByCodeId` 补齐字段真相。
- 重建 4 个核心对象的 `skills/shadow/*` bundle，修复必填、自动派生、只读字段与参数键冲突问题。

## 实施范围

- 新增模板 provider 抽象：`PublicTemplateProvider`、`InternalTemplateProvider`。
- 新增 canonical template 合并：`sourcePayloads.publicViewFormDef`、`sourcePayloads.internalGetFormByCodeId`、`mergeDiagnostics`。
- 扩展标准化字段：`edit`、`view`、`systemDefault`、`placeholder`、`writePolicy`、`provenance`、写入/查询参数键。
- 扩展 skill contract：新增 `derivedParams`。
- 重做 create/update preview 准备层：
  - `requiredParams` 只保留用户需要补齐的 promptable 静态必填。
  - `_S_TITLE` 按模板标题规则自动派生。
  - update 只硬要求 `form_inst_id`，条件必填仍在 preview 阶段触发校验。
  - 只读字段按 `writePolicy=read_only` 阻断。
- 重新生成 `customer / contact / opportunity / followup` 全部 shadow skill bundle 与 references。

## 合并规则

- 内部模板优先负责字段真相：`required`、`readOnly`、`edit`、`view`、`systemDefault`、`placeholder`、`titleEntity`、`noRepeat`、系统字段行为。
- 公开模板优先负责开放接口侧元数据：查询/筛选结构、公共选项/关联字段开放结构、公开返回独有 widget 配置。
- 两侧独有字段不丢弃，统一保留 provenance。
- `references/template-raw.json` 路径保持不变，内容升级为双源合并快照。

## 系统字段策略

- `_S_TITLE` 且存在 `defaultTitle/titleEntity`：`derived`，preview/live 自动生成。
- `_S_NAME` 且 `edit:true` 且识别为主名称字段：`promptable`。
- `_S_DISABLE` 不静默代填；模板要求且可编辑时进入用户必填合同。
- `edit:false`、只读控件或没有安全写入语义的字段：`read_only`。

## 4 对象回归结果

- customer：`_S_TITLE` 自动派生，`customer_name` 恢复为 `_S_NAME` 主名称参数，客户状态/客户类型/启用状态/联系人姓名/联系人手机等静态必填恢复。
- contact：`_S_TITLE` 自动派生，`contact_name`、`mobile_phone`、`enabled_state` 恢复为 create 必填。
- opportunity：`_S_TITLE` 按默认标题规则派生，`opportunity_name`、客户编号、销售阶段、预计成交时间、商机预算恢复为 create 必填。
- followup：`_S_TITLE` 按默认标题规则派生，`followup_record`、`followup_method`、`owner_open_id`、客户编号恢复为 create 必填。

## 文档更新

- 已更新 `docs/03-记录系统动态技能中心.md`。
- 已更新 `docs/12-云之家接口映射与待验证清单.md`。

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test -- --test-name-pattern="ShadowMetadataService|HTTP endpoints expose settings|HTTP shadow preview"`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/admin-pro build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。
- `pnpm build`：通过。

## 未完成项与下一步

- 当前内部源以仓库 fixture `yzj-api/getFormByCodeId/*.json` 承载；后续接入真实内部 HTTP provider 时，不改变合并规则和 skill 合同。
- 继续沉淀 4 个对象之外的业务对象模板差异样本，扩大 `mergeDiagnostics` 回归覆盖。
