# 0.4.2 版本说明

## 版本目标

- 在 `externalppt` 分支完成 `ext.super_ppt` 的正式接入与真实 Docmee 验证
- 新增企业 PPT 模板管理、缺省提示词、独立编辑页与编辑会话能力
- 基于 Docmee V2 官方接口重新审视 `super-ppt` 生成链路，优先修复质量下降与运行失败问题

## 本轮范围

- `3rdSkill/super-ppt`
- `apps/skill-runtime`
- `apps/admin-api`
- `apps/admin-pro`
- `packages/shared`
- `README.md`
- `docs/04-场景技能总览与编排原则.md`
- `docs/09-用户对话层与Agent编排.md`
- `iterations/0.4.2/README.md`

## 已完成能力

### 1. super-ppt 与模板管理落地

- 全仓已将 `ext.presentation_generate` 替换为 `ext.super_ppt`
- `super-ppt` 以 `implementationType = skill` 接入，provider 固定为 `docmee-v2`
- 后台已新增 `企业PPT模板` 管理页，支持：
  - 上传模板
  - 重命名
  - 设为企业默认
  - 下载
  - 删除
  - 缺省提示词编辑
- 调试台与结果区已支持下载 `.pptx`、创建 `presentation-session`、打开独立编辑页

### 2. Docmee V2 诊断与协议修复

- 新增直连诊断脚本：
  - [apps/skill-runtime/scripts/docmee-v2-diagnose.ts](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/apps/skill-runtime/scripts/docmee-v2-diagnose.ts)
- 修复 `generateContent(JSON)` 的真实兼容问题：
  - 远端最终 `result` 可能返回 JSON 字符串
  - 个别返回会把 key 误写成 `**page_number**` 这种 Markdown 粗体形式
  - 现已增加 JSON 修复与再解析逻辑
- 修复 `generatePptxByAi` 的 multipart 传参错误：
  - `data` 字段不再被二次 `JSON.stringify`
  - 已按官方 `--form-string 'data=JSON'` 语义发送原始 JSON 字符串
- 修复 Docmee 临时 token 创建失败：
  - `uid` 已缩短，不再因为拼接完整 `jobId` 导致 `The uid parameter is too long`

### 3. 官方 AIL 分支真实结论

- 通过真实 Docmee key 对官方 JSON AIL 分支进行了多次 live 探针
- 关键诊断目录：
  - [2026-04-26T11-28-04-734Z](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/.local/docmee-diagnostics/2026-04-26T11-28-04-734Z)
  - [2026-04-26T11-33-30-212Z](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/.local/docmee-diagnostics/2026-04-26T11-33-30-212Z)
- 真实 API 行为已确认：
  - `generateContent(stream=true, outlineType='JSON')` 可以返回结构化大纲对象
  - `generatePptxByAi` 会持续输出 `running / ping`
  - `latestData` 在无模板场景下会逐步返回 `payload.htmlMap`
  - `getConvertResult` 主要返回状态码，不提供 Markdown 正文
- 真实 task 验证结果：
  - 带模板 task `2048368480427847680`：超过 5 分钟仍为 `running`
  - 无模板 task `2048370419844657152`：`latestData.payload.htmlMap` 已出现，但 `getConvertResult.status = 1`，仍未收口为可直接消费的 Markdown

### 4. super-ppt 生产链路修正

- `super-ppt` 现已明确区分“布局完成”和“Markdown 生成”两个阶段：
  1. 先走 `generateContent(JSON)` + `generatePptxByAi(templateId?)`，等待 Docmee AIL 布局状态真正完成
  2. 布局完成后，再调用 `generateContent(MD)` 生成最终 Markdown 并调用 `generatePptx`
- AIL 分支不再把“没有直接返回 Markdown”误判为失败
- AIL 轮询超时已从运行时的 `90s` 提升到 `10min`
- `generateContent` 的关键参数已统一为：
  - `length = short`
  - `aiSearch = false`
  - `isGenImg = false`
  - `scene = 公司介绍`
  - `audience = 大众`
  - `lang = zh（简体中文）`
- 若 AIL 真正超时或报错，当前正式行为是直接失败，不再回退到 Markdown-only 兜底链路
- `super-ppt` 生成态 token 与编辑态 token 现已复用同一 Docmee `uid`
  - 修复编辑器中“保存 PPT / 导出 PPT 报 `1003 无权限访问`”的问题
  - 原因是 Docmee `createApiToken` 的 `uid` 参与数据隔离，生成与编辑若使用不同 `uid`，会被视作不同数据归属
- 运行 metadata 与 `presentation_ready` 事件会显式记录最终命中的 `docmeeFlow`

### 5. 独立编辑器服务化与会话接管

- 原先挂在 `admin-pro/public/super-ppt-editor.html` 下的编辑页已改为跳转壳
- 新增独立服务 `apps/super-ppt-editor`，默认端口为 `8001`
- 新编辑器通过独立端口承载 Docmee iframe，并由本地服务代理 `admin-api` 的编辑会话接口
- `skill-runtime` 已新增单活租约接口：
  - `presentation-session/open`
  - `presentation-session/heartbeat`
  - `presentation-session/close`
