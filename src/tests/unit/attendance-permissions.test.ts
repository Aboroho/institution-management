import { describe, it, expect } from "vitest";
import {
  canPerform,
  canViewSessions,
  canViewStudentData,
  canViewHistory,
  canTakeAttendance,
  canEditAttendance,
  canRequestChange,
  canApproveChange,
  canRejectChange,
  filterByRoll,
  type AttendanceAction,
  type AttendanceRole,
} from "@/modules/attendance/attendance.permissions";

/**
 * Attendance permission matrix (pure unit tests — no database).
 *
 *   Teacher takes and edits attendance. Admin does not take or directly edit
 *   attendance. Admin only monitors attendance and approves/rejects change
 *   requests when the teacher's edit quota has been reached.
 *
 * API routes implement the same matrix AND verify the teacher's active
 * assignment per offering (IDOR protection); the matrix itself is pinned here
 * so role regressions fail fast.
 */

const MATRIX: Record<AttendanceAction, Record<AttendanceRole, boolean>> = {
  viewSessions: { ADMIN: true, TEACHER: true, STUDENT: false },
  viewStudentData: { ADMIN: true, TEACHER: true, STUDENT: false },
  viewHistory: { ADMIN: true, TEACHER: true, STUDENT: false },
  takeAttendance: { ADMIN: false, TEACHER: true, STUDENT: false },
  editAttendance: { ADMIN: false, TEACHER: true, STUDENT: false },
  requestChange: { ADMIN: false, TEACHER: true, STUDENT: false },
  approveChange: { ADMIN: true, TEACHER: false, STUDENT: false },
  rejectChange: { ADMIN: true, TEACHER: false, STUDENT: false },
};

describe("Attendance permission matrix", () => {
  const actions = Object.keys(MATRIX) as AttendanceAction[];
  const roles: AttendanceRole[] = ["ADMIN", "TEACHER", "STUDENT"];

  for (const action of actions) {
    for (const role of roles) {
      it(`${role} ${MATRIX[action][role] ? "CAN" : "CANNOT"} ${action}`, () => {
        expect(canPerform(action, role)).toBe(MATRIX[action][role]);
      });
    }
  }

  it("unknown roles default to deny", () => {
    expect(canPerform("takeAttendance", "NOBODY" as AttendanceRole)).toBe(false);
    expect(canPerform("approveChange", "NOBODY" as AttendanceRole)).toBe(false);
  });
});

describe("Attendance permission helpers — key business rules", () => {
  it("admin can inspect but never take or edit", () => {
    expect(canViewSessions("ADMIN")).toBe(true);
    expect(canViewStudentData("ADMIN")).toBe(true);
    expect(canViewHistory("ADMIN")).toBe(true);
    expect(canTakeAttendance("ADMIN")).toBe(false);
    expect(canEditAttendance("ADMIN")).toBe(false);
  });

  it("assigned teacher can take/edit/request but never approve", () => {
    expect(canTakeAttendance("TEACHER")).toBe(true);
    expect(canEditAttendance("TEACHER")).toBe(true);
    expect(canRequestChange("TEACHER")).toBe(true);
    expect(canApproveChange("TEACHER")).toBe(false);
    expect(canRejectChange("TEACHER")).toBe(false);
  });

  it("only admin can approve/reject change requests", () => {
    expect(canApproveChange("ADMIN")).toBe(true);
    expect(canRejectChange("ADMIN")).toBe(true);
    expect(canApproveChange("STUDENT")).toBe(false);
    expect(canRejectChange("STUDENT")).toBe(false);
  });

  it("students have no attendance operational access", () => {
    expect(canTakeAttendance("STUDENT")).toBe(false);
    expect(canEditAttendance("STUDENT")).toBe(false);
    expect(canRequestChange("STUDENT")).toBe(false);
    expect(canApproveChange("STUDENT")).toBe(false);
  });
});

describe("Student Status roll filter (frontend-only)", () => {
  const rows = [
    { rollNumber: 1023, name: "Rahim" },
    { rollNumber: 1024, name: "Karim" },
    { rollNumber: 2111, name: "Hasan" },
    { rollNumber: null, name: "No roll" },
  ];

  it("returns everything on empty query", () => {
    expect(filterByRoll(rows, "")).toHaveLength(4);
    expect(filterByRoll(rows, "   ")).toHaveLength(4);
  });

  it("matches roll substrings", () => {
    expect(filterByRoll(rows, "1023").map((r) => r.name)).toEqual(["Rahim"]);
    expect(filterByRoll(rows, "102").map((r) => r.name)).toEqual(["Rahim", "Karim"]);
    expect(filterByRoll(rows, "11").map((r) => r.name)).toEqual(["Hasan"]);
  });

  it("is whitespace tolerant", () => {
    expect(filterByRoll(rows, "  1024 ").map((r) => r.name)).toEqual(["Karim"]);
  });

  it("excludes rows without a roll when filtering", () => {
    expect(filterByRoll(rows, "1").map((r) => r.name)).toEqual(["Rahim", "Karim", "Hasan"]);
  });

  it("does not mutate the underlying list", () => {
    const before = [...rows];
    filterByRoll(rows, "102");
    expect(rows).toEqual(before);
  });
});
