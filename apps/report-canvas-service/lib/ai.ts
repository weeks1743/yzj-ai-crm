import { createOpenAI } from "@ai-sdk/openai";
import { getDashScopeBaseUrl, loadReportCanvasEnv } from "@/lib/env";

loadReportCanvasEnv();

export const dashscope = createOpenAI({
  baseURL: getDashScopeBaseUrl(),
  apiKey: process.env.DASHSCOPE_API_KEY,
  name: "dashscope",
});

// 带联网搜索能力的 provider（用于规划阶段，注入 DashScope enable_search 参数）
const dashscopeWithSearch = createOpenAI({
  baseURL: getDashScopeBaseUrl(),
  apiKey: process.env.DASHSCOPE_API_KEY,
  name: "dashscope-search",
  fetch: async (url, options) => {
    if (options?.body && typeof options.body === "string") {
      const body = JSON.parse(options.body);
      body.enable_search = true;
      options = { ...options, body: JSON.stringify(body) };
    }
    return globalThis.fetch(url, options);
  },
});

// 普通模式：用于代码生成、数据准备等执行类任务
export const model = dashscope(process.env.AI_MODEL || "qwen-plus");

// 思考模式 + 联网搜索：用于需求理解、结构规划等需要深度推理的任务
// 联网搜索让规划阶段可以获取实时信息（最新财报、行业数据等）
export const thinkingModel = dashscopeWithSearch(
  process.env.AI_THINKING_MODEL || "qwen-plus-thinking"
);
