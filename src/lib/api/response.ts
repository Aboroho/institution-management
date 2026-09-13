import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors/errors";
import { logger } from "@/lib/logging/logger";

export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status });
}

export function paginated<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  extraMeta?: Record<string, unknown>
) {
  return NextResponse.json({
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit), ...(extraMeta ?? {}) },
  });
}

export function fail(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status }
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: err.flatten(),
        },
      },
      { status: 422 }
    );
  }
  logger.error("unhandled api error", { err: String(err) });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong", details: null } },
    { status: 500 }
  );
}

export function parsePagination(search: URLSearchParams) {
  const page = Math.max(1, Number(search.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.get("limit") ?? 25) || 25));
  return { page, limit, skip: (page - 1) * limit };
}
