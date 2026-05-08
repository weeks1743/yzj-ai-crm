# 0.9.3 公司研究长任务线上超时修复

## 版本目标

- 修复线上通过 Cloudflare 访问 AI 工作台时，首次公司研究耗时过长导致 `/api/agent/chat` 被边缘请求窗口切断并显示“智能体接口当前不可用”的问题。
- 保留公司研究真实 Skill Job，不生成本地替代内容。
- 在同步响应返回运行中后，由后端继续补偿等待并沉淀公司研究资料。

## 范围

- `apps/admin-api`：公司研究同步等待窗口从 420 秒调整为 70 秒，避免 HTTP 请求超过 Cloudflare 常规超时窗口。
- `apps/admin-api`：同步窗口结束时返回 `running` 状态，并启动后台补偿任务继续等待公司研究 Skill Job。
- `apps/admin-api`：后台补偿拿到成功结果后继续执行 Markdown 解析、可用性校验、公司研究 Artifact 写入与向量化。

## 关键页面 / 能力

- AI 销售工作台：
  - 首次执行 `/公司研究 <公司名称>` 时，若真实研究超过同步窗口，页面显示“公司研究仍在运行”。
  - 研究任务继续在服务端执行；完成后后续再次询问同一公司可复用已沉淀的公司研究资料。
  - 不再把 Cloudflare 524 当作智能体接口不可用暴露给用户。

## 验收结果

- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-service.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] 服务器 Docker 镜像重建并重启 `admin-api` / `web`
- [x] 线上 `https://chat.xiami66.com/chat` 执行公司研究不再出现 HTTP 524
- [x] 首次研究 `江苏亚威机床股份有限公司` 75 秒返回 `running`，随后后台补偿写入公司研究 Artifact，二次访问复用资料并返回 `completed`。

## 未完成项

- 本轮不新增前端轮询卡片。
- 本轮不调整公司研究 Skill 的研究质量、搜索策略或模型。

## 下一步计划

- 增加前端对运行中公司研究任务的刷新入口，让用户可以从同一会话继续查看完成状态。
