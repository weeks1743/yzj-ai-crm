# 0.9.2 公司研究图片生成完整资料输入修复

## 版本目标

- 修复公司研究资料卡生成图片时只使用代表片段或摘要片段的问题。
- 确保图片生成绑定完整公司研究 Artifact，而不是绑定卡片展示内容或向量命中片段。
- 避免资料卡预览层对生成图片进行比例裁切。

## 范围

- `apps/admin-api`：Artifact 图片生成服务改为从服务端读取完整公司研究 Markdown 后构造图片 prompt。
- `apps/admin-api`：图片生成前会去除研究日期、数据截至、研究目的、来源引用表和免责声明等非画面核心信息，并将送入图片 provider 的 Markdown 正文控制在 3800 字以内。
- `apps/admin-api`：图片生成 provider 请求超时从 60 秒调整为 150 秒。
- `apps/assistant-web`：资料卡生成图片时只提交尺寸和质量，不再提交前端摘要 prompt；图片预览按原始比例完整展示。
- `packages/shared`：新增资料卡图片生成请求类型，区别于后台通用文生图调试请求。
- `docs/`：同步公司研究图片生成的完整资料输入口径。

## 关键页面 / 能力

- AI 销售工作台：
  - “生成图片 / 重新生成图片”只触发派生动作。
  - 图片 prompt 由后端基于完整公司研究 Markdown 生成，并在调用图片 provider 前剔除元信息、引用表和免责声明。
  - 图片生成 Markdown 正文长度控制在 3800 字以内，避免长引用和开头信息挤占有效视觉内容。
  - 不再从卡片代表片段、最高分命中片段或 360 字 snippet 生成图片。
  - 图片预览不再使用 `object-fit: cover` 裁切。

## 验收结果

- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/artifact-image-service.test.ts`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web build`
- [x] `git diff --check`
- [x] 使用绍兴贝斯美化工股份有限公司公司研究 Artifact 在控制台真实调用图片生成 provider：Markdown 正文 3212 字，完整 prompt 3416 字，provider 耗时 72.567 秒，生成成功。

## 未完成项

- 本轮不调整图片 provider 模型或质量档位。
- 本轮不改公司研究 Skill 本身的研究内容产出。

## 下一步计划

- 评估是否将图片生成 prompt 与精简前后正文在运行洞察中做更友好的可视化展示。
