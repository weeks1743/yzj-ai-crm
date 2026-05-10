# 0.10.18 线上问题修复

## 版本目标

- 修复拜访准备 Markdown 缺少生成报告入口的问题。
- 修复更新字段卡片当前值文案多出“当前：”的问题。
- 修复录音查看页 `/recording-viewer-loading` 线上 404。
- 修复录音下游 Skill 读取 `inputs/profile-analysis` 子目录失败。

## 范围

- 新增 transient Markdown 报告生成接口，不写入资料资产和 artifact 报告表。
- 拜访准备 Markdown 卡片在“生成图片”旁增加报告按钮。
- `profile-analysis/*.md` 附件在 skill-runtime inputs 中保留子目录结构。
- `read_source_file` 支持读取 `inputsDir` 下的受支持文本目录。

## 验收

- 待本地测试与生产部署后补充。

## 未完成项

- 图片生成超时与 provider 稳定性不在本轮范围内。
