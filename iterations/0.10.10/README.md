# 0.10.10 录单中断修复

## 版本目标

- 修复客户录入链路中，客户名、行业、客户类型语义拆分不稳定的问题。
- 将可定位字段的模板校验错误转成可回答的补充问题卡，避免记录写入流程停在不可恢复的 `waiting_input`。
- 稳定同一业务 run 的 trace 查询入口，resume 时不再用单次调用 trace 覆盖业务 trace。

## 范围

- `apps/admin-api`：
  - 优化 CRM 记录写入参数抽取，只在 CRM agent pack / shadow 元数据层处理客户字段别名和模板选项归一。
  - 支持 `电子行业 -> 电子` 这类唯一模板选项命中归一，无法唯一命中时继续追问。
  - 将可定位字段的 `validationErrors` 生成带 `paramKey`、当前值、选项和原因的问题行。
  - resume 复用原 run 稳定 `traceId`，并在消息 `agentTrace` 上补充可选 `attemptTraceId` 供单次调用排查。
- `apps/assistant-web`：
  - 当前补充卡定位改为识别 pending question card 本身；即使问题项为空，也能作为当前等待项展示并支持取消。

## 验收结果

- [x] `新增客户 江苏三木集团有限公司，行业：电子行业，VIP客户` 解析为 `customer_name=江苏三木集团有限公司`、`industry=electronics`、`customer_type=vip`。
- [x] 连续补联系人、状态、负责人后进入 `waiting_confirmation`，不再停在空问题卡的 `waiting_input`。
- [x] `行业：电子制造行业` 这类不可唯一归一的非法选项会生成“所属行业”单选问题卡。
- [x] 同一 run resume 后稳定 `traceId` 不变，单次调用 trace 放入 `agentTrace.attemptTraceId`。
- [x] 空问题 pending question card 仍被前端识别为当前等待项，可触发取消。

## 验证

- [x] `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-runtime.test.ts --test-name-pattern "normalizes customer create|repairable validation"`：实际执行 `agent-runtime.test.ts` 全文件，111 passed。
- [x] `pnpm --filter @yzj-ai-crm/assistant-web test -- meta-question-card-utils.test.ts`：实际执行 assistant-web 测试集，34 passed。
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web build`：通过，保留既有 Vite 大 chunk 提示。
- [x] `pnpm build`：通过，覆盖 `admin-api`、`skill-runtime`、`admin-pro`、`assistant-web`、`report-canvas-service`。

## 未完成项

- 本轮不改写外部 `yzj-form` Skill，也不把它直接接入 CRM 记录写入链路。
- 本轮不新增 CRM 场景专用 runtime skill，主 Agent core 继续保持业务无关。
