# 0.10.19 线上录音与回写热修

## 目标

- 修复录音下游“客户价值定位”因 `read_skill_file` 参数为空导致失败。
- 优化录音卡片与洞察中的 Skill 产物显示，不直接暴露内部 Markdown 文件名。
- 调整录音卡片在聊天时间线中的位置，避免旧录音任务恢复后固定在最上方遮挡阅读。
- 修复记录写回确认重复触发时“实际成功但提示失败”的误报。
- 让写回确认与完成文案不向用户暴露确认 ID、内部工具名和内部记录 ID。
- 修复录音来源拜访记录标题，按“客户的商机跟进记录”生成；没有商机名称时不写入商机名称。

## 范围

- `apps/skill-runtime`
- `apps/assistant-web`
- `apps/admin-api`
- 相关单元测试

## 验收结果

- 本地验证通过：
  - `pnpm --filter @yzj-ai-crm/skill-runtime test`
  - `pnpm --filter @yzj-ai-crm/skill-runtime build`
  - `pnpm --filter @yzj-ai-crm/assistant-web test`
  - `pnpm --filter @yzj-ai-crm/assistant-web build`
  - `pnpm --filter @yzj-ai-crm/admin-api test -- --test-name-pattern "record writeback|recording material after confirmed|metadata-driven opportunity update|personSelectWidget fields|does not derive opportunity or followup titles|normalizes opportunity and followup"`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
- 待线上部署后补充线上验收。

## 未完成项

- 待线上验收后补充生产环境结果。
