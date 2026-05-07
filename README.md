# yzj-ai-crm

`yzj-ai-crm` 是面向云之家 / 金蝶销售工作方式的 AI CRM 正式产品原型。项目当前不是单页 demo，而是按“管理员后台 + 用户 AI 工作台 + 后端 Agent Runtime + 外部 Skill Runtime”协同推进的同仓库工程。

当前能力基线：`0.9.0`

本次 README 刷新归属：`0.9.0`

## 当前进展

### 产品侧

项目已经从早期 `0.4.x` 的外部技能接入，推进到 `0.9.x` 的“记录系统 + 公司研究 + 录音资料 + 下游分析”综合闭环：

- 用户可以用自然语言查询、新增、更新 CRM 记录对象。
- 当前重点覆盖客户、联系人、商机、拜访 / 跟进记录四类销售对象。
- 写入类任务统一走“预览 -> 用户确认 -> 写回”，不会直接静默改数据。
- 录入过程中可以中途查询其他对象，再回到原任务补字段。
- 查询后可以继续说“这个客户”“这个联系人”进行上下文承接。
- 裸集合查询如 `查询客户`、`查询所有客户` 不再误用上一轮具体客户。
- 关系字段如“联系人关联客户”会走候选选择链路，不把客户名误写成省份或普通文本。
- 用户 AI 端的运行洞察抽屉可以展示意图、上下文使用、工具选择、过滤来源、target 清洗和写入阻断原因。
- 用户可以上传客户拜访录音，系统通过独立通义录音处理服务生成资料包，并在用户确认新增拜访记录后正式归档为可跨会话消费的资料资产。
- 录音卡支持 meeting-viewer 回看、拜访会话理解、客户需求工作待办分析、问题陈述、客户价值定位和新增拜访记录。
- 跨会话综合问题可组合记录系统实时数据、公司研究 Markdown、录音资料包 Markdown 和下游分析结果回答。
- Chat 会话采用服务端权威同步：`admin-api` 会话接口成功返回时覆盖浏览器本地缓存，清空实例数据后刷新页面即可看到干净状态。
- 管理员后台承担租户配置、组织同步、记录对象治理、技能目录、Agent 观测与运行治理。

### 技术侧

`0.9.x` 在业务无关主 Agent 之上补齐录音资料正式存储、原子工具编排和跨会话消费：

- `agent-core`、`agent-runtime`、`tool-registry` 表达通用意图、任务、工具、策略、确认、证据和上下文。
- CRM 业务对象、字段、口语、测试样例集中在 `crm-agent-pack`、工具元数据和测试 fixture 中。
- 通过 `ContextFrame`、语义引用解析、工具元数据和搜索入参构建实现上下文承接。
- 集合查询和指代查询被明确区分：
  - `查询客户`、`查询所有客户` 是集合查询，不承接旧客户。
  - `查询这个客户的联系人` 是关系查询，会承接当前客户。
  - `更新这个联系人手机号` 是指代更新，会承接当前联系人。
- 增加 Target Grounding Gate：LLM 生成的 target 如果没有落在用户原文或真实上下文中，不得进入搜索 filters。
- 记录查询只在唯一命中时沉淀新的 record context；空结果、多结果和裸集合查询不会刷新旧主体。
- 写入参数提取使用“静态工具契约 + Shadow 元数据 promptable 字段”并集，支持元数据字段如联系人备注、地址、职务等。
- QA-agent 类确定性质检器会对每轮 trace 做风险评分，拦截 `params={}`、历史上下文污染、LLM target 污染、关系字段误写等高风险问题。
- 主 Agent 不注册 `scene.*`，复杂综合问题优先选择 `meta.context_summary`，由 `crm-agent-pack` 内部显性编排 `record.*` 与 `artifact.search` 原子工具。
- Artifact 从公司研究扩展为通用资料资产，支持 `company_research`、`recording_material`、`analysis_material`。
- 录音上传解析结果先写入 `tmp/tongyi/<fileMd5>/` 临时缓存；只有用户确认写入正式 followup 后，才归档为 `recording_material` Artifact 并进入跨会话 Evidence。
- 下游录音技能结果按 `followupId + skillCode` 单份 upsert 为 `analysis_material`，重复运行覆盖当前正式结果。
- `transcription.json`、`translations.json`、`textPolish.json` 等过程文件只供调试和 viewer 使用，不进入 Artifact、Qdrant、Evidence 或普通对话检索。
- 同一 MP3 按 MD5 幂等复用已完成解析结果，失败任务允许重新处理。

