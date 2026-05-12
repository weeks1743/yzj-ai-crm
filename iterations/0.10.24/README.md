# 0.10.24 后台观测与时间展示优化

## 目标

- 后台运行观测按用户名和运行状态过滤，并在运行记录中显示用户名。
- 后台列表和详情中的 ISO 时间统一显示为本地常用时间格式。
- 移除后台静态说明提示区域，压缩运行观测页头与统计卡片之间的间距。

## 范围

- `apps/admin-api`
- `apps/admin-pro`
- `packages/shared`

## 关键实现

- `agent_runs` 增加 `operator_open_id` 字段，初始化时从会话表回填历史运行的操作人。
- `/api/agent/runs` 支持 `operatorName` 查询参数按用户名搜索，`operatorOpenId` 不作为运行观测筛选参数；运行摘要返回 `operatorName`，内部保留 `operatorOpenId` 作为身份关联字段。
- 后台运行观测表新增用户列，只保留状态 / 用户两个筛选项，时间列统一使用 `YYYY-MM-DD HH:mm`。
- 组织同步、技能目录、记录系统技能等后台列表和详情时间显示改为本地时间。
- 移除“管理视图说明”“当前阶段口径”等静态提示区域，保留真实错误、健康状态和执行结果提示。

## 验收结果

- 已通过：
  - `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/agent-observability-service.test.ts tests/http.test.ts tests/database.test.ts`
  - `pnpm --filter @yzj-ai-crm/admin-api build`
  - `pnpm --filter @yzj-ai-crm/admin-pro build`
  - `pnpm build`
- 已补充接口验证：`operatorName=伟棠` 可命中用户记录，`operatorOpenId` 查询参数不影响运行观测筛选。

## 未完成项

- 暂无。
