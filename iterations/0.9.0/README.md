# 0.9.0 录音处理服务完整闭环

## 版本目标

- 将通义录音处理能力拷贝为本项目内独立 Python 服务，由 `admin-api` 通过 HTTP 调用。
- 建立“录音资料包”作为对话和外部技能消费边界，过程 JSON 不进入 Artifact、向量索引或 Evidence。
- 打通用户端上传引导、录音任务卡、meeting-viewer 查看和后续动作入口。
- 在管理员后台提供“录音处理服务”配置页，并在外部技能详情中展示可使用上游资料。

## 范围

- `apps/tongyi-audio-service`：录音任务服务、fixture 读取、Markdown 资料包生成、通义离线任务封装、meeting-viewer。
- `apps/admin-api`：录音任务 HTTP 路由、幂等复用、任务状态存储、资料包 Artifact 落库、下游外部技能 Job。
- `apps/assistant-web`：音频附件上传引导、任务卡轮询、meeting-viewer 打开、完成/失败动作。
- `apps/admin-pro`：系统设置页和外部技能详情上游资料说明。
- `docs/` 与 `.env.example`：同步产品边界和环境变量。

## 关键规则

- `transcription.json`、`translations.json`、`textPolish.json`、`task-result.json`、`create-task.json`、`summary.txt` 只作为过程信息保存。
- `summarization.json`、`mindMapSummary.json`、`meetingAssistance.json`、`autoChapters.json` 是通义结构化分析文件，可用于生成标准 Markdown，也可作为白名单附件传给下游外部技能。
- 默认可被对话检索和 Evidence 使用的资料仍只有 `recording-material.md` 或 outputs 中已有 `profile-analysis/*.md`。
- 下游外部技能优先消费通义结构化分析 JSON，再参考 `recording-material.md` 或 `profile-analysis/*.md`；不得读取转写、翻译、润色等原始过程文件。
- meeting-viewer 可读取过程 JSON 用于人工回看；其中 `mindMapSummary.json` 可直接合并到 viewer 的 `summarization.mindMapSummary` 展示。
- 不再从 `transcription.json` 兜底生成摘要、关键词、章节或思维导图，避免把逐字转写误当结构化分析结论。
- 相同录音文件按 MD5 做幂等缓存；已有资料包时重复上传直接复用，不重新请求通义录音处理。
- 相同录音文件若上次处理失败，允许重新提交处理，不复用旧失败结果。
- 通义环境变量兼容 `TONGYI_DASHSCOPE_API_KEY`/`DASHSCOPE_API_KEY` 与 `TONGYI_TINGWU_APP_ID`/`TINGWU_APP_ID`，相对路径按仓库根目录解析。
- 通义解析产物默认写入 `tmp/tongyi/<fileMd5>/`，目录结构与原 `tongyi-agent/outputs/<dataId>/` 保持一致；这是任务缓存，不进入正式资料资产。
- 上传录音不再按 playback MD5 映射到固定 fixture；只有同一 MP3 已经在本服务中真实解析完成后，下一次上传才按 MD5 复用该任务。
- 上传录音解析完成后只允许在当前录音任务与 meeting-viewer 中查看；未确认新增拜访记录前，不创建 `recording_material` Artifact，不写入 Qdrant，不进入 Evidence，也不支持跨会话检索。
- 用户确认新增拜访记录后，系统以正式 `followup` 为锚点进行二次归档，生成 `recording_material` Artifact；anchors 必须包含 `customerId`、`opportunityId`、`followupId`、`sourceFileMd5` 和 `recordingTaskId`。
- 四个录音下游技能完成后，若录音已正式绑定 `followup`，按 `followupId + skillCode` upsert 为单份 `analysis_material` Artifact；重复点击覆盖当前正式结果并更新当前版本，不暴露多版本列表。
- 未绑定正式 `followup` 的下游技能结果只作为临时 Job 结果展示，不进入正式 Artifact、Qdrant 或跨会话 Evidence。
- 普通用户侧不展示 `record.*`、`artifact.search` 等技术工具名，只展示业务资料来源；工程 trace 保留 `record.customer.get/search`、`record.opportunity.search`、`record.followup.search`、`artifact.search(company_research/recording_material/analysis_material)` 等原子调用。
- 复杂跨资料问题统一选择 `meta.context_summary`，由 `crm-agent-pack` 内部显性编排原子工具装配记录系统、公司研究、录音资料包和下游分析结果；不新增 `scene.*`，不新增大而全的多资料源综合分析工具。
- Evidence Card 只展示正式归档 Markdown 资料，包括 `company_research`、`recording_material`、`analysis_material`；不得展示 `transcription.json`、`translations.json`、`textPolish.json` 等过程文件。
- 生成正式跟进记录前必须补齐客户与商机，并继续走确认写回链路。
- 录音卡片完成后点击主体打开 meeting-viewer；卡片动作只保留拜访会话理解、客户需求工作待办分析、问题陈述、客户价值定位、新增拜访记录。
- Chat 会话列表、消息和录音卡以 `admin-api` 成功返回的数据为权威；浏览器本地缓存只作为接口不可用时的离线兜底，清空实例数据后刷新页面即可看到干净状态，不要求用户手动清理 `localStorage`。

