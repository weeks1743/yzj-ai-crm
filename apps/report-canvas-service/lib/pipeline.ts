/**
 * 3 阶段报告生成流水线（优化版：合并冗余阶段，减少 AI 调用次数）
 * 每个阶段通过 AI SDK v6 的 reasoning 事件向客户端流式推送思考过程
 *
 * 阶段1: 理解需求 & 规划结构（合并原 stage 1+2）
 * 阶段2: 准备数据（沙箱执行或 AI 生成模拟数据）
 * 阶段3: 生成可视化报告（合并原 stage 4+5，直接生成代码）
 */
import { generateText, streamText } from "ai";
import { model, thinkingModel } from "@/lib/ai";
import { executeSandbox } from "@/lib/vefaas";

export interface PipelineContext {
  userQuery: string;
  attachedData?: string;
  existingCode?: string; // 已有报告代码，存在时进入修改模式
}

// UIMessageStreamWriter 的最小类型定义
interface StreamWriter {
  write(chunk: Record<string, unknown>): void;
}

/**
 * 从 AI 文本中提取 React 代码块
 */
function extractCodeFromText(text: string): string | null {
  const codeBlockMatch = text.match(
    /```(?:jsx|tsx|javascript|react)?\s*\n([\s\S]*?)```/
  );
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  if (text.includes("export default") && text.includes("import")) {
    return text.trim();
  }
  return null;
}

/**
 * 将文本分段通过 reasoning-delta 输出
 */
function emitText(writer: StreamWriter, id: string, text: string) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.trim()) {
      writer.write({ type: "reasoning-delta", id, delta: line + "\n" });
    }
  }
}

/**
 * 运行 3 阶段流水线
 * @returns 最终生成的 React 组件代码
 */
