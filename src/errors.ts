export type ClawSDKErrorOptions = {
  code?: string;
  status?: number;
  method?: string;
  path?: string;
  field?: string;
  details?: unknown;
  cause?: unknown;
};

/**
 * Base SDK error. Consumers can catch this once and still inspect route,
 * HTTP status, validation field, and raw sandbox details when present.
 */
export class ClawSDKError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly method?: string;
  readonly path?: string;
  readonly field?: string;
  readonly details?: unknown;

  constructor(message: string, options: ClawSDKErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ClawSDKError";
    this.code = options.code ?? "CLAW_SDK_ERROR";
    this.status = options.status;
    this.method = options.method;
    this.path = options.path;
    this.field = options.field;
    this.details = options.details;
  }
}

export class ClawValidationError extends ClawSDKError {
  constructor(message: string, options: ClawSDKErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? "CLAW_VALIDATION_ERROR",
    });
    this.name = "ClawValidationError";
  }
}

export function getErrorMessage(error: unknown, response?: Response): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
  }
  return response?.statusText || "Unknown error";
}

export function createSandboxError(
  action: string,
  response: Response,
  error: unknown,
  options: Pick<ClawSDKErrorOptions, "method" | "path"> = {},
): ClawSDKError {
  return new ClawSDKError(`${action} (${response.status}): ${getErrorMessage(error, response)}`, {
    code: "CLAW_SANDBOX_ERROR",
    status: response.status,
    method: options.method,
    path: options.path,
    details: error,
  });
}

export async function createHttpError(
  action: string,
  response: Response,
  options: Pick<ClawSDKErrorOptions, "method" | "path"> = {},
): Promise<ClawSDKError> {
  let details: unknown;
  try {
    details = await response.text();
  } catch {
    details = response.statusText;
  }
  return new ClawSDKError(`${action} (${response.status}): ${getErrorMessage(details, response)}`, {
    code: "CLAW_HTTP_ERROR",
    status: response.status,
    method: options.method,
    path: options.path,
    details,
  });
}
