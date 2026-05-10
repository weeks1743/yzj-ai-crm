# 0.10.17 报告打开与图片持久化热修

## 版本目标

- 修复报告页 `/embed/<sessionId>` 已生成完成但一直显示“正在打开报告”的问题。
- 修复图片产物写入 `/app/tmp` 后在容器重建时丢失，导致 `/api/artifact-images/<id>/file` 返回 500 的问题。

## 修复范围

- `web` Nginx：
  - 将 `/_next/` 代理到 `report-canvas-service`，保证报告页所需的 Next.js JS/CSS 静态资源可加载。
- `admin-api`：
  - Artifact 图片文件改为写入 `.local/artifact-images/`，随 `admin-api-local` 卷持久化。
  - 读取已生成图片时若文件缺失，返回“图片文件不存在，请重新生成图片”，并把记录标记为 `failed`，避免继续返回 500。

## 验收结果

- 待验证：`pnpm --filter @yzj-ai-crm/admin-api test`。
- 待验证：`pnpm --filter @yzj-ai-crm/admin-api build`。
- 待线上验证：`https://huaguopm.com/embed/rpt_6afdd7306233` 不再卡在“正在打开报告”。
- 待线上验证：重新生成图片后 `/api/artifact-images/c2b36219-51d9-4acf-89c2-612835638821/file?download=1` 可返回图片文件。

## 未完成项

- 不调整图片 provider、prompt 或超时策略；本轮只处理图片文件持久化和缺失文件错误处理。