export async function runPipeline(
  writer: StreamWriter,
  context: PipelineContext
): Promise<string> {
  // 修改模式：已有代码时走增量修改路径
  if (context.existingCode) {
    return await modifyReport(writer, context);
  }

  let planOutput = "";
  let dataOutput = "";

  // ===== 阶段1: 理解需求 & 规划结构（使用思考模式深度推理） =====
  writer.write({ type: "reasoning-start", id: "stage_1" });
  writer.write({ type: "reasoning-delta", id: "stage_1", delta: "## 理解需求 & 规划结构（深度思考中）\n\n" });

  try {
    const planResult = await generateText({
      model: thinkingModel,
      system: `你是一位高级数据分析师和内容可视化专家，具备联网搜索能力。

**首要原则：识别用户输入的内容类型，选择对应的处理策略。**

## 内容类型判断

请先判断用户输入属于哪种类型：

**类型A - 研究主题型（需要联网搜索）**：用户给出一个公司名/行业/主题，希望你搜索数据并分析
- 示例：「帮我分析三星电子」「生成新能源行业报告」
- 处理方式：联网搜索 → 收集数据 → 规划报告

**类型B - 内容可视化型（忠实呈现已有内容）**：用户提供了已经写好的文档/报告/研究材料，希望转化为可视化看板
- 特征：输入中已包含完整的章节结构、分析结论、具体数据
- 示例：拜访准备材料、企业研究简报、会议纪要、客户分析文档
- 处理方式：提取原文结构 → 识别所有关键信息块 → 规划忠实呈现全部内容的看板布局
- **关键要求：不得用联网搜索到的数据替换或覆盖原文内容。原文中的每个章节、每条结论、每项建议都必须在报告中有所呈现。**

---

## 类型A处理流程

一、数据搜索与收集（最重要！）：
- 搜索目标公司/行业的最新公开数据（财报、公告、新闻等）
- 收集关键财务指标的最新数值（营收、利润、增长率等），明确标注数据所属时间段
- 搜索行业趋势、竞争格局、近期重大事件
- **必须输出一个"关键数据汇总"段落，列出所有搜索到的具体数字和来源时间**

二、需求理解（3-5行）：
- 分析主题、目标公司/行业
- 核心分析维度（3-5个关键指标）

三、报告结构规划（同下方规划规则）

---

## 类型B处理流程

一、原文内容提取（最重要！逐章节梳理）：
- 列出原文中**所有**章节标题和核心内容摘要
- 标记每个章节的信息类型：数据指标类 / 文字分析类 / 列表要点类 / 建议建议类 / 风险警示类
- **特别注意**：不要遗漏任何章节！如果原文有讲解提纲、话术要点、拜访策略、核心问题、行动建议等内容，必须全部提取

二、可视化映射规划：
- 将每个信息块映射为最合适的可视化形式：
  * 数据指标 → KPI卡片
  * 趋势数据 → 折线图/面积图
  * 分类对比 → 柱状图/饼图
  * 文字要点/策略/建议 → 带图标的信息卡片列表
  * 话术/讲解内容 → 重点突出的内容区块
  * 风险/注意事项 → 彩色告警卡片
  * 流程/步骤 → 步骤条或时间线

三、报告结构规划（同下方规划规则）

---

## 报告结构规划规则（类型A和B共用）

- 报告标题（简洁有力，反映原文主题）
- 根据内容复杂度决定报告结构：
  * 如果内容维度较少（如单一产品、简单对比），使用**单页滚动布局**，不需要Tab
  * 如果内容维度较多（如综合分析、多业务线、拜访准备多模块），使用**多Tab布局**，Tab数量根据实际内容决定（2-5个），不要强制凑数
- 每个内容区域的核心卡片（KPI/图表/信息卡片/洞察各几个）
- 明确标注使用Tab还是单页布局，以及原因

输出简洁中文，不需要代码。类型A需标注数据来源时间；类型B需确认覆盖了原文所有章节。`,
      messages: [{ role: "user" as const, content: context.userQuery }],
    });

    planOutput = planResult.text || "";
    emitText(writer, "stage_1", planOutput);
  } catch (err) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_1",
      delta: `[规划阶段出错: ${err instanceof Error ? err.message : "未知错误"}]\n`,
    });
  }

  writer.write({ type: "reasoning-end", id: "stage_1" });

  // ===== 阶段2: 准备数据 =====
  writer.write({ type: "reasoning-start", id: "stage_2" });
  writer.write({ type: "reasoning-delta", id: "stage_2", delta: "## 准备数据\n\n" });

  try {
    if (context.attachedData) {
      // 有附件：尝试沙箱执行
      writer.write({ type: "reasoning-delta", id: "stage_2", delta: "检测到附件数据，尝试云沙箱分析...\n" });

      const pythonResult = await generateText({
        model,
        system: `你是Python数据分析专家。编写简洁的Python代码分析数据。
代码用 \`\`\`python 包裹。最后 print(json.dumps(result, ensure_ascii=False))。
结果JSON包含: kpis(数组), chartData(数组), pieData(数组), insights(数组), risks(数组)`,
        messages: [{
          role: "user" as const,
          content: `分析：\n${context.attachedData}\n\n主题：${context.userQuery}`,
        }],
      });

      const codeMatch = pythonResult.text?.match(/```python\s*\n([\s\S]*?)```/);
      if (codeMatch) {
        writer.write({ type: "reasoning-delta", id: "stage_2", delta: "执行 Python 分析代码...\n" });
        const sandboxResult = await executeSandbox(codeMatch[1].trim());
        if (sandboxResult.success && sandboxResult.data) {
          dataOutput = JSON.stringify(sandboxResult.data, null, 2);
          writer.write({ type: "reasoning-delta", id: "stage_2", delta: "沙箱分析完成。\n" });
          writer.write({ type: "reasoning-end", id: "stage_2" });
          return await generateReport(writer, context, planOutput, dataOutput);
        }
        writer.write({ type: "reasoning-delta", id: "stage_2", delta: "沙箱不可用，AI 生成数据...\n" });
      }
    }

    // 无附件或沙箱失败：让 AI 基于规划阶段搜索到的真实数据生成结构化数据
    writer.write({ type: "reasoning-delta", id: "stage_2", delta: "根据规划内容整理结构化数据...\n" });

    const dataResult = await generateText({
      model,
      system: `你是数据可视化专家。你的任务是将规划阶段提取或搜索到的内容整理成结构化JSON格式，用于后续生成可视化报告。

**核心原则：**
1. 优先使用规划阶段提供的真实数据和原文内容，不要凭空编造。
2. 如果规划中有具体数字，必须原样使用。
3. 如果原文是非数据类内容（如拜访准备、讲解提纲、策略建议），则用 textBlocks 字段忠实呈现所有文字内容。

直接输出JSON（用\`\`\`json包裹），根据内容类型选择合适的字段组合：

**数据密集型内容使用：**
- kpis: [{name, value, change, trend("up"|"down"), period}] 4-6个
- chartData: [{period, ...metrics}] 6-8个时间点
- pieData: [{name, value}] 4-6个分类

**文字/策略类内容使用：**
- textBlocks: [{title, type("points"|"strategy"|"qa"|"steps"|"comparison"), items: [string]}] 按原文章节组织
  * type说明：points=要点列表, strategy=策略/建议, qa=问答/话术, steps=流程步骤, comparison=对比分析

**通用字段（都需要）：**
- insights: ["洞察/关键结论1", "洞察2", "洞察3"] 3条
- risks: [{level("high"|"medium"), title, description}] 2-3个
- dataSource: "数据来源说明"

注意：两类字段可以组合使用。例如拜访准备报告可能同时有 kpis（企业指标）和 textBlocks（讲解提纲、话术要点）。`,
      messages: [{
        role: "user" as const,
        content: `主题：${context.userQuery}\n\n规划阶段提取的内容和分析：\n${planOutput}`,
      }],
    });

    const raw = dataResult.text || "{}";
    const jsonMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    dataOutput = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    writer.write({ type: "reasoning-delta", id: "stage_2", delta: "数据准备完成。\n" });
  } catch (err) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_2",
      delta: `[数据阶段出错: ${err instanceof Error ? err.message : "未知错误"}，将使用内联数据]\n`,
    });
  }

  writer.write({ type: "reasoning-end", id: "stage_2" });

  // ===== 阶段3: 生成可视化报告 =====
  return await generateReport(writer, context, planOutput, dataOutput);
}

