# 架构模式探讨：分类分发 vs 主 Agent + Skill

> 当 Skill 数量增长到 20-30 个时，"先分类再分发"还是"让 Agent 直接选工具"更合适？本篇对比三种架构模式，并给出推荐方案。

---

## 背景：为什么要重新审视架构模式

在 03-04 篇中，我们设计了一套"两阶段路由"架构：

```
用户输入 → Turn Router（LLM 分类） → intentType → 分发到对应 Handler → 执行 Skill
```

其中 Turn Router 输出结构化的 `TurnDecision`，包含 7 种 intentType：

| intentType | 处理方式 |
|-----------|---------|
| execute_skill | 分发到 Skill Executor |
| clarify | 返回澄清卡片 |
| query | 分发到 Query Engine |
| composite_task | 分发到 DAG Planner |
| audio_task | 分发到 Audio Handler |
| chitchat | 直接 LLM 回复 |
| resume_pending | 恢复待续任务 |

这个设计在逻辑上是完整的。但当我们深入思考实际运行时的问题后，一个关键疑问浮现：

**分类这一步本身，是否就是系统最大的脆弱点？**

如果 Turn Router 把"帮我查下联系人"分到了 `chitchat` 而不是 `query`，后续所有流程都白费。分类错误 = 全链路失败。

---

## 三种架构模式

### 模式 A：Turn Router + intentType 分发（当前设计）

```
用户输入
    |
    v
+----------------------------------+
|  Turn Router (LLM)               |
|  输出: TurnDecision JSON         |
|  { intentType, skillId, ... }    |
+----------------------------------+
    |
    v
Switch(intentType)
    ├── execute_skill → Skill Executor
    ├── clarify       → Clarify Handler
    ├── query         → Query Engine
    ├── composite_task→ DAG Planner
    ├── audio_task    → Audio Handler
    ├── chitchat      → LLM Direct
    └── resume_pending→ Resume Handler
```

**特征**：

- **两次 LLM 调用**：第一次分类（Turn Router），第二次执行（Skill 内部的 LLM）
- **显式分类**：intentType 是明确的枚举值，可审计、可统计
- **中间有"接缝"**：分类结果和执行结果之间存在信息损失的可能

**优势**：

| 优势 | 说明 |
|------|------|
| 结果可控 | intentType 是有限枚举，不会出现意外分支 |
| 可审计 | 每次分类决策都可以记录和回溯 |
| 模型要求低 | Turn Router 只需要做分类，对模型推理能力要求较低 |
| 分层清晰 | 路由层和执行层完全解耦 |

**劣势**：

| 劣势 | 说明 |
|------|------|
| 分类错误致命 | 一旦 intentType 判断错误，后续全链路失败 |
| 两次 LLM 开销 | Turn Router 消耗一次 LLM 调用，增加延迟和成本 |
| 边界模糊场景难处理 | "帮我总结这个客户最近的情况" —— 是 query 还是 execute_skill？ |
| 新增分支需改代码 | 每增加一种 intentType 都需要对应的 Handler |

### 模式 B：主 Agent + 子 Agent（层级结构）

```
用户输入
    |
    v
+----------------------------------+
|  Main Agent (LLM)                |
|  看到: 子 Agent 列表             |
|  决策: 委派给哪个子 Agent        |
+----------------------------------+
    |
    v
+--------+--------+--------+
| Sales  | Query  | Task   |
| Agent  | Agent  | Agent  |
+--------+--------+--------+
    |         |         |
    v         v         v
[Skills]  [Skills]  [Skills]
```

**特征**：

- **至少三次 LLM 调用**：主 Agent 路由 → 子 Agent 理解 → Skill 执行
- **层级委派**：主 Agent 不直接执行，只负责分配
- **子 Agent 有独立 System Prompt**：每个子 Agent 有自己的领域知识

**优势**：

| 优势 | 说明 |
|------|------|
| 关注点分离 | 每个子 Agent 专注自己的领域 |
| 可独立演进 | Sales Agent 和 Query Agent 可以独立迭代 |
| 上下文隔离 | 每个子 Agent 只看到自己领域的 Tools，不会互相干扰 |
| 适合大规模 | 当 Skills 达到 100+ 时，层级拆分是必然 |

**劣势**：

| 劣势 | 说明 |
|------|------|
| 延迟叠加 | 3+ 次 LLM 调用，延迟至少翻倍 |
| 跨领域困难 | "查客户信息并分析商机" 涉及 Query Agent + Sales Agent，协调复杂 |
| 过度设计 | AI-CRM 当前 20-30 个 Skill，不需要层级拆分 |
| 维护成本高 | 每个子 Agent 都需要独立的 System Prompt 维护 |

