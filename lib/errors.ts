export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "POLICY_DENIED"
  | "LIMIT_EXCEEDED"
  | "INTEGRATION_ERROR"
  | "NOT_CONFIGURED"
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  POLICY_DENIED: 403,
  LIMIT_EXCEEDED: 429,
  INTEGRATION_ERROR: 502,
  NOT_CONFIGURED: 409,
  INTERNAL: 500,
};

/**
 * Expected, user-presentable error. `message` must be human readable — it is shown
 * in the UI and API responses. Unexpected errors are never shown verbatim.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { details?: Record<string, unknown>; fieldErrors?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.details = opts.details;
    this.fieldErrors = opts.fieldErrors;
  }

  get status() {
    return HTTP_STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (message = "You don't have permission to do that.") => new AppError("FORBIDDEN", message);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Converts any thrown value into a safe, presentable message. */
export function toSafeMessage(err: unknown): string {
  if (isAppError(err)) return err.message;
  return "Something went wrong. Please try again.";
}