/**
 * 阶段3: 生成最终 React 报告代码
 */
async function generateReport(
  writer: StreamWriter,
  context: PipelineContext,
  planOutput: string,
  dataOutput: string
): Promise<string> {
  writer.write({ type: "reasoning-start", id: "stage_3" });
  writer.write({ type: "reasoning-delta", id: "stage_3", delta: "## 生成可视化报告\n\n" });
  writer.write({ type: "reasoning-delta", id: "stage_3", delta: "正在生成交互式 React 组件...\n" });

  try {
    const codeSystemPrompt = `你是顶级 React 前端开发专家，擅长高端数据可视化报告设计。参考 Vercel v0、Tremor 等顶级设计系统的视觉语言，生成具有专业质感的交互式报告组件。

## 技术约束
- export default 导出组件
- 样式：Tailwind CSS（通过 CDN 加载）
- 唯一 hook：useState（Tab 切换，仅在多Tab布局时使用）
- 图表必须用 ResponsiveContainer 包裹
- 不要 import React
- **严禁使用下方清单之外的任何组件或库**。不要使用 Chip、Badge、Card、Tag、Tabs 等 UI 组件库的元素，所有 UI 都用原生 HTML 元素 + Tailwind CSS 实现

## 可用组件清单（仅限以下，不可使用任何其他组件）

### recharts（图表库）
可用导出：Area, AreaChart, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Funnel, FunnelChart, Label, LabelList, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis

### lucide-react（图标库）
可用导出：Activity, AlertCircle, AlertTriangle, ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Award, Banknote, BarChart2, BarChart3, Bell, BookOpen, Bookmark, Box, Briefcase, Building, Building2, Calendar, Check, CheckCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleDot, Clock, Cloud, Code, Coins, CreditCard, Crown, Database, DollarSign, Download, ExternalLink, Eye, Factory, FileText, Filter, Flag, Flame, Folder, Gift, Globe, Globe2, GraduationCap, Hash, Heart, HelpCircle, Home, Info, Key, Landmark, Layers, LayoutDashboard, Lightbulb, LineChart, Link, List, Lock, Mail, Map, MapPin, MessageCircle, Minus, Monitor, MoreHorizontal, Package, Percent, Phone, PieChart, Plus, Rocket, Search, Send, Settings, Share, Shield, ShieldCheck, ShoppingCart, Smartphone, Sparkles, Star, Sun, Table, Tag, Target, ThumbsDown, ThumbsUp, Timer, TrendingDown, TrendingUp, Trophy, Truck, Upload, User, UserCheck, Users, Wallet, Zap, X, XCircle

### react
仅可导入：useState

## 布局选择策略（根据规划决定，不要每次都用Tab）

### 单页滚动布局（适合简单分析、单一维度）
- 不需要 useState，不需要 Tab
- 自上而下依次展示：Hero区 → KPI指标行 → 主图表区 → 辅助图表 → 洞察/风险区
- 用留白和分隔自然划分区域
- 内容一目了然，不需要用户切换

### 多Tab布局（适合多维度综合分析）
- 使用 useState 管理 Tab 状态
- Tab 数量根据实际内容决定（2-5个），不强制凑3个
- Tab 按钮直接写在 JSX 中，禁止定义子组件
- 内容区用条件渲染：{activeTab === 0 && (<div>...</div>)}
- 禁止在组件内定义 const XxxComponent = () => ... 的子组件
- 所有 UI 直接写在 return 的 JSX 中

## 视觉设计系统（核心！决定报告质感 - 浅色主题）

### 色彩体系（浅色优雅风格）
- 页面背景：bg-gradient-to-br from-slate-50 to-gray-100（柔和渐变底色）
- 卡片背景：bg-white（纯白卡片，干净利落）
- 边框：border border-gray-200/60（极淡边框，精致不抢眼）
- 主色调渐变：from-indigo-600 via-violet-600 to-purple-600（高级感强调色）
- 辅助色：emerald-500（正向/增长）、rose-500（风险/下降）、amber-500（警告）
- 文字层级：text-gray-900（标题）→ text-gray-700（正文）→ text-gray-500（辅助）→ text-gray-400（标签/注释）

### 卡片设计（Clean Elevation 风格）
- 所有卡片：rounded-2xl bg-white border border-gray-200/60 shadow-sm hover:shadow-md transition-all duration-300
- 卡片内间距：p-6（标准）或 p-8（大卡片）
- KPI 卡片顶部加一条 2px 渐变色条：div h-1 rounded-t-2xl bg-gradient-to-r from-indigo-500 to-purple-500
- 卡片悬停：hover:shadow-lg hover:border-gray-300/60 hover:-translate-y-0.5

### Typography（字体层级）
- 页面标题：text-3xl font-bold text-gray-900
- 区域标题：text-xl font-semibold text-gray-800
- KPI 数值：text-3xl font-bold tabular-nums tracking-tight text-gray-900
- KPI 标签：text-sm text-gray-500 font-medium
- 正文：text-sm text-gray-600 leading-relaxed
- 趋势标签：text-xs font-semibold（正向 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full / 负向 text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full）

### 布局节奏（重要！避免拥挤）
- 整体容器：max-w-7xl mx-auto px-6 py-8 space-y-8
- KPI 行：grid grid-cols-2 lg:grid-cols-4 gap-5（保持卡片间距充足）
- 图表行：grid grid-cols-1 lg:grid-cols-2 gap-6（双列等分为主，避免一大一小的不对称布局）
- 若需要不对称布局，使用 grid-cols-5 中的 col-span-3 + col-span-2
- 每个区域之间用 space-y-8 保持呼吸感
- KPI 卡片高度保持一致，内容垂直居中
- **避免将过多内容（如大饼图+多个KPI）塞进同一个区域**，应拆分为独立的区域块

### 图表美化（Recharts - 浅色主题）
- 图表容器卡片内 padding：p-6，图表区域高度 h-64 或 h-72
- 面积图使用渐变填充：<defs><linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.15}/><stop offset="100%" stopColor="#6366f1" stopOpacity={0.01}/></linearGradient></defs>
- 折线使用 strokeWidth={2.5} stroke="#6366f1" dot={false}（干净无点）
- 网格线：<CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />（淡灰色网格）
- 坐标轴：tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false}
- 饼图色板：['#6366f1','#06b6d4','#10b981','#f59e0b','#ec4899','#8b5cf6']
- 饼图不要占据过大面积，建议 outerRadius={100} 左右，旁边配文字说明
- Tooltip 样式：contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}

### Tab 导航设计（仅在多Tab布局时使用）
- Tab 栏：flex gap-1 p-1 bg-gray-100 rounded-xl mb-6
- 活跃 Tab：bg-white text-gray-900 shadow-sm rounded-lg px-5 py-2.5 font-medium
- 非活跃 Tab：text-gray-500 hover:text-gray-700 px-5 py-2.5 rounded-lg transition-all

### 顶部 Hero 区域
- 使用柔和渐变背景：bg-gradient-to-br from-indigo-50 via-white to-purple-50 rounded-2xl p-8
- 左侧标题+描述，右侧可放1-2个核心指标（不要放太多）
- 标题：text-3xl font-bold text-gray-900，描述 text-gray-500
- 底部无分割线，依靠留白和卡片阴影自然区隔
- **Hero 区域应保持简洁，不要堆砌过多KPI和图表**

### 洞察/结论区
- 使用带左侧色条的卡片：border-l-4 border-indigo-500 bg-indigo-50/50 pl-4 py-3 rounded-r-lg
- 或圆点列表：flex gap-3 items-start，配圆形色点 w-2 h-2 rounded-full bg-indigo-500 mt-2

### 文字内容块（textBlocks）可视化
- 当数据中包含 textBlocks 字段时，必须为每个 block 生成对应的可视化区域
- type="points"（要点列表）：使用图标+文字的卡片列表，每条配一个 lucide 图标
- type="strategy"（策略/建议）：使用带序号的彩色左边框卡片，突出展示
- type="qa"（问答/话术）：使用问答式布局，问题加粗，回答/话术用浅色背景包裹
- type="steps"（流程步骤）：使用步骤条或纵向时间线布局
- type="comparison"（对比分析）：使用双列或表格对比布局
- **每个 textBlock 的 items 数组中的每一条都必须完整呈现，不可省略或合并**

### 风险卡片
- 高风险：bg-rose-50 border border-rose-200 rounded-xl p-4
- 中风险：bg-amber-50 border border-amber-200 rounded-xl p-4
- 加 badge：text-xs px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium

### 数据来源标注
- 在报告底部添加数据来源说明：text-xs text-gray-400 mt-4
- 格式如："数据来源：XX公司2024年Q3财报、公开市场数据"

## 数据格式要求（违反导致编译失败）
- 数值必须是纯数字：不能写 12.5亿，要写 1250000000 或字符串 "12.5亿"
- 不能使用千分位逗号：不能写 1,234,567，要写 1234567
- 数字后不能直接跟字母/中文：不能写 100万、45.2B，要写 "100万"、"45.2B"
- 百分比不能写 12.5%，要写 "12.5%" 或 12.5（纯数字）
- 所有带单位的值必须用引号包裹成字符串

## 输出
只输出代码，用 \`\`\`jsx 包裹。数据内联。`;

    // 使用 streamText 流式生成代码
    const result = streamText({
      model,
      system: codeSystemPrompt,
      messages: [{
        role: "user" as const,
        content: `用户需求：${context.userQuery}

报告规划（含搜索数据）：
${planOutput}

结构化数据：
${dataOutput}

请根据规划中指定的布局方式（单页或多Tab），生成完整的 React 报告组件。优先使用搜索到的真实数据。`,
      }],
    });

    // 通过 code_stream reasoning 通道流式输出代码
    writer.write({ type: "reasoning-start", id: "code_stream" });
    let accumulated = "";
    for await (const chunk of result.textStream) {
      accumulated += chunk;
      writer.write({ type: "reasoning-delta", id: "code_stream", delta: chunk });
    }
    writer.write({ type: "reasoning-end", id: "code_stream" });

    // 从流式输出中提取代码
    const code = extractCodeFromText(accumulated);
    if (code) {
      const qaResult = await qaCheck(code, writer);
      writer.write({ type: "reasoning-end", id: "stage_3" });
      return qaResult.code;
    }

    // 代码可能没有代码块标记
    if (accumulated.includes("export default")) {
      const qaResult = await qaCheck(accumulated, writer);
      writer.write({ type: "reasoning-end", id: "stage_3" });
      return qaResult.code;
    }

    writer.write({ type: "reasoning-delta", id: "stage_3", delta: "代码提取失败。\n" });
  } catch (err) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_3",
      delta: `[生成出错: ${err instanceof Error ? err.message : "未知错误"}]\n`,
    });
  }

  writer.write({ type: "reasoning-end", id: "stage_3" });
  return "";
}

