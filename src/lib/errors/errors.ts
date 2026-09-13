export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "APPROVAL_REQUIRED"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;
  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = (msg = "Authentication required") =>
  new AppError("UNAUTHORIZED", msg, 401);
export const forbidden = (msg = "You do not have access to this resource") =>
  new AppError("FORBIDDEN", msg, 403);
export const notFound = (msg = "Resource not found") =>
  new AppError("NOT_FOUND", msg, 404);
export const conflict = (msg = "Resource conflict", details?: unknown) =>
  new AppError("CONFLICT", msg, 409, details);
export const validationError = (msg = "Validation failed", details?: unknown) =>
  new AppError("VALIDATION_ERROR", msg, 422, details);
export const approvalRequired = (msg = "Admin approval required", details?: unknown) =>
  new AppError("APPROVAL_REQUIRED", msg, 403, details);
export const businessRule = (msg: string, details?: unknown) =>
  new AppError("BUSINESS_RULE", msg, 422, details);
