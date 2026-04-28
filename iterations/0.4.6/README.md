# 0.4.6 MVP：公司分析 Artifact 持久化与对话引用

## 版本目标

- 实现第一条真实非结构化闭环：公司分析 Markdown Artifact 可保存、可向量化、可在后续对话中作为证据引用。
- 使用 MongoDB 保存 Artifact 元数据和版本正文。
- 使用阿里 `text-embedding-v4` 生成 1024 维向量。
- 使用 Qdrant 保存 chunk 向量与租户、锚点 payload。
- 用户 AI 工作台展示证据卡，不新增独立资产页。

## 范围

本轮实现：

- `POST /api/artifacts/company-research`
- `GET /api/artifacts/:artifactId`
- `POST /api/artifacts/search`
- MongoDB collection：`artifacts`、`artifact_versions`
- Qdrant collection：`yzj_artifact_chunks`
- `/客户分析` 与“研究 XX 公司”对话入口沉淀 Artifact
- 后续客户问题可检索 Artifact 并展示证据卡

本轮不实现：

- 录音转写
- 录音分析
- 真实对象级权限
- 真实 Main Agent / Plan Engine
- 独立 AI 资产页面

## 本地服务

| 服务 | 容器名 | 本地地址 | 数据目录 |
|------|--------|----------|----------|
| MongoDB | `yzj-mongodb` | `mongodb://127.0.0.1:27018` | `.local/mongodb` |
| Qdrant | `yzj-qdrant` | `http://127.0.0.1:6333` | `.local/qdrant` |

## 环境变量

```bash
MONGODB_URI=mongodb://127.0.0.1:27018
MONGODB_DB=yzj_ai_crm_dev
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=yzj_artifact_chunks
DASHSCOPE_API_KEY=
DASHSCOPE_EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
```

`DASHSCOPE_API_KEY` 只写本机 `.env`，不进入 Git、README 或日志。

## 数据与隔离

- Mongo 文档必须带 `eid + appId`。
- Qdrant payload 必须带 `eid + appId`。
- 检索 filter 必须带 `eid + appId`。
- Artifact 支持多锚点：`customer`、`opportunity`、`contact`、`followup`、`company`、`source_file`。
- MVP 默认同租户同应用内可复用，对象级权限预留 hook。

## 验收项

- “研究 XX 公司”生成 Markdown Artifact。
- `/客户分析 XX 公司` 会保存 Artifact 并返回证据卡。
- “研究这家公司 XX有限公司”会从自然语言中抽取公司名，不再回落到固定 mock 客户。
- “这个客户最近有什么值得关注”优先检索已有 Artifact。
- 同一会话内保留最近公司焦点，后续“这个客户 / 这家公司”可继续指向上一轮研究对象。
- 缺少 `DASHSCOPE_API_KEY` 时 Artifact 保存成功，向量状态为 `pending_config`。
- Qdrant upsert payload 包含 `eid/appId/artifactId/versionId/anchorTypes/anchorIds/sourceToolCode/logicalPointId`。
- Qdrant 真实 point id 使用 `logicalPointId` 派生出的确定性 UUID，因为 Qdrant 不接受 `${versionId}:${chunkIndex}` 这类任意字符串作为 point id。
- 上传录音不触发录音分析，只提示当前 MVP 暂不转写。

## 验证结果

- `docker ps --filter name=yzj-`：MongoDB 与 Qdrant 容器运行中。
- MongoDB ping：`{ ok: 1 }`。
- Qdrant `/healthz`：`healthz check passed`。
- `pnpm --filter @yzj-ai-crm/admin-api test`：通过。
- `pnpm --filter @yzj-ai-crm/admin-api build`：通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build`：通过。

## 未完成项

- 未做录音转写与录音分析。
- 未做对象级权限校验。
- 未做 Artifact 管理页。
- 未做真实异步任务队列，当前 MVP 由接口内完成保存与向量化尝试。