- 同一 `jobId` 的 PPT 编辑会话当前固定为“单活接管”：
  - 同 client 重入时复用原 token
  - 不同 client 并发打开时默认返回占用冲突
  - 显式 takeover 后重新 mint token，并让旧窗口在下次心跳时收到“已被接管”提示
- 本轮的修复重点不再是继续在 `admin-pro` 页面内兜 token，而是把 Docmee 编辑器从后台壳中拆出，减少多窗口互相顶掉 token 导致的 `1003 无权限访问`

## Live 验证

### 官方 AIL 探针

- 输入文件：
  - [绍兴贝斯美化工企业研究报告.md](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/tmp/绍兴贝斯美化工企业研究报告.md)
- 结论：
  - 请求格式问题已修复
  - 但官方 JSON -> AIL 分支在当前真实接口下长时间只返回 `running/htmlMap`，未在可接受时间内收口为最终 Markdown
  - 2026-04-26 再次直连带模板探针时，Docmee 官方 AIL 明确返回模板解析错误：
    - `模板文件解析失败：Classification result must include at least one content page`
    - 当前 `金蝶ppt模板.pptx` 至少在 Docmee 的模板分类规则下未识别出可用内容页

### super-ppt 真实任务重跑

- 无模板直连 job：
  - `66b32932-3d2e-4a9f-8018-b95405a45453`
  - `pptId = 2048373115024715776`
  - 最终状态：`succeeded`
  - 最终链路：`docmeeFlow = markdown-route-fallback`
- 带企业默认模板直连 job：
  - `f39daeab-5617-46da-aaa0-5a27dba47c36`
  - `pptId = 2048374584591396864`
  - 最终状态：`succeeded`
  - `presentation_ready.templateId = 2047834450045317120`
  - 最终链路：`docmeeFlow = markdown-route-fallback`
- 禁止降级后的带金蝶模板真实任务：
  - `jobId = d2edb9b0-9962-4b84-ac5f-47ead7c05596`
  - `taskId = 2048429646470590464`
  - `pptId = 2048429646470590464`
  - `templateId = 2048419284614524928`
  - 最终状态：`succeeded`
  - `presentation_ready.docmeeFlow = official-v2-main-flow`
  - `presentation_ready.convertStatus = completed`
  - `finalMarkdownSource = markdown_generate_after_official_layout`
- 真实产物已落盘：
  - `.pptx`
  - `content-outline.json`
  - `source.md`
  - `final-markdown.md`
  - `ai-layout.log`
  - metadata `.json`
- 关键产物可参考：
  - [final-markdown.md](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/.local/skill-runtime-artifacts/66b32932-3d2e-4a9f-8018-b95405a45453/super-ppt-66b32932-3d2e-4a9f-8018-b95405a45453-final-markdown.md)
  - [content-outline.json](/Users/weeks/Desktop/workspaces-yzj/yzj-ai-crm/.local/skill-runtime-artifacts/66b32932-3d2e-4a9f-8018-b95405a45453/super-ppt-66b32932-3d2e-4a9f-8018-b95405a45453-content-outline.json)

## 当前结论

- 截至 `2026-04-26`，Docmee V2 文档与真实接口表现表明：
  - Markdown 生成链路和 JSON AIL 链路需要区分看待
  - JSON AIL 分支当前更像“长时间布局任务”，`latestData` 优先暴露的是 HTML 布局结果，而不是 Markdown
- 当前正式策略是：
  - 先走官方 AIL 链路并等待 `latestData/getConvertResult` 收口
  - 只有在 AIL 完成后才继续 `generateContent(MD) -> generatePptx`
  - AIL 未完成时直接失败，禁止降级生成 PPT

## 验证结果

- 已验证：
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`
  - `pnpm --filter @yzj-ai-crm/skill-runtime build`
  - 禁止降级后的真实 `super-ppt` live job 成功生成
- 此前已完成并通过：
  - `pnpm --filter @yzj-ai-crm/admin-api test`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/admin-pro build`
  - `pnpm --filter @yzj-ai-crm/super-ppt-editor build`

## 未完成项

- 仍需继续确认 Docmee 官方 JSON AIL 分支在长时任务下的最终收口条件
- 若后续确认 `generatePptxByAi` 的完整终态或官方推荐的 HTML -> PPT 收口方式，仍可继续优化当前“布局完成后再生成最终 Markdown/PPT”的闭环
- `super-ppt` v1 仍只支持单个 Markdown 附件
- 截至 `2026-04-27`，独立 `super-ppt-editor` 已完成拆分、单活会话与诊断埋点，但 Docmee 编辑器内“保存 PPT / 导出 PPT”仍可能返回 `1003 无权限访问`
- 当前本地排查已确认：
  - 编辑页可正常 `mounted`
  - `beforeDownload` 可触发
  - 运行时 token 直接调用 Docmee `downloadPptx` 接口可成功
  - 但 Docmee iframe 最终保存/导出链路仍会在其服务端权限校验阶段报 `1003`
- 该问题更像 Docmee 侧的 `uid / userId / 文档归属` 口径差异，需联系官方技术支持继续协查；本轮代码先按“问题未彻底解决，但已沉淀独立服务、租约控制与诊断信息”收口
