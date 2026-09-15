import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance Report — per-session update counting.
 *
 * `updateCount` is a stored counter on AttendanceSession: one edit operation
 * (save / approved change request) that changed the session counts as exactly
 * ONE update, no matter how many student records it touched, and the initial
 * creation is not an update. The report selects the counter directly — it must
 * never aggregate change-log rows (that inflated one 30-student edit into
 * "Updated: 30 times").
 *
 * The service reaches the database through `@/lib/db/prisma`; the mock below
 * lets us assert the exact queries `listAttendanceReport` issues without a
 * live PostgreSQL.
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

function makeSession(id: string, date: string, updateCount: number) {
  return {
    id,
    courseOfferingId: "off-1",
    attendanceDate: d(`${date}T00:00:00.000Z`),
    createdById: "u-1",
    createdAt: d(`${date}T08:00:00.000Z`),
    updatedAt: d(`${date}T08:05:00.000Z`),
    updateCount,
  };
}

/** Wires the mocked database layer for a two-session report page. */
function stubDb() {
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prismaMock),
  );
  prismaMock.attendanceSession.count.mockResolvedValue(2);
  prismaMock.attendanceSession.findMany.mockResolvedValue([
    makeSession("s1", "2026-09-15", 2),
    makeSession("s2", "2026-09-14", 0),
  ]);
  prismaMock.attendanceRecord.groupBy.mockResolvedValue([
    { sessionId: "s1", status: "PRESENT", _count: { _all: 40 } },
    { sessionId: "s1", status: "ABSENT", _count: { _all: 1 } },
    { sessionId: "s2", status: "PRESENT", _count: { _all: 41 } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Attendance Report — update count source", () => {
  it("selects the stored per-session updateCount column", async () => {
    stubDb();

    await listAttendanceReport({ courseOfferingId: "off-1", page: 1, pageSize: 20 });

    expect(prismaMock.attendanceSession.findMany).toHaveBeenCalledTimes(1);
    const select = prismaMock.attendanceSession.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({ id: true, updateCount: true });
  });

  it("reports the stored counter verbatim (one edit = one update)", async () => {
    stubDb();

    const res = await listAttendanceReport({ courseOfferingId: "off-1", page: 1, pageSize: 20 });

    // s1 was edited twice, s2 never — regardless of how many student records
    // each edit touched.
    expect(res.items.map((i) => i.updateCount)).toEqual([2, 0]);
  });

  it("never aggregates change-log rows for the count", async () => {
    stubDb();

    await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(prismaMock.attendanceChangeLog.findMany).not.toHaveBeenCalled();
  });

  it("short-circuits before aggregating when the page has no sessions", async () => {
    prismaMock.$transaction.mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prismaMock),
    );
    prismaMock.attendanceSession.count.mockResolvedValue(0);
    prismaMock.attendanceSession.findMany.mockResolvedValue([]);

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(res).toMatchObject({ items: [], total: 0, page: 1 });
    expect(prismaMock.attendanceRecord.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.attendanceChangeLog.findMany).not.toHaveBeenCalled();
  });
});

describe("Attendance Report — summaries alongside the count", () => {
  it("returns status summaries aggregated in the database", async () => {
    stubDb();

    const res = await listAttendanceReport({ courseOfferingId: "off-1" });

    expect(res.items[0].summary).toEqual({ total: 41, present: 40, absent: 1, late: 0, excused: 0 });
    expect(res.items[1].summary).toEqual({ total: 41, present: 41, absent: 0, late: 0, excused: 0 });
    expect(res.total).toBe(2);
  });
});
