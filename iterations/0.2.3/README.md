# 0.2.3 版本说明

## 版本目标

在 `0.2.2` 已完成客户 `SKILL.md + references` 生成的基础上，继续把“客户读取”从 preview 推进到真实联调可用：

- 打通客户真实查询与真实详情读取
- 使用轻云 team `AccessToken` + `searchList` / `data/list`
- 保持写操作仍为 preview-only
- 用固定 `openid` 做真实数据验证

## 为什么本次是 0.2.3

本轮没有改动对象范围，也没有进入真实写入，只是把 `customer_search` / `customer_get` 的读链路从 dry-run 推进到真实读取，因此按小版本升级为 `0.2.3`。

## 本次范围

- `admin-api` 新增轻云真实读取客户端方法
- 新增真实读取接口：
  - `POST /api/shadow/objects/:objectKey/execute/search`
  - `POST /api/shadow/objects/:objectKey/execute/get`
- `shadow.customer_search`
  - 保留 preview
  - 新增 live read 执行绑定
- `shadow.customer_get`
  - 保留 preview
  - 新增 live read 执行绑定
- 真实返回统一补齐：
  - `recordId`
  - `important`
  - `fields`
  - `fieldMap`
  - `requestBody`

## 不在本轮范围

- `customer_create` / `customer_update` 真实写入
- 联系人、商机、商机跟进记录真实联调
- 前端界面与技能消费链路改造

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- 使用固定 `openid` 至少成功完成一次真实 `search` 与一次真实 `get`
