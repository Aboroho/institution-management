import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_FILTER_ORDER,
  attendanceDependentFields,
  attendanceFilterDisabledHint,
  attendanceFilterPrerequisites,
  attendanceOfferingQuery,
  applyAttendanceFilterChange,
  emptyAttendanceFilterContext,
  isAttendanceFilterReady,
  isAttendanceSectionReady,
  type AttendanceFilterContext,
} from "@/modules/attendance/attendance.filters";

/**
 * Admin Attendance Report (/admin/attendance) dependent filters.
 *
 * Chain: Academic Year -> Trade -> Semester -> Shift -> Section -> Course Offering.
 * These rules are derived from the Prisma schema relations
 * (Semester.tradeId; Section.{academicYearId,tradeId,semesterId,shiftId};
 * CourseOffering -> Section) and the tests pin them so the UI can never submit
 * a stale/mismatched academic context.
 */

function ctx(overrides: Partial<AttendanceFilterContext> = {}): AttendanceFilterContext {
  return { ...emptyAttendanceFilterContext(), ...overrides };
}

const FULL = ctx({
  academicYearId: "y1",
  tradeId: "t1",
  semesterId: "s1",
  shiftId: "sh1",
  sectionId: "sec1",
  courseOfferingId: "off1",
});

describe("attendance filter chain — order and prerequisites", () => {
  it("renders the selectors in dependency order", () => {
    expect(ATTENDANCE_FILTER_ORDER).toEqual([
      "academicYearId",
      "tradeId",
      "semesterId",
      "shiftId",
      "sectionId",
      "courseOfferingId",
    ]);
  });

  it("requires a trade before a semester", () => {
    expect(attendanceFilterPrerequisites("semesterId")).toEqual(["tradeId"]);
  });

  it("requires the full academic context before a section", () => {
    expect(attendanceFilterPrerequisites("sectionId")).toEqual([
      "academicYearId",
      "tradeId",
      "semesterId",
      "shiftId",
    ]);
  });

  it("requires a section before a course offering", () => {
    expect(attendanceFilterPrerequisites("courseOfferingId")).toEqual(["sectionId"]);
  });

  it("gates readiness on every prerequisite being selected", () => {
    expect(isAttendanceFilterReady(ctx({ tradeId: "t1" }), "semesterId")).toBe(true);
    expect(isAttendanceFilterReady(ctx(), "semesterId")).toBe(false);

    const partial = ctx({ academicYearId: "y1", tradeId: "t1", semesterId: "s1" });
    expect(isAttendanceFilterReady(partial, "sectionId")).toBe(false);
    expect(isAttendanceFilterReady({ ...partial, shiftId: "sh1" }, "sectionId")).toBe(true);
    expect(isAttendanceSectionReady(partial)).toBe(false);
    expect(isAttendanceSectionReady({ ...partial, shiftId: "sh1", sectionId: "sec1" })).toBe(true);
  });

  it("explains what is missing when a selector is disabled", () => {
    expect(attendanceFilterDisabledHint(ctx(), "sectionId")).toBe(
      "Select academic year, trade, semester, shift first",
    );
    expect(attendanceFilterDisabledHint(ctx({ sectionId: "sec1" }), "courseOfferingId")).toBeNull();
  });
});

describe("attendance filter chain — stale selections are cleared", () => {
  it("changing academic year clears the section and offering", () => {
    const next = applyAttendanceFilterChange(FULL, "academicYearId", "y2");
    expect(next.academicYearId).toBe("y2");
    expect(next.tradeId).toBe("t1");
    expect(next.semesterId).toBe("s1");
    expect(next.shiftId).toBe("sh1");
    expect(next.sectionId).toBe("");
    expect(next.courseOfferingId).toBe("");
  });

  it("changing trade clears semester, section and offering", () => {
    const next = applyAttendanceFilterChange(FULL, "tradeId", "t2");
    expect(next).toMatchObject({ tradeId: "t2", semesterId: "", sectionId: "", courseOfferingId: "" });
  });

  it("changing semester clears section and offering", () => {
    const next = applyAttendanceFilterChange(FULL, "semesterId", "s2");
    expect(next).toMatchObject({ semesterId: "s2", sectionId: "", courseOfferingId: "" });
  });

  it("changing shift clears section and offering", () => {
    const next = applyAttendanceFilterChange(FULL, "shiftId", "sh2");
    expect(next).toMatchObject({ shiftId: "sh2", sectionId: "", courseOfferingId: "" });
  });

  it("changing section clears the offering", () => {
    const next = applyAttendanceFilterChange(FULL, "sectionId", "sec2");
    expect(next).toMatchObject({ sectionId: "sec2", courseOfferingId: "" });
  });

  it("clearing a parent clears every dependent value", () => {
    const next = applyAttendanceFilterChange(FULL, "tradeId", "");
    expect(next.tradeId).toBe("");
    expect(next.semesterId).toBe("");
    expect(next.sectionId).toBe("");
    expect(next.courseOfferingId).toBe("");
  });

  it("re-selecting the same value keeps dependents (no accidental reset)", () => {
    const next = applyAttendanceFilterChange(FULL, "tradeId", "t1");
    expect(next).toEqual(FULL);
  });

  it("only changes the selected field when it has no dependents", () => {
    const next = applyAttendanceFilterChange(FULL, "courseOfferingId", "off2");
    expect(next.courseOfferingId).toBe("off2");
    expect(next.sectionId).toBe("sec1");
  });

  it("lists dependents transitively", () => {
    expect(attendanceDependentFields("tradeId")).toEqual(["semesterId", "sectionId", "courseOfferingId"]);
    expect(attendanceDependentFields("sectionId")).toEqual(["courseOfferingId"]);
    expect(attendanceDependentFields("courseOfferingId")).toEqual([]);
  });
});

describe("attendance filter chain — offering options come from the backend", () => {
  it("forwards only the currently selected context to the API", () => {
    expect(attendanceOfferingQuery(FULL)).toEqual({
      academicYearId: "y1",
      tradeId: "t1",
      semesterId: "s1",
      shiftId: "sh1",
      sectionId: "sec1",
    });
    expect(attendanceOfferingQuery(ctx({ sectionId: "sec1" }))).toEqual({ sectionId: "sec1" });
    expect(attendanceOfferingQuery(emptyAttendanceFilterContext())).toEqual({});
  });

  it("never exposes a manually built offering id", () => {
    // The query helper only returns filter parameters — course offering ids are
    // always produced by the API and selected by the user.
    expect(Object.keys(attendanceOfferingQuery(FULL))).not.toContain("courseOfferingId");
  });
});
