# 0.10.15 云之家 Ticket 刷新重放与本地身份兼容修复

## 版本目标

- 修复云之家线上集成环境点击“刷新应用”后重复消费一次性 ticket，导致 `/api/yzj/auth/resolve-ticket` 502 和“云之家身份解析失败”的问题。
- 保持本地开发无 ticket 访问 `/chat` 时继续使用指定 `VITE_YZJ_OPERATOR_OPEN_ID` 或默认测试 openid。

## 文档依据

- `yzj-api/解析用户身份.md`：ticket 解析必须使用 app 级 AccessToken，请求体包含 `appid`、`ticket`、`disposable: true`。
- `yzj-api/解析用户身份.md`：ticket 不可缓存重复使用。
- `yzj-api/轻应用开发.md`：`getPersonInfo` 仅适合客户端展示身份，不作为服务端登录凭证。

## 修复范围

- 用户 AI 端：
  - 首次 ticket 解析成功后缓存已验证身份，并额外保存 ticket 的 SHA-256 fingerprint，不保存原始 ticket。
  - 线上刷新应用再次带回同一个旧 ticket 时，命中 fingerprint 后复用已验证身份，不再调用 `/api/yzj/auth/resolve-ticket`。
  - ticket 解析成功或命中缓存后，从当前 URL 移除 `ticket` 参数，保留云之家其他入口参数。
  - 本地开发无 ticket 时优先使用本地固定身份，不被旧 ticket 身份缓存覆盖。

## 验收结果

- 已执行：`pnpm --filter @yzj-ai-crm/assistant-web test`。
- 已执行：`pnpm --filter @yzj-ai-crm/assistant-web build`。
- 已验证：新增 ticket fingerprint 缓存单测通过，覆盖同 ticket 命中、异 ticket 不命中、local_fixed 清理 fingerprint。
- 已验证：assistant-web 生产构建通过，未引入新的编译错误。

## 未完成项

- 本轮不引入 HttpOnly 服务端会话。
- 本轮不使用 `getPersonInfo` 替代服务端 ticket SSO。
- 首个红色 `/chat?...ticket=...` 若只是云之家 iframe 导航过程中的中断且应用最终可用，不作为本轮主修复对象。
