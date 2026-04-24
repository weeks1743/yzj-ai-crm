export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { cause?: unknown; details?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, 'CONFIG_ERROR', message, { details });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(404, 'NOT_FOUND', message, { details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, { details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, details?: unknown) {
    super(403, 'FORBIDDEN', message, { details });
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'EXTERNAL_SERVICE_ERROR', message, { details });
  }
}
