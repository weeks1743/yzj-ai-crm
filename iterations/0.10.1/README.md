# 0.10.1 云之家入口稳定性与首屏加载优化

## 版本目标

- 修复云之家轻应用内点击“新会话”后丢失入口 ticket 并进入身份解析失败页的问题。
- 优化线上 Web 容器静态资源缓存与 gzip，降低重复访问和首屏资源加载成本。

## 范围

- 用户 AI 端：首次 ticket 解析成功后在当前浏览器会话缓存身份，上下文内路由跳转不再依赖一次性 ticket。
- 用户 AI 端：保留本地调试无 ticket 固定身份策略。
- 线上部署：补齐 Web Nginx 静态资源缓存、gzip、`index.html` 不缓存策略。
- 线上部署：保留 0.10.0 生产 Compose 中 `admin-api` 注入 `SKILL_RUNTIME_POSTGRES_URL` 的修复。

## 验收结果

- 已完成：
  - `pnpm --filter @yzj-ai-crm/assistant-web test`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
- 待完成：
  - 线上 Docker Compose 重建与健康检查

## 未完成项

- 首屏主 JS 包仍偏大，后续可拆分 `antd/x`、Markdown、A2UI、录音模块等大型依赖。
- 多租户后台可配置仍留到后续迭代。

## 下一步计划

- 将生产部署配置从临时 `tmp/` 资料整理为可跟踪的正式部署目录。
- 继续拆分用户 AI 端首屏 bundle，并增加真实网络条件下的 Lighthouse/Performance 记录。
