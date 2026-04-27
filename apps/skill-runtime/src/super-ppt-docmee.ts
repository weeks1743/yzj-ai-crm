import type {
  AppConfig,
} from './contracts.js';
import {
  extractDocmeeStatusCandidate,
  type DocmeeAiLayoutResponse,
  type DocmeeClient,
  type DocmeeConvertResultResponse,
  type DocmeeLatestDataResponse,
} from './docmee-client.js';
import { ExternalServiceError } from './errors.js';

export const DOCMEE_PROMPT_MAX_LENGTH = 50;
export const DEFAULT_SUPER_PPT_PROMPT =
  '请基于完整材料生成专业、清晰、适合管理层汇报的科技行业PPT';
const DOCMEE_RUNTIME_TOKEN_HOURS = 1;
const DOCMEE_RUNTIME_TOKEN_LIMIT = 50;
const DOCMEE_AI_LAYOUT_WARMUP_MS = 3_000;
const DOCMEE_LAYOUT_POLL_INTERVAL_MS = 5_000;
const DOCMEE_LAYOUT_POLL_TIMEOUT_MS = 600_000;

export interface ResolvedSuperPptPrompt {
  defaultPrompt: string;
  effectivePrompt: string;
  promptMaxLength: number;
  isFallbackApplied: boolean;
  fallbackReason: string | null;
}

export function resolveSuperPptPrompt(prompt: string | null | undefined): ResolvedSuperPptPrompt {
  const trimmed = prompt?.trim() || DEFAULT_SUPER_PPT_PROMPT;
  if ([...trimmed].length <= DOCMEE_PROMPT_MAX_LENGTH) {
    return {
      defaultPrompt: trimmed,
      effectivePrompt: trimmed,
      promptMaxLength: DOCMEE_PROMPT_MAX_LENGTH,
      isFallbackApplied: false,
      fallbackReason: null,
    };
  }

  return {
    defaultPrompt: trimmed,
    effectivePrompt: DEFAULT_SUPER_PPT_PROMPT,
    promptMaxLength: DOCMEE_PROMPT_MAX_LENGTH,
    isFallbackApplied: true,
    fallbackReason: `当前提示词超过 Docmee 官方 ${DOCMEE_PROMPT_MAX_LENGTH} 字限制，运行时已回退系统默认短提示词。`,
  };
}

export function createSuperPptDocmeeUid(seed: string): string {
  const compactSeed = seed
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 48) || 'job';
  return `sp-${compactSeed}`;
}

export async function createSuperPptRuntimeToken(
  docmeeClient: DocmeeClient,
  seed: string,
): Promise<string> {
  const payload = await docmeeClient.createApiToken({
    uid: createSuperPptDocmeeUid(seed),
    limit: DOCMEE_RUNTIME_TOKEN_LIMIT,
    timeOfHours: DOCMEE_RUNTIME_TOKEN_HOURS,
  });
  return payload.token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEmptyAiLayoutResponse(): DocmeeAiLayoutResponse {
  return {
    streamLog: '',
    events: [],
    finalEventData: undefined,
    inferredMarkdown: null,
    inferredHtml: null,
    inferredStatus: null,
    aborted: false,
  };
}

function normalizeDocmeeLayoutStatus(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === '2') {
    return 'completed';
  }
  if (normalized === '1') {
    return 'running';
  }
  if (normalized === '0') {
    return 'pending';
  }
  if (normalized === '-1') {
    return 'error';
  }

  return normalized;
}

function isDocmeeLayoutCompleted(status: string | null): boolean {
  return Boolean(
    status
    && (
      status === 'completed'
      || status === 'complete'
      || status === 'done'
      || status === 'success'
      || status === 'convert_success'
    )
  );
}

function isDocmeeLayoutFailed(status: string | null): boolean {
  return status === 'error' || status === 'failed';
}

export interface DocmeeLayoutState {
  status: string | null;
  source: 'ai_layout' | 'latest_data' | 'convert_result' | null;
  isCompleted: boolean;
  isFailed: boolean;
}