// ===== QA Agent: 代码质量检查与自动修复 =====

interface QAResult {
  code: string;
  issues: string[];
  fixed: boolean;
}

/**
 * 使用 Babel 解析代码，检测 JSX 语法错误
 * 返回 null 表示无错误，否则返回错误信息
 */
function checkSyntaxWithBabel(code: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parse } = require("@babel/parser");
    parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
    return null;
  } catch (e) {
    if (e instanceof Error) {
      return e.message;
    }
    return "未知语法错误";
  }
}

/**
 * 验证 lucide-react / recharts 的 import 是否都是真实存在的导出
 * 移除不存在的导入并替换其 JSX 用法为 <span> 占位符
 */
function validateAndFixImports(code: string, issues: string[]): string {
  let fixedCode = code;

  // 动态加载可用导出列表
  let lucideExports: Set<string> = new Set();
  let rechartsExports: Set<string> = new Set();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lucideExports = new Set(Object.keys(require("lucide-react")));
  } catch { /* lucide-react 不可用则跳过 */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    rechartsExports = new Set(Object.keys(require("recharts")));
  } catch { /* recharts 不可用则跳过 */ }

  // 匹配所有 import { X, Y, Z } from 'package' 语句
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = importPattern.exec(fixedCode)) !== null) {
    const importedNames = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    const pkg = match[2];

    let validExports: Set<string> | null = null;
    if (pkg === "lucide-react") validExports = lucideExports;
    else if (pkg === "recharts") validExports = rechartsExports;
    else continue;

    if (validExports.size === 0) continue;

    const invalidNames = importedNames.filter((name) => !validExports!.has(name));
    if (invalidNames.length === 0) continue;

    const validNames = importedNames.filter((name) => validExports!.has(name));
    issues.push(`无效的 ${pkg} 导入: ${invalidNames.join(", ")}（已自动移除）`);

    // 替换 import 语句：移除无效的导入名
    if (validNames.length > 0) {
      const newImport = `import { ${validNames.join(", ")} } from '${pkg}'`;
      fixedCode = fixedCode.replace(match[0], newImport);
    } else {
      // 全部无效则移除整行 import
      fixedCode = fixedCode.replace(match[0], `/* removed invalid ${pkg} imports */`);
    }

    // 替换 JSX 中对无效组件的引用：<InvalidIcon .../> → <span />
    for (const name of invalidNames) {
      // 自闭合标签：<Icon size={16} />
      const selfCloseRegex = new RegExp(`<${name}(\\s[^>]*)?\\/?>`, "g");
      fixedCode = fixedCode.replace(selfCloseRegex, "<span />");
      // 包裹标签：<Icon>...</Icon>
      const wrapRegex = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "g");
      fixedCode = fixedCode.replace(wrapRegex, "<span>$2</span>");
    }
  }

  return fixedCode;
}

