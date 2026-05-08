# 0.9.5 本地与 Docker 环境配置兼容修复

## 版本目标

- 修复 `admin-api` 因本地 `.env` 缺少 `YZJ_ORG_READ_SECRET` 直接启动失败的问题诊断。
- 统一本地开发 `.env` 与 Docker 部署 env 的变量契约，数据库、MongoDB、Qdrant 和内部服务地址使用同名 key。
- 在启动期提供可观测配置错误，不输出任何密钥明文。

## 范围

- `apps/admin-api`：强化环境变量校验、连接地址格式校验和启动错误日志。
- `.env.example`：作为本地与 Docker 共用的 env key 模板，补充本地/Docker 地址映射说明。
- `apps/admin-api/tests`：补充配置校验、Docker 服务名地址和 env 模板一致性测试。

## 环境兼容规则

- 本地 `.env` 与 Docker env 使用同一批 key、同一含义、同一必填性。
- 本地连接地址使用宿主机地址，例如 `127.0.0.1:5432`、`127.0.0.1:27018`、`127.0.0.1:6333`。
- Docker 连接地址使用容器服务名和内部端口，例如 `postgres:5432`、`mongodb:27017`、`qdrant:6333`。
- 真实密钥、数据库密码、生产 env 文件不进入 Git、日志、README 或测试输出。

## 验收结果

- [x] `YZJ_ORG_READ_SECRET` 缺失、空值或示例占位值时输出清晰配置错误。
- [x] 本地数据库/服务地址配置可加载。
- [x] Docker 服务名形式的数据库/服务地址配置可加载。
- [x] `.env.example` 覆盖 admin-api、skill-runtime、tongyi-audio-service 需要的关键 env。
- [x] 已补齐本地未跟踪 `.env` 中缺失的 `YZJ_ORG_READ_SECRET`、PostgreSQL URL 和 `SKILL_RUNTIME_BASE_URL`。
- [x] `pnpm --filter @yzj-ai-crm/admin-api test`
- [x] `pnpm --filter @yzj-ai-crm/admin-api build`
- [x] `curl http://127.0.0.1:3001/api/health`

## 未完成项

- 本轮不提交真实 `.env` 或 `.env.production`。
- 本轮不新增用户端 API。

## 下一步计划

- 在服务器私有 `.env.production` 中按同名 key 补齐生产值，并重启 `admin-api` 容器验证健康检查。
