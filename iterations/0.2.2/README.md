# 0.2.2 版本说明

## 版本目标

将 `0.2.1` 中“客户影子对象元数据 -> 技能 contract -> CRUD 请求体预演”的实现，重构为真正可被 Codex / Claude 类代理直接消费的技能产物：

- 以 `customer` 为唯一激活对象，生成真实的 `SKILL.md`
- 为每个技能生成配套 `references/` 资源
- 让模板信息进入技能正文或被技能显式引用的资源文件
- 保留审批模板读取、字段标准化、公共选项解析与 preview 能力作为生成底座
- 补齐 `customer_get` 的 preview 执行映射，避免“有技能名、无实际绑定”

## 为什么本次是 0.2.2

`0.2.1` 虽然已经打通了客户模板刷新、公共选项预留和写入预演，但“技能”仍主要落在后端运行时 contract 中，没有形成真实技能目录与 `SKILL.md` 资产。本轮属于对同一能力链路的纠偏式重构，因此按小版本升级为 `0.2.2`。

## 本次范围

- 新增技能 bundle 输出目录与生成规则
- `admin-api` refresh 后生成真实技能产物：
  - `SKILL.md`
  - `agents/openai.yaml`
  - `references/skill-bundle.json`
  - `references/template-summary.json`
  - `references/template-raw.json`
  - `references/dictionaries.json`
  - `references/execution.json`
- `GET /api/shadow/objects/:objectKey/skills` 改为返回真实技能 bundle 元数据与文件路径
- 新增 `POST /api/shadow/objects/:objectKey/preview/get`
- 继续保留：
  - `preview/search`
  - `preview/upsert`
  - 公共选项 `manual_json | approval_api | hybrid`

## 技能产物目录

默认输出到仓库内：

- `skills/shadow/customer/search`
- `skills/shadow/customer/get`
- `skills/shadow/customer/create`
- `skills/shadow/customer/update`

若环境变量 `YZJ_SHADOW_SKILL_OUTPUT_DIR` 被配置，则以该目录为准。

## 关键能力

### 1. 技能从“运行时 contract”升级为“真实 bundle”

每个客户技能都必须实际生成以下文件：

- `SKILL.md`
- `agents/openai.yaml`
- `references/skill-bundle.json`
- `references/template-summary.json`
- `references/template-raw.json`
- `references/dictionaries.json`
- `references/execution.json`

其中：

- `SKILL.md` 只保留必要 workflow、边界和引用入口
- 模板详情、标准化字段、原始模板、公共选项状态都放入 `references/`
- 生成结果仍保留 `source_form_code_id`、`source_version`、`required_params`、`optional_params`、`confirmation_policy`

### 2. `customer_get` 补齐真实执行映射

本轮新增读取详情的 preview 映射：

- 内部 preview API：
  `POST /api/shadow/objects/customer/preview/get`
- 轻云上游映射：
  `POST /gateway/lightcloud/data/list`

输入固定要求：

- `record_id`

输出仍然是预演请求体，不直接发真实查询写回。

### 3. 公共选项继续保留正式扩展位

公共选项仍按 `referId` 做外部枚举绑定：

- 已解析：
  可接受 `title`、`dicId`、`{title,dicId}`
- 未解析：
  不允许 title-only 自动猜测
  仅允许显式 `{title,dicId}`

所有 `Pw_*` 字段最终都必须归一化为：

```json
[
  {
    "title": "北京",
    "dicId": "d005a1"
  }
]
```

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`

以上两项为本轮必须通过的后端验收。

## 未完成项

- 真实轻云读写联调仍未开启
- 联系人、商机、商机跟进记录仍未进入 bundle 生成
- 前端界面设置和技能消费逻辑本轮不改
- 审批官方公共选项三层接口仍以“适配层预留”为主

## 下一步

- 用固定测试 `openId/oid` 联调客户真实查询与创建 / 更新
- 将 `skills/shadow` 接入管理后台的技能治理视图
- 扩展到联系人、商机、商机跟进记录的 bundle 生成
