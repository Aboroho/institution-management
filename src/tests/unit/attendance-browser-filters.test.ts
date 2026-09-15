import { describe, expect, it } from "vitest";
import {
  EMPTY_ATTENDANCE_CONTEXT,
  hasOption,
  offeringsPath,
  pruneContext,
  sectionsPath,
  semestersPath,
  toOfferingOptions,
  toSectionOptions,
  toSemesterOptions,
  toTradeOptions,
  withAcademicYear,
  withSection,
  withTrade,
  type AttendanceContext,
  type FilterOption,
} from "@/modules/attendance/attendance-browser-filters";

/**
 * Admin attendance browser (/admin/attendance) — the trade select and the
 * dependent cascade it drives.
 *
 * `Semester` is trade-scoped in the database, and `Section`/`CourseOffering`
 * carry the academic context FKs. These pure tests pin the rules without a
 * database:
 *   - the trade list comes from GET /trades,
 *   - the semester list is narrowed by the chosen trade,
 *   - sections/offerings are narrowed by all chosen roots,
 *   - selections that stop being valid are cleared (never left stale).
 */

const option = (value: string, label = value): FilterOption => ({ value, label, search: label.toLowerCase() });

const ctx = (overrides: Partial<AttendanceContext> = {}): AttendanceContext => ({
  ...EMPTY_ATTENDANCE_CONTEXT,
  ...overrides,
});

describe("Admin attendance browser — option builders", () => {
  it("labels trades with their code and searches name + code", () => {
    const [cse] = toTradeOptions([{ id: "t1", name: "Computer Science", code: "CSE" }]);
    expect(cse.value).toBe("t1");
    expect(cse.label).toBe("Computer Science (CSE)");
    expect(cse.search).toContain("computer science");
    expect(cse.search).toContain("cse");
  });

  it("keeps the trade code on semester labels", () => {
    const [sem] = toSemesterOptions([
      { id: "s1", name: "Semester 1", trade: { id: "t1", name: "Computer Science", code: "CSE" } },
    ]);
    expect(sem.label).toBe("Semester 1 (CSE)");
    expect(sem.search).toContain("computer science");
  });

  it("disambiguates identically-named sections across contexts", () => {
    const [sec] = toSectionOptions([
      { id: "sec1", name: "A", semester: { name: "Semester 1" }, shift: { name: "Morning" } },
    ]);
    expect(sec.label).toBe("Section A · Semester 1 · Morning");
  });

  it("labels offerings with course code + title", () => {
    const [off] = toOfferingOptions([
      { id: "o1", course: { code: "CSE-101", title: "Digital Electronics" } },
    ]);
    expect(off.label).toBe("CSE-101 — Digital Electronics");
    expect(off.search).toContain("digital electronics");
  });

  it("never leaks 'undefined' into labels when relations are missing", () => {
    expect(toSemesterOptions([{ id: "s1", name: "Semester 1" }])[0].label).toBe("Semester 1");
    expect(toSectionOptions([{ id: "sec1", name: "A" }])[0].label).toBe("Section A");
    expect(toOfferingOptions([{ id: "o1" }])[0].label).not.toContain("undefined");
    expect(toTradeOptions([{ id: "t1", name: "Computer Science" }])[0].label).toBe("Computer Science");
  });
});

describe("Admin attendance browser — dependent query paths", () => {
  it("lists every semester when no trade is chosen", () => {
    expect(semestersPath("")).toBe("/semesters");
  });

  it("narrows the semester list to the chosen trade", () => {
    expect(semestersPath("t1")).toBe("/semesters?tradeId=t1");
  });

  it("requires an academic year before listing sections", () => {
    expect(sectionsPath(EMPTY_ATTENDANCE_CONTEXT)).toBeNull();
    expect(sectionsPath(ctx({ tradeId: "t1" }))).toBeNull();
  });

  it("narrows sections by every chosen root", () => {
    const path = sectionsPath(
      ctx({ academicYearId: "y1", tradeId: "t1", semesterId: "s1", shiftId: "sh1" }),
    );
    expect(path).toBe("/sections?limit=100&academicYearId=y1&tradeId=t1&semesterId=s1&shiftId=sh1");
  });

  it("omits empty roots instead of sending blank filters", () => {
    expect(sectionsPath(ctx({ academicYearId: "y1", shiftId: "sh1" }))).toBe(
      "/sections?limit=100&academicYearId=y1&shiftId=sh1",
    );
  });

  it("requires a section before listing offerings", () => {
    expect(offeringsPath(ctx({ academicYearId: "y1", tradeId: "t1" }))).toBeNull();
  });

  it("narrows offerings by the section plus the academic roots", () => {
    const path = offeringsPath(
      ctx({ academicYearId: "y1", tradeId: "t1", semesterId: "s1", shiftId: "sh1", sectionId: "sec1" }),
    );
    expect(path).toBe(
      "/course-offerings?limit=100&academicYearId=y1&tradeId=t1&semesterId=s1&shiftId=sh1&sectionId=sec1",
    );
  });
});

