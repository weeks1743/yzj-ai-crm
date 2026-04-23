# Claude Code 实现机制分析

> 基于 Claude Code 源码的深度分析，揭示其多 Agent 编排、Tool/Skill 路由、通信和任务持续性的核心实现。

## 1. 核心设计哲学

Claude Code 的核心理念：**LLM 即路由器**。

没有预定义的状态图，没有 Supervisor 节点，没有规则引擎。LLM 阅读所有工具描述，通过 `tool_use` function calling 自主决定调用哪个工具。"路由"是 LLM 推理的自然结果，而非工程化的分支逻辑。

## 2. Tool 统一接口

Claude Code 中每个能力（读文件、执行命令、搜索代码等）都实现统一的 Tool 接口：

```typescript
interface Tool {
  name: string;
  prompt(): string;          // 核心：生成 LLM 可读的自然语言描述
  inputSchema: JSONSchema;   // 参数定义
  call(params, ctx): Promise<ToolResult>;
  checkPermissions(params, ctx): PermissionResult;
  isConcurrencySafe(): boolean;
}
```

**`prompt()` 方法是整个路由机制的关键**——它生成工具的自然语言描述，被注入到 System Prompt 中。LLM 通过阅读这些描述来决定使用哪个工具。

示例：`ReadTool.prompt()` 返回的内容类似于：
```
Read the contents of a file from the local filesystem.
Use this when you need to examine the contents of an existing file.
...
```

所有工具通过 `getAllBaseTools()` 函数统一注册，编译时通过 `toolToAPISchema()` 转换为 Claude API 的 function calling 格式。系统启动时注册 50+ 个工具。

## 3. SkillTool 二级路由

SkillTool 是一个特殊的 Tool，它本身**聚合了所有可用 Skill 的描述**：

```
工作流程:
1. 扫描 SKILL.md 文件（项目级 + 用户级）
2. 将所有 Skill 的描述拼接成 SkillTool 自己的 prompt()
3. LLM 看到 SkillTool 的描述时，知道可以通过它访问特定 Skill
4. LLM 调用 SkillTool 时传入 skill_name 参数
5. SkillTool 内部执行对应的 Skill
```

这构成了**两级路由**：
- 第一级：LLM 从 50+ 个 Tool 中选择 SkillTool
- 第二级：SkillTool 根据 skill_name 参数定位并执行具体 Skill

## 4. 多 Agent 架构

### 4.1 七种 TaskType

Claude Code 定义了 7 种任务类型：

| TaskType | 说明 | 典型场景 |
|----------|------|---------|
| `local_bash` | 本地 shell 命令执行 | 运行 npm install |
| `local_agent` | 本地后台异步 Agent | 长时间运行的代码搜索 |
| `remote_agent` | 远程 Agent（API 调用） | 预留扩展 |
| `in_process_teammate` | 同进程内的队友 Agent | 并行子任务 |
| `local_workflow` | 本地工作流编排 | 多步骤自动化 |
| `monitor_mcp` | MCP 服务器监控 | 外部工具集成 |
| `dream` | 异步"思考"任务 | 后台推理分析 |

### 4.2 三种 Agent 运行模式

**模式 1: LocalAgentTask（后台异步）**

```
主 Agent                        子 Agent (后台)
  |                                |
  |-- 创建 LocalAgentTask -------->|
  |   (不等待，继续处理用户输入)      |-- 独立执行任务
  |                                |-- 写结果到文件
  |                                |-- 发送低优先级通知
  |<-- 通知（空闲时展示）-----------|
```

特点：不阻塞主对话，结果通过通知队列异步返回。

**模式 2: InProcessTeammate（同进程隔离）**

```
主进程
  |
  |-- AsyncLocalStorage 创建隔离上下文
  |     |
  |     |-- Teammate A (独立 Memory, 独立 Tool 白名单)
  |     |-- Teammate B (独立 Memory, 独立 Tool 白名单)
  |     |
  |-- 合并结果
```

特点：共享进程但隔离状态，通过 Node.js `AsyncLocalStorage` 实现上下文隔离。

**模式 3: 同步 Agent**

```
主 Agent --> 子 Agent --> 等待完成 --> 继续
```

特点：阻塞等待，用于必须串行的步骤。

## 5. 三层消息通信

Claude Code 的 Agent 间通信采用三层架构：

### 5.1 Memory Mailbox（内存邮箱）

- 同进程内的快速消息传递
- 基于 `AsyncLocalStorage` 隔离
- 适用于 InProcessTeammate 之间的通信

