# 0.6.7 枚举与开关控件写入值修复

## Summary

- 修复记录写回确认后轻云返回 `1101032: 主表单控件输入值类型错误` 的问题。
- 本质原因是 `switchWidget` 没有像 `radioWidget` 一样归一化为轻云模板真实选项 key，导致 `启用状态` 在写入 payload 中可能以 `true/false` 进入轻云。
- 保持主 Agent core/runtime 业务无关；修复点落在 ShadowMetadata 控件归一化、CRM 业务包预览展示和测试用例。

## Changes

- `ShadowMetadataService`：
  - `switchWidget` 纳入静态 options 解析。
  - 新增通用开关归一化：`启用/开启/true/1` -> 模板启用 key，`停用/关闭/false/0` -> 模板停用 key。
  - 无模板 options 时兜底输出 `'1' / '0'`，避免向轻云提交 boolean。
- `crm-agent-pack`：
  - Meta Question Card 的枚举/开关选项优先提交模板 key。
  - 预览确认摘要基于字段元数据把 key 显示回用户可读选项，避免普通用户看到 `true` 或裸 key。
- 测试：
  - 覆盖结构化问题卡提交开关 key。
  - 覆盖确认预览中 `enabled_state` 显示为 `开启`。
  - 覆盖 ShadowMetadata 写入请求中 `_S_DISABLE` 生成 `'1'`。

## Validation

- `pnpm --filter @yzj-ai-crm/admin-api test -- tests/agent-runtime.test.ts` 通过。
- `pnpm --filter @yzj-ai-crm/admin-api build` 通过。
- `pnpm --filter @yzj-ai-crm/assistant-web build` 通过。

## Notes

- 本轮未改记录系统 Skill 生成物语义，也未新增 `scene.*`。
- 对已创建但尚未确认的旧 confirmation，本次修复也能在 commit 前重新归一化 `enabled_state: true` 为模板 key。
