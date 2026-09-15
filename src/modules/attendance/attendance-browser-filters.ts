/**
 * Admin attendance browser (/admin/attendance) — filter logic.
 *
 * Deliberately free of React/SWR/fetch so the cascade rules can be unit tested
 * without a database or a browser (see
 * `src/tests/unit/attendance-browser-filters.test.ts`).
 *
 * Dependency model (follows the database relationships — Section and
 * CourseOffering carry the academic context FKs, and Semester is trade-scoped):
 *
 *   Academic Year ────────────────────────────┐
 *   Trade ──► Semester (trade-scoped) ────────┼──► Section ──► Course Offering
 *   Shift ────────────────────────────────────┘
 *
 * Year, trade and shift are independent roots. The semester list is narrowed by
 * the chosen trade, sections by the chosen roots, and offerings by the chosen
 * section plus the same roots. Nothing here invents values: every option comes
 * from the real API rows.
 */

export type Row = Record<string, unknown>;

/** Shape consumed by `SearchableSelect` in `@/components/ui`. */
export type FilterOption = { value: string; label: string; search: string };

/** One admin attendance browser selection ("" = not chosen / all). */
export type AttendanceContext = {
  academicYearId: string;
  tradeId: string;
  semesterId: string;
  shiftId: string;
  sectionId: string;
  offeringId: string;
};

export const EMPTY_ATTENDANCE_CONTEXT: AttendanceContext = {
  academicYearId: "",
  tradeId: "",
  semesterId: "",
  shiftId: "",
  sectionId: "",
  offeringId: "",
};

const str = (v: unknown) => String(v ?? "");

// ---------------------------------------------------------------- options

export function toYearOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}

/** Trade owns the semester list, so admins pick the trade before the semester. */
export function toTradeOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const name = str(r.name);
    const code = str(r.code);
    const label = code ? `${name} (${code})` : name;
    return { value: str(r.id), label, search: `${name} ${code}`.toLowerCase() };
  });
}

export function toSemesterOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const trade = r.trade as Row | undefined;
    const code = trade ? str(trade.code) : "";
    const label = code ? `${str(r.name)} (${code})` : str(r.name);
    return {
      value: str(r.id),
      label,
      search: `${str(r.name)} ${trade ? `${str(trade.name)} ${code}` : ""}`.toLowerCase(),
    };
  });
}

export function toShiftOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: `${label} ${str(r.code)}`.toLowerCase() };
  });
}

export function toSectionOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const sem = r.semester as Row | undefined;
    const shift = r.shift as Row | undefined;
    // Sections are often just named "A"/"B" — include semester + shift so
    // identically-named sections across contexts stay distinguishable.
    const label = `Section ${str(r.name)}${sem ? ` · ${str(sem.name)}` : ""}${shift ? ` · ${str(shift.name)}` : ""}`;
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}

export function toOfferingOptions(rows: Row[]): FilterOption[] {
  return rows.map((r) => {
    const course = r.course as Row | undefined;
    const label = `${str(course?.code)} — ${str(course?.title)}`;
    return {
      value: str(r.id),
      label,
      search: `${str(course?.code)} ${str(course?.title)}`.toLowerCase(),
    };
  });
}

// ---------------------------------------------------------------- queries

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `/semesters` (all trades) or `/semesters?tradeId=...` (that trade only). */
export function semestersPath(tradeId: string): string {
  return withQuery("/semesters", { tradeId: tradeId || undefined });
}

/**
 * Sections are filtered by every chosen root. A section always belongs to an
 * academic year, so no year means no section list (the chain is meaningless
 * without it) — callers should keep the control disabled.
 */
export function sectionsPath(ctx: AttendanceContext): string | null {
  if (!ctx.academicYearId) return null;
  return withQuery("/sections", {
    limit: 100,
    academicYearId: ctx.academicYearId,
    tradeId: ctx.tradeId,
    semesterId: ctx.semesterId,
    shiftId: ctx.shiftId,
  });
}

/** Offerings of the chosen section, narrowed by the same academic roots. */
export function offeringsPath(ctx: AttendanceContext): string | null {
  if (!ctx.sectionId) return null;
  return withQuery("/course-offerings", {
    limit: 100,
    academicYearId: ctx.academicYearId,
    tradeId: ctx.tradeId,
    semesterId: ctx.semesterId,
    shiftId: ctx.shiftId,
    sectionId: ctx.sectionId,
  });
}

// ------------------------------------------------------------- cascading

export type LoadedOptionLists = {
  /** `null`/`undefined` = the list has not loaded yet, so never clear because of it. */
  semesters?: FilterOption[] | null;
  sections?: FilterOption[] | null;
  offerings?: FilterOption[] | null;
};

export function hasOption(options: FilterOption[] | null | undefined, value: string): boolean {
  if (!options || !value) return false;
  return options.some((o) => o.value === value);
}

/**
 * Clears selections that are no longer valid for the freshly loaded lists.
 *
 * - a semester that does not belong to the selected trade,
 * - a section that is not in the (year/trade/semester/shift filtered) list,
 * - an offering that does not belong to the selected section.
 *
 * Returns the SAME object when nothing changed so React can bail out of a
 * re-render instead of looping on identity changes.
 */
export function pruneContext(ctx: AttendanceContext, lists: LoadedOptionLists): AttendanceContext {
  let next = ctx;
  const patch = (values: Partial<AttendanceContext>) => {
    next = { ...next, ...values };
  };

  if (ctx.semesterId && lists.semesters && !hasOption(lists.semesters, ctx.semesterId)) {
    patch({ semesterId: "" });
  }
  if (next.sectionId && lists.sections && !hasOption(lists.sections, next.sectionId)) {
    // The offering lives under the section, so it goes with it.
    patch({ sectionId: "", offeringId: "" });
  }
  if (next.offeringId && lists.offerings && !hasOption(lists.offerings, next.offeringId)) {
    patch({ offeringId: "" });
  }
  return next;
}

/**
 * Root change: the section chain is scoped to a single academic year, so
 * changing (or clearing) the year drops the selected section and its offering.
 */
export function withAcademicYear(ctx: AttendanceContext, academicYearId: string): AttendanceContext {
  if (academicYearId === ctx.academicYearId) return ctx;
  return { ...ctx, academicYearId, sectionId: "", offeringId: "" };
}

/**
 * Root change: picking a specific trade narrows the trade-owned semester list
 * and the sections under it, so those choices cannot be kept. Widening back to
 * "All trades" only grows the lists — `pruneContext` keeps whatever is valid.
 */
export function withTrade(ctx: AttendanceContext, tradeId: string): AttendanceContext {
  if (tradeId === ctx.tradeId) return ctx;
  if (!tradeId) return { ...ctx, tradeId };
  return { ...ctx, tradeId, semesterId: "", sectionId: "", offeringId: "" };
}

/** Section change: the offering is always scoped to one section. */
export function withSection(ctx: AttendanceContext, sectionId: string): AttendanceContext {
  if (sectionId === ctx.sectionId) return ctx;
  return { ...ctx, sectionId, offeringId: "" };
}
