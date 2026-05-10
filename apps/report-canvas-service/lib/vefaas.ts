/**
 * 火山引擎 AIO-Code Sandbox 客户端
 * 通过 API 网关调用沙箱实例执行 Python 代码
 *
 * API 格式:
 *   POST {GATEWAY_URL}/v1/shell/exec
 *   Body: { "command": "python3 -c '...'" }
 *   Response: { "success": true, "data": { "output": "...", "exit_code": 0 } }
 */

export interface SandboxExecuteResult {
  success: boolean;
  output: string;
  data: unknown;
  error?: string;
}

interface ShellExecResponse {
  success: boolean;
  message: string;
  data: {
    session_id: string;
    command: string;
    status: string;
    output: string;
    exit_code: number;
  };
}

/**
 * 从沙箱 shell 输出中提取最后的 JSON 结果
 * 沙箱输出格式：命令回显 + 换行 + 实际输出
 */
function extractJsonFromOutput(output: string): unknown {
  // 尝试从输出的最后找到 JSON
  const lines = output.trim().split("\n");

  // 从后向前找第一个有效 JSON 行
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }

  // 如果没找到独立 JSON 行，尝试用正则匹配最后出现的 JSON
  const jsonMatch = output.match(/(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * 调用 AIO-Code Sandbox 执行 Python 代码
 */
export async function executeSandbox(
  pythonCode: string
): Promise<SandboxExecuteResult> {
  const endpoint = process.env.VEFAAS_SANDBOX_ENDPOINT;

  // Mock 模式
  if (!endpoint || endpoint === "mock") {
    return getMockResult();
  }

  try {
    // 通过 API 网关调用沙箱的 /v1/shell/exec
    // 使用 python3 -c 执行代码，需要正确转义
    const escapedCode = pythonCode.replace(/'/g, "'\\''");
    const command = `python3 -c '${escapedCode}'`;

    const response = await fetch(`${endpoint}/v1/shell/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        data: null,
        error: `Sandbox HTTP error: ${response.status} - ${errorText}`,
      };
    }

    const result: ShellExecResponse = await response.json();

    if (!result.success || result.data.exit_code !== 0) {
      return {
        success: false,
        output: result.data?.output || "",
        data: null,
        error: `Python execution failed (exit_code=${result.data?.exit_code}): ${result.data?.output}`,
      };
    }

    // 提取 JSON 输出
    const rawOutput = result.data.output;
    const parsedData = extractJsonFromOutput(rawOutput);

    return {
      success: true,
      output: rawOutput,
      data: parsedData || rawOutput,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      data: null,
      error: err instanceof Error ? err.message : "Unknown sandbox error",
    };
  }
}

/**
 * Mock 模式：当未配置真实沙箱时返回失败结果
 * 让上层逻辑根据用户的实际查询内容生成报告，而非使用写死的数据
 */
function getMockResult(): SandboxExecuteResult {
  return {
    success: false,
    output: "",
    data: null,
    error: "Sandbox not configured (mock mode). AI will generate data based on user query.",
  };
}