export function resolveOfficialLayoutState(input: {
  aiLayout: DocmeeAiLayoutResponse;
  latestData?: DocmeeLatestDataResponse | null;
  convertResult?: DocmeeConvertResultResponse | null;
}): DocmeeLayoutState {
  const candidates = [
    {
      source: 'convert_result' as const,
      status: normalizeDocmeeLayoutStatus(extractDocmeeStatusCandidate(input.convertResult)),
    },
    {
      source: 'latest_data' as const,
      status: normalizeDocmeeLayoutStatus(extractDocmeeStatusCandidate(input.latestData)),
    },
    {
      source: 'ai_layout' as const,
      status: normalizeDocmeeLayoutStatus(extractDocmeeStatusCandidate(input.aiLayout.finalEventData)),
    },
  ].filter((item) => item.status);

  const completed = candidates.find((item) => isDocmeeLayoutCompleted(item.status));
  if (completed) {
    return {
      status: completed.status,
      source: completed.source,
      isCompleted: true,
      isFailed: false,
    };
  }

  const failed = candidates.find((item) => isDocmeeLayoutFailed(item.status));
  if (failed) {
    return {
      status: failed.status,
      source: failed.source,
      isCompleted: false,
      isFailed: true,
    };
  }

  const pending = candidates[0];
  return {
    status: pending?.status || null,
    source: pending?.source || null,
    isCompleted: false,
    isFailed: false,
  };
}

export async function waitForOfficialLayoutCompletion(input: {
  docmeeClient: DocmeeClient;
  aiLayout: DocmeeAiLayoutResponse;
  taskId: string;
  runtimeToken: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<{
  latestData: DocmeeLatestDataResponse | null;
  convertResult: DocmeeConvertResultResponse | null;
  latestDataError: string | null;
  convertResultError: string | null;
  layoutState: DocmeeLayoutState;
}> {
  let latestData: DocmeeLatestDataResponse | null = null;
  let convertResult: DocmeeConvertResultResponse | null = null;
  let latestDataError: string | null = null;
  let convertResultError: string | null = null;

  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DOCMEE_LAYOUT_POLL_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? DOCMEE_LAYOUT_POLL_INTERVAL_MS;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      latestData = await input.docmeeClient.latestData(input.taskId, input.runtimeToken);
      latestDataError = null;
    } catch (error) {
      latestDataError = error instanceof Error ? error.message : String(error);
    }

    try {
      convertResult = await input.docmeeClient.getConvertResult(input.taskId, input.runtimeToken);
      convertResultError = null;
    } catch (error) {
      convertResultError = error instanceof Error ? error.message : String(error);
    }

    const layoutState = resolveOfficialLayoutState({
      aiLayout: input.aiLayout,
      latestData,
      convertResult,
    });
    if (layoutState.isCompleted) {
      return {
        latestData,
        convertResult,
        latestDataError,
        convertResultError,
        layoutState,
      };
    }
    if (layoutState.isFailed) {
      throw new ExternalServiceError('Docmee AI 智能布局失败', {
        taskId: input.taskId,
        latestData,
        convertResult,
        layoutState,
      });
    }

    await delay(intervalMs);
  }

  throw new ExternalServiceError('Docmee AI 智能布局未在预期时间内完成', {
    taskId: input.taskId,
    latestData,
    latestDataError,
    convertResult,
    convertResultError,
    layoutState: resolveOfficialLayoutState({
      aiLayout: input.aiLayout,
      latestData,
      convertResult,
    }),
  });
}

