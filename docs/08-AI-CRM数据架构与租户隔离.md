# AI-CRM数据架构与租户隔离

## 本篇回答什么问题

本篇回答以下问题：

- AI销售助手 的结构化与非结构化数据到底怎么分层
- 哪些数据存数据库，哪些存文件，哪些存向量索引
- 如何设计 EID + APPID 强租户隔离
- PostgreSQL + pgvector 与 MongoDB + 向量数据库在本项目中的适配性如何比较

## 1. 数据架构总原则

### 原则 1：影子系统保留结构化主数据

以下主数据仍保留在轻云影子系统：

- 客户
- 联系人
- 商机
- 商机跟进记录

AI-CRM 不复制这些对象作为新的主事实源。

### 原则 2：AI-CRM 只存 AI 原生资产

AI-CRM 存储的内容包括：

- 配置
- 任务
- 会话
- 研究快照
- 录音分析结果
- 联系人关系
- 实体记忆
- 文件元数据
- 检索索引
- 审计事件

### 原则 3：无图数据库

联系人关系、竞争关系、支持关系一律用关系型边表表达。

### 原则 4：最小租户边界固定为 EID + APPID

所有数据库表、缓存键、文件路径、索引命名、任务上下文都必须带：

- `eid`
- `appId`

## 2. 数据域划分

### A. 系统配置域

保存：

- 租户配置
- 应用配置
- OAuth 配置
- 组织同步配置
- 模型配置
- 研究配置
- 录音转写配置

### B. 运行时任务域

保存：

- 对话线程
- 场景任务
- 后台任务
- 重试状态
- 写回状态

### C. AI 原生资产域

保存：

- 公司研究快照
- 录音分析结果
- 实体记忆
- 联系人关系
- 结构化摘要

### D. 文件与原文域

保存：

- 音频文件
- 转写原始 JSON
- 网页快照
- 抓取原文
- Markdown 产物

### E. 检索索引域

保存：

- 研究文本块向量
- 转写文本块向量
- 拜访摘要向量

## 3. 推荐的 v1 数据底座

当前阶段性推荐：

- 主数据库：`PostgreSQL`
- 向量索引：`pgvector`
- 文件存储：`Object Storage`
- 缓存与锁：`Redis`

推荐原因：

- 更适合当前项目强关联、强状态、强审计的业务约束
- 减少 v1 技术栈分裂
- 更利于把多源资产绑定到客户 / 商机 / 联系人上

这不是最终定案，后文会给出与 Mongo 路线的详细对比和决策门。

## 4. 核心实体设计

### 系统配置类

- `tenant_config`
- `org_sync_job`
- `integration_secret`

### 运行时任务类

- `conversation_thread`
- `conversation_message`
- `conversation_task`
- `task_step`

### 录音导入类

- `audio_asset`
- `audio_transcript`
- `audio_analysis_result`

### 公司分析类

- `company_profile_snapshot`
- `research_source_item`

### AI 资产类

- `entity_memory`
- `entity_relation`
- `knowledge_chunk`
- `artifact_file`

### 审计与观测类

- `audit_event`
- `model_invocation_log`
- `tool_invocation_log`

## 5. 联系人关系与实体记忆设计

### 联系人关系

不使用图数据库，统一采用 `entity_relation` 表。

建议字段：

- `eid`
- `app_id`
- `source_type`
- `source_id`
- `target_type`
- `target_id`
- `relation_type`
- `strength`
- `confidence`
- `evidence_ref`
- `created_at`
- `updated_at`

### 实体记忆

实体记忆用于存储“可被多场景复用的最新摘要”，例如：

- 客户最新摘要
- 联系人画像摘要
- 商机最新风险摘要
- 最近录音中提到的关键问题
- 最近研究快照中提到的切入点

建议字段：

- `memory_id`
- `eid`
- `app_id`
- `entity_type`
- `entity_id`
- `memory_type`
- `summary`
- `source_snapshot_refs`
- `freshness_level`
- `updated_at`

## 6. 文件与数据库边界

### 放数据库的内容

- 元数据
- 状态
- 结构化摘要
- 版本引用
- 审计事件
- 关系边

### 放对象存储的内容

- 原始音频
- 原始网页快照
- 原始转写 JSON
- 长文本原文
- 导出文件

### 放向量索引的内容

- 可被问答检索的文本块
- 可被相似度检索的摘要块

## 7. EID + APPID 强租户隔离设计