### 模式 C：主 Agent + Skills 平铺（Claude Code 风格）

```
用户输入
    |
    v
+-------------------------------------------+
|  Main Agent (LLM)                         |
|  System Prompt: 业务语义 + 所有 Skill 描述  |
|  直接通过 function calling 选择 Skill       |
+-------------------------------------------+
    |
    v
+------+------+------+------+------+------+
|Skill |Skill |Skill |Skill |Skill | ...  |
|  A   |  B   |  C   |  D   |  E   |      |
+------+------+------+------+------+------+
```

**特征**：

- **一次 LLM 调用**（可能回环多次，但每次都是同一个 Agent 在决策）
- **无分类步骤**：LLM 直接从 Skill 列表中选择要调用的 Skill
- **这就是 Claude Code 的核心模式**：50+ Tools 平铺，LLM 直接选

**优势**：

| 优势 | 说明 |
|------|------|
| 零分类错误 | 没有中间分类步骤，不存在"分错分支"的问题 |
| 低延迟 | 一次 LLM 调用完成决策+执行 |
| 扩展简单 | 新增 Skill 只需注册，无需改路由逻辑 |
| 跨 Skill 组合 | LLM 可以在一个 turn 里调用多个 Skill |
| 简化代码 | 不需要 Turn Router、不需要 intentType 枚举、不需要 Switch 分发 |

**劣势**：

| 劣势 | 说明 |
|------|------|
| 对模型能力要求高 | 需要 LLM 能从 20-30 个工具描述中准确选择 |
| 结构化输出难保证 | 澄清卡片、DAG 计划等需要特定格式的输出 |
| 不可控感 | LLM 的选择是黑盒，不像 intentType 那样可枚举 |
| 需要高质量 prompt | 每个 Skill 的 prompt() 描述必须精确，否则 LLM 会选错 |

---

## 模式 C 变体：推荐方案

纯粹的模式 C 有一个实际问题：某些场景需要**结构化的中间输出**（如澄清卡片、DAG 执行计划），这不是简单的工具调用能解决的。

解决方案是引入 **结构化 meta-tool**——把原本 intentType 的"分支逻辑"变成"工具"：

```
+-------------------------------------------+
|  Main Agent (LLM)                         |
|  System Prompt: 业务语义 + 角色定义         |
|                                           |
|  可用工具:                                 |
|    [业务 Skills]                           |
|    ├── create_followup_record             |
|    ├── analyze_opportunity_6factors       |
|    ├── search_contacts                    |
|    ├── generate_visit_plan                |
|    ├── ...                                |
|    [Meta Tools]                           |
|    ├── clarify_card    → 输出澄清卡片      |
|    ├── plan_composite  → 输出 DAG 执行计划  |
|    └── query_with_context → 带语义的数据查询 |
+-------------------------------------------+
```

### Meta Tools 设计

#### clarify_card

当 Agent 发现用户意图明确但缺少必要参数时，调用此工具输出结构化的澄清卡片：

```typescript
interface ClarifyCardTool {
  name: "clarify_card";
  description: "当用户意图清晰但缺少必要字段时，生成结构化澄清卡片让用户补充信息";
  inputSchema: {
    targetSkill: string;         // 目标 Skill ID
    missingFields: Array<{
      field: string;             // 字段名
      label: string;             // 显示标签
      type: "text" | "select" | "date" | "contact_picker";
      options?: string[];        // select 类型的选项
      hint?: string;             // 提示文字
    }>;
    contextSummary: string;      // 已理解的上下文摘要
  };
}
```

**效果**：Agent 看到 `create_followup_record` 需要 `客户名称` 和 `跟进日期`，用户只说了"记一下跟进"，Agent 主动调用 `clarify_card` 输出缺失字段的卡片。

#### plan_composite

当 Agent 判断用户请求涉及多个步骤时，调用此工具生成执行计划：

```typescript
interface PlanCompositeTool {
  name: "plan_composite";
  description: "当用户请求需要多个步骤协同完成时，生成 DAG 执行计划";
  inputSchema: {
    goal: string;                // 用户最终目标
    steps: Array<{
      id: string;
      skill: string;             // 要调用的 Skill
      inputs: Record<string, any>;
      dependsOn: string[];       // 依赖的前置步骤
    }>;
    confirmRequired: boolean;    // 是否需要用户确认后再执行
  };
}
```

