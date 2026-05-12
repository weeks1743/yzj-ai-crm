# 0.10.23 录音重复上传卡片语义优化

## 目标

- 让同一 MD5 录音再次上传时表现为新的业务录音卡片，而不是沿用旧卡片的拜访记录状态。
- 保留 MD5 重复校验，用于复用通义录音处理底座，避免重复消耗转写和结构化分析资源。
- 确保拜访会话理解、客户需求工作待办分析、客户价值定位等下游分析不会继承旧卡片结果，而是在新卡片点击后重新生成。

## 范围

- `apps/admin-api`
- `docs/05-录音导入场景设计.md`

## 关键实现

- `recording_audio_tasks` 取消 `eid + app_id + file_sha256` 唯一约束，改为文件哈希普通索引，允许同一录音文件生成多张业务卡片。
- `RecordingTaskService.uploadTask` 命中已有非失败 MD5 时新建业务任务，复用已有 `serviceTaskId / providerDataId / materialPath / playback / stages` 等处理底座。
- 新业务任务清空旧 `artifactId`、归档状态、待归档 payload、旧正式 anchors 和旧下游分析状态，只保留本次上传传入的建议关联。
- 失败 MD5 重传会重新触发通义上传，并创建新的业务任务，不覆盖旧失败卡片。
- 下游技能请求文本带当前 `recording-task-*`；重复上传任务查找历史下游 job 时只认当前业务 taskId，避免用 MD5 或共享通义 taskId 撞回旧分析结果。

## 验收结果

- 已通过：
  - `pnpm --filter @yzj-ai-crm/admin-api exec tsx --test tests/recording-task-service.test.ts tests/database.test.ts`
  - `pnpm --filter @yzj-ai-crm/admin-api build`

## 未完成项

- 不处理历史已缓存到浏览器本地、且已经显示为“已新增拜访记录”的旧录音卡片。
