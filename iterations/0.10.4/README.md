# 0.10.4 云之家真实身份展示替换

> 合并说明：本版本同时保留线上主线的“真实身份展示 / 公网 Viewer 修复”，以及本地分支中已完成的 `/拜访准备` 客户对象优先与非资产化修复记录。

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

---

# 0.10.4 `/拜访准备` 客户对象优先与非资产化修复

## 版本目标

- 修复 `/拜访准备 贝斯美` 被公司研究资料主对象漂移匹配的问题。
- 将 `/拜访准备` 的业务主语调整为客户对象：先解析客户，再读取该客户关联的公司研究资料。
- 多个客户或多份公司研究资料命中时，使用 Meta Question Card `single_select` 让用户点选。
- 将 `ext.yunzhijia_visit_prep` 配置为不沉淀资料资产，只返回本轮对话 Markdown。
- 修复 Agent 运行态误用 AI 轻应用 `appId` 导致无法命中轻云记录系统资料空间的问题，统一使用 `eid + config.yzj.lightCloud.appId` 作为隔离标识。
- 取消 `/拜访准备` 超过 70 秒后持久化“仍在运行”的占位响应；拜访准备必须等 Skill 成功或失败后再返回最终结果。
- 恢复 `/拜访准备` 运行时 Markdown 附件的“生成图片”能力，并移除图片提示词中的免责声明、内部提醒和“待确认”噪声。

## 实施范围

- 后端 Agent 编排：
  - `/拜访准备` 先执行 `record.customer.search`。
  - 客户 0 命中时阻断并要求补充客户名称。
  - 客户多命中时返回客户单选澄清卡片。
  - 客户唯一命中后读取 `customer:<formInstId>` 关联的 `company_research`，旧资料无客户 anchor 时按同 `eid + appId` 名称 fallback。
  - 公司研究资料多命中时返回资料单选澄清卡片。
  - `customerNeed` 改为可选，未提供时要求 Skill 生成通用拜访准备并标注待销售确认事项。
  - 公司研究资料读取优先使用轻云记录系统 `lightCloud.appId` 命名空间；过渡期只读兼容误落到 AI 轻应用 `appId` 的历史 `company_research`。

- 资料沉淀策略：
  - 外部技能目录新增静态 `assetMaterialization` 配置。
  - 公司研究沉淀 `company_research`。
  - 录音资料包沉淀 `recording_material`，录音下游分析沉淀 `analysis_material`。
  - 客户拜访准备关闭资料沉淀，不创建 `analysis_material`，不生成 Evidence Card，不进入向量检索。
  - 新生成的公司研究、录音资料、录音分析资料统一写入 `eid + lightCloud.appId` 资料空间。

- 租户隔离与数据修复：
  - 新增 `tenant-isolation` helper，服务端忽略前端或 ticket 传入的非 canonical `appId`，统一归一到 `config.yzj.lightCloud.appId`。
  - 根目录 `AGENTS.md` 增补应用 ID 隔离约定：`config.yzj.appId` 仅用于 AI 轻应用 SSO/ticket 凭证，不作为资料隔离键。
  - 新增 `pnpm --filter @yzj-ai-crm/admin-api repair:agent-isolation-app-id`，默认 dry-run；显式 `-- --apply` 时把误落到 legacy AI appId 的 Mongo Artifact/Qdrant payload 迁回 `lightCloud.appId`。

- 管理员后台与用户端：
  - 外部技能详情新增只读“资料沉淀策略”区块。
  - `/拜访准备` placeholder 调整为“输入客户名称，客户关注点可选”。
  - `/拜访准备` 成功后返回本轮 Skill runtime Markdown 附件下载入口；附件不是 CRM 资料资产，不进入 Evidence Card 或向量检索。

- 历史运行态修复：
  - 新增 `pnpm --filter @yzj-ai-crm/admin-api repair:visit-prep-stuck-runs`，默认 dry-run。
  - 显式 `-- --apply` 时，对账已成功的 `ext.yunzhijia_visit_prep` job，将卡在 `running` 的 Agent run/tool call/message 回写为 `completed`。

