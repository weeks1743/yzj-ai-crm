# 0.9.8 双端品牌 Logo 替换

## 版本目标

- 将用户 AI 端与管理员后台的站点 Logo 统一替换为新的蓝色 S 形品牌图标。
- 复用既有共享品牌资产入口，避免分别在双端写死图片路径。
- 保持用户侧 `@ant-design/x` 工作台壳体与管理侧 Ant Design Pro 布局范式不变。

## 范围

- `packages/shared/src/assets/logo.png`：替换为新的 512 x 512 PNG 品牌图标。
- 用户 AI 端：继续通过共享 `brandLogo` 渲染侧边栏 Logo 与运行时 favicon。
- 管理员后台：继续通过共享 `brandLogo` 渲染 Pro 顶栏 Logo 与运行时 favicon。

## 验收结果

- [x] 新图标已写入共享品牌资源 `packages/shared/src/assets/logo.png`。
- [x] 用户侧与管理侧均引用同一共享 Logo 资源，无需额外页面结构调整。
- [x] `pnpm --filter @yzj-ai-crm/admin-pro build`
- [x] `pnpm --filter @yzj-ai-crm/assistant-web build`

## 未完成项

- 本轮不调整品牌名称、导航结构、页面信息架构或主题色。
- 本轮不修改 `logo2.png` 等当前未被双端引用的历史资产。
