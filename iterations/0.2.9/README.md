# 0.2.9 版本说明

## 版本目标

围绕客户影子技能继续收口真实写入链路，优先补齐“附件可真实上传并进入客户更新请求”的能力，同时修正技能生成里的对象命名问题：

- 新增审批文件上传能力与独立 `SKILL.md`
- 客户更新技能正式支持 `attachmentWidget`
- 修复联系人技能仍写成 `shadow.customer_*` 的生成错误
- 继续验证客户 `Bd_1/basicDataWidget`（联系人编号）真实写入形状，但本轮不伪装成已稳定支持

## 范围

- `admin-api` 新增审批文件上传 client / service / HTTP 接口
- `shadow` 元数据与技能生成链路接入附件字段
- 新增文件上传相关测试，扩展现有 `shadow` / HTTP / LightCloud 解析测试
- 新增 `skills/approval/file-upload/`，供后续客户附件更新链路复用

## 验收

- `pnpm --filter @yzj-ai-crm/admin-api test`
- `pnpm --filter @yzj-ai-crm/admin-api build`
- 使用真实审批文件服务上传 `/tmp/测试上传附件.pptx`
- 将上传返回的附件对象写入客户真实更新请求

## 未完成项

- `Bd_1/basicDataWidget` 仍缺少官方明确写入样例；已确认其关联联系人对象且显示列为 `_S_ENCODE`，但真实更新 payload 仍需继续联调验证

## 下一步

- 继续基于联系人 `_S_ENCODE` / 真实前端抓包结果确认 `basicDataWidget` 更新格式
- 在 customer update 的真实联调用例中补上联系人关系字段