### 强制规则

1. 每一张业务表都带 `eid` 与 `app_id`
2. 每一个文件路径都带 `eid/app_id`
3. 每一个缓存键都带 `eid:appId:...`
4. 每一个向量索引集合都按 `eid + appId` 隔离
5. 任何跨租户实体引用必须显式拒绝

### 为什么需要 APPID

仅靠 `eid` 还不够，因为：

- 同租户可能存在多个自建应用实例
- 同一租户下未来可能不仅有 AI销售助手，还会有合同助手等产品

因此 `appId` 是隔离“应用实例”的必要维度。

## 8. 存储选型对比：PostgreSQL + pgvector vs MongoDB + 向量数据库

### 8.1 为什么这件事现在不拍板

当前阶段的重点不是先选一个“正确数据库”，而是先明确：

- 比较什么
- 如何比较
- 什么时候触发重新评估

这样做的原因是：

- 你当前需求对结构化主数据绑定、任务状态、审计和多场景消费要求很强
- 但公司分析和录音导入又确实带有大量文档型和非结构化特征

因此，本阶段先形成“对比 + 决策门 + 阶段性建议”，不做不可逆拍板。

### 8.2 候选方案定义

#### 方案 A

`PostgreSQL + pgvector + Object Storage + Redis`

#### 方案 B1

`MongoDB + MongoDB Atlas Vector Search + Object Storage + Redis`

#### 方案 B2

`MongoDB + 独立向量数据库 + Object Storage + Redis`

说明：

- B1 是 Mongo 一体化路线
- B2 是 Mongo + 第三方向量库的更重路线
- B2 不作为 v1 首选，只作为备选扩展路线

### 8.3 官方资料

- pgvector README：
  <https://github.com/pgvector/pgvector>
- PostgreSQL 对 pgvector 的官方新闻：
  <https://www.postgresql.org/about/news/pgvector-080-released-2952/>
- PostgreSQL JSONB 文档：
  <https://www.postgresql.org/docs/current/static/datatype-json.html>
- PostgreSQL 全文检索文档：
  <https://www.postgresql.org/docs/current/functions-textsearch.html>
- MongoDB Vector Search Overview：
  <https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/>
- MongoDB Atlas Vector Search 产品页：
  <https://www.mongodb.com/en-us/products/platform/atlas-vector-search>

### 8.4 评价维度

本项目统一按以下维度比较：

1. 数据模型匹配度
2. 多实体关联能力
3. 事务与一致性
4. 检索与过滤一体化
5. 租户隔离与审计
6. 文档灵活性
7. 开发复杂度
8. 运维复杂度
9. 横向扩展
10. 对三大核心场景的适配度

### 8.5 总体对比结论

| 维度 | PostgreSQL + pgvector | MongoDB + 向量数据库 |
|------|------------------------|-----------------------|
| 数据模型匹配度 | 更优 | 中 |
| 多实体关联能力 | 更优 | 中 |
| 事务与一致性 | 更优 | 中 |
| 检索与过滤一体化 | 优 | 优 |
| 租户隔离与审计 | 更优 | 中 |
| 文档灵活性 | 中 | 更优 |
| 开发复杂度 | 更低 | 中到高 |
| 运维复杂度 | 更低 | 中到高 |
| 横向扩展 | 中到优 | 优 |
| 核心场景适配度 | 更优 | 中到优 |

### 8.6 详细对比口径

#### 数据模型匹配度

对当前项目，PostgreSQL 更适合。

原因是你的核心对象和运行时状态都围绕以下关系展开：

- 客户
- 联系人
- 商机
- 跟进记录
- 公司分析快照
- 录音分析结果
- 任务
- 审计
- 关系边表
- 版本快照

这些天然是强关联模型。

Mongo 路线更适合“整文档聚合 + 文档结构多变”的系统。

#### 多实体关联能力

PostgreSQL 更优。

因为这里存在大量明确关联：

- 客户-联系人
- 客户-商机
- 商机-跟进记录
- 公司分析-客户
- 录音分析-客户 / 商机 / 联系人

这些关系如果要做版本引用、约束校验和审计回放，关系型更自然。

#### 事务与一致性

PostgreSQL 更优。

因为录音导入、公司分析、写回确认、任务状态推进都带状态机特征：

- 创建任务
- 处理中
- 生成候选
- 用户确认
- 写回成功 / 失败

