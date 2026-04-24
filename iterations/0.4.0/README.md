# 0.4.0 版本说明

## 版本目标

- 新增独立 `apps/skill-runtime` 服务，专门承载外部技能市场中的 `implementationType=skill`
- 保持与 AI-CRM、影子系统、轻云对象和 `YZJ_*` 配置完全解耦
- 首期打通 `company-research` 与 `pptx` 两类样板 skill 的真实运行链路
- 为后续 `skill / http_request / mcp/tool` 并存的外部技能市场预留统一 API 与状态字段

## 范围

- `apps/skill-runtime`
- `README.md`
- `.env.example`
- `package.json`
- `iterations/0.4.0/README.md`

## 依赖框架

- 管理员后台：本轮不变，继续保持 `@umijs/max + @ant-design/pro-components`
- 用户 AI 端：本轮不变，继续保持 `@ant-design/x` 官方工作台口径
- 独立 Runtime 服务：`TypeScript + node:http + node:test + node:sqlite`

## 关键能力

### 1. 独立 SKILL Runtime 服务

- 新增 `apps/skill-runtime`
- 服务启动后扫描 `3rdSkill/*/SKILL.md`
- 建立 skill catalog、状态、依赖探测与模型目录 API
- 与 `admin-api` 平行部署，不依赖 AI-CRM / 影子系统运行时

### 2. DeepSeek + 火山联网搜索双层执行

- 底层模型固定走 DeepSeek 官方兼容接口
- 仅允许：
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`
- `company-research` 通过 Runtime 内部的 `web_search` 工具接入火山联网搜索
- `web_fetch_extract` 由 Runtime 独立抓取和提炼网页正文

### 3. 异步 Job 与 Artifact 管理

- 新增 API：
  - `GET /api/health`
  - `GET /api/models`
  - `GET /api/skills`
  - `POST /api/jobs`
  - `GET /api/jobs/:jobId`
  - `GET /api/jobs/:jobId/artifacts/:artifactId`
- Job 状态固定为：
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
- Artifact 统一落本地文件系统并写入 SQLite 元数据

### 4. 样板 skill 与分层状态

- 首期可执行：
  - `company-research`
  - `pptx`
- 首期 catalog 可见但不开放执行：
  - `docx`
  - `xlsx`
  - `pdf`
  - 其余 `3rdSkill`
- Skill 状态固定为：
  - `available`
  - `blocked`
  - `unsupported_yet`

### 5. PPTX 商务化优化（v2）

- `pptx` 拆分为内部双模式：
  - `fresh_deck`
  - `template_following`
- `fresh_deck` 不再从 `python-pptx` 默认模板起步，改为：
  - `read_source_file`
  - `pptx_plan_deck`
  - `pptx_render_deck`
  - `pptx_quality_check`
  - `pptx_render_previews`
- 新增受控 `deckSpec` 与本地 `PptxGenJS` 渲染器：
  - 固定 16:9
  - 商务化 safe area / 字号层级 / 页脚规范
  - cover / summary / company overview / timeline / KPI / risk / closing 等版式
- 保留原 XML 工具链，但仅用于 `template_following`
- `pptx` job 增加稳定事件：
  - `deck_planned`
  - `deck_rendered`
  - `qa_report`
  - `previews_rendered`
- `saved-PPTX QA` 不再依赖读 JPG 二进制，而是先做结构化验收，再产出 PDF/JPG 预览
- `pptx` tool loop 增加 mode-aware budget 与 stop condition：
  - QA 通过并完成 previews 后自动结束
  - 不再出现 pack 成功后继续空转到 failed 的问题

## 验收结果

- 已新增独立 `apps/skill-runtime` 工程骨架与根脚本接入
- 已实现 skill loader、frontmatter/base-dir 注入、catalog 与依赖探测
- 已实现基于 SQLite 的 job / event / artifact 持久化
- 已实现 DeepSeek tool loop、火山联网搜索 provider 标准化、网页抓取提炼
- 已实现 `company-research` 与 `pptx` 的首期执行通路
- 已将 `pptx` 升级为商务化 v2 流程，并补齐：
  - fresh/template 双模式
  - DSL 规划与受控渲染
  - saved-PPTX QA
  - PDF/JPG 预览链路
  - mode-aware stop condition
- 已补充 mock / 集成 / live 测试入口与构建脚本

## 未完成项

- 外部技能市场本轮尚未直接改造为接入 `skill-runtime`
- `docx / xlsx / pdf` 仅登记为 `unsupported_yet`，暂不开放执行
- 不实现 ClaudeCode 的 REPL、Ink UI、MCP、Agent swarm、多线程会话

## 密钥与配置要求

- DeepSeek 与火山凭据只允许通过本地环境变量注入
- 火山联网搜索模型通过 `ARK_WEB_SEARCH_MODEL` 指定，默认使用 `doubao-seed-2-0-lite-260215`，也可替换为方舟 Endpoint ID
- 不写入仓库
- 不写入 SQLite
- 不在版本说明、测试夹具或示例日志中明文展示

## 验证要求

- `pnpm --filter @yzj-ai-crm/skill-runtime test`
- `pnpm --filter @yzj-ai-crm/skill-runtime build`
- `pnpm build`

## 下一步计划

- 将外部技能市场页面映射到 `skill-runtime` 的 catalog / invoke 能力
- 在场景技能层补上“命中什么场景就转发到什么 implementationType”的编排入口
- 逐步评估 `docx / xlsx / pdf` 的依赖补齐与开放顺序