**效果**：用户说"帮我准备明天拜访华为的材料"，Agent 规划出"查客户信息 → 查历史跟进 → 查竞品动态 → 生成拜访计划"的 DAG，调用 `plan_composite` 输出计划卡片。

#### query_with_context

封装带业务语义的数据查询：

```typescript
interface QueryWithContextTool {
  name: "query_with_context";
  description: "带业务语义的数据查询，自动关联上下文中的实体信息";
  inputSchema: {
    query: string;              // 自然语言查询
    entityContext?: {           // 上下文中的实体
      type: string;             // customer | opportunity | contact
      id?: string;
      name?: string;
    };
    outputFormat: "summary" | "table" | "card";
  };
}
```

### 原 intentType → Meta Tools 的映射关系

| 原 intentType | 模式 C 变体中的处理方式 |
|--------------|---------------------|
| execute_skill | Agent 直接调用对应的业务 Skill |
| clarify | Agent 调用 `clarify_card` Meta Tool |
| query | Agent 调用 `query_with_context` Meta Tool |
| composite_task | Agent 调用 `plan_composite` Meta Tool |
| audio_task | Agent 调用 `audio_transcribe` Skill |
| chitchat | Agent 直接用自然语言回复，不调用任何工具 |
| resume_pending | 由 System Prompt 中的 pending_context 驱动，Agent 自动选择恢复动作 |

**关键变化**：7 种 intentType 不再是"枚举分支"，而是 Agent 工具箱中自然的一部分。分类和执行合并为一步。

---

## 多维对比

| 维度 | 模式 A (Turn Router) | 模式 B (主+子 Agent) | 模式 C 变体 (主 Agent + Skills + Meta Tools) |
|------|---------------------|---------------------|------------------------------------------|
| **LLM 调用次数** | 2 次（分类+执行） | 3+ 次（路由+子Agent+执行） | 1 次（直接选工具） |
| **延迟** | 中等 | 高 | 低 |
| **分类错误风险** | 有，且致命 | 有（主 Agent 分配错误） | 无，不存在独立分类步骤 |
| **Skill 扩展** | 需更新 Turn Router prompt | 需决定放入哪个子 Agent | 直接注册，无需改路由 |
| **结构化输出** | 天然支持（每个 Handler 独立控制） | 天然支持（子 Agent 控制） | 通过 Meta Tools 支持 |
| **跨 Skill 组合** | 需要 composite_task 分支 | 需要跨子 Agent 协调 | Agent 自然组合多个工具 |
| **可调试性** | 高（intentType 可记录） | 中等（需追踪多层调用） | 中等（需记录 tool_use 序列） |
| **可审计性** | 高（分类结果明确） | 高（委派记录清晰） | 中等（依赖 tool_use 日志） |
| **对模型能力要求** | 低（分类任务简单） | 中等 | 高（需从 20-30 工具中准确选择） |
| **代码复杂度** | 中等（需维护 Router + 7 Handler） | 高（多 Agent + 协调逻辑） | 低（一个 Agent + 工具注册） |
| **适合 Skill 数量** | 任意（不受影响） | 50+（层级才有意义） | 20-40（超过后需分组） |

---

## 关键决策因素

### 为什么推荐模式 C 变体

**1. 消除了最大的系统风险——分类错误**

在模式 A 中，Turn Router 需要在 7 个 intentType 之间做选择。实际场景中，很多用户输入的边界是模糊的：

- "帮我查下华为最近的跟进情况，顺便分析下这个商机的健康度" —— 是 query 还是 execute_skill 还是 composite_task？
- "记录一下：今天和李总聊了项目进展" —— 是 execute_skill 还是 audio_task（如果是语音输入）？
- "这个客户怎么样" —— 是 query 还是 execute_skill（商机分析）还是 chitchat？

模式 C 变体中，Agent 不需要做这个选择。它可以：
1. 先调用 `query_with_context` 查询跟进记录
2. 再调用 `analyze_opportunity_6factors` 分析商机
3. 最后用自然语言组合两个结果

决策从"选一个分支"变成了"选一个或多个工具"，容错性大幅提高。

**2. 符合 AI-CRM 当前的规模**

当前可预见的 Skill 数量在 20-30 个，加上 3 个 Meta Tools，总共 23-33 个工具。这个数量级：

- Claude Code 用 50+ 工具验证了可行性
- DeepSeek / Qwen 的 function calling 能力在 30 个工具内表现良好
- 不需要层级拆分带来的额外复杂性