describe("Admin attendance browser — cascade invalidation", () => {
  it("keeps the trade-scoped semester when it belongs to the selected trade", () => {
    const current = ctx({ tradeId: "t1", semesterId: "s1" });
    const next = pruneContext(current, { semesters: [option("s1"), option("s2")] });
    expect(next).toBe(current); // same reference → no re-render loop
    expect(next.semesterId).toBe("s1");
  });

  it("clears a semester that does not belong to the selected trade", () => {
    const next = pruneContext(ctx({ tradeId: "t2", semesterId: "s1" }), {
      semesters: [option("s2")],
    });
    expect(next.semesterId).toBe("");
    expect(next.tradeId).toBe("t2");
  });

  it("clears a section (and its offering) that is no longer in the filtered list", () => {
    const next = pruneContext(ctx({ academicYearId: "y1", sectionId: "sec1", offeringId: "o1" }), {
      sections: [option("sec2")],
    });
    expect(next.sectionId).toBe("");
    expect(next.offeringId).toBe("");
  });

  it("clears an offering that does not belong to the selected section", () => {
    const next = pruneContext(ctx({ sectionId: "sec1", offeringId: "o1" }), {
      sections: [option("sec1")],
      offerings: [option("o2")],
    });
    expect(next.sectionId).toBe("sec1");
    expect(next.offeringId).toBe("");
  });

  it("never clears anything while a list is still loading (null)", () => {
    const current = ctx({ tradeId: "t1", semesterId: "s1", sectionId: "sec1", offeringId: "o1" });
    const next = pruneContext(current, { semesters: null, sections: null, offerings: null });
    expect(next).toBe(current);
  });

  it("treats an empty (but loaded) list as authoritative", () => {
    const next = pruneContext(ctx({ sectionId: "sec1", offeringId: "o1" }), {
      sections: [],
      offerings: [],
    });
    expect(next.sectionId).toBe("");
    expect(next.offeringId).toBe("");
  });

  it("hasOption ignores blank values", () => {
    expect(hasOption([option("a")], "")).toBe(false);
    expect(hasOption(null, "a")).toBe(false);
    expect(hasOption([option("a")], "a")).toBe(true);
  });
});

describe("Admin attendance browser — root selections", () => {
  it("picking another trade drops semester, section and offering (all trade-scoped)", () => {
    const current = ctx({ academicYearId: "y1", tradeId: "t1", semesterId: "s1", sectionId: "sec1", offeringId: "o1" });
    const switched = withTrade(current, "t2");
    expect(switched.tradeId).toBe("t2");
    expect(switched.semesterId).toBe("");
    expect(switched.sectionId).toBe("");
    expect(switched.offeringId).toBe("");
    // roots that are independent of the trade survive
    expect(switched.academicYearId).toBe("y1");
  });

  it("widening back to 'All trades' keeps the selection for pruneContext to judge", () => {
    const current = ctx({ tradeId: "t1", semesterId: "s1", sectionId: "sec1", offeringId: "o1" });
    expect(withTrade(current, "")).toEqual({ ...current, tradeId: "" });
  });

  it("re-selecting the same trade is a no-op (same reference)", () => {
    const current = ctx({ tradeId: "t1" });
    expect(withTrade(current, "t1")).toBe(current);
  });

  it("changing the academic year clears the section chain (a section belongs to one year)", () => {
    const switched = withAcademicYear(ctx({ academicYearId: "y1", sectionId: "sec1", offeringId: "o1" }), "y2");
    expect(switched.academicYearId).toBe("y2");
    expect(switched.sectionId).toBe("");
    expect(switched.offeringId).toBe("");
  });

  it("clearing the academic year clears the section chain too", () => {
    const switched = withAcademicYear(ctx({ academicYearId: "y1", sectionId: "sec1", offeringId: "o1" }), "");
    expect(switched.academicYearId).toBe("");
    expect(switched.sectionId).toBe("");
    expect(switched.offeringId).toBe("");
  });

  it("changing the section clears the offering below it", () => {
    const switched = withSection(ctx({ sectionId: "sec1", offeringId: "o1" }), "sec2");
    expect(switched.sectionId).toBe("sec2");
    expect(switched.offeringId).toBe("");
  });
});
