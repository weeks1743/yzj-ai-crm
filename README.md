# yzj-ai-crm

`yzj-ai-crm` 从 `0.1.0` 起切换为同仓库协同开发的双系统正式原型，并在 `0.2.x` 引入独立 `admin-api` 承载系统基础设置、云之家组织同步和客户影子技能生成的真实联调；`0.3.0` 开始补入首个真实外部技能；`0.4.0` 新增独立 `skill-runtime`，承载外部技能市场中的 `implementationType=skill` 运行时：

- `管理员后台`：基于 `ant-design-pro` 工程范式，承担租户接入、记录系统治理、AI 资产管理、技能编排与系统配置
- `用户 AI 端`：基于 `ant-design/x` 独立式工作台，承担自然语言对话、任务推进、录音分析、公司研究与拜访准备
- `admin-api`：基于 TypeScript + Node，承担本地 `.env` 配置读取、SQLite 持久化、组织同步、客户模板元数据刷新、影子技能 bundle 生成、图片外部技能目录，以及 `ext.image_generate` 的真实 HTTP provider 调用
- `skill-runtime`：基于 TypeScript + Node 的独立 SKILL Runtime 服务，负责扫描 `3rdSkill/*/SKILL.md`、建立 catalog、调用 DeepSeek 工具循环、接入火山联网搜索，并异步执行 `company-research` / `pptx` 等外部 skill

`skill-runtime` 当前火山联网搜索模型通过 `ARK_WEB_SEARCH_MODEL` 配置，默认按最新验证切到 `doubao-seed-2-0-lite-260215`；也可以填写你在方舟控制台创建的 Endpoint ID。

## 当前版本

- 版本：`0.4.0`
- 目标：落地独立 SKILL Runtime 服务，为外部技能市场建立 `implementationType=skill` 的真实执行底座

## 核心原则

- 同一业务域拆分为两个正式入口，但共享同一套租户上下文、主数据对象、任务资产和技能治理
- 管理员后台优先采用 `@umijs/max + @ant-design/pro-components` 的官方后台范式
- 用户 AI 端优先采用 `@ant-design/x + @ant-design/x-sdk + @ant-design/x-markdown` 的官方独立式对话范式

## 目录说明

- [docs](./docs)：
  正式设计文档
- [iterations/0.3.0](./iterations/0.3.0/README.md)：
  当前版本说明
- [apps/admin-api](./apps/admin-api)：
  系统基础设置、组织同步、客户影子技能与图片外部技能后端
- [apps/skill-runtime](./apps/skill-runtime)：
  外部技能市场 `implementationType=skill` 的独立执行服务
- [skills/shadow](./skills/shadow)：
  客户影子技能 bundle 输出目录
- [apps/admin-pro](./apps/admin-pro)：
  管理员后台
- [apps/assistant-web](./apps/assistant-web)：
  用户 AI 端
- [packages/shared](./packages/shared)：
  共享类型与业务 mock
- [apps/prototype](./apps/prototype)：
  旧版 `0.0.x` 原型存档，不再作为默认启动入口

## 启动方式

```bash
pnpm install
pnpm dev:api
pnpm dev:skill-runtime
pnpm dev:admin
pnpm dev:assistant
```

构建：

```bash
pnpm build
```

默认端口约定：

- admin-api：`http://localhost:3001`
- skill-runtime：`http://localhost:3012`
- 管理员后台：`http://localhost:8000`
- 用户 AI 端：`http://localhost:5173`
