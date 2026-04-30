# yzj-ai-crm

`yzj-ai-crm` 是面向云之家 / 金蝶销售工作方式的 AI CRM 正式产品原型。项目当前不是单页 demo，而是按“管理员后台 + 用户 AI 工作台 + 后端 Agent Runtime + 外部 Skill Runtime”协同推进的同仓库工程。

当前能力基线：`0.7.6`

本次 README 刷新归属：`0.7.7`

## 当前进展

### 产品侧

项目已经从早期 `0.4.x` 的外部技能接入，推进到 `0.7.x` 的会话式 CRM 任务闭环：

- 用户可以用自然语言查询、新增、更新 CRM 记录对象。
- 当前重点覆盖客户、联系人、商机、拜访 / 跟进记录四类销售对象。
- 写入类任务统一走“预览 -> 用户确认 -> 写回”，不会直接静默改数据。
- 录入过程中可以中途查询其他对象，再回到原任务补字段。
- 查询后可以继续说“这个客户”“这个联系人”进行上下文承接。
- 裸集合查询如 `查询客户`、`查询所有客户` 不再误用上一轮具体客户。
- 关系字段如“联系人关联客户”会走候选选择链路，不把客户名误写成省份或普通文本。
- 用户 AI 端的运行洞察抽屉可以展示意图、上下文使用、工具选择、过滤来源、target 清洗和写入阻断原因。
- 管理员后台承担租户配置、组织同步、记录对象治理、技能目录、Agent 观测与运行治理。

### 技术侧

`0.7.x` 的重点是把主 Agent 从 CRM 个案中抽离出来，形成业务无关的核心协议和业务包扩展机制：

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
  - 会话运行审计和调试 trace。
  - 记录写回预览、确认、取消和提交。

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

## 测试质量体系

当前后端主测试已达到：

- `pnpm --filter @yzj-ai-crm/admin-api test`：134/134 通过。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。

重点测试层次：

- 单元层：集合查询判定、target grounding、语义引用解析。
- Runtime 层：planner 到最终工具输入 payload。
- Repository 层：上下文候选和 `contextSubject` 持久化。
- Scenario 层：完整多轮销售会话。
- UI 层：运行洞察调试展示。
- QA-agent 质检层：对 trace 做确定性风险评分。

完整交互场景当前约 128 条，覆盖 428+ 轮多轮对话；其中 0.7.5 新增 48 条 QA-agent 质量场景，覆盖 176+ 轮。

## 目录说明

- [`docs`](./docs)：正式设计文档。
- [`iterations`](./iterations)：版本迭代记录。
- [`iterations/0.7.6`](./iterations/0.7.6/README.md)：当前能力基线说明。
- [`apps/admin-api`](./apps/admin-api)：后端 Agent Runtime 与云之家 / 轻云适配。
- [`apps/admin-pro`](./apps/admin-pro)：管理员后台。
- [`apps/assistant-web`](./apps/assistant-web)：用户 AI 工作台。
- [`apps/skill-runtime`](./apps/skill-runtime)：外部 Skill Runtime。
- [`apps/super-ppt-editor`](./apps/super-ppt-editor)：Super PPT 编辑器服务。
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
```

或并行启动主要服务：

```bash
pnpm dev
```

默认端口：

- Admin API：`http://localhost:3001`
- Skill Runtime：`http://localhost:3012`
- 管理员后台：`http://localhost:8000`
- 用户 AI 端：`http://localhost:5173`

## 常用命令

```bash
pnpm --filter @yzj-ai-crm/admin-api test
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

## 当前未完成项

- live 测试不是每轮必跑项，真实接口巡检需要按环境和账号状态单独执行。
- 真实 LLM judge 目前只作为后续巡检方向，主 CI 仍采用确定性断言和固定 seed。
- 部分 `docs/` 早期章节仍保留 0.1.x 口径，后续需要继续按 0.7.x Agent 治理现状同步更新。
