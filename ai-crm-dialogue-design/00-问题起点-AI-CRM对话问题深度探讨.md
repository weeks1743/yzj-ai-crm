# AI-CRM 对话问题深度探讨

> 核心问题：用户在 AI-CRM 的对话栏输入一句话，系统如何将其语义化地映射到正确的系统能力上？

## 1. 问题背景

我们正在构建一个 AI 原生 CRM 系统，采用五层架构：

```
本体层 (ontology)  → 业务对象定义（YAML DSL）
能力层 (ability)   → 24+ 个 SKILL.md 定义的技能
场景层 (scene)     → 场景编排（IT评估等）
交互层 (portal)    → Web UI
对话层 (chat)      → 对话入口，用户与系统的主要交互界面
```

对话层是用户接触系统的第一入口。销售人员在对话框中说的每一句话，背后都需要映射到某个具体的系统能力——创建客户、查询商机、分析6要素、准备拜访材料等。

**这个映射如何实现，是整个系统能否"AI 原生"的关键。**

## 2. 当前系统的三个结构性缺陷

### 2.1 硬编码路由

`thread-assistant.ts` 的 `determineRoute()` 仅支持 3 个固定路由：

```typescript
// 现状：正则 + 硬编码
function looksLikeQuery(text: string) {
  return /[?？]|(什么|多少|谁|怎么|如何|阶段|预算|商机|联系人)/.test(text);
}

function determineRoute(state) {
  if (state.audioPath) return "start_recording_task";
  if (state.activeInterrupt && !looksLikeQuery(text)) return "resume_recording_task";
  return "answer_query";
}
```

问题：无法处理"帮我录入客户"、"分析商机健康度"、"准备拜访材料"等新意图。每新增一种意图都要改路由代码。

### 2.2 Skill 对 LLM 不可见

能力层已有 24+ 个 SKILL.md（本体技能 + 外部技能），但 chat 层通过硬编码调用：

```typescript
executeOntologySkill("ont.crm.lead_create", { title: "XX公司" })
```

主 Agent（LLM）无法"看到"可用技能列表，也无法自主选择该用哪个技能。这意味着每新增一个 Skill，都需要一个开发者手动编写对应的路由规则和调用代码。

### 2.3 查询引擎不可扩展

`query-engine.ts` 用 18 种硬编码问题类型 + 字符串拼接生成答案：

```typescript
// 现状：18 种 classifyQuestion + 对应的 answerXxx 函数
switch (questionType) {
  case "opportunity_count": return answerOpportunityCount(ctx);
  case "customer_budget": return answerCustomerBudget(ctx);
  // ... 16 种更多
}
```

每新增一种查询都要改代码，无法自然语言回答开放式问题。

## 3. 核心问题拆解

这个问题可以拆解为四个子问题：

### 3.1 路由问题
用户说的话千变万化，系统如何知道该调用哪个能力？

### 3.2 参数补全问题
即使知道了要调用"创建客户"，用户可能只说了公司名没说联系人电话，如何优雅地追问？

### 3.3 多步编排问题
"帮我准备拜访材料"需要多个步骤（公司研究→客户分析→策略生成→PPT制作），如何编排？

### 3.4 跨轮次持续问题
一个任务可能一次对话完不成（如录入客户缺字段），下次回来用户可能已经在做别的事，如何处理？

## 4. 探索路径

为了回答上述问题，我们进行了以下探索：

### 4.1 开源项目调研

调研了 AI 编码工具和多 Agent 框架，理解业界如何解决类似问题：

**AI 编码工具**（类似我们的对话→能力映射）：

| 项目 | 特点 | 与直接调 LLM 的区别 |
|------|------|-------------------|
| Aider | Git 感知的 AI 编程，自动 commit | 代码上下文感知 |
| Continue | IDE 插件，支持多模型 | 工具使用 + 工作流集成 |
| Cline | VSCode 插件，自主规划执行 | 多步编排 + 权限确认 |
| OpenHands | 全栈 AI 开发 Agent | 容器化执行环境 |
| SWE-agent | 学术界 benchmark Agent | 搜索-编辑循环 |

**AI 编码工具 vs 直接调用 LLM 的 6 大差异**：

1. **代码上下文感知**：自动读取项目结构、依赖关系、类型定义，而非每次手动粘贴代码
2. **工具使用**：可以读写文件、执行命令、搜索代码，而非只能生成文本
3. **多步编排**：自动规划任务步骤，按序执行，处理中间结果
4. **上下文窗口管理**：智能截断、摘要、分块处理超长内容
5. **Prompt 工程**：内置领域特定的 System Prompt 和决策规则
6. **工作流集成**：与 Git、CI/CD、IDE 等开发工具链集成

**多 Agent 协作框架**：

| 项目 | 类型 | 适用场景 |
|------|------|---------|
| LangGraph | 编排框架 | 自定义状态图，条件路由 |
| CrewAI | 角色协作 | 定义角色→分配任务→协作完成 |
| AutoGen | 对话式多 Agent | Agent 之间通过消息对话协作 |
| MetaGPT | 软件公司模拟 | 产品经理→架构师→开发者→测试 |
| ChatDev | 对话驱动开发 | 类似 MetaGPT 的对话式流程 |
| OpenAI Swarm | 轻量框架 | Agent 之间的 handoff 模式 |

### 4.2 Claude Code 源码深度分析

选择 Claude Code 作为重点研究对象，原因：
- 它是目前最成熟的 AI 编码工具之一
- 它解决的问题（对话→工具选择→执行→反馈）与我们高度相似
- 源码可获得，可以分析具体实现

详见 [01-Claude-Code实现机制分析.md](./01-Claude-Code实现机制分析.md)

### 4.3 架构设计

基于开源调研和 Claude Code 分析，设计了 AI-CRM 的对话语义化落地架构。

详见 [03-AI-CRM实现思路与方案对比.md](./03-AI-CRM实现思路与方案对比.md) 和 [04-实现方案详细设计.md](./04-实现方案详细设计.md)

## 5. 结论预览

经过探索，我们得出的核心设计决策：

1. **路由机制**：采用两阶段 LLM 结构化输出路由（非 Claude Code 的单阶段 tool_use，也非现有的硬编码路由）
2. **工具可见性**：借鉴 Claude Code 的 `prompt()` 模式，让每个 Skill 自动生成 LLM 可读的描述，注入 System Prompt
3. **参数补全**：LLM 自主判断缺失参数，生成结构化澄清卡片
4. **多步编排**：LLM 规划 + 确定性分步执行（DAG 拓扑序）
5. **跨轮次持续**：借鉴 Claude Code 的最佳实践——用户意图最高优先，任务挂起不阻塞，后台可继续执行的部分继续执行

这些决策的详细论证在后续文档中展开。
