# yzj-ai-crm

`yzj-ai-crm` 当前按全新重构的 `AI销售助手` 处理，默认不以旧实现为迁移目标，而是以 `docs/` 中定义的产品边界、系统分层和场景能力为正式设计依据。

## 当前版本

- 版本：`0.0.1`
- 目标：AI 主入口原型骨架

## 核心原则

- `AI销售助手` 是主入口，用户主要通过对话完成工作
- `AI销售助手_记录系统` 是影子系统，负责结构化主数据真值与确认后写回
- `系统基础设置` 是整套系统的运行根

## 目录说明

- [docs](./docs)：
  正式设计文档
- [iterations/0.0.1](./iterations/0.0.1/README.md)：
  当前版本说明
- [apps/prototype](./apps/prototype)：
  首版高保真可点击原型

## 启动方式

```bash
pnpm install
pnpm dev
```

构建：

```bash
pnpm build
```
