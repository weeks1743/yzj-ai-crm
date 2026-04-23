# yzj-ai-crm

`yzj-ai-crm` 从 `0.1.0` 起切换为同仓库协同开发的双系统正式原型：

- `管理员后台`：基于 `ant-design-pro` 工程范式，承担租户接入、记录系统治理、AI 资产管理、技能编排与系统配置
- `用户 AI 端`：基于 `ant-design/x` 独立式工作台，承担自然语言对话、任务推进、录音分析、公司研究与拜访准备

## 当前版本

- 版本：`0.1.0`
- 目标：管理员/用户双系统高保真正式原型

## 核心原则

- 同一业务域拆分为两个正式入口，但共享同一套租户上下文、主数据对象、任务资产和技能治理
- 管理员后台优先采用 `@umijs/max + @ant-design/pro-components` 的官方后台范式
- 用户 AI 端优先采用 `@ant-design/x + @ant-design/x-sdk + @ant-design/x-markdown` 的官方独立式对话范式

## 目录说明

- [docs](./docs)：
  正式设计文档
- [iterations/0.1.0](./iterations/0.1.0/README.md)：
  当前版本说明
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
pnpm dev:admin
pnpm dev:assistant
```

构建：

```bash
pnpm build
```

默认端口约定：

- 管理员后台：`http://localhost:8000`
- 用户 AI 端：`http://localhost:5173`
