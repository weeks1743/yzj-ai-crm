# Tongyi Audio Service

本服务是从 `tongyi-agent` 拷贝并产品化后的本项目内置录音处理独立进程。它可以作为后台服务单独启动，由 `admin-api` 通过 HTTP 调用。

相同音频内容按 MD5 做本地幂等缓存；同一个 mp3 重复上传会复用已有任务和资料包，不重新创建通义听悟处理任务。

## 启动

```bash
pnpm --filter @yzj-ai-crm/tongyi-audio-service dev
```

根目录执行 `pnpm dev` 时也会一起启动本服务。

默认监听 `127.0.0.1:${TONGYI_AUDIO_SERVICE_PORT:-3018}`。

## 环境变量

- `TONGYI_AUDIO_SERVICE_PORT`
- `TONGYI_DASHSCOPE_API_KEY`，可回退到 `DASHSCOPE_API_KEY`
- `TONGYI_TINGWU_APP_ID`
- `TONGYI_AUDIO_OUTPUT_DIR`
- `TONGYI_AUDIO_FIXTURE_OUTPUT_DIR`

## 资料边界

服务会保存通义返回的过程文件，但默认只将 `recording-material.md` 或 `profile-analysis/*.md` 作为对话和技能可消费资料。`transcription.json`、`translations.json`、`textPolish.json`、`task-result.json`、`create-task.json`、`summary.txt`、`summarization.json`、`meetingAssistance.json`、`autoChapters.json` 不进入资料包、不进入向量索引，也不作为 Evidence 暴露。
