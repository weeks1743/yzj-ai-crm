# 0.8.0 SQLite 到 PostgreSQL 迁移

## 版本目标

- 将 `admin-api` 与 `skill-runtime` 的运行态关系型存储从 SQLite 替换为 PostgreSQL。
- 使用一个 PostgreSQL 数据库、两个 schema 承载原有关系表：
  - `admin_api`
  - `skill_runtime`
- 保持 MongoDB 与 Qdrant 的职责、连接配置、集合和检索逻辑不变。

## 数据范围

- `admin-api` 迁入 PostgreSQL 的表：
  - `org_sync_runs`
  - `org_employees`
  - `shadow_object_registry`
  - `shadow_object_snapshots`
  - `enterprise_ppt_templates`
  - `enterprise_ppt_template_settings`
  - `agent_runs`
  - `agent_messages`
  - `agent_tool_calls`
  - `agent_confirmations`
  - `artifact_ppt_generations`
- `skill-runtime` 迁入 PostgreSQL 的表：
  - `jobs`
  - `job_events`
  - `job_artifacts`
- MongoDB 继续只负责 `artifacts` / `artifact_versions` 正文与版本数据。
- Qdrant 继续只负责检索向量分块与 payload。

## 关键变更

- `docker-compose.dev.yml` 新增 `postgres:16` 服务，容器名 `yzj-postgres`，默认数据库 `yzj_ai_crm_dev`，数据目录 `.local/postgres`。
- 两端配置从 `storage.sqlitePath` 改为 `storage.postgresUrl` + `storage.postgresSchema`。
- `.env.example` 新增：
  - `ADMIN_API_POSTGRES_URL`
  - `ADMIN_API_POSTGRES_SCHEMA`
  - `SKILL_RUNTIME_POSTGRES_URL`
  - `SKILL_RUNTIME_POSTGRES_SCHEMA`
- 引入 `pg` 作为轻量 PostgreSQL 访问层，不引入 ORM，不启用 pgvector。
- 将两端 repository、service、server wiring 和测试 helper 调整为 async。
- 新增 `apps/admin-api/scripts/migrate-sqlite-to-postgres.ts`，用于从旧 SQLite 文件导入 PostgreSQL，并兼容旧 `shadow_dictionary_bindings` 到 `dictionary_bindings_json` 的迁移。
- `docmee-v2-diagnose.ts` 改为读取 `admin_api` PostgreSQL schema 中的企业 PPT 模板配置。
- 保留 `ORG_SYNC_SQLITE_PATH` 与 `SKILL_RUNTIME_SQLITE_PATH` 仅供导入脚本读取旧数据。

## 验收结果

- 已通过：`docker compose -f docker-compose.dev.yml up -d postgres`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api migrate:postgres`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api test`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime test`
- 已通过：`pnpm --filter @yzj-ai-crm/admin-api build`
- 已通过：`pnpm --filter @yzj-ai-crm/skill-runtime build`
- 已通过：`pnpm build`

## 迁移影响评估

- 影响等级：中到偏大。
- 主要影响来自 `node:sqlite` 同步 API 切换为 PostgreSQL async API，涉及 repository、service、server、HTTP handler、测试 helper 的调用链调整。
- SQLite 专属逻辑已从运行时代码移除；当前保留的 SQLite 访问只存在于导入脚本和迁移测试 fixture 中。
- 本轮没有修改 MongoDB artifact 流程，也没有修改 Qdrant 向量检索逻辑。

## 本地数据导入结果

- 已从 `.local/admin-api.sqlite` 导入 `admin_api` schema：
  - `org_sync_runs`: 1
  - `org_employees`: 639
  - `shadow_object_registry`: 4
  - `shadow_object_snapshots`: 20
  - `enterprise_ppt_templates`: 4
  - `enterprise_ppt_template_settings`: 0
  - `agent_runs`: 596
  - `agent_messages`: 1470
  - `agent_tool_calls`: 1035
  - `agent_confirmations`: 125
  - `artifact_ppt_generations`: 1
- 已从 `.local/skill-runtime.sqlite` 导入 `skill_runtime` schema：
  - `jobs`: 93
  - `job_events`: 1347
  - `job_artifacts`: 108

## 未完成项

- 线上或其他开发机环境仍需按各自 `.env` 与旧 SQLite 文件路径执行一次导入。
