# 0.10.0 云之家 SAAS 正式集成

## 版本目标

- 开始接入云之家正式轻应用环境，按 EID 做租户隔离。
- 明确【AI销售助手】与【轻云AI销售助手记录系统】双应用边界。
- 优先跑通 `YZJ_EID=21024647`，后续再迁移为后台可配置。

## 范围

- 后端新增云之家 app 级 AccessToken 与一次性 `ticket` 身份解析。
- 用户 AI 端支持从 URL `ticket` 解析真实 `openid/eid/appid`，本地无 `ticket` 时继续使用固定测试身份。
- 管理员后台“租户 / 应用”“云之家接入”只读展示 AI 轻应用、轻云记录系统与组织同步配置。
- `.env.example` 增加双应用配置分组说明。

## 关键能力

- 【AI销售助手】轻应用使用 `YZJ_APP_ID / YZJ_APP_SECRET / YZJ_SIGN_KEY`，负责 SSO、AI 会话、资料资产和 Agent 运行隔离。
- 【轻云AI销售助手记录系统】继续使用 `YZJ_LIGHTCLOUD_*`，负责轻云对象元数据、查询与写回。
- `/api/yzj/auth/resolve-ticket` 解析云之家身份，并拒绝非当前 `YZJ_EID` 的工作圈访问。
- `/api/yzj/auth/local-identity` 为本地调试提供固定身份兜底。

## 验收结果

- [x] 用户 AI 端可构建：`pnpm --filter @yzj-ai-crm/assistant-web build`
- [x] Admin API 测试：`pnpm --filter @yzj-ai-crm/admin-api test`
- [x] 用户 AI 端测试：`pnpm --filter @yzj-ai-crm/assistant-web test`
- [x] Admin API 构建：`pnpm --filter @yzj-ai-crm/admin-api build`
- [x] 管理员后台构建：`pnpm --filter @yzj-ai-crm/admin-pro build`
- [ ] 云之家正式入口手工验证

## 访问地址

- 云之家【AI销售助手】轻应用正式地址应配置为 `https://<你的正式域名>/chat`。
- 本地验证地址：
  - 用户 AI 端：`http://localhost:5173/chat`
  - 管理员后台：`http://localhost:8000/settings/tenant-app`
  - Admin API：`http://localhost:3001`

## 未完成项与下一步计划

- 本轮不做后台在线编辑租户/应用配置。
- 本轮不把密钥写入前端，不在后台明文展示。
- 下一步将 `eid/appId/轻云应用/外部技能配置` 从 `.env` 迁移为按租户持久化配置。