/**
 * 检测代码中使用但未定义的 JSX 组件名，自动注入 stub 定义
 * 根治 "X is not defined" 类 ReferenceError
 */
function injectMissingComponentStubs(code: string, issues: string[]): string {
  // 1. 收集所有 imported 的名称
  const importedNames = new Set<string>();
  const importPattern = /import\s*(?:\{([^}]*)\}|(\w+))\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = importPattern.exec(code)) !== null) {
    if (m[1]) {
      // named imports: import { A, B, C } from '...'
      m[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => importedNames.add(n));
    }
    if (m[2]) {
      // default import: import X from '...'
      importedNames.add(m[2]);
    }
  }

  // 2. 收集所有本地定义的组件/变量名（大写开头）
  const definedNames = new Set<string>(importedNames);
  // function Xxx / const Xxx / let Xxx / var Xxx
  const defPattern = /(?:function|const|let|var)\s+([A-Z][A-Za-z0-9]*)/g;
  while ((m = defPattern.exec(code)) !== null) {
    definedNames.add(m[1]);
  }

  // 3. 找出所有在 JSX 中使用的大写开头组件名
  const jsxUsagePattern = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;
  const usedComponents = new Set<string>();
  while ((m = jsxUsagePattern.exec(code)) !== null) {
    usedComponents.add(m[1]);
  }

  // 4. 找出未定义的组件
  const undefinedComponents = [...usedComponents].filter((name) => !definedNames.has(name));

  if (undefinedComponents.length === 0) return code;

  // 5. 在第一个 import 语句之后、组件函数之前注入 stub
  const stubs = undefinedComponents.map(
    (name) => `const ${name} = ({ children, ...props }) => <span {...props}>{children}</span>;`
  ).join("\n");

  issues.push(`未定义的组件: ${undefinedComponents.join(", ")}（已注入占位 stub）`);

  // 找到最后一个 import 语句的位置，在其后插入
  const lastImportMatch = [...code.matchAll(/^import\s.+$/gm)];
  if (lastImportMatch.length > 0) {
    const lastImport = lastImportMatch[lastImportMatch.length - 1];
    const insertPos = lastImport.index! + lastImport[0].length;
    return code.slice(0, insertPos) + "\n\n// Auto-injected stubs for undefined components\n" + stubs + "\n" + code.slice(insertPos);
  }

  // 没有 import 语句，插入到文件开头
  return "// Auto-injected stubs for undefined components\n" + stubs + "\n\n" + code;
}

