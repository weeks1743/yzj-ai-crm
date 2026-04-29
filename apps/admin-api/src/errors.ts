export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_INVALID', 500, details);
  }
}

export class YzjApiError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'YZJ_API_ERROR', 502, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'BAD_REQUEST', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', 404, details);
  }
}

export class SyncAlreadyRunningError extends AppError {
  constructor(runId?: string) {
    super('已有同步进行中', 'SYNC_ALREADY_RUNNING', 409, runId ? { runId } : undefined);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'SERVICE_UNAVAILABLE', 503, details);
  }
}

export class ExternalSkillProviderError extends AppError {
  constructor(message: string, statusCode = 502, details?: unknown) {
    super(message, 'EXTERNAL_SKILL_PROVIDER_ERROR', statusCode, details);
  }
}

export interface ErrorDebugInfo {
  name?: string;
  message: string;
  code?: string;
  statusCode?: number;
  detailsSummary: string[];
  details?: unknown;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误';
}

export function buildErrorDebugInfo(error: unknown): ErrorDebugInfo {
  const appError = error instanceof AppError ? error : null;
  const details = appError?.details !== undefined
    ? sanitizeDebugValue(appError.details)
    : undefined;

  return {
    name: error instanceof Error ? error.name : undefined,
    message: getErrorMessage(error),
    code: appError?.code,
    statusCode: appError?.statusCode,
    detailsSummary: summarizeDebugDetails(details),
    ...(details !== undefined ? { details } : {}),
  };
}

export function formatErrorDebugSummary(info: ErrorDebugInfo): string {
  return [
    info.code ? `code=${info.code}` : '',
    typeof info.statusCode === 'number' ? `statusCode=${info.statusCode}` : '',
    ...info.detailsSummary,
  ].filter(Boolean).join('；');
}

function summarizeDebugDetails(details: unknown): string[] {
  if (!details || typeof details !== 'object') {
    return [];
  }

  const record = details as Record<string, unknown>;
  const payload = readObject(record.payload) ?? record;
  const payloadData = readObject(payload.data);
  const summaries: string[] = [];

  pushScalarSummary(summaries, 'http', record.status);
  pushScalarSummary(summaries, 'success', payload.success);
  pushScalarSummary(summaries, 'errorCode', payload.errorCode ?? payload.code);
  pushScalarSummary(summaries, 'message', payload.message ?? payload.msg ?? payload.errorMsg ?? payload.error);
  pushScalarSummary(summaries, 'text', record.text);

  if (payloadData) {
    pushScalarSummary(summaries, 'hasException', payloadData.hasException);
    if (Array.isArray(payloadData.formInstIds)) {
      summaries.push(`formInstIds=${payloadData.formInstIds.map((item) => item ?? 'null').join(',')}`);
    }
    const exceptions = readObject(payloadData.exceptions);
    if (exceptions) {
      for (const [key, value] of Object.entries(exceptions).slice(0, 8)) {
        summaries.push(`exception[${key}]=${formatSummaryValue(value)}`);
      }
    }
  }

  for (const key of ['missingRequiredParams', 'blockedReadonlyParams', 'missingRuntimeInputs', 'validationErrors']) {
    const value = record[key];
    if (Array.isArray(value) && value.length) {
      summaries.push(`${key}=${value.map(formatSummaryValue).join(',')}`);
    }
  }

  return summaries.filter(Boolean);
}

function pushScalarSummary(summaries: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    summaries.push(`${label}=${formatSummaryValue(value)}`);
  }
}

function formatSummaryValue(value: unknown): string {
  if (value === undefined || value === null) {
    return String(value);
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizeDebugValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key)) {
    return maskSensitiveValue(value);
  }
  if (depth >= 6) {
    return '[MaxDepth]';
  }
  if (typeof value === 'string') {
    return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDebugValue(item, key, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 80)) {
      output[childKey] = sanitizeDebugValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  return /(secret|token|access.?token|authorization|password|api.?key|sign.?key)/i.test(key);
}

function maskSensitiveValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) {
    return '***';
  }
  return text.length <= 8 ? '***' : `${text.slice(0, 3)}***${text.slice(-3)}`;
}
