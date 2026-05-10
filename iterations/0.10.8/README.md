# 0.10.8 管理后台菜单收口与分析运营看板静态版

## 版本目标

- 移除后台中与当前生产运营无关的 AGENT 治理入口。
- 删除运营看板下原有三个分散示例页，收口为一个正式后台口径的分析运营看板。
- 保持管理员后台继续基于 `@umijs/max + @ant-design/pro-components` 的 Pro 页面范式。

## 实施范围

- 管理员后台路由：
  - 运营看板菜单收口为 `分析运营看板` 单入口。
  - `/dashboard/monitor`、`/dashboard/workplace` 历史路径隐藏并重定向到 `/dashboard/analysis`。
  - AGENT 治理移除 `会话任务`、`计划模板`、`策略与确认` 菜单入口，保留 `工具与对象` 和 `运行观测`。
  - `/skills/scene-assembly`、`/skills/writeback-policies`、`/assets/sessions` 等旧入口不再进入已删除页面。

- 分析运营看板：
  - 重写 `apps/admin-pro/src/pages/dashboard/analysis/index.tsx`。
  - 看板围绕 AI 会话、任务运行、待确认、失败运行、核心能力使用、写回和资料沉淀组织。
  - 静态样板数据放在页面局部常量中，不再依赖共享 mock 数据渲染运营看板。
  - 页面使用 `PageContainer`、`StatisticCard`、`ProCard`、`ProTable`、`ProDescriptions` 和 `Progress` 组织正式后台视图。

- 页面清理：
  - 删除 `apps/admin-pro/src/pages/dashboard/monitor/index.tsx`。
  - 删除 `apps/admin-pro/src/pages/dashboard/workplace/index.tsx`。
  - 删除旧资产静态页和场景编排静态页，避免已下线入口仍可被误用。
  - 移除 `agent-governance` 动态页中的计划模板和策略确认静态渲染分支。

## 验收结果

- 侧边栏运营看板不再出现 `分析页`、`运行监控`、`工作台` 三个子菜单。
- 侧边栏 AGENT 治理不再出现 `会话任务`、`计划模板`、`策略与确认`。
- `/dashboard`、`/dashboard/analysis` 均进入新的分析运营看板。
- 已删除的旧路径通过隐藏重定向进入保留页面，不再展示旧示例页。
- 新看板保持静态实现，不新增后端聚合接口。

## 验证

- 已通过：`pnpm --filter @yzj-ai-crm/admin-pro build`

## 未完成项

- 后续若需要实时生产数据，可新增后端运营聚合接口替换页面局部静态数据。
