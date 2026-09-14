import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance Report — per-session modification counting.
 *
 * The service reaches the database through `@/lib/db/prisma`; the mock below lets us
 * assert the exact queries `listAttendanceReport` issues (the contract with Prisma)
 * without a live PostgreSQL, plus the aggregation the UI renders as "Updated N times".
 *
 * Regression guard: the count must never filter or select on a denormalized
 * `attendanceSessionId` column. No such field exists on `AttendanceChangeLog` (see
 * migration 20260915120000_drop_attendance_change_log_session_id), and querying it makes
 * Prisma reject the call client-side with "Unknown argument `attendanceSessionId`" —
 * which turned GET /api/v1/course-offerings/{id}/attendance/sessions into a 500.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    attendanceSession: { count: vi.fn(), findMany: vi.fn() },
    attendanceRecord: { groupBy: vi.fn() },
    attendanceChangeLog: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import { listAttendanceReport } from "@/modules/attendance/attendance.service";

const d = (iso: string) => new Date(iso);

function makeSession(id: string, date: string) {
  return {
    id,
    courseOfferingId: "off-1",
    attendanceDate: d(`${date}T00:00:00.000Z`),
    createdById: "u-1",
    createdAt: d(`${date}T08:00:00.000Z`),
    updatedAt: d(`${date}T08:05:00.000Z`),
  };
}

/** Wires the mocked database layer for a two-session report page. */
function stubDb(modifications: { sessionId: string }[]) {
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prismaMock),
  );
  prismaMock.attendanceSession.count.mockResolvedValue(2);
  prismaMock.attendanceSession.findMany.mockResolvedValue([
    makeSession("s1", "2026-09-15"),
    makeSession("s2", "2026-09-14"),
  ]);
  prismaMock.attendanceRecord.groupBy.mockResolvedValue([
    { sessionId: "s1", status: "PRESENT", _count: { _all: 40 } },
    { sessionId: "s1", status: "ABSENT", _count: { _all: 1 } },
    { sessionId: "s2", status: "PRESENT", _count: { _all: 41 } },
  ]);
  prismaMock.attendanceChangeLog.findMany.mockResolvedValue(
    modifications.map((m) => ({ record: { sessionId: m.sessionId } })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Attendance Report — modification count query", () => {
  it("counts modifications through the AttendanceChangeLog -> record relation", async () => {
    stubDb([{ sessionId: "s1" }, { sessionId: "s1" }, { sessionId: "s2" }]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1", page: 1, pageSize: 20 });

    // The sessions on the page are scoped through the relation, and only real
    // modifications (oldStatus IS NOT NULL) are counted.
    expect(prismaMock.attendanceChangeLog.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.attendanceChangeLog.findMany).toHaveBeenCalledWith({
      where: {
        oldStatus: { not: null },
        record: { sessionId: { in: ["s1", "s2"] } },
      },
      select: { record: { select: { sessionId: true } } },
    });

    // s1 has two modifications, s2 has one.
    expect(res.items.map((i) => i.updateCount)).toEqual([2, 1]);
  });

  it("never references a denormalized attendanceSessionId column", async () => {
    stubDb([{ sessionId: "s1" }]);

    await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(prismaMock.attendanceChangeLog.findMany.mock.calls.length).toBeGreaterThan(0);
    for (const call of prismaMock.attendanceChangeLog.findMany.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("attendanceSessionId");
    }
  });

  it("reports zero updates when no session was modified", async () => {
    stubDb([]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(prismaMock.attendanceChangeLog.findMany).toHaveBeenCalledTimes(1);
    expect(res.items.map((i) => i.updateCount)).toEqual([0, 0]);
  });

  it("counts every correction of the same record, not just the record", async () => {
    // Three change-log rows for one session (e.g. one record corrected twice and
    // another once) must yield an update count of 3.
    stubDb([{ sessionId: "s1" }, { sessionId: "s1" }, { sessionId: "s1" }]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(res.items.map((i) => i.updateCount)).toEqual([3, 0]);
  });

  it("short-circuits before counting when the page has no sessions", async () => {
    prismaMock.$transaction.mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prismaMock),
    );
    prismaMock.attendanceSession.count.mockResolvedValue(0);
    prismaMock.attendanceSession.findMany.mockResolvedValue([]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(res).toMatchObject({ items: [], total: 0, page: 1 });
    expect(prismaMock.attendanceChangeLog.findMany).not.toHaveBeenCalled();
  });
});

describe("Attendance Report — summaries alongside the count", () => {
  it("returns status summaries aggregated in the database", async () => {
    stubDb([{ sessionId: "s1" }]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(res.items[0].summary).toEqual({ total: 41, present: 40, absent: 1, late: 0, excused: 0 });
    expect(res.items[1].summary).toEqual({ total: 41, present: 41, absent: 0, late: 0, excused: 0 });
    expect(res.total).toBe(2);
  });
});
