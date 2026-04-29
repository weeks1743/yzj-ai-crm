# 0.6.11 去除“查看已有研究”未定义能力

## 版本目标

- 移除 Meta Question Card 中未定义的“查看已有研究”入口。
- 防止用户选择“查看已有研究”时被误路由到公司研究，并把“已有研究”当作公司名。
- 保留 `artifact.search` 的普通上下文追问能力，但不把它包装成“该客户已产生的公司研究数据读取”能力。

## 关键改动

- `artifact.search` 退出 `subject_profile_lookup` 冲突组，不再出现在工具语义仲裁候选中。
- 删除 `existing_artifact` choiceRouting 分支。
- 收紧公司研究选择别名，移除过宽的“研究/分析”单词匹配。
- 等待态中输入“查看已有研究”时继续等待并说明该能力尚未定义，不触发外部公司研究。

## 验收结果

- 通过：`pnpm --filter @yzj-ai-crm/admin-api test -- tests/agent-runtime.test.ts`
  - 覆盖“命中客户后的问题卡不包含查看已有研究”。
  - 覆盖“等待态输入查看已有研究不路由到公司研究，继续等待用户选择已开放能力”。
- 通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 通过：`pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 本轮不实现公司研究历史读取。
- 后续若恢复该入口，需要先定义公司研究结果的数据模型或读取 Skill 契约。
