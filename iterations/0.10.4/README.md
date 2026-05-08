# 0.10.4 云之家真实身份展示替换

## Summary

- 移除用户 AI 端左下角硬编码身份副标题，只展示当前云之家登录人姓名。
- 管理员后台全局顶栏不再展示样板租户名称，EID 与右上角用户信息改为云之家身份解析结果。
- 保留本地调试固定身份兜底，正式轻应用入口优先使用 ticket 解析后的真实 `eid`、`userName` 和 `operatorOpenId`。

## Scope

- `assistant-web`
  - 左下角只显示登录人姓名，去除角色标签与 SOUL 配置状态。
  - 运行洞察中的租户上下文使用当前身份的 `eid/appId/userName`。
- `admin-pro`
  - `getInitialState` 读取云之家身份接口。
  - 顶栏移除租户名称 Tag，仅保留 EID Tag。
  - 头像与右上角姓名使用当前登录人姓名。
- `admin-api` / `shared`
  - 云之家身份响应补充 `displayEid`，统一前端展示字段。

## Acceptance

- 用户 AI 端左下角不再出现“金蝶云之家销售 · SOUL 未配置”。
- 管理员后台顶栏不再出现“云之家华东样板租户”。
- 管理员后台 EID 不再使用 `eid_yzj_cn_hz_001` mock 值，而是来自云之家身份响应。
- 管理员后台右上角姓名不再使用 `张晨路` mock 值，而是来自云之家身份响应。

## Verification

- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`

## Follow-up

- 若云之家后台管理入口后续提供独立 ticket 注入方式，可将管理侧与用户侧共用的身份解析缓存抽成共享前端模块。

---

# 0.10.4 录音资料包与公网 Viewer 修复

## Summary

- 修复服务端录音下游技能提示“录音资料包文件不存在”的容器卷边界问题。
- 修复 meeting-viewer 跳转暴露 Docker 内部地址 `tongyi-audio-service:3018` 的公网访问问题。
- 修复真实上传任务 `providerDataId` 与 md5 输出目录不一致导致公网 viewer API 404 的问题。
- 本轮保持通义音频服务只在内网运行，浏览器统一通过 `https://chat.xiami66.com/audio-viewer/` 反向代理访问。

## Scope

- `admin-api`
  - 新增 `TONGYI_AUDIO_PUBLIC_BASE_URL` 配置，用于浏览器 viewer 跳转。
  - 保留 `TONGYI_AUDIO_SERVICE_BASE_URL` 作为服务端内部调用地址。
- `tongyi-audio-service`
  - meeting-viewer 支持 `/audio-viewer/*` 前缀访问。
  - viewer 静态脚本在带前缀路径下请求 `/audio-viewer/api/*` 与 `/audio-viewer/outputs/*`。
  - viewer API 支持通过 `providerDataId`、音频 md5、内部 `taskId` 别名定位真实输出目录。
- 生产 Docker / Nginx
  - `admin-api`、`skill-runtime` 只读挂载 `audio-data:/app/.local/tongyi`。
  - `chat.xiami66.com` 新增 `/audio-viewer/` 到 `tongyi-audio-service:3018` 的代理。

## Acceptance

- `recording-task-812532a7` 的 viewer 跳转不再包含 `tongyi-audio-service` 内部域名。
- 对真实上传任务，即使资料包尚未生成，viewer 也优先使用共享回放路径推导 md5 输出目录，避免 `providerDataId` 目录 404。
- `admin-api` 与 `skill-runtime` 容器均可读取 `/app/.local/tongyi/.../recording-material.md`。
- 对已完成录音任务触发下游技能时，不再报“录音资料包文件不存在”。
- viewer 页面能加载任务列表、任务详情、音频回放和画像分析写入结果。

## Verification

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime test`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime build`
- 已通过：`pnpm --filter @yzj-ai-crm/tongyi-audio-service test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm build`

## Follow-up

- 后续可把 `TONGYI_AUDIO_PUBLIC_BASE_URL` 纳入管理后台只读配置状态展示。
