# 智能纪要本地查看器

这个子项目用于本地查看 `outputs/<task_id>/` 中已经生成好的通义听悟结果，尽量还原官网的双栏阅读体验。

## 功能

- 任务列表切换
- 左侧音频播放、转写内容、翻译结果、书面化结果查看
- 右侧智能速览
- 右侧思维导图可视化
- 章节点击跳转音频时间
- 发言总结、要点回顾展示

## 启动

```bash
cd /Users/weeks/Desktop/workspaces-yzj/aiproject/tongyi-agent
python3 meeting-viewer/server.py
```

默认地址：

```text
http://127.0.0.1:8123/meeting-viewer/
```

如果要直接打开某个任务：

```text
http://127.0.0.1:8123/meeting-viewer/?task=EV5TddyrE5zM
```

## 说明

- 思维导图不是单独文件，而是来自 `assets/summarization.json` 中的 `mindMapSummary`
- 服务端会自动读取 `outputs` 下的任务目录，并提供聚合后的 JSON 接口
