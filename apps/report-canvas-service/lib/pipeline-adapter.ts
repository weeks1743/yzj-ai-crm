/**
 * Pipeline 适配器：将 pipeline 的 StreamWriter 接口适配为 Session Store 更新
 * 用于 API 模式下无 SSE 的异步报告生成
 */

import { sessionStore, type PipelineStage, type SessionError } from "./session-store";
import { runPipeline, type PipelineContext } from "./pipeline";

/**
 * SessionStreamWriter 实现 pipeline.ts 中 StreamWriter 接口
 * 将 pipeline 的 reasoning 事件映射为 session store 的状态更新
 */
class SessionStreamWriter {
  private codeStreamChunks = 0;

  constructor(private readonly sessionId: string) {}

  write(chunk: Record<string, unknown>): void {
    const type = chunk.type as string;
    const id = chunk.id as string | undefined;

    if (type === "reasoning-start" && id) {
      this.handleStageStart(id);
    } else if (type === "reasoning-delta" && id === "code_stream") {
      // Track code streaming progress incrementally
      this.codeStreamChunks++;
      if (this.codeStreamChunks % 10 === 0) {
        // Update progress during code streaming (75 -> 92)
        const streamProgress = Math.min(92, 75 + Math.floor(this.codeStreamChunks / 10));
        sessionStore.updateStatus(this.sessionId, {
          status: "generating",
          stage: "code_gen",
          progress: streamProgress,
        });
      }
    } else if (type === "reasoning-end" && id === "code_stream") {
      // Code streaming finished, QA check phase
      sessionStore.updateStatus(this.sessionId, {
        status: "generating",
        stage: "code_gen",
        progress: 93,
      });
    } else if (type === "reasoning-end" && id === "stage_3") {
      // Stage 3 complete, nearly done
      sessionStore.updateStatus(this.sessionId, {
        status: "generating",
        stage: "code_gen",
        progress: 98,
      });
    }
  }

  private handleStageStart(stageId: string): void {
    let stage: PipelineStage = null;
    let progress = 0;

    switch (stageId) {
      case "stage_1":
        stage = "understand";
        progress = 10;
        break;
      case "stage_2":
        stage = "data_prep";
        progress = 40;
        break;
      case "stage_3":
        stage = "code_gen";
        progress = 60;
        break;
      case "code_stream":
        stage = "code_gen";
        progress = 75;
        this.codeStreamChunks = 0;
        break;
    }

    if (stage) {
      sessionStore.updateStatus(this.sessionId, {
        status: "generating",
        stage,
        progress,
      });
    }
  }
}

/**
 * 异步执行 pipeline 并更新 session store
 * 使用 fire-and-forget 模式，不阻塞 HTTP 响应
 */
export function startPipelineAsync(
  sessionId: string,
  input: { markdown: string; query?: string }
): void {
  // 构建组合查询文本：强调忠实呈现输入内容的结构和意图
  const userQuery = input.query
    ? `${input.query}\n\n以下是需要可视化呈现的完整内容（请忠实呈现其中的所有章节和信息，不要遗漏或替换为自行搜索的数据）：\n\n${input.markdown}`
    : `请将以下内容转化为可视化报告看板。重要要求：必须忠实呈现文档中的所有章节、观点和数据，报告结构应反映原文的逻辑组织，不要用联网搜索到的数据替代原文内容。\n\n${input.markdown}`;

  const context: PipelineContext = {
    userQuery,
    attachedData: undefined,
    existingCode: undefined,
  };

  const writer = new SessionStreamWriter(sessionId);

  // 更新状态为生成中
  sessionStore.updateStatus(sessionId, {
    status: "generating",
    stage: "understand",
    progress: 5,
  });

  // Fire-and-forget: 异步执行 pipeline
  runPipeline(writer, context)
    .then((code) => {
      if (code) {
        sessionStore.setComplete(sessionId, code);
      } else {
        sessionStore.setError(sessionId, {
          code: "PIPELINE_ERROR",
          message: "报告代码生成失败，pipeline 返回空结果",
        });
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "未知错误";
      sessionStore.setError(sessionId, {
        code: "AI_SERVICE_ERROR",
        message: `Pipeline 执行出错: ${message}`,
      });
    });
}