- 运行时 Markdown 配图：
  - 新增 `/api/markdown/image`，复用外部图片生成服务，但不创建资料资产、不写 Artifact 图片生成记录、不进入向量检索。
  - 用户端在 Markdown 附件区恢复“生成图片/重新生成图片”，生成后在附件下方预览并支持下载。
  - 图片生成提示词会先清洗 Markdown，移除来源元信息、免责声明、内部校验提醒、`待销售确认/待确认/核实确认` 行与章节，避免无关内容出现在图片里。

- 本地调试身份：
  - 用户 AI 端在本地开发或 localhost 无 ticket 访问时，直接使用固定 openid 身份，不再请求服务端 `/api/yzj/auth/local-identity`。
  - “云之家身份解析失败”错误卡仅用于真实服务器/ticket 入口解析失败场景，避免本地调试时被后端 500 或端口占用误挡。

## 验收结果

- `/拜访准备 贝斯美` 命中单个客户且有关联公司研究资料时，直接调用 `ext.yunzhijia_visit_prep`，返回 Markdown，不保存 `analysis_material`。
- 多个“贝斯美”客户时，返回客户单选 Meta Question Card。
- 单客户命中多份公司研究资料时，返回资料单选 Meta Question Card。
- 缺少客户对象或有效公司研究 Markdown 时，阻断外部 Skill 调用。
- 外部技能目录接口返回资料沉淀策略，后台只读展示。
- `/拜访准备 贝斯美` 与 `/拜访准备 绍兴贝斯美化工股份有限公司` 的真实 trace 根因为运行态 `appId=501037729`、公司研究资料 `appId=501037649`；修复后运行态归一到 `lightCloud.appId=501037649`，可命中已有公司研究 Markdown。
- `trace-agent-0a7e48ae` 与 `trace-agent-8837d41b` 的 Skill job 均已成功，根因为 Agent 在 70 秒窗口后提前保存 `running` 终态；修复脚本已把本地历史 run 对账为 `completed`，并补回 Markdown 附件。
- `/拜访准备` 返回的运行时 Markdown 附件可直接生成图片；该图片仅作为本轮附件衍生物，不沉淀为 CRM 资料资产。
- 图片提示词已剔除与业务内容无关的免责声明、内部提醒、待确认章节和待确认标记。
- 本地开发访问 `/chat` 不再因缺少云之家 ticket 或本地身份接口异常显示“云之家身份解析失败”。

## 验证

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api repair:agent-isolation-app-id`，本地 Mongo 资料资产 dirty count 为 0。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api repair:agent-isolation-app-id -- --apply`，本地无待迁移 dirty artifact，执行幂等。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api repair:visit-prep-stuck-runs -- --trace trace-agent-0a7e48ae --trace trace-agent-8837d41b`，dry-run 命中 2 条可修复 run。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api repair:visit-prep-stuck-runs -- --apply --trace trace-agent-0a7e48ae --trace trace-agent-8837d41b`，本地 2 条历史 run 已回写为 completed。
- 已验证：真实 `/api/agent/chat` 请求 `/拜访准备 贝斯美` 在 trace `trace-agent-ad0c71dc` 中成功复用公司研究 artifact `9d0691df-4d27-4ea0-b276-4671b43a0bd7`，并触发 `ext.yunzhijia_visit_prep`。
- 已验证：真实 `/api/agent/chat` 请求 `/拜访准备 贝斯美` 在 trace `trace-agent-64fa9f2d` 中等待约 84.5 秒后直接返回 `completed`，未出现“仍在运行/已等待 70 秒”文案，并返回 Markdown 附件 `yunzhijia-visit-prep-b77f2cc3-339f-4cd8-99bf-e985cd6685f0.md`。
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test -- artifact-image-service.test.ts`，覆盖运行时 Markdown 图片生成不落库，以及提示词移除免责声明/待确认噪声。
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web test`

## 未完成项

- 本轮不自动联网补做公司研究。
- 本轮不提供管理员编辑资料沉淀策略能力，后台仅只读展示静态配置。
