# 0.3.0 版本说明

## 版本目标

- 从“记录系统技能阶段”切换到“外部技能真实接入阶段”
- 首轮只真实接入 `ext.image_generate`
- 为外部技能建立最小统一契约，明确实现方式、状态与调用边界
- 将管理员后台 `外部技能` 页从静态目录升级为“目录 + 试运行台”

## 范围

- `apps/admin-api`
- `apps/admin-pro`
- `packages/shared`
- `docs/04-场景技能总览与编排原则.md`
- `docs/09-用户对话层与Agent编排.md`
- `README.md`
- `iterations/0.3.0/README.md`

## 依赖框架

- 管理员后台：`@umijs/max + @ant-design/pro-components`
- 用户 AI 端：本轮不变，继续保持 `@ant-design/x` 官方工作台口径
- 后端服务：`TypeScript + Node.js`

## 关键能力

### 1. 外部技能首轮真实接入

- 新增 `ext.image_generate`
- 实现方式固定为 `http_request`
- 底层调用固定走 `POST /v1/images/generations`
- 当前只支持文生图，不做图生图、编辑与资产沉淀

### 2. 外部技能统一契约

- `ExternalSkillStatus` 扩展为：
  - `运行中`
  - `告警中`
  - `占位中`
- 外部技能新增：
  - 实现方式
  - 是否支持调用
  - 模型 / Provider
- 图片生成新增公开请求 / 响应 DTO

### 3. 管理后台外部技能页升级

- `/skills/external-skills` 改为真实 API 驱动
- 显式展示：
  - 实现方式
  - 是否可调用
  - 模型 / Provider
  - 状态
- `ext.image_generate` 详情支持：
  - Prompt 输入
  - 尺寸选择
  - 质量选择
  - 生成按钮
  - 错误提示
  - 图片预览
  - 生成元信息展示

## 验收结果

- 已新增 `ext.image_generate`，并固定按 `http_request` 方式调用 `POST /v1/images/generations`
- 已为外部技能补齐最小统一契约：实现方式、是否可调用、模型 / Provider、`运行中 / 告警中 / 占位中`
- 已将后台 `/skills/external-skills` 升级为真实 API 驱动的“目录 + 试运行台”
- 其他 `ext.*` 能力继续以占位目录展示，不提供执行入口
- 已完成构建与测试验证：
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/admin-pro build`

## 未完成项

- AI 端不新增图片技能入口
- 其他 ext.* 技能仍保持占位展示，不接真实 provider
- 图片结果不进入正式 AI 资产体系
- 不做 MCP / tool / skill wrapper 适配

## 密钥与配置要求

- 图片 API Key 只允许保存在本地 `.env`
- 不写入仓库
- 不写入数据库
- 不在后台明文展示
- `.env.example` 只保留变量名与占位值

## 验证要求

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- `pnpm --filter @yzj-ai-crm/admin-pro build`

## 下一步计划

- 评估 `ext.company_research_pm` 是否从占位切到真实 provider
- 评估图片结果是否需要沉淀为正式 AI 资产
- 再决定是否给 AI 端增加独立图片入口或把图片能力纳入后续场景编排
