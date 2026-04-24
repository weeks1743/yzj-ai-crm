# 0.2.21 版本说明

## 本轮目标

- 将 `opportunity`、`followup` 从“模板刷新 + 技能生成”推进到“真实 CRUD 联调准备完成、关键边界可回归”。
- 为 `Pw_0 / Pw_1 / Pw_2` 接入省市区专用字典链路，支持写入、校验与搜索预演。
- 对超出四对象范围的关联字段继续保留原始 `fieldCode`，但补强关系元数据与失败提示。
- 对未支持字段显式拒绝，避免静默吞参，当前重点覆盖 `followup.Lo_0(locationWidget)`。

## 本轮范围

- `apps/admin-api`
- `skills/shadow/*`
- `iterations/0.2.21/README.md`

## 关键实现

- 新增省市区字段绑定字典：
  - `Pw_0 -> province`
  - `Pw_1 -> city`
  - `Pw_2 -> district`
- 影子技能 bundle 新增“交互策略”正式契约，生成到 `SKILL.md` 与 `references/skill-bundle.json`：
  - `recommendedFlow`
  - `parameterCollectionPolicy`
  - `clarificationTriggers`
  - `disambiguationRules`
  - `targetResolutionPolicy`
  - `executionGuardrails`
- `create / update / delete` 的技能说明不再只是字段清单，新增“先搜后改、缺参澄清、写前 preview、显式确认”的原生约束，便于 Codex / Claude 直接消费。
- 省市区字典源来自仓库内工作簿：
  - [省市区数据信息.xlsx](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/yzj-api/省市区数据信息.xlsx)
- 运行时仅按三套独立字典处理，不实现省市区级联过滤。
- `opportunity`、`followup` 增补附件、日期、枚举、内部关联、外部关联与 unsupported widget 的回归。
- 新增 `test:live-shadow` 本地 live 联调入口，读取 gitignore 的 `.local/shadow-live-fixtures.json`。

## 当前已知事实

- 截至 2026-04-24，`69e75eb5e4b0e65b61c014da` 与 `66160cfde4b014e237ba75ca` 对 `opportunity / followup` 的无筛选 `searchList` 仍返回 `0`。
- 因此本轮 live 联调默认采用 `create -> get -> update -> delete` 的 create-first 策略，查询仅作为补充验证，并在失败时记录为 `search visibility gap`。
- `Bd_4` 仍保留原始字段码暴露；若缺真实样例，仅做 metadata / preview 断言，不强行发明稳定别名。
- 真实 LightCloud `batchDelete` 成功响应存在 `success=true + data=null` 的情况，本轮已兼容为回退使用请求中的 `formInstIds`。

## 本轮实测结果

- `pnpm --filter @yzj-ai-crm/admin-api test` 已通过。
- `pnpm --filter @yzj-ai-crm/admin-api build` 已通过。
- `pnpm --filter @yzj-ai-crm/admin-api test:live-shadow` 已通过。
- live 基线使用本地 `.local/shadow-live-fixtures.json`，实际联调了：
  - `opportunity`：附件、日期、枚举、人员、客户/联系人关联的真实 `create -> get -> update -> delete`
  - `followup`：附件、日期、枚举、人员、客户/商机关联的真实 `create -> get -> update -> delete`
- 真实附件联调已使用本地文件：
  - [测试上传附件.pptx](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/tmp/测试上传附件.pptx)
- `opportunity / followup` 的 `get` 在 live 中可读，但列表查询仍是可见性缺口：
  - `opportunity: searchList 返回 0`
  - `followup: searchList 返回 0`
- 客户对象的省市区字段已基于真实 workbook 与 live 回写验证：
  - 已将【上海松井机械有限公司】真实更新并回读为 `江苏 / 南通市 / 海门市`
  - 真实 dicId 分别为 `d005a12 / d006a965 / d007a38365`
  - `Pw_0 -> Pw_1 -> Pw_2` 的模板 `linkCodeId` 已保留到字段快照与 skill references
- 省市区 title-only 输入已补强：
  - 唯一标题可继续自动映射
  - 对 `城区` 这类重复标题，影子技能现在会拒绝 title-only，并要求传入完整 `{title,dicId}`
- 记录系统技能现已把“用户表达不精确”视为默认输入形态：
  - `search` 默认承担候选收敛，不先反问 `formInstId`
  - `update` 缺少目标 id 时先 search，再要求用户选定唯一记录
  - `create` 先按业务标签收集必填与高价值字段，不要求用户说字段码
  - `delete` 仍只接受精确 `form_inst_ids` 与显式确认

## 待继续确认

- `Bd_4` 的真实业务样例与可用 live 基线。
- `opportunity / followup` 的列表可见性 `operatorOpenId`。
- 省市区 workbook 当前只按三套独立字典接入，后续若拿到真实层级关系数据，再补 `parentEntryId / hierarchyPath` 与级联过滤。

## 验证要求

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- `pnpm --filter @yzj-ai-crm/admin-api test:live-shadow`