## 系统组成

### 用户 AI 端

目录：[`apps/assistant-web`](./apps/assistant-web)

- 基于 `@ant-design/x`、`@ant-design/x-sdk`、`@ant-design/x-markdown`。
- 对齐 `3rd/x-main` 官方独立式 AI 工作台范式。
- 承担自然语言会话、任务推进、记录查询结果展示、写入预览确认、运行洞察调试。

### 管理员后台

目录：[`apps/admin-pro`](./apps/admin-pro)

- 基于 `@umijs/max + @ant-design/pro-components`。
- 对齐 `3rd/ant-design-pro-master` 官方后台范式。
- 承担基础配置、组织同步、记录对象治理、技能治理、Agent 观测。

### Admin API / Agent Runtime

目录：[`apps/admin-api`](./apps/admin-api)

- 基于 TypeScript + Node.js。
- 承担 Agent Runtime、工具注册、上下文管理、写回确认、运行记录、Shadow 元数据、云之家接口适配。
- 主要能力包括：
  - 组织同步。
  - 轻云记录对象元数据刷新。
  - 客户 / 联系人 / 商机 / 跟进记录工具生成与调用。
  - 公司研究 Artifact 生成和检索。
  - 录音任务管理、资料包归档、下游 Skill Job 创建和录音 Artifact 检索。
  - 会话运行审计和调试 trace。
  - 记录写回预览、确认、取消和提交。

### Tongyi Audio Service

目录：[`apps/tongyi-audio-service`](./apps/tongyi-audio-service)

- 独立 Python 进程，由 `admin-api` 通过 HTTP 调用，不直接引用外部目录。
- 提供录音上传、任务状态、资料包生成和 meeting-viewer 静态查看页。
- 通义解析产物默认写入 `tmp/tongyi/<fileMd5>/`，与原 `tongyi-agent/outputs/<dataId>/` 结构保持兼容。
- `pnpm dev` 会随主服务启动；也可单独运行 `pnpm run dev:audio`。

### Skill Runtime

目录：[`apps/skill-runtime`](./apps/skill-runtime)

- 独立外部技能执行服务。
- 扫描 `3rdSkill/*/SKILL.md` 建立技能目录。
- 支持公司研究、PM 文本类 skill、PPT / super-ppt 等外部能力。
- 当前联网搜索模型由 `ARK_WEB_SEARCH_MODEL` 配置。

### Super PPT Editor

目录：[`apps/super-ppt-editor`](./apps/super-ppt-editor)

- 承接 super-ppt 编辑器相关服务。
- 与 `skill-runtime` 中的 PPT 生成链路协同。

### 原型存档

目录：[`apps/prototype`](./apps/prototype)

- 旧版 `0.0.x` 原型存档。
- 不再作为默认主应用增量开发入口。

## Agent 能力状态

### 已覆盖的销售会话

当前回归测试覆盖了以下典型链路：

- 查询客户 / 联系人 / 商机 / 拜访记录。
- 新增客户、联系人、商机、拜访 / 跟进记录。
- 缺字段时生成补充卡，用户补齐后继续预览。
- 查重命中后选择更新已有或仍然新建。
- 查客户 A、更新 A、再查客户 B、继续更新 B。
- 联系人详情后更新手机号、备注、地址、职务等字段。
- 联系人关联客户，走 `basicDataWidget` 候选选择。
- 商机、拜访记录绑定当前客户。
- 录入中插入查询、更新、再回到原任务。
- `查询所有客户` 等范围集合查询不承接旧上下文。
- 上传拜访录音后生成录音任务卡，点击卡片打开 meeting-viewer，点击按钮可触发四个下游外部技能。
- 从录音卡新增拜访记录时必须补齐客户、商机、跟进方式和负责人；正式写入前仍需用户确认。
- 同一录音已归档后，卡片显示“已新增拜访记录”，后端也阻止重复创建 pending。
- 新会话追问“上次拜访客户主要提了什么需求”等问题时，只检索已正式归档的录音资料和分析结果。

### 调试与观测

运行洞察已经能展示：

- 本轮意图帧。
- 是否使用上下文，以及使用或跳过原因。
- 语义候选和候选未承接状态。
- 工具选择与工具输入。
- 搜索过滤来源：
  - 用户显式条件。
  - 关系上下文绑定。
  - 名称 fallback。
  - 无过滤。