/**
 * 核心策略：用 Babel 编译器做真正的语法验证，失败时让 AI 修复
 */
async function qaCheck(code: string, writer: StreamWriter): Promise<QAResult> {
  writer.write({ type: "reasoning-delta", id: "stage_3", delta: `\n代码质检中（${code.length} 字符）...\n` });

  const issues: string[] = [];
  let fixedCode = code;

  // 规则1: 清除残留的 markdown 代码块标记
  if (fixedCode.startsWith("```") || fixedCode.includes("\n```")) {
    fixedCode = fixedCode.replace(/```[\w]*\n?/g, "").trim();
    issues.push("代码包含 markdown 代码块标记（已清除）");
  }

  // 规则2: 缺少 export default
  if (!fixedCode.includes("export default")) {
    issues.push("缺少 export default 导出");
    const funcMatch = fixedCode.match(/function\s+([A-Z]\w+)/);
    if (funcMatch) {
      fixedCode += `\nexport default ${funcMatch[1]};\n`;
      issues[issues.length - 1] += "（已自动修复）";
    }
  }

  // 规则3: 使用了 useState 但没 import
  if (fixedCode.includes("useState") && !fixedCode.includes("import")) {
    issues.push("缺少 useState import（已自动修复）");
    fixedCode = `import { useState } from 'react';\n${fixedCode}`;
  } else if (fixedCode.includes("useState") && !fixedCode.match(/import\s*\{[^}]*useState[^}]*\}\s*from\s*['"]react['"]/)) {
    issues.push("useState 未从 react 导入（已自动修复）");
    fixedCode = `import { useState } from 'react';\n${fixedCode}`;
  }

  // 规则4: 检测内联子组件定义
  const inlineComponentPattern = /^\s*const\s+([A-Z][A-Za-z0-9]*)\s*=\s*\(\s*\{[^}]*\}\s*\)\s*=>/gm;
  const functionStart = fixedCode.match(/export\s+default\s+function\s+\w+/);
  if (functionStart) {
    const fnBodyStart = fixedCode.indexOf(functionStart[0]);
    const afterFnStart = fixedCode.slice(fnBodyStart);
    const matches = [...afterFnStart.matchAll(inlineComponentPattern)];
    if (matches.length > 0) {
      const names = matches.map((m) => m[1]);
      issues.push(`内联子组件: ${names.join(", ")}（会导致状态丢失）`);
    }
  }

  // 规则5: 使用了禁止的 hooks
  const forbiddenHooks = ["useEffect", "useRef", "useContext", "useReducer", "useMemo", "useCallback"];
  const usedForbidden = forbiddenHooks.filter((h) => fixedCode.includes(h));
  if (usedForbidden.length > 0) {
    issues.push(`使用了禁止的 hooks: ${usedForbidden.join(", ")}`);
  }

  // 规则6: 验证 lucide-react 和 recharts 的 import 有效性（防止运行时 undefined 错误）
  fixedCode = validateAndFixImports(fixedCode, issues);

  // 规则7: 检测未定义的 JSX 组件，注入 stub 防止 ReferenceError（根治 "X is not defined"）
  fixedCode = injectMissingComponentStubs(fixedCode, issues);

  // 规则8（核心）: Babel 语法验证
  const syntaxError = checkSyntaxWithBabel(fixedCode);
  if (syntaxError) {
    issues.push(`语法错误: ${syntaxError.slice(0, 120)}`);
  }

  // 判断是否需要 AI 修复
  const needsAIFix = issues.some((i) =>
    i.includes("内联子组件") || i.includes("禁止的 hooks") || i.includes("语法错误")
  );

  if (needsAIFix) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_3",
      delta: `发现 ${issues.length} 个问题: ${issues.join("; ")}。正在 AI 修复...\n`,
    });

    try {
      const fixResult = await generateText({
        model,
        system: `你是 React/JSX 代码修复专家。修复以下问题，保持原有功能和样式不变。

修复规则：
- 修复所有语法错误（确保代码可被 Babel 正确解析）
- 所有含中文/单位的数值必须是字符串："12.5亿" 而非 12.5亿
- 不能有裸的千分位逗号数字：用 1234567 或 "1,234,567"
- 将组件内部定义的子组件内联到使用它的 JSX 位置
- 移除 useEffect/useRef/useContext 等禁止的 hooks，只保留 useState
- 不要使用 Chip、Badge、Card、Tag、Tabs 等 UI 组件库的元素，用原生 HTML 元素 + Tailwind CSS 替代
- 只能使用 recharts 和 lucide-react 这两个库的组件，不能使用其他 UI 库
- 保持所有数据、样式、图表配置不变
- 只输出修复后的完整代码，用 \`\`\`jsx 包裹`,
        messages: [{
          role: "user" as const,
          content: `问题列表：\n${issues.join("\n")}\n\n需要修复的代码：\n\`\`\`jsx\n${fixedCode}\n\`\`\``,
        }],
      });

      const fixed = extractCodeFromText(fixResult.text || "");
      if (fixed && fixed.includes("export default")) {
        // 验证修复后的代码是否通过语法检查
        const recheck = checkSyntaxWithBabel(fixed);
        if (!recheck) {
          fixedCode = fixed;
          writer.write({ type: "reasoning-delta", id: "stage_3", delta: "AI 修复完成，语法验证通过。\n" });
        } else {
          writer.write({ type: "reasoning-delta", id: "stage_3", delta: `AI 修复后仍有语法问题: ${recheck.slice(0, 80)}，使用原始代码。\n` });
        }
      } else {
        writer.write({ type: "reasoning-delta", id: "stage_3", delta: "AI 修复未返回有效代码，使用原始代码。\n" });
      }
    } catch {
      writer.write({ type: "reasoning-delta", id: "stage_3", delta: "AI 修复调用失败，使用原始代码。\n" });
    }
  } else if (issues.length > 0) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_3",
      delta: `质检完成，已自动修复 ${issues.length} 个小问题。\n`,
    });
  } else {
    writer.write({ type: "reasoning-delta", id: "stage_3", delta: "代码质检通过，Babel 语法验证通过。\n" });
  }

  return { code: fixedCode, issues, fixed: issues.length > 0 };
}

