# 0.10.9 腾讯云生产部署治理

## 版本目标

- 为腾讯云轻量应用服务器整理可维护的生产部署操作清单。
- 明确 `deploy/` 目录只用于本地/服务器部署资料，不进入 Git。
- 将部署域名口径统一为已在腾讯云备案的 `huaguopm.com`。
- 为后续 Codex 维护、排障、重建服务提供统一入口。
- 完成 `main` 分支在腾讯云生产环境的 Docker Compose 部署与公网验证。

## 范围

- 新增本地部署清单：`deploy/DEPLOYMENT_CHECKLIST.md`，但该目录按约定不提交。
- 更新 `.gitignore`：忽略根目录 `deploy/`。
- 更新 GitHub 远端操作代理约定，推送、拉取和 fetch 默认使用本地代理。
- 不提交生产 `.env.production`、证书、私钥、Compose 热修文件或数据库备份。

## 关键内容

- 生产域名采用单域名路径部署：
  - 用户 AI 工作台：`https://huaguopm.com/chat`
  - 管理员后台：`https://huaguopm.com/admin/`
  - 后端健康检查：`https://huaguopm.com/api/health`
  - 录音 Viewer：`https://huaguopm.com/audio-viewer/`
- 公网只开放 `22/80/443`，数据库、Qdrant、Node 服务和录音处理服务只走 Docker 内网。
- 生产 Compose、Nginx、Dockerfile、后台菜单和外部技能目录不再暴露 `super-ppt` / Docmee / 录音处理服务占位入口。

## 验收结果

- [x] 已创建本版本迭代记录。
- [x] 已将 `deploy/` 加入 `.gitignore`。
- [x] 已按 `huaguopm.com` 更新部署清单域名口径。
- [x] 已在腾讯云轻量服务器 `175.178.128.159` 完成 GitHub Deploy Key 配置并拉取 `main` 分支。
- [x] 已配置服务器生产 Compose、Nginx、`.env.production`、SSL 证书和域名。
- [x] 已完成服务器 Docker 镜像构建与 `docker compose up -d`。
- [x] 已验证 `https://huaguopm.com/api/health` 返回 `{"status":"ok","service":"@yzj-ai-crm/admin-api","port":3001}`。
- [x] 已验证 `https://huaguopm.com/chat` 返回 `200 text/html`。
- [x] 已验证 `https://huaguopm.com/admin/` 返回 `200 text/html`。
- [x] 已验证管理员后台 `/admin/` 资源从 `/admin/` 路径加载且入口 HTML 设置 `Cache-Control: no-store`。
- [x] 已完成生产记录系统模板初始化：`customer`、`contact`、`opportunity`、`followup` 均为 `ready`。
- [x] 已完成生产组织同步：最近一次运行 `completed`，拉取并写入在职人员 `647` 人。
- [x] 已验证外部技能目录不再包含 `ext.super_ppt` 与 `ext.audio_transcribe`。
- [x] 已验证 `https://huaguopm.com/super-ppt/` 返回 `404`。
- [x] 已验证 `https://huaguopm.com/audio-viewer/` 按 GET 访问会跳转到 `/audio-viewer/meeting-viewer/`。
- [x] 已验证 SSL 证书 CN 为 `huaguopm.com`，有效期为 `2026-05-10` 至 `2026-08-07`。

## 未完成项

- 本轮不提交生产部署密钥、证书或真实 `.env.production`。
- 本轮不提交 `deploy/` 清单正文，只保留忽略规则和版本记录。
- 证书有效期到 `2026-08-07`，需要在到期前续签并替换服务器证书。
- 建议部署完成后重置服务器 root 密码，后续维护优先使用 SSH key。

## 下一步计划

- 为生产环境补充周期性数据库备份和恢复演练。
- 后续发布前先在本地完成对应版本构建验证，再在服务器执行拉取、构建、重启和外网回归。
- 如后续拆分子域名或接入 CDN，需同步更新 Nginx、前端 public path、CORS 和本迭代部署清单。
