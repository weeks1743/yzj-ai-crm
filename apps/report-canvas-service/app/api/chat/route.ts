import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  convertToModelMessages,
  tool,
} from "ai";
import { z } from "zod";
import { model } from "@/lib/ai";
import { getReportAiConfigError } from "@/lib/env";
import { isReportRequest, CHAT_SYSTEM_PROMPT } from "@/lib/prompts";
import { runPipeline, PipelineContext } from "@/lib/pipeline";

export const maxDuration = 180;

// renderReport 工具定义（用于前端识别 tool part）
const renderTool = {
  renderReport: tool({
    description: "生成交互式 React 组件代码",
    inputSchema: z.object({
      code: z.string(),
      title: z.string(),
      description: z.string(),
    }),
    execute: async ({ code, title, description }) => {
      return { code, title, description };
    },
  }),
};

/**
 * 将 UIMessages 转换为 AI SDK 可接受的 ModelMessages
 * 处理含 reasoning/tool parts 的复杂历史消息
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeConvertMessages(messages: any[]) {
  try {
    return await convertToModelMessages(messages, { tools: renderTool });
  } catch {
    // 回退：只提取 text 内容
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        let content = "";
        if (typeof m.content === "string") {
          content = m.content;
        } else if (Array.isArray(m.parts)) {
          content = m.parts
            .filter((p: { type: string; text?: string }) => p.type === "text" && p.text)
            .map((p: { text: string }) => p.text)
            .join("\n");
        }
        return { role: m.role as "user" | "assistant", content };
      })
      .filter((m: { content: string }) => m.content.length > 0);
  }
}

export async function POST(req: Request) {
  try {
    const { messages, existingCode } = await req.json();

    // 提取用户最新消息文本
    const lastUserMessage = messages
      .filter((m: { role: string }) => m.role === "user")
      .pop();

    let userQuery = "";
    if (lastUserMessage) {
      if (typeof lastUserMessage.content === "string") {
        userQuery = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        userQuery = lastUserMessage.content
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { text: string }) => p.text)
          .join(" ");
      } else if (Array.isArray(lastUserMessage.parts)) {
        userQuery = lastUserMessage.parts
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { text: string }) => p.text)
          .join(" ");
      }
    }

    // 判断是否为报告生成/修改请求
    // 1. 有 existingCode 说明已有报告，用户意图是修改 → 走流水线
    // 2. 关键词匹配 → 新建报告 → 走流水线
    if (existingCode || isReportRequest(userQuery)) {
      const configError = getReportAiConfigError();
      if (configError) {
        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            const textId = `config_${Date.now()}`;
            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta: configError,
            });
            writer.write({ type: "text-end", id: textId });
          },
        });
        return createUIMessageStreamResponse({ stream });
      }

      // 报告模式：使用 createUIMessageStream + 5 阶段 pipeline
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          try {
            // 构建 pipeline 上下文
            const context: PipelineContext = {
              userQuery,
              existingCode: existingCode || undefined,
            };

            // 检查是否有附件数据（从消息内容中提取）
            if (userQuery.includes("附件内容")) {
              const fileMatch = userQuery.match(
                /以下是上传的附件内容：\s*([\s\S]*)/
              );
              if (fileMatch) {
                context.attachedData = fileMatch[1];
              }
            }

            // 运行 5 阶段流水线
            const code = await runPipeline(writer, context);

            if (code) {
              // 输出 tool result，让前端渲染报告
              const toolCallId = `call_${Date.now()}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: "renderReport",
                input: {
                  title: "数据分析报告",
                  description: "基于多阶段分析生成的可视化报告",
                  code,
                },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: {
                  code,
                  title: "数据分析报告",
                  description: "基于多阶段分析生成的可视化报告",
                },
              });
            } else {
              // 代码生成失败，发送文字提示
              const textId = `text_${Date.now()}`;
              writer.write({ type: "text-start", id: textId });
              writer.write({
                type: "text-delta",
                id: textId,
                delta: "报告代码生成失败，请重试或调整您的需求描述。",
              });
              writer.write({ type: "text-end", id: textId });
            }
          } catch (err) {
            // 确保 pipeline 错误能返回给前端
            console.error("[pipeline] Error:", err);
            const textId = `error_${Date.now()}`;
            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta: `生成报告时出错: ${err instanceof Error ? err.message : "未知错误"}，请重试。`,
            });
            writer.write({ type: "text-end", id: textId });
          }
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

    // 非报告请求：普通对话模式
    const modelMessages = await safeConvertMessages(messages);

    const result = streamText({
      model,
      system: CHAT_SYSTEM_PROMPT,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[route] Unhandled error:", err);
    // 返回 SSE 格式的错误，这样 useChat 能正确处理
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const textId = `error_${Date.now()}`;
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta: `服务器错误: ${err instanceof Error ? err.message : "请刷新页面重试"}`,
        });
        writer.write({ type: "text-end", id: textId });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}
