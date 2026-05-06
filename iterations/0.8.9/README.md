# 0.8.9 公司研究图片本地持久化

## 版本目标

- 为公司研究资料卡生成的图片增加 MVP 阶段持久化能力。
- 采用“图片二进制存本地文件夹，数据库只存元数据索引”的方案。

## 范围

- 新增 `artifact_image_generations` 元数据表。
- 新增 Artifact 图片生成服务与仓储，负责调用图片生成技能、写入本地文件、保存 prompt 和文件索引。
- 新增资料卡图片接口：
  - `GET /api/artifacts/:artifactId/image`
  - `POST /api/artifacts/:artifactId/image`
  - `GET /api/artifact-images/:generationId/file`
- 前端资料卡改为调用 Artifact 图片接口，并在刷新后读取已保存图片。

## 存储方案

- 图片文件保存到仓库根目录下的 `tmp/artifact-images/<eid>/<artifactId>/`。
- PostgreSQL 仅保存 `generationId`、`artifactId`、`versionId`、prompt、模型、provider、尺寸、质量、文件路径、MIME、大小、生成时间和状态。
- 不把图片 base64 或二进制写入数据库，便于后续替换为对象存储 URL。

## 关键页面 / 能力

- 公司研究资料卡：
  - 点击“生成图片 / 重新生成图片”后保存图片文件和元数据。
  - 成功后展示服务端图片 URL，而不是只依赖前端内存中的 base64。
  - 已生成图片支持下载。
  - 刷新后重新读取图片元数据，仍可展示已保存图片。

## 验收结果

- 已通过：`pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/artifact-image-service.test.ts tests/database.test.ts`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/assistant-web build`
- 已执行：`pnpm --filter @yzj-ai-crm/admin-api test`，149/150 通过；剩余 1 个为既有 live 风格用例缺少 `DEEPSEEK_API_KEY`：`AgentService rejects real company research result for nonexistent company without artifact`。
- 未执行：`pnpm build`，本轮未新增 shared 类型，已覆盖受影响的 `admin-api` 与 `assistant-web` 构建。

## 未完成项

- 本轮不接对象存储。
- 本轮不做图片历史版本列表。
- 本轮不调整图片生成超时、重试或 prompt 截断策略。
