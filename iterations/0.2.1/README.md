# 0.2.1 版本说明

## 版本目标

在 `0.2.0` 组织同步后端基础上，补齐一条“客户影子对象元数据 -> 技能契约 -> CRUD 请求体预演”的真实后端链路：

- 在 `admin-api` 中接入审批模板读取
- 以客户对象为唯一激活对象生成影子技能契约
- 为轻云公共选项控件预留正式的字典解析设计
- 继续保持前端页面不改壳、不抢跑真实 CRUD

## 为什么本次是 0.2.1

本轮是在 `0.2.0` 已有后端基础上的增量能力扩展，主要新增客户影子技能生成、对象快照、字典缓存与 preview 接口，没有改变双系统产品边界，因此按小版本升级为 `0.2.1`。

## 本次范围

- 扩展 `apps/admin-api` 配置项与 SQLite 表结构
- 新增审批模板客户端、轻云 preview 客户端、公共选项解析器
- 新增客户对象注册表、对象快照、技能契约、字典绑定与字典元素缓存
- 新增影子对象接口：
  - `GET /api/shadow/objects`
  - `POST /api/shadow/objects/:objectKey/refresh`
  - `GET /api/shadow/objects/:objectKey`
  - `GET /api/shadow/objects/:objectKey/skills`
  - `GET /api/shadow/objects/:objectKey/dictionaries`
  - `POST /api/shadow/objects/:objectKey/preview/search`
  - `POST /api/shadow/objects/:objectKey/preview/upsert`
- 新增 admin-api 自动化测试，覆盖模板解析、公共选项与 preview 边界
- 更新根 README、设计文档与 `.env.example`

## 关键能力

### 1. 客户对象元数据刷新

- 只激活 `customer`
- 通过审批 `team` token + `viewFormDef` 拉取模板结构
- 标准化为统一字段模型：
  - `fieldCode`
  - `label`
  - `widgetType`
  - `required`
  - `readOnly`
  - `multi`
  - `options`
  - `referId`
  - `semanticSlot`
  - `enumBinding`

### 2. 客户技能契约生成

- 固定生成：
  - `shadow.customer_search`
  - `shadow.customer_get`
  - `shadow.customer_create`
  - `shadow.customer_update`
- 契约中统一带：
  - `source_form_code_id`
  - `source_version`
  - `required_params`
  - `optional_params`
  - `confirmation_policy`

### 3. 公共选项预留

- 将 `publicOptBoxWidget` 视为外部枚举源，而不是普通静态枚举
- 支持三种来源：
  - `manual_json`
  - `approval_api`
  - `hybrid`
- 当前优先通过本地 JSON 文件接码表：
  - 默认路径 `/.local/shadow-dictionaries.json`
- 若公共选项未解析成功：
  - 字段保留在对象元数据里
  - 不自动进入强必填参数
  - preview 只接受显式 `{title, dicId}`

### 4. CRUD 请求体预演

- 查询只生成 `searchList` 请求体
- 新增 / 更新只生成 `batchSave` 请求体
- 当前不发起真实轻云写入
- preview 响应会明确返回：
  - `unresolvedDictionaries`
  - `resolvedDictionaryMappings`
  - `missingRequiredParams`
  - `blockedReadonlyParams`
  - `missingRuntimeInputs`
  - `validationErrors`
  - `readyToSend`
  - `requestBody`

## 依赖框架

- 管理员后台：
  `@umijs/max`
  `@ant-design/pro-components`
  `antd`
- 用户 AI 端：
  `@ant-design/x`
  `@ant-design/x-markdown`
  `@ant-design/x-sdk`
  `antd`
- 后端：
  `TypeScript`
  `Node.js`
  `node:sqlite`

## 验收结果

- `pnpm --filter @yzj-ai-crm/admin-api test` 已通过
- `pnpm --filter @yzj-ai-crm/admin-api build` 已通过
- 客户对象模板刷新、公共选项 pending/resolved、preview 严格值约束已覆盖自动化测试

## 未完成项

- 真实 `searchList` / `batchSave` 联调未开启
- 固定测试 `openId/oid` 尚未接入
- 联系人、商机、商机跟进记录仍为 pending
- 审批公共选项三层接口虽然预留了适配层，但本轮默认仍以本地 JSON 码表优先
- 管理员后台与用户 AI 端尚未消费新 shadow 接口

## 下一步

- 接入真实客户查询与新增 / 更新联调
- 用固定测试 `openId/oid` 补齐客户 CRUD 验证
- 扩展到联系人、商机、商机跟进记录
- 决定公共选项最终以审批官方接口还是租户 JSON 为主数据源