### 5.2 File TeammateMailbox（文件邮箱）

- 基于文件系统的持久化消息
- 跨进程/跨 Agent 通信
- 消息写入文件，接收方轮询读取

### 5.3 Priority Command Queue（优先级命令队列）

三种优先级：

| 优先级 | 用途 | 示例 |
|--------|------|------|
| `now` | 立即处理 | 用户主动输入 |
| `next` | 下一轮处理 | 子任务完成通知 |
| `later` | 空闲时处理 | 后台任务完成报告 |

关键设计：**用户输入永远是 `now` 优先级**，不会被后台任务的通知打断。

## 6. System Prompt 分层构建

Claude Code 的 System Prompt 分为**静态**和**动态**两层：

### 6.1 静态层（跨会话缓存）

```
角色定义 + 行为准则
+
工具列表（所有 Tool 的 prompt() 输出）
+
规则约束（安全策略、权限规则等）
```

这部分在会话期间不变，可以利用 API 的 prompt caching 减少 token 消耗。

### 6.2 动态层（每次请求更新）

```
当前上下文（工作目录、打开的文件等）
+
活跃任务状态
+
最近对话摘要
```

## 7. 工具过滤机制

不同类型的 Agent 可以访问不同的工具集：

```
工具过滤 = 白名单 ∩ ¬黑名单 ∩ 功能开关
```

- **白名单（allowed-tools）**：在 SKILL.md 或 Agent 配置中声明可用工具
- **黑名单**：全局排除的危险操作
- **功能开关**：根据用户订阅/环境动态启停

示例：一个"代码搜索" Agent 只能访问 Read、Grep、Glob 工具，不能访问 Write、Bash。

## 8. 任务持续性机制

Claude Code 处理跨轮次任务的五个核心原则：

### 8.1 用户意图最高优先

用户的新输入永远优先处理。如果用户在后台任务执行期间提出新问题，系统立即响应新问题，不要求用户"等一下"。

### 8.2 不阻塞

未完成的任务以通知形式呈现，不是阻塞弹窗。用户可以选择查看或忽略。

### 8.3 细粒度持久化

任务的每一步结果都写入持久化存储（文件/数据库），不依赖内存状态。进程重启后可以从最近的 checkpoint 恢复。

### 8.4 追加式通知

后台任务完成后，通知消息追加到对话末尾（而非插入到对话中间），在用户空闲时展示。

### 8.5 任务驱逐

长时间无响应的任务会被系统自动标记为过期/驱逐，避免无限积累。

## 9. 涌现路由模式

虽然 Claude Code 没有显式的"路由分支"，但从行为上可以观察到 5 种涌现模式：

1. **直接工具执行**：LLM 选中一个具体工具（Read, Bash, Edit 等）
2. **子 Agent 委托**：调用 AgentTool 派生后台/同步/队友 Agent
3. **Skill 二级路由**：调用 SkillTool，由它在 Skill 列表中再选择
4. **多工具组合**：一个 turn 里并行调用多个工具
5. **纯文本回复**：不调用任何工具，直接文本回复

这些"分支"不是预定义的，而是 LLM 根据上下文自然涌现的行为。

## 10. 对 AI-CRM 的启示

从 Claude Code 的实现中，我们提取了以下可复用的模式：

| Claude Code 模式 | AI-CRM 借鉴 |
|-----------------|------------|
| `prompt()` 方法 | 每个 CRM Skill 自动生成 LLM 可读描述 |
| Tool Registry | 自动扫描 SKILL.md 注册工具 |
| SkillTool 二级路由 | Tool Registry 聚合所有 Skill 描述 |
| System Prompt 分层 | 静态层（角色+工具+规则）+ 动态层（上下文+任务） |
| 优先级命令队列 | 用户意图最高优先，通知低优先级追加 |
| 细粒度持久化 | 任务每步结果写入数据库 |

**但不照搬的部分**：

| Claude Code 方式 | AI-CRM 的不同选择 | 原因 |
|-----------------|------------------|------|
| 单阶段 tool_use 路由 | 两阶段结构化输出路由 | 销售用户需要结构化引导；审计合规 |
| Claude Sonnet/Opus | DeepSeek/Qwen | 国产化合规 |
| CLI 文本追问 | 结构化卡片澄清 | 销售人员需要 GUI 引导 |
| 50+ 通用工具 | 领域特定 CRM 工具 | 聚焦 B2B 销售场景 |

详见 [03-AI-CRM实现思路与方案对比.md](./03-AI-CRM实现思路与方案对比.md)
