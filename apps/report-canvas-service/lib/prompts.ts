/**
 * 报告生成流水线 - Prompt 配置
 */

// 判断用户输入是否为报告生成请求
const REPORT_KEYWORDS = [
  "分析", "报告", "图表", "仪表盘", "dashboard",
  "财报", "财务", "季报", "年报", "销量",
  "趋势", "对比", "可视化", "数据",
];

export function isReportRequest(query: string): boolean {
  return REPORT_KEYWORDS.some((kw) => query.includes(kw));
}

// 普通对话 system prompt（非报告请求时使用）
export const CHAT_SYSTEM_PROMPT = `你是一位友好的 AI 分析助手。你可以帮助用户：
1. 分析数据并生成可视化报告（请描述具体的分析需求）
2. 回答关于数据分析的问题
3. 解释图表和报告内容

如果用户想要生成报告，请引导他们描述具体的分析主题、公司/行业、关注指标等。`;