关系型事务、唯一约束、幂等键更直接。

#### 检索与过滤一体化

两者都可以做，但侧重点不同。

`pgvector` 的优势是：

- 向量与业务表同库
- SQL JOIN 与过滤自然一体化
- 适合“先过滤租户 / 客户 / 商机，再做相似检索”

MongoDB Vector Search 的优势是：

- 文档与向量一体化
- 过滤与聚合管道很强
- 适合重文档检索

#### 租户隔离与审计

PostgreSQL 更优。

对 `eid + appId` 强隔离、审计事件、唯一约束、权限判断、批量修复这些事情，关系型更容易制度化。

#### 文档灵活性

Mongo 路线更优。

如果后续长期保存大量：

- 原始抓取结果
- 深层嵌套研究结构
- 复杂中间 JSON

Mongo 会更自然。

但当前项目不仅要“存文档”，更要把它变成可复用业务资产，这又把重心拉回关系型。

#### 开发复杂度

对当前项目，PostgreSQL 更低。

如果选 Mongo 路线，你通常仍要补一层关系型或等价状态治理层来处理：

- 配置
- 幂等
- 审计
- 任务状态
- 关联引用

整体心智负担更高。

#### 运维复杂度

PostgreSQL + pgvector 的 v1 运维更简单。

MongoDB Atlas Vector Search 如果全托管也可以很省事，但一旦变成 `MongoDB + 独立向量库`，复杂度会明显上升。

### 8.7 分场景对比

#### 记录系统技能

PostgreSQL 更优。

原因：

- 记录技能和影子系统对象关系清晰
- 写回确认、版本、审计都更自然

#### 录音导入

PostgreSQL 略优。

原因：

- 音频文件元数据、转写任务、候选结果、确认状态、审计事件更适合关系型
- 原始音频和原始 JSON 放对象存储即可

Mongo 路线也能做，但会更偏“转写文档仓”思路。

#### 公司分析

两者接近，但当前仍偏 PostgreSQL。

原因：

- 原始网页和抓取文本确实偏文档型
- 但研究快照最终要绑定客户实体并进入后续消费链

#### 准备拜访材料

PostgreSQL 更优。

因为它依赖多源拼接：

- 影子系统主数据
- 公司分析快照
- 历史录音分析
- 联系人关系
- 商机状态

这是典型的多表 + 版本引用 + 过滤查询场景。

#### 对话查询与问答

两者都可行。

如果问答主要围绕“客户锚点 + 多源事实组合”，PostgreSQL 更顺。

如果问答主要围绕“长文档语义检索”，Mongo 路线会更自然。

### 8.8 决策门

#### 优先选 PostgreSQL + pgvector 的信号

- 结构化对象关系明显多于原始文档资产
- 写操作确认、任务状态、审计是核心要求
- 查询常常围绕客户 / 商机 / 联系人实体展开
- 希望 v1 技术栈更收敛

#### 优先考虑 Mongo 路线的信号

- 原始文档和半结构化对象量远高于结构化对象
- 查询多数围绕整文档聚合，而不是围绕实体关系
- 团队已有成熟 Mongo / Atlas 运维体系
- 需要深度依赖 Mongo 聚合管道作为主查询范式

### 8.9 阶段性建议

本项目当前阶段建议写为：

> v1 默认优先采用 `PostgreSQL + pgvector + Object Storage + Redis`，在 MVP 跑通后，根据录音导入、公司分析、准备拜访材料三大核心场景的真实数据规模与查询模式，复核是否需要切换或补充 Mongo 路线。

这个建议是阶段性推荐，不是最终不可变结论。

## 9. 对现有核心场景文档的影响

### 对录音导入的影响

必须明确：

- 哪些数据进主库
- 哪些进对象存储
- 哪些进向量索引

### 对公司分析的影响

必须明确：

- 研究快照
- 原始资料
- 向量块
- 客户绑定关系

分别如何落在两类方案上。

### 对准备拜访材料的影响

必须把“多源消费复杂度”写清楚，因为这是最能拉开选型差距的场景。

## 本篇结论

当前不急着拍板数据库，但可以形成清晰的阶段性建议：

- 对当前 AI销售助手 v1，`PostgreSQL + pgvector` 更匹配
- Mongo 路线不是被否定，而是更适合作为文档型资产占主导时的备选路线
- 最终是否切换，不应靠主观偏好，而应由核心场景的真实运行特征来决定
