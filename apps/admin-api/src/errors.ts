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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误';
}
