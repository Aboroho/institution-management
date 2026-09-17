// Pure dependent-filter logic for the admin Attendance Report
// (/admin/attendance). No React / no Prisma imports so unit tests can pin the
// behaviour without a database.
//
// The chain mirrors the database relationships (see prisma/schema.prisma):
//
//   AcademicYear ─┐
//   Trade ────────┤
//   Semester ─────┼──► Section ──► CourseOffering ──► AttendanceSession
//   Shift ────────┘
//
//   Semester.tradeId            -> Trade
//   Section.{academicYearId, tradeId, semesterId, shiftId}
//   CourseOffering.{academicYearId, tradeId, semesterId, shiftId, sectionId}
//
// A child selector is only *ready* once every value it depends on is selected;
// changing a parent clears the child (and everything below it) so a stale
// selection can never be submitted.

import { applyDependentChange } from "@/lib/filters/filter-defaults";

export type AttendanceFilterField =
  | "academicYearId"
  | "tradeId"
  | "semesterId"
  | "shiftId"
  | "sectionId"
  | "courseOfferingId";

/** The order the selectors are rendered in. */
export const ATTENDANCE_FILTER_ORDER: readonly AttendanceFilterField[] = [
  "academicYearId",
  "tradeId",
  "semesterId",
  "shiftId",
  "sectionId",
  "courseOfferingId",
] as const;

/**
 * child field -> parent fields it depends on (same shape as
 * `ACADEMIC_DEPENDENCIES` in `@/lib/filters/filter-defaults`).
 */
export const ATTENDANCE_FILTER_DEPENDENCIES: Record<string, string[]> = {
  academicYearId: [],
  tradeId: [],
  // A semester belongs to a trade.
  semesterId: ["tradeId"],
  // Shifts are global.
  shiftId: [],
  // A section is identified by academic year + trade + semester + shift.
  sectionId: ["academicYearId", "tradeId", "semesterId", "shiftId"],
  // An offering belongs to exactly one section + context.
  courseOfferingId: ["sectionId", "academicYearId", "tradeId", "semesterId", "shiftId"],
};

export type AttendanceFilterContext = Record<AttendanceFilterField, string>;

export function emptyAttendanceFilterContext(): AttendanceFilterContext {
  return {
    academicYearId: "",
    tradeId: "",
    semesterId: "",
    shiftId: "",
    sectionId: "",
    courseOfferingId: "",
  };
}

/** Parents that must be selected before `field` can be chosen. */
export function attendanceFilterPrerequisites(field: AttendanceFilterField): AttendanceFilterField[] {
  switch (field) {
    case "semesterId":
      return ["tradeId"];
    case "sectionId":
      return ["academicYearId", "tradeId", "semesterId", "shiftId"];
    case "courseOfferingId":
      return ["sectionId"];
    default:
      return [];
  }
}

/** Whether every dependency of `field` is currently selected. */
export function isAttendanceFilterReady(ctx: AttendanceFilterContext, field: AttendanceFilterField): boolean {
  return attendanceFilterPrerequisites(field).every((parent) => Boolean(ctx[parent]));
}

/** "Select trade first", "No sections available for this selection", ... */
export function attendanceFilterDisabledHint(ctx: AttendanceFilterContext, field: AttendanceFilterField): string | null {
  const missing = attendanceFilterPrerequisites(field).filter((parent) => !ctx[parent]);
  if (missing.length === 0) return null;
  const labels = missing.map((f) => ATTENDANCE_FILTER_LABELS[f].toLowerCase());
  return `Select ${labels.join(", ")} first`;
}

/**
 * Apply a selector change, clearing every dependent selector. Values that are
 * unchanged keep their dependents (so re-selecting the same value is a no-op).
 */
export function applyAttendanceFilterChange(
  ctx: AttendanceFilterContext,
  field: AttendanceFilterField,
  value: string,
): AttendanceFilterContext {
  const next: AttendanceFilterContext = applyDependentChange(ctx, field, value, ATTENDANCE_FILTER_DEPENDENCIES);
  // Guard: a cleared parent must never leave a dependent set behind, even if a
  // caller passes a dependency map that misses a level.
  if (!value) {
    for (const dependent of attendanceDependentFields(field)) next[dependent] = "";
  }
  return next;
}

/** Every field that must be cleared when `field` changes (transitive). */
export function attendanceDependentFields(field: AttendanceFilterField): AttendanceFilterField[] {
  const out = new Set<AttendanceFilterField>();
  const queue: AttendanceFilterField[] = [field];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const candidate of ATTENDANCE_FILTER_ORDER) {
      if (out.has(candidate)) continue;
      if (ATTENDANCE_FILTER_DEPENDENCIES[candidate].includes(current)) {
        out.add(candidate);
        queue.push(candidate);
      }
    }
  }
  return ATTENDANCE_FILTER_ORDER.filter((f) => out.has(f));
}

/** True once an academic context + section is fully selected. */
export function isAttendanceSectionReady(ctx: AttendanceFilterContext): boolean {
  return isAttendanceFilterReady(ctx, "sectionId") && Boolean(ctx.sectionId);
}

export const ATTENDANCE_FILTER_LABELS: Record<AttendanceFilterField, string> = {
  academicYearId: "Academic Year",
  tradeId: "Trade",
  semesterId: "Semester",
  shiftId: "Shift",
  sectionId: "Section",
  courseOfferingId: "Course Offering",
};

/**
 * Query string parameters for `GET /course-offerings` for the current context.
 * Components must not build offering IDs by hand — they pass this to the API
 * so the options always match the selected filters.
 */
export function attendanceOfferingQuery(ctx: AttendanceFilterContext): Record<string, string> {
  const params: Record<string, string> = {};
  if (ctx.academicYearId) params.academicYearId = ctx.academicYearId;
  if (ctx.tradeId) params.tradeId = ctx.tradeId;
  if (ctx.semesterId) params.semesterId = ctx.semesterId;
  if (ctx.shiftId) params.shiftId = ctx.shiftId;
  if (ctx.sectionId) params.sectionId = ctx.sectionId;
  return params;
}