**3. 扩展性最好**

新增一个 Skill 的流程：

| 步骤 | 模式 A | 模式 C 变体 |
|------|--------|-----------|
| 1 | 编写 Skill 代码 | 编写 Skill 代码 |
| 2 | 决定映射到哪个 intentType | —（无需） |
| 3 | 更新 Turn Router prompt | —（无需） |
| 4 | 可能需要新增 intentType 和 Handler | —（无需） |
| 5 | 注册到 Tool Registry | 注册到 Tool Registry |

模式 C 变体：写好 Skill，注册，完成。系统自动可用。

**4. 代码更简洁**

模式 A 需要维护的模块：
```
Turn Router → 7 个 Handler → Skill Executor → Skills
```

模式 C 变体需要维护的模块：
```
Main Agent → Skills（含 Meta Tools）
```

代码量大约减少 40%。

---

## 模式 C 变体的实现挑战与对策

### 挑战一：模型选择准确性

**问题**：DeepSeek / Qwen 在 20-30 个工具描述下，能否准确选择正确的工具？

**对策**：

1. **高质量 Skill prompt()**：每个 Skill 的 `prompt()` 方法必须输出精准的触发条件描述
   ```
   // 好的描述
   "当用户要求记录一次客户跟进、拜访记录、电话沟通记录时使用此工具。
    触发词：记录、写一下、记一下、跟进、拜访完了、打完电话了。
    不要与「查询跟进记录」混淆。"

   // 差的描述
   "跟进记录工具"
   ```

2. **灰度验证**：上线前用 100 条真实用户输入做 A/B 测试，对比分类准确率
3. **兜底策略**：如果 LLM 没有选择任何工具，走 chitchat 默认路径

### 挑战二：结构化卡片输出

**问题**：业务场景需要结构化的 UI 卡片（澄清表单、查询结果表格、执行计划），模式 C 如何保证输出格式？

**对策**：Meta Tools 的 `inputSchema` 就是格式约束。Agent 调用 `clarify_card` 时，必须按 Schema 提供参数，前端按 Schema 渲染。这比 Turn Router 输出自由文本再解析更可靠。

### 挑战三：可观测性

**问题**：模式 A 的 intentType 天然是一个审计点。模式 C 如何保证可观测性？

**对策**：
```typescript
// 每次 tool_use 都记录日志
interface ToolUseLog {
  turnId: string;
  timestamp: number;
  userInput: string;
  toolName: string;
  toolInput: Record<string, any>;
  toolOutput: Record<string, any>;
  latencyMs: number;
}
```

通过 `tool_use` 日志，可以还原 Agent 的完整决策路径。虽然不如 intentType 直观，但信息量更大（记录了具体参数）。

### 挑战四：成本控制

**问题**：20-30 个 Skill 的 prompt() 拼入 System Prompt，token 消耗会不会过高？

**对策**：

| 策略 | 说明 |
|------|------|
| prompt() 精简 | 每个 Skill 的 prompt() 控制在 100-150 token |
| 动态加载 | 根据用户历史行为和当前上下文，只加载相关的 Skill 子集 |
| 缓存 | System Prompt 的 Skill 描述部分变化不频繁，可利用 prefix caching |

以 30 个 Skill × 120 token 计算，Skill 描述部分约 3600 token，在可接受范围内。

---

## 决策树：如何选择

```
                    当前有多少个 Skills？
                    /                    \
              ≤ 40 个                   > 40 个
                |                         |
    DeepSeek/Qwen function calling     考虑模式 B
    准确率 ≥ 90%?                     （主 Agent + 子 Agent）
           /          \
         是            否
         |              |
    模式 C 变体        模式 A
    (推荐)          (Turn Router)
```

**分阶段策略**：

| 阶段 | Skill 数量 | 推荐模式 | 理由 |
|------|-----------|---------|------|
| MVP | 5-10 | 模式 C 变体 | 工具少，LLM 准确率高，开发成本低 |
| 成长期 | 10-30 | 模式 C 变体 | Claude Code 验证了此规模的可行性 |
| 成熟期 | 30-50 | 模式 C 变体 + 动态工具加载 | 通过上下文过滤减少可见工具数 |
| 规模期 | 50+ | 模式 B 或 混合 | Skill 按领域分组，子 Agent 各管一域 |

---

## 模式 C 变体的完整架构图

