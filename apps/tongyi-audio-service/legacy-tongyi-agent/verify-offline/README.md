# 通义听悟离线验证

这个子项目用于本地验证以下链路：

1. 上传本地音频到 DashScope OSS
2. 创建通义听悟离线任务
3. 轮询任务状态直到完成
4. 将原始响应和摘要结果保存到本地 `outputs/`

## 准备

```bash
cd /Users/weeks/Desktop/workspaces-yzj/aiproject/tongyi-agent
python3 -m venv .venv
. .venv/bin/activate
pip install -r verify-offline/requirements.txt
```

## 运行

```bash
export DASHSCOPE_API_KEY="你的 API Key"
python verify-offline/run_offline_verify.py \
  --app-id tw_xxx \
  --audio "/Users/weeks/Desktop/workspaces-yzj/aiproject/tongyi-agent/录音样本1.m4a"
```

可选参数：

```bash
python verify-offline/run_offline_verify.py --help
```

如果已经有任务 ID，也可以直接续跑并下载结果：

```bash
export DASHSCOPE_API_KEY="你的 API Key"
python verify-offline/run_offline_verify.py --data-id 任务ID
```

## 输出

运行完成后会在 `outputs/<task_id>/` 下生成：

- `create-task.json`
- `task-result.json`
- `summary.txt`
- `assets/*.json`
- `assets/playback.mp3`
- `assets/mindMapSummary.json`

如果任务尚未完成，脚本会持续轮询直到超时。
