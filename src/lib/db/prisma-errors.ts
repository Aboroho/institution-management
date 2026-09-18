/**
 * Narrow helpers for interpreting Prisma errors without leaking driver internals to
 * the client. Used to turn unique-constraint races into a friendly conflict instead
 * of a 500.
 */

export function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Fields reported by a P2002 (unique constraint) error, e.g. ["email"]. */
export function uniqueConstraintFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return typeof target === "string" ? [target] : [];
}

/**
 * True when the failure is a unique-constraint violation. When `field` is given the
 * constraint must name that field (or, when the driver omits the target, we still
 * treat a P2002 as a duplicate so callers can surface a plain "already in use").
 */
export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  if (prismaErrorCode(error) !== "P2002") return false;
  if (!field) return true;
  const fields = uniqueConstraintFields(error);
  return fields.length === 0 || fields.includes(field);
}

/** True for a foreign-key/restrict violation (P2003): a dependent record exists. */
export function isForeignKeyConstraintError(error: unknown): boolean {
  return prismaErrorCode(error) === "P2003";
}
