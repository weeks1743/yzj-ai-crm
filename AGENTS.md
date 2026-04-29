# AGENTS

本文件是 `yzj-ai-crm` 仓库内给 Codex 及其他代理使用的执行公约。

目标只有一个：后续所有迭代都必须基于本项目既定的版本治理、官方框架范式和正式产品形态推进，禁止再次出现“看起来像临时演示页”或“用了框架名但没有按官方方式设计”的情况。

## 1. 版本迭代规范

- 项目根目录固定维护 `iterations/` 版本迭代目录。
- 每次进入新迭代前，必须先创建对应版本目录，例如 `iterations/0.1.1/`。
- 每个版本目录内必须包含 `README.md`，用于记录本轮版本目标、范围、关键页面/能力、验收结果、未完成项和下一步计划。
- 版本号统一采用语义化版本：
  - 小功能：`0.0.1`
  - 中型迭代：`0.1.0`
  - 大型里程碑：`1.0.0`
- 每次代码提交都必须映射到明确版本，不允许出现无版本归属的提交。
- 提交信息必须显式带版本号，例如：
  - `feat(0.1.0): 重构管理员后台与用户AI双系统原型`
  - `fix(0.1.1): 修复用户AI端全局滚动`
- 阶段收口或对外发布时应创建对应 tag，例如 `v0.1.0`。

## 2. 前端框架强约束

### 2.1 用户 AI 端

- 用户 AI 端必须使用本仓库本地参考源码：
  - `3rd/x-main`
- 设计和实现必须优先对齐：
  - `3rd/x-main/packages/x/docs/playground/independent.tsx`
- 对话侧必须采用 `@ant-design/x`、`@ant-design/x-sdk`、`@ant-design/x-markdown` 的官方组合方式。
- 严禁使用 Codex 内置前端交互风格、默认 AI 对话壳、类 Copilot/Codex 自定义布局替代 `x-main` 官方壳。
- 严禁只使用 `Bubble`、`Sender` 等零散组件后手工拼出一个“看起来像聊天页”的自定义界面。
- 用户 AI 端必须首先像正式 AI 工作台，其次才是业务定制。

### 2.2 管理员后台

- 管理员后台必须使用本仓库本地参考源码：
  - `3rd/ant-design-pro-master`
- 设计和实现必须优先对齐：
  - `3rd/ant-design-pro-master/config/routes.ts`
  - `3rd/ant-design-pro-master/src/pages/dashboard/analysis/index.tsx`
- 管理侧必须采用 `@umijs/max + @ant-design/pro-components` 的官方后台工程范式。
- 严禁使用 Codex 内置前端交互风格、临时玻璃卡片风格、手工拼装伪后台页面替代 Pro 正式页型。
- 列表页、详情页、表单页、仪表盘页必须优先使用 Pro 的页面组织方式，而不是随意堆卡片。

## 3. 严禁事项

- 严禁把 `apps/prototype` 继续当作默认主应用增量修补。
- 严禁脱离 `3rd/x-main` 和 `3rd/ant-design-pro-master` 的官方参考，自行发明新的前端壳体。
- 严禁为了图快，使用 Codex 默认审美或通用 AI 原型样式覆盖项目既定框架风格。
- 严禁在没有版本目录和版本说明文件的前提下直接开始新一轮实现。
- 严禁提交生成产物、临时缓存或与源码无关的构建目录。

## 4. Agent 业务无关与奥卡姆剃刀原则

- 主 Agent 内核必须保持业务无关。`agent-core`、`agent-runtime`、`tool-registry` 等核心层只能表达通用契约、状态、工具、策略、确认、证据和上下文，不允许出现 customer/contact/opportunity/followup 等具体 CRM 类型。
- 业务对象、业务字段、业务话术和验收场景只能放在业务包、计划模板、slash 入口、测试样例或工具元数据中，例如 `crm-agent-pack`，不得回流成主 Agent 内核分支。
- 处理上下文承接、指代消解、写前查重、写回确认等能力时，优先采用业务无关机制，例如 `ContextFrame`、`ReferenceResolver`、`ToolDefinition` 元数据和 `PolicyDecision`，不允许为了单个 CRM 场景硬编码特殊流程。
- 遵循奥卡姆剃刀原则：能用已有通用分层、工具契约和元数据解决的问题，不新增场景技能、不新增专用路由、不新增平行框架；只有当通用机制无法表达稳定需求时，才引入新的抽象。
- 新抽象必须先证明它减少真实复杂度、复用现有框架范式，并能服务多个业务包；不得为了绕过当前 bug 或演示路径创建一次性概念。
- 记录系统 Skill 默认视为外部黑盒工具。主 Agent 可以根据工具契约组织输入、解释输出和做策略守卫；若怀疑 Skill 本身实现有问题，必须先形成诊断并与用户确认，不得擅自改写 Skill 语义。
- 严禁在主 Agent 核心层注册或选择 `scene.*` 运行时技能；场景只能作为 slash 入口、计划模板、业务工具包和验收场景存在。

## 5. 文档与设计依据

- `docs/` 是正式设计依据，除非用户明确改变口径，否则必须先遵循：
  - `docs/README.md`
  - `docs/项目公约.md`
  - 当前版本对应的 `iterations/<version>/README.md`
- 如果用户明确调整产品方向、信息架构或框架基线，必须同步更新：
  - `docs/项目公约.md`
  - 相关设计文档
  - 对应版本迭代说明

## 6. 实施要求

- 修改前端页面时，先核对对应 `3rd/` 参考实现，再动手。
- 用户 AI 端新增页面或重构页面时，优先复用 `independent` 的布局、Welcome、Prompts、Bubble.List、Sender.Header、Sender 等组合关系。
- 管理员后台新增页面或重构页面时，优先复用 Pro 的路由组织、PageContainer、ProTable、ProDescriptions、ProForm、分析页布局等模式。
- 若业务需要定制，只允许在官方壳体和官方交互骨架之上做业务化延展，不允许改回玩具化页面。

## 7. 交付与验证要求

- 所有前端改动完成后，至少验证受影响应用可构建：
  - 管理员后台：`pnpm --filter @yzj-ai-crm/admin-pro build`
  - 用户 AI 端：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 若改动涉及双端共享逻辑，需执行根构建：
  - `pnpm build`
- 最终说明中必须明确：
  - 本次归属的版本号
  - 是否已更新 `iterations/<version>/README.md`
  - 是否已完成构建验证

## 8. 默认执行原则

- 默认优先做“正式产品原型”，不是“临时 demo”。
- 默认优先保持与官方框架一致的结构和气质，而不是追求个人化发挥。
- 默认优先保证页面像真实管理员/用户产品，而不是像 Codex 自动生成页面。

## 9. GitHub 推送约定

- 若推送或拉取 GitHub 远端时遇到网络问题，默认优先尝试本地代理，而不是反复重试裸连。
- 当前仓库可使用以下代理环境变量进行 GitHub 推送：
  - `export http_proxy=http://127.0.0.1:1087`
  - `export https_proxy=http://127.0.0.1:1087`
- 执行 `git push`、`git pull`、`git fetch` 等 GitHub 远端操作前，若裸连失败，可先注入上述代理环境再执行。
