/**
 * Course-offering "context" code — the single, app-wide human-readable
 * identifier for a CourseOffering.
 *
 * Format (all parts joined with "-"):
 *
 *   {course_name}-{trade_code}-{semester_number}-{shift_first_letter}-{section_name}
 *
 * Example:
 *
 *   Digital Electronics-EC-2-M-A
 *
 * Rules:
 * - `context` is a DISPLAY identifier only. It is computed from the related
 *   entities (Course, Trade, Semester, Shift, Section) and is NEVER stored as
 *   the CourseOffering ID. The generated CourseOffering `id` remains the
 *   database identifier; UI code must never construct or submit IDs from the
 *   context string.
 * - Because it is derived from related entities it is always consistent with
 *   them — no manual entry, no second copy to keep in sync.
 *
 * This module is pure (no server dependencies) so it is imported by both the
 * API layer (which adds `context` + `available` to offering payloads) and the
 * React components that render the code.
 */

export interface OfferingContextSource {
  course?: { title?: string | null } | null;
  trade?: { code?: string | null } | null;
  semester?: { number?: number | null; name?: string | null } | null;
  shift?: { name?: string | null } | null;
  section?: { name?: string | null } | null;
  [key: string]: unknown;
}

function part(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Compute the context code for a course offering row.
 * Accepts any row shape that carries the related entities (API payloads,
 * Prisma `include` results, option rows, ...). Missing parts are skipped so
 * partially-loaded rows still produce a stable prefix.
 */
export function offeringContextCode(offering: OfferingContextSource | null | undefined): string {
  const courseName = part(offering?.course?.title);
  const tradeCode = part(offering?.trade?.code);
  const semesterNumber = part(offering?.semester?.number);
  const shiftFirstLetter = part(offering?.shift?.name).charAt(0).toUpperCase();
  const sectionName = part(offering?.section?.name);
  return [courseName, tradeCode, semesterNumber, shiftFirstLetter, sectionName].filter(Boolean).join("-");
}

/**
 * Whether an offering is AVAILABLE for new operations (teacher assignment,
 * substitution, schedules, ...).
 *
 * Availability is DERIVED from the existing data model — not duplicated:
 *   available = offering.isActive AND academicYear.isActive
 *
 * An offering whose Academic Year has been deactivated is never available,
 * even if the offering's own flag is still true. Historical data on such
 * offerings stays fully readable; only new operations are blocked (enforced
 * server-side in the assignment services).
 *
 * If the academic year was not loaded on this payload, the offering's own
 * flag is the only signal we have and is returned as-is (the backend always
 * re-checks the year before performing an operation).
 */
export function offeringAvailable(offering: OfferingContextSource | null | undefined): boolean {
  if (!offering || offering.isActive === false) return false;
  const year = offering.academicYear as { isActive?: boolean | null } | null | undefined;
  if (year && typeof year.isActive === "boolean") return year.isActive;
  return offering.isActive !== false;
}

/**
 * Add the derived `context` and `available` fields to an offering row.
 * Used by service functions so every API response that returns course
 * offerings exposes the same fields.
 */
export function withOfferingContext<T extends OfferingContextSource>(offering: T): T & {
  context: string;
  available: boolean;
} {
  return {
    ...offering,
    context: offeringContextCode(offering),
    available: offeringAvailable(offering),
  };
}