## 验收状态

- [x] Python 服务测试通过：`pnpm --filter @yzj-ai-crm/tongyi-audio-service test`。
- [x] admin-api 录音任务与 Artifact 测试通过：`pnpm --filter @yzj-ai-crm/admin-api test`。
- [x] 用户 AI 端构建通过：已由 `pnpm build` 覆盖 `@yzj-ai-crm/assistant-web`。
- [x] 管理后台构建通过：已由 `pnpm build` 覆盖 `@yzj-ai-crm/admin-pro`。
- [x] 根构建验证完成：`pnpm build`。
- [x] 音频服务 dev 启停修复：`Ctrl+C` 正常停机不再打印 Python traceback 或 pnpm failure。
- [x] 音频服务端口复用修复：若 `3018` 已有健康且配置一致的录音服务，根 `pnpm dev` 会复用已有服务；若旧进程仍指向旧 fixture，会提示停止旧进程，避免悄悄复用错误配置。
- [x] 音频失败缓存重试修复：同 MD5 录音成功后复用，失败后可重新处理。
- [x] 录音卡片交互修复：恢复 meeting-viewer，删除“查看录音资料/关联客户商机/生成跟进记录草稿”，新增四个下游外部技能和“新增拜访记录”入口。
- [x] 音频服务配置修复：原始通义 key 名可直接使用，`.env` 中相对 outputs 路径固定解析到仓库根目录。
- [x] 录音上传会话修复：上传录音会创建或更新最近会话，录音任务卡按会话持久化，刷新后继续显示并恢复轮询。
- [x] 下游技能附件修复：需求待办等通用文本技能只读取具体 Markdown 附件文件，防止把输入目录当文件读取导致 `EISDIR`。
- [x] 录音输出目录修复：通义服务产物统一写入 `tmp/tongyi`，清理旧 `.local/tongyi-audio-service/outputs` 测试产物后可重新开始上传验证。
- [x] 录音上传缓存修复：移除上传 MP3 到固定 fixture 的映射，只复用本服务已完成解析的相同 MD5 任务。
- [x] 通义完整产物等待修复：不再把 `output.status = 0` 当作完成信号，等待 `autoChapters/meetingAssistance/playback/pptExtraction/summarization/textPolish/transcription/translations` 等原 `tongyi-agent` 产物字段到齐后再下载。
- [x] 下游文本 Skill 目录读取修复：当模型误把 `_jobs/<jobId>/inputs` 目录传给 `read_source_file` 时，运行时会读取目录内的 JSON/Markdown 附件并合并为输入内容，避免“暂不支持读取该附件类型: inputs”导致问题陈述等技能失败。
- [x] 下游技能资料包修复：`auto` 资料包优先生成包含会话摘要、关键主题、关键词、自动章节的标准 Markdown，并附加 `profile-analysis` 画像；调用下游 Skill 前会强制刷新为 `generated` 资料包。
- [x] 录音态页面修复：有录音卡时隐藏公司研究欢迎区、能力入口、工作台原则和底部公司研究快捷提示，顶部标识切换为“录音处理”。
- [x] 运行洞察修复：改为 `Agent 任务 / 录音任务 / 下游技能 / 原始 Trace` 多标签；同一会话既有录音任务又有录单/追问时默认展示最新 Agent 任务，不再被录音洞察覆盖。
- [x] 录音 Skill 产物查看修复：录音卡下游 Skill 产物 Markdown 点击后在用户端侧滑预览，不再直接触发浏览器下载。
- [x] 通义结构化分析输入修复：移除转写兜底分析层，viewer/资料包直接读取 `summarization.json`、`mindMapSummary.json`、`meetingAssistance.json`、`autoChapters.json`；下游 Skill 附件优先传这些 JSON，并继续隔离 `transcription.json`、`translations.json`、`textPolish.json`。
- [x] 录音新增拜访记录修复：录音卡按消息锚点插入聊天时间线，“新增拜访记录”后续会话显示在录音卡下方；卡片发起的 `record.preview_create` 客户端动作优先路由到 `record.followup.preview_create`，不再误进录音处理入口。
- [x] 客户录入名称修复：写入类命令会剥离 `新增/新建/创建/录入/写入/补录 + 客户/公司` 前缀，`新增客户 绍兴贝斯美化工股份有限公司` 只写入真实客户名；单独 `新增客户` 继续要求补客户名称。
- [x] 录音来源拜访记录守卫：从录音卡发起 followup 新建时，正式预览前必须补齐客户、商机、跟进方式和跟进负责人；`recording_material` source 会保留到补充卡、确认请求和 commit 归档阶段。
- [x] 录音拜访记录幂等修复：录音任务归档后 response 返回 `archive.status=archived` 和 `followupId/artifactId`，录音卡按钮切换为“已新增拜访记录”，后端重复发起会返回“已存在拜访记录”而不创建新的 pending。
- [x] 待补充录入取消修复：补充字段卡新增“取消本次录入”，自然语言 `取消/取消录入/不录了/放弃/停止本次录入` 会取消当前未确认等待态，不删除已正式写入记录。
- [x] 录音正式存储修订：`materializeTask` 只写临时可消费 Markdown；`archiveTask` 在 followup 确认写入后才创建 `recording_material` Artifact。
- [x] 下游技能单份存储修订：正式录音的下游技能结果按 `followupId + skillCode` upsert 为 `analysis_material`，重复运行覆盖当前正式结果。
- [x] 跨会话消费修订：复杂综合问题选择 `meta.context_summary`，trace 中保留记录系统与三类 Artifact 搜索原子调用，用户回答展示“记录系统/公司研究/拜访录音/分析结果”等业务来源。
- [x] Chat 会话服务端权威同步修复：服务端会话接口成功返回时覆盖本地自定义会话，远端空消息不再回退到旧本地消息，并清理无效会话下的消息与录音卡缓存。
- [x] 用户侧清库验证口径修复：执行 `node tmp/reset-instance-data.mjs --confirm` 后刷新 Chat 页面即可验证历史会话、旧消息和旧录音卡消失。
- [x] assistant-web 测试入口补齐：`pnpm --filter @yzj-ai-crm/assistant-web test` 覆盖会话同步、消息兜底和录音时间线等用户端纯函数。
- [x] 追加验证完成：`pnpm --filter @yzj-ai-crm/tongyi-audio-service test`、`pnpm --filter @yzj-ai-crm/admin-api test`、`pnpm --filter @yzj-ai-crm/admin-api build`、`pnpm --filter @yzj-ai-crm/assistant-web build`、`pnpm build`。

说明：admin-api 全量测试中 `AgentService rejects real company research result for nonexistent company without artifact` 是真实外部公司研究 live 用例；本地缺少 `DEEPSEEK_API_KEY` / `ARK_API_KEY` 时按 skip 处理。

## 未完成项

- 暂无。本轮保留真实通义听悟线上处理与真实客户/商机关联自动推断的后续增强空间。

## 下一步计划

- 根据真实通义听悟字段继续补充资料包模板。
- 与公司研究、需求待办、问题陈述等外部技能形成统一上游资料声明治理。