// ===== 修改模式：基于已有代码进行增量修改 =====

/**
 * 修改已有报告：跳过规划和数据阶段，直接基于已有代码 + 用户指令修改
 */
async function modifyReport(
  writer: StreamWriter,
  context: PipelineContext
): Promise<string> {
  writer.write({ type: "reasoning-start", id: "stage_1" });
  writer.write({ type: "reasoning-delta", id: "stage_1", delta: "## 修改模式\n\n" });
  writer.write({ type: "reasoning-delta", id: "stage_1", delta: `修改指令: ${context.userQuery}\n` });
  writer.write({ type: "reasoning-delta", id: "stage_1", delta: "基于已有报告代码进行增量修改，跳过规划和数据阶段...\n" });
  writer.write({ type: "reasoning-end", id: "stage_1" });

  writer.write({ type: "reasoning-start", id: "stage_3" });
  writer.write({ type: "reasoning-delta", id: "stage_3", delta: "## 修改报告代码\n\n" });
  writer.write({ type: "reasoning-delta", id: "stage_3", delta: "正在根据指令修改组件...\n" });

  try {
    const modifySystemPrompt = `你是 React 前端开发专家。用户已有一份 React 报告组件代码，现在需要根据修改指令进行调整。

修改规则：
- 理解用户的修改意图，精准修改对应部分
- 保持未提及部分的代码不变
- 保持原有的数据、图表配置、样式风格
- 确保修改后代码完整可运行

技术约束（必须遵守）：
- export default 导出组件
- 仅可使用 recharts（图表）和 lucide-react（图标）这两个库，不可使用其他 UI 库
- 不要使用 Chip、Badge、Card、Tag、Tabs 等 UI 组件库的元素，用原生 HTML 元素 + Tailwind CSS 实现
- 样式：Tailwind CSS
- 唯一 hook：useState（Tab 切换）
- 禁止定义内联子组件
- 禁止使用 useEffect/useRef 等其他 hooks
- 数值带单位必须用字符串：如 "12.5亿" 而非 12.5亿

输出：只输出修改后的完整代码，用 \`\`\`jsx 包裹。`;

    const result = streamText({
      model,
      system: modifySystemPrompt,
      messages: [{
        role: "user" as const,
        content: `修改指令：${context.userQuery}

已有代码：
\`\`\`jsx
${context.existingCode}
\`\`\`

请根据修改指令调整上述代码，输出修改后的完整代码。`,
      }],
    });

    // 流式输出修改后的代码
    writer.write({ type: "reasoning-start", id: "code_stream" });
    let accumulated = "";
    for await (const chunk of result.textStream) {
      accumulated += chunk;
      writer.write({ type: "reasoning-delta", id: "code_stream", delta: chunk });
    }
    writer.write({ type: "reasoning-end", id: "code_stream" });

    // 提取代码
    const code = extractCodeFromText(accumulated);
    if (code) {
      const qaResult = await qaCheck(code, writer);
      writer.write({ type: "reasoning-end", id: "stage_3" });
      return qaResult.code;
    }

    if (accumulated.includes("export default")) {
      const qaResult = await qaCheck(accumulated, writer);
      writer.write({ type: "reasoning-end", id: "stage_3" });
      return qaResult.code;
    }

    writer.write({ type: "reasoning-delta", id: "stage_3", delta: "修改后代码提取失败，返回原始代码。\n" });
    writer.write({ type: "reasoning-end", id: "stage_3" });
    return context.existingCode || "";
  } catch (err) {
    writer.write({
      type: "reasoning-delta",
      id: "stage_3",
      delta: `[修改出错: ${err instanceof Error ? err.message : "未知错误"}，返回原始代码]\n`,
    });
    writer.write({ type: "reasoning-end", id: "stage_3" });
    return context.existingCode || "";
  }
}
