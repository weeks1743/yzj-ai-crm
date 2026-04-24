# 0.2.7 版本说明

## 版本目标

将客户影子更新技能从请求体预演推进到真实轻云写入：

- `customer_update` 新增真实 `execute/upsert` 写入链路
- `LightCloudClient` 正式接入 `data/batchSave`
- 更新技能 bundle 执行元数据，明确区分 preview 与 live write
- 用真实客户单据完成一次“读取 -> 更新 -> 回读”联调

## 范围

- 扩展 `admin-api` 写入响应契约
- 扩展 `app.ts` 路由，新增 `POST /api/shadow/objects/:objectKey/execute/upsert`
- 扩展 `shadow-metadata-service` 真实写入执行逻辑
- 扩展 `lightcloud-client` 的 `batchSave` 请求与响应处理
- 更新客户 update skill bundle 与测试

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- 使用真实 `operatorOpenId + formInstId` 成功完成一次客户更新并回读