```
┌─────────────────────────────────────────────────────────────┐
│                       前端 (Chat UI)                         │
│  用户输入 → 发送消息 → 接收响应（文本 / 卡片 / 表格 / 计划）    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Main Agent (LLM)                          │
│                                                              │
│  System Prompt:                                              │
│    ① 角色定义（AI-CRM 销售助理）                               │
│    ② 业务语义（CRM 领域知识、销售流程）                         │
│    ③ 当前用户上下文（客户、商机、待办）                          │
│    ④ 行为规则（什么时候该用什么工具）                            │
│                                                              │
│  工具列表:                                                    │
│    [通过 Tool Registry 动态注入]                               │
│                                                              │
│  决策方式:                                                    │
│    function calling / tool_use                                │
└──────────┬──────────────────────────────────────┬───────────┘
           │                                      │
     tool_use 调用                          自然语言回复
           │                              （chitchat 场景）
           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Tool Registry                            │
│                                                              │
│  业务 Skills (来自影子系统适配 + 原生能力):                     │
│    ├── create_followup_record     (记录跟进)                  │
│    ├── analyze_opportunity_6factors (商机6要素分析)            │
│    ├── search_contacts            (搜索联系人)                │
│    ├── generate_visit_plan        (生成拜访计划)              │
│    ├── competitor_analysis        (竞品分析)                  │
│    ├── sales_coaching             (销售辅导)                  │
│    ├── pipeline_overview          (漏斗概览)                  │
│    ├── ...                        (其他业务 Skills)           │
│    └── audio_transcribe           (语音转文字+结构化)          │
│                                                              │
│  Meta Tools (结构化输出工具):                                  │
│    ├── clarify_card               (澄清卡片)                  │
│    ├── plan_composite             (复合任务计划)               │
│    └── query_with_context         (带语义的数据查询)            │
│                                                              │
│  Shadow Adapter (轻云 API 适配层):                             │
│    └── 将轻云 REST API 包装为 CRMTool 接口                     │
└──────────┬──────────────────────────────────────┬───────────┘
           │                                      │
           ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────────┐
│  轻云 CRM (System A) │              │  AI-CRM 原生数据         │
│  - 客户/联系人 CRUD   │              │  - 非结构化分析结果       │
│  - 商机管理           │              │  - 会话记录              │
│  - 审批流             │              │  - 语音转写结果          │
│  - 权限控制           │              │  - 向量检索索引          │
└─────────────────────┘              └─────────────────────────┘
```

---

## 与前序文档的关系

| 文档 | 与本篇的关系 |
|------|------------|
| 03-方案对比 | 03 讨论的是三种**路由方案**（Claude Code 式 / LangGraph / 两阶段），本篇讨论的是三种**架构模式**（分类分发 / 主+子Agent / 主Agent+Skills） |
| 04-详细设计 | 04 是基于模式 A 的详细设计。如果采用模式 C 变体，04 中的 Turn Router 和 7 Handler 将被简化为 Main Agent + Tool Registry |
| 06-影子系统 | 影子系统策略不受架构模式影响。无论模式 A/B/C，Shadow Adapter 都是将轻云 API 包装为 CRMTool 接口 |

**如果最终选择模式 C 变体，04 文档需要做以下更新**：

1. 删除 Turn Router 模块设计
2. 删除 7 个 intentType Handler 的设计
3. 新增 Main Agent System Prompt 设计（合并路由层和执行层）
4. 新增 Meta Tools 详细设计
5. 简化实现步骤（从 8 个模块减少为 4-5 个模块）

---

## 结论

**推荐方案：模式 C 变体（主 Agent + Skills + Meta Tools）**

核心理由：

1. **消除分类错误**——系统最大的脆弱点被彻底移除
2. **低延迟**——一次 LLM 调用完成决策和执行
3. **扩展简单**——新增 Skill 只需注册，无需改任何路由逻辑
4. **跨 Skill 组合自然**——Agent 可在一个 turn 内调用多个工具
5. **代码量更少**——去掉了 Turn Router + 7 Handler 的维护成本

**前提条件**：

- DeepSeek / Qwen 的 function calling 在 20-30 个工具场景下准确率 ≥ 90%
- 每个 Skill 的 `prompt()` 质量足够高，触发条件描述清晰无歧义

**兜底方案**：

如果验证发现模型准确率不够，可以退回模式 A（Turn Router），因为模式 A 本质上是"用显式分类来弥补模型能力的不足"——这不是更好的设计，而是更安全的设计。随着模型能力的提升，最终方向一定是模式 C。
