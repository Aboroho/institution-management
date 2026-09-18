import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The state the Take Attendance page renders for one CourseOffering + date.
 *
 * Pinned here (service level, with a fake Prisma) because this payload is what
 * decides between "show the create form" and "show the recorded attendance":
 *
 *   - no session            -> null  (the page must render the taking UI)
 *   - existing session      -> roster + summary + authoritative permissions +
 *                              the entry's single pending request
 *   - roster completeness   -> the whole ACTIVE section, NOT students that
 *                              merely happen to have a record (a student
 *                              enrolled after the save shows as NOT_MARKED)
 *   - roll scoping          -> StudentEnrollment is filtered by the FULL
 *                              academic context, never `sectionId` alone
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    attendanceSession: { findUnique: vi.fn() },
    attendanceChangeRequest: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import {
  buildAttendanceRoster,
  computeAttendancePermissions,
  getSessionForAttendanceEditor,
  getSessionRoster,
} from "@/modules/attendance/attendance.service";

const OFFERING = {
  id: "off-1",
  academicYearId: "year-1",
  tradeId: "trade-1",
  semesterId: "sem-1",
  shiftId: "shift-1",
  sectionId: "sec-1",
  course: { title: "Intro to CS", code: "CSC101" },
  section: { name: "A" },
  semester: { name: "Semester 1" },
  trade: { name: "Computer", code: "CSE" },
  shift: { name: "Morning" },
  academicYear: { name: "2026-27" },
};

const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    courseOfferingId: "off-1",
    attendanceDate: today(),
    updateCount: 0,
    note: null,
    createdById: "u-teacher",
    courseOffering: OFFERING,
    records: [
      { id: "rec-1", studentId: "stu-1", status: "PRESENT", note: null, directCorrections: 0, student: { id: "stu-1", studentId: "R1", user: { name: "Rahim", email: "r@school" } } },
      { id: "rec-2", studentId: "stu-2", status: "ABSENT", note: "Sick", directCorrections: 0, student: { id: "stu-2", studentId: "R2", user: { name: "Karim", email: "k@school" } } },
    ],
    ...overrides,
  };
}

const ENROLLMENTS = [
  { rollNumber: 1, student: { id: "stu-1", studentId: "R1", user: { name: "Rahim", email: "r@school" } } },
  { rollNumber: 2, student: { id: "stu-2", studentId: "R2", user: { name: "Karim", email: "k@school" } } },
  // Enrolled after the entry was saved: no AttendanceRecord exists for them.
  { rollNumber: 3, student: { id: "stu-3", studentId: "R3", user: { name: "Ayna", email: "a@school" } } },
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.studentEnrollment.findMany.mockResolvedValue(ENROLLMENTS);
  prismaMock.attendanceChangeRequest.findFirst.mockResolvedValue(null);
});

describe("getSessionForAttendanceEditor — recorded attendance is served, not linked", () => {
  it("returns null when no session exists, so the page shows the taking form", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(null);

    await expect(getSessionForAttendanceEditor("off-1", today())).resolves.toBeNull();
  });

  it("returns the recorded statuses, roll numbers and summary for the date", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow());

    const entry = await getSessionForAttendanceEditor("off-1", today());

    expect(entry).toMatchObject({
      id: "sess-1",
      courseOfferingId: "off-1",
      updateCount: 0,
      summary: { total: 2, present: 1, absent: 1, late: 0, excused: 0 },
    });
    expect(entry?.roster).toHaveLength(3);
    expect(entry?.roster[0]).toMatchObject({ rollNumber: 1, studentName: "Rahim", status: "PRESENT", hasRecord: true });
    expect(entry?.roster[1]).toMatchObject({ rollNumber: 2, studentName: "Karim", status: "ABSENT", note: "Sick" });
    // The student added after the save must still be listed — as unmarked.
    expect(entry?.roster[2]).toMatchObject({ rollNumber: 3, studentName: "Ayna", status: "NOT_MARKED", hasRecord: false });
    // studentPk is what the save endpoint addresses students by.
    expect(entry?.roster[0].studentPk).toBe("stu-1");
  });

  it("reports the backend correction state so the UI never counts corrections", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow({ updateCount: 1 }));

    const entry = await getSessionForAttendanceEditor("off-1", today(), true);

    expect(entry?.permissions).toEqual({
      directCorrectionLimit: 2,
      correctionsUsed: 1,
      correctionCapacityRemaining: 1,
      withinEditWindow: true,
      canDirectCorrect: true,
      canRequestChange: false,
      hasPendingChangeRequest: false,
    });
  });

  it("closes the request path while a request is pending and while capacity remains", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow({ updateCount: 2 }));
    prismaMock.attendanceChangeRequest.findFirst.mockResolvedValue({
      id: "req-1",
      reason: "Register mis-copied",
      status: "PENDING",
      createdAt: new Date("2026-09-17T08:30:00.000Z"),
      _count: { changes: 3 },
    });

    const entry = await getSessionForAttendanceEditor("off-1", today(), true);

    expect(entry?.permissions).toMatchObject({ canDirectCorrect: false, canRequestChange: false, hasPendingChangeRequest: true });
    expect(entry?.pendingChangeRequest).toEqual({
      id: "req-1",
      reason: "Register mis-copied",
      status: "PENDING",
      displayStatus: "PENDING",
      createdAt: new Date("2026-09-17T08:30:00.000Z").toISOString(),
      changeCount: 3,
    });
  });

  it("grants no correction rights to a caller who may not edit (admins)", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow({ updateCount: 0 }));

    const entry = await getSessionForAttendanceEditor("off-1", today(), false);

    expect(entry?.permissions).toMatchObject({ canDirectCorrect: false, canRequestChange: false });
  });

  it("resolves the roster by the full academic context, never sectionId alone", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow());

    await getSessionForAttendanceEditor("off-1", today());

    expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicYearId: "year-1",
          tradeId: "trade-1",
          semesterId: "sem-1",
          shiftId: "shift-1",
          sectionId: "sec-1",
          status: "ACTIVE",
        },
        orderBy: { rollNumber: "asc" },
      }),
    );
    const where = prismaMock.studentEnrollment.findMany.mock.calls[0][0].where;
    // A bare sectionId filter would mix roll numbers of same-named sections in
    // other academic years/trades/semesters/shifts.
    expect(Object.keys(where).sort()).toEqual(["academicYearId", "sectionId", "semesterId", "shiftId", "status", "tradeId"]);
  });
});