- 被忽略的未落地 LLM target。
- 写入预览、确认、取消和守卫阻断原因。
- 录音任务、下游技能和原始 trace 多标签；同一会话同时存在录音与录单任务时默认展示最新 Agent 任务。
- 用户侧展示业务资料来源，工程侧 trace 保留实际原子工具调用和 Evidence 来源。

## 测试质量体系

当前主验证命令：

- `pnpm --filter @yzj-ai-crm/tongyi-audio-service test`
- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/assistant-web test`
- `pnpm build`

重点测试层次：

- 单元层：集合查询判定、target grounding、语义引用解析。
- Runtime 层：planner 到最终工具输入 payload。
- Repository 层：上下文候选和 `contextSubject` 持久化。
- Scenario 层：完整多轮销售会话。
- UI 层：运行洞察调试展示、录音卡时间线、Chat 服务端权威同步。
- QA-agent 质检层：对 trace 做确定性风险评分。
- 录音层：fixture 读取、真实 outputs 解析、Markdown 资料包、缓存复用、过程文件隔离、正式归档与下游技能单份存储。

## 目录说明

- [`docs`](./docs)：正式设计文档。
- [`iterations`](./iterations)：版本迭代记录。
- [`iterations/0.9.0`](./iterations/0.9.0/README.md)：当前能力基线说明。
- [`apps/admin-api`](./apps/admin-api)：后端 Agent Runtime 与云之家 / 轻云适配。
- [`apps/admin-pro`](./apps/admin-pro)：管理员后台。
- [`apps/assistant-web`](./apps/assistant-web)：用户 AI 工作台。
- [`apps/skill-runtime`](./apps/skill-runtime)：外部 Skill Runtime。
- [`apps/super-ppt-editor`](./apps/super-ppt-editor)：Super PPT 编辑器服务。
- [`apps/tongyi-audio-service`](./apps/tongyi-audio-service)：通义录音处理独立服务。
- [`packages/shared`](./packages/shared)：共享类型与业务数据。
- [`3rd`](./3rd)：官方框架参考源码。
- [`3rdSkill`](./3rdSkill)：外部技能参考与运行材料。

## 启动方式

安装依赖：

```bash
pnpm install
```

分别启动：

```bash
pnpm dev:api
pnpm dev:skill-runtime
pnpm dev:admin
pnpm dev:assistant
pnpm dev:audio
```

或并行启动主要服务：

```bash
pnpm dev
```

默认端口：

- Admin API：`http://localhost:3001`
- Skill Runtime：`http://localhost:3012`
- Tongyi Audio Service：`http://127.0.0.1:3018`
- 管理员后台：`http://localhost:8000`
- 用户 AI 端：`http://localhost:5173`

## 常用命令

```bash
pnpm --filter @yzj-ai-crm/admin-api test
pnpm --filter @yzj-ai-crm/tongyi-audio-service test
pnpm --filter @yzj-ai-crm/assistant-web test
pnpm --filter @yzj-ai-crm/admin-api build
pnpm --filter @yzj-ai-crm/assistant-web build
pnpm --filter @yzj-ai-crm/admin-pro build
pnpm build
```

真实接口巡检按需执行：

```bash
pnpm --filter @yzj-ai-crm/admin-api test:live-agent-sales
pnpm --filter @yzj-ai-crm/admin-api test:live-shadow
pnpm --filter @yzj-ai-crm/skill-runtime test:live
```

## 开发约束

- 主 Agent 内核必须保持业务无关，不允许把 CRM 对象硬编码进核心层。
- CRM 业务对象、字段、口语和测试样例放在业务包、工具元数据或测试中。
- 不新增 `scene.*` 运行时技能。
- 前端改动必须保持官方框架范式：
  - 用户 AI 端对齐 `3rd/x-main`。
  - 管理员后台对齐 `3rd/ant-design-pro-master`。
- 每次迭代必须更新 `iterations/<version>/README.md`。
- 通义和其他第三方密钥只放 `.env`，不得提交真实 Key。

## 当前未完成项

- live 测试不是每轮必跑项，真实接口巡检需要按环境、账号、通义和模型 Key 状态单独执行。
- 真实 LLM judge 目前只作为后续巡检方向，主 CI 仍采用确定性断言和固定 seed。
- 部分 `docs/` 早期章节仍保留较早口径，后续需要继续按 `0.9.x` Agent 治理和录音资料闭环同步更新。