export async function runOfficialDocmeeLayoutFlow(input: {
  docmeeClient: DocmeeClient;
  taskId: string;
  runtimeToken: string;
  data: unknown;
  templateId?: string;
  timeoutMs?: number;
  intervalMs?: number;
  warmupMs?: number;
}): Promise<{
  aiLayout: DocmeeAiLayoutResponse;
  latestData: DocmeeLatestDataResponse | null;
  convertResult: DocmeeConvertResultResponse | null;
  latestDataError: string | null;
  convertResultError: string | null;
  layoutState: DocmeeLayoutState;
}> {
  const controller = new AbortController();
  const aiLayoutPromise = input.docmeeClient.generatePptxByAi({
    id: input.taskId,
    data: input.data,
    templateId: input.templateId,
    signal: controller.signal,
    allowAbort: true,
  }, input.runtimeToken);

  const warmupResult = await Promise.race([
    aiLayoutPromise.then((aiLayout) => ({
      kind: 'ai_layout' as const,
      aiLayout,
    }), (error) => ({
      kind: 'error' as const,
      error,
    })),
    delay(input.warmupMs ?? DOCMEE_AI_LAYOUT_WARMUP_MS).then(() => ({
      kind: 'warmup' as const,
    })),
  ]);

  if (warmupResult.kind === 'error') {
    throw warmupResult.error;
  }

  if (warmupResult.kind === 'ai_layout') {
    const layoutState = resolveOfficialLayoutState({
      aiLayout: warmupResult.aiLayout,
    });
    if (layoutState.isFailed) {
      throw new ExternalServiceError('Docmee AI 智能布局失败', {
        taskId: input.taskId,
        aiLayout: warmupResult.aiLayout.finalEventData,
        layoutState,
      });
    }
    if (layoutState.isCompleted) {
      return {
        aiLayout: warmupResult.aiLayout,
        latestData: null,
        convertResult: null,
        latestDataError: null,
        convertResultError: null,
        layoutState,
      };
    }
  }

  let polledState: {
    latestData: DocmeeLatestDataResponse | null;
    convertResult: DocmeeConvertResultResponse | null;
    latestDataError: string | null;
    convertResultError: string | null;
    layoutState: DocmeeLayoutState;
  } | null = null;
  let pollError: unknown = null;

  try {
    polledState = await waitForOfficialLayoutCompletion({
      docmeeClient: input.docmeeClient,
      aiLayout: createEmptyAiLayoutResponse(),
      taskId: input.taskId,
      runtimeToken: input.runtimeToken,
      timeoutMs: input.timeoutMs,
      intervalMs: input.intervalMs,
    });
  } catch (error) {
    pollError = error;
  } finally {
    controller.abort();
  }

  const aiLayoutResult = await aiLayoutPromise.then((aiLayout) => ({
    kind: 'ai_layout' as const,
    aiLayout,
  }), (error) => ({
    kind: 'error' as const,
    error,
  }));

  if (aiLayoutResult.kind === 'error') {
    throw aiLayoutResult.error;
  }

  const mergedLayoutState = resolveOfficialLayoutState({
    aiLayout: aiLayoutResult.aiLayout,
    latestData: polledState?.latestData,
    convertResult: polledState?.convertResult,
  });

  if (mergedLayoutState.isFailed) {
    throw new ExternalServiceError('Docmee AI 智能布局失败', {
      taskId: input.taskId,
      aiLayout: aiLayoutResult.aiLayout.finalEventData,
      latestData: polledState?.latestData,
      convertResult: polledState?.convertResult,
      layoutState: mergedLayoutState,
    });
  }

  if (mergedLayoutState.isCompleted) {
    return {
      aiLayout: aiLayoutResult.aiLayout,
      latestData: polledState?.latestData ?? null,
      convertResult: polledState?.convertResult ?? null,
      latestDataError: polledState?.latestDataError ?? null,
      convertResultError: polledState?.convertResultError ?? null,
      layoutState: mergedLayoutState,
    };
  }

  if (pollError) {
    throw pollError;
  }

  throw new ExternalServiceError('Docmee AI 智能布局未在预期时间内完成', {
    taskId: input.taskId,
    aiLayout: aiLayoutResult.aiLayout.finalEventData,
    latestData: polledState?.latestData ?? null,
    latestDataError: polledState?.latestDataError ?? null,
    convertResult: polledState?.convertResult ?? null,
    convertResultError: polledState?.convertResultError ?? null,
    layoutState: mergedLayoutState,
  });
}

export function createPromptMetadata(config: AppConfig, resolvedPrompt: ResolvedSuperPptPrompt) {
  return {
    defaultPrompt: resolvedPrompt.defaultPrompt,
    effectivePrompt: resolvedPrompt.effectivePrompt,
    promptMaxLength: resolvedPrompt.promptMaxLength,
    isFallbackApplied: resolvedPrompt.isFallbackApplied,
    fallbackReason: resolvedPrompt.fallbackReason,
    docmeeBaseUrl: config.docmee.baseUrl,
  };
}