describe("buildAttendanceRoster — shared by the report dialog and Take Attendance", () => {
  it("merges recorded statuses onto the section roster in roll order", () => {
    const { roster, summary } = buildAttendanceRoster(
      [
        { id: "rec-1", studentId: "stu-1", status: "LATE", note: null, directCorrections: 1 },
        { id: "rec-2", studentId: "stu-2", status: "EXCUSED", note: null, directCorrections: 0 },
      ],
      ENROLLMENTS,
    );

    expect(roster.map((row) => [row.rollNumber, row.status])).toEqual([
      [1, "LATE"],
      [2, "EXCUSED"],
      [3, "NOT_MARKED"],
    ]);
    expect(summary).toEqual({ total: 2, present: 0, absent: 0, late: 1, excused: 1 });
  });

  it("falls back to the recorded rows when the academic context cannot resolve enrollments", () => {
    const { roster } = buildAttendanceRoster([{ id: "rec-1", studentId: "stu-1", status: "PRESENT", student: { id: "stu-1", studentId: "R1", user: { name: "Rahim", email: "r@school" } } }], []);

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ studentPk: "stu-1", studentName: "Rahim", status: "PRESENT", hasRecord: true, rollNumber: null });
  });
});

describe("getSessionRoster — Student Status endpoint payload", () => {
  it("returns the session context, roster and summary for one session", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(sessionRow());

    const payload = await getSessionRoster("sess-1");

    expect(payload.session).toMatchObject({ id: "sess-1", courseOffering: { course: { title: "Intro to CS" } } });
    expect(payload.records).toHaveLength(3);
    expect(payload.summary.total).toBe(2);
  });

  it("404s for an unknown session instead of pretending the roster is empty", async () => {
    prismaMock.attendanceSession.findUnique.mockResolvedValue(null);

    await expect(getSessionRoster("nope")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("computeAttendancePermissions — one rule set for every screen", () => {
  const base = { updateCount: 0, attendanceDateAgeDays: 0, canEdit: true, hasPendingChangeRequest: false };

  it("allows direct corrections while capacity remains, and blocks requests until then", () => {
    expect(computeAttendancePermissions(base)).toMatchObject({
      correctionCapacityRemaining: 2,
      canDirectCorrect: true,
      canRequestChange: false,
    });
    expect(computeAttendancePermissions({ ...base, updateCount: 1 })).toMatchObject({
      correctionCapacityRemaining: 1,
      canDirectCorrect: true,
      canRequestChange: false,
    });
  });

  it("switches to the approval path once capacity is exhausted", () => {
    expect(computeAttendancePermissions({ ...base, updateCount: 2 })).toMatchObject({
      correctionCapacityRemaining: 0,
      canDirectCorrect: false,
      canRequestChange: true,
    });
  });

  it("a pending request blocks another one", () => {
    expect(computeAttendancePermissions({ ...base, updateCount: 2, hasPendingChangeRequest: true })).toMatchObject({
      canRequestChange: false,
      hasPendingChangeRequest: true,
    });
  });

  it("closes direct corrections outside the edit window but keeps the approval path", () => {
    expect(computeAttendancePermissions({ ...base, attendanceDateAgeDays: 8 })).toMatchObject({
      withinEditWindow: false,
      canDirectCorrect: false,
      canRequestChange: false,
    });
    expect(computeAttendancePermissions({ ...base, updateCount: 2, attendanceDateAgeDays: 8 })).toMatchObject({
      withinEditWindow: false,
      canDirectCorrect: false,
      // The stored rule: requests depend on capacity + pending, not the window.
      canRequestChange: true,
    });
  });

  it("never grants rights to a caller who may not edit", () => {
    expect(computeAttendancePermissions({ ...base, canEdit: false })).toMatchObject({ canDirectCorrect: false, canRequestChange: false });
  });

  it("clamps a corrupt counter instead of producing a negative capacity", () => {
    expect(computeAttendancePermissions({ ...base, updateCount: 5 })).toMatchObject({ correctionCapacityRemaining: 0, correctionsUsed: 5 });
    expect(computeAttendancePermissions({ ...base, updateCount: -3 })).toMatchObject({ correctionsUsed: 0, correctionCapacityRemaining: 2 });
  });
});
