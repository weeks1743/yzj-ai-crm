# 0.2.18 版本说明

## 版本目标

- 将管理后台 `/skills` 从静态原型页重构为真实 `shadow` 技能治理页
- 为后续 `scene.*` 组装落地只读准备中心，显式展示记录系统技能与外部技能依赖
- 修订记录系统对象页入口与元数据口径，统一改为 `formCodeId / snapshotVersion / schemaHash / activationStatus / refreshStatus`

## 范围

- `apps/admin-pro` 技能与记录系统相关页面重构
- `packages/shared` 影子对象、技能合同、字典绑定与场景草案前端消费类型补齐
- 新增 `记录系统技能详情` 与 `场景组装详情` 页面

## 验收结果

- 新增 `/skills/record-skills` 真实列表页
  - 直接消费 `GET /api/shadow/objects`
  - 统计真实对象数、激活对象数、技能总数、刷新异常对象数
- 新增 `/skills/record-skills/:objectKey` 详情页
  - 展示技能清单、字段快照、字典绑定、引用资源
  - 支持 `刷新模板快照`
  - 技能清单已收敛为摘要卡片，点击后通过抽屉查看完整技能详情
- 新增 `/skills/scene-assembly` 与 `/skills/scene-assembly/:sceneKey`
  - 以真实 `shadow.*` 技能 + 静态场景草案解析依赖状态
  - 显式暴露记录系统缺口与外部技能风险
- 保留 `/skills/external-skills` 与 `/skills/writeback-policies`
  - 页面定位调整为目录 / 治理视图
  - 不再展示旧的工具注册表与伪场景技能运行页
- `/records/[objectType]` 已改为跳转真实对象技能详情
  - “发起技能” 改为 “查看对象技能”
  - 顶部元数据改为真实影子对象口径
- `记录系统技能` 列表页已修复长字段导致的异常行高问题
  - `formCodeId / 快照版本 / Schema Hash / 最近刷新` 均改为紧凑单行展示

## 未完成项

- 本轮仍未在后台内联渲染原始 `SKILL.md` 与 `template-raw.json` 正文
- 场景组装仍为只读准备中心，尚未进入拖拽编排、保存发布与执行阶段
- 外部技能与写回策略当前仍为静态治理草案，待后续治理接口替换

## 下一步计划

- 继续将联系人、商机、跟进记录等对象技能接入同一治理视图并补齐联调状态
- 为场景组装页增加更细粒度的执行边界、确认边界与编排草案版本管理
- 视后端能力成熟度，逐步把外部技能目录与写回策略迁移为真实接口驱动
