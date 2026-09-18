import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance save/edit behaviour (partial saves + per-session update counter).
 *
 * The service reaches the database through `@/lib/db/prisma`; the mock below
 * swaps in a tiny in-memory fake so the edit rules can be exercised without a
 * live PostgreSQL:
 *
 * - creating a session writes initial logs and does NOT bump updateCount
 * - one edit touching many records bumps updateCount exactly once
 * - the session-level correction capacity is authoritative; an exhausted
 *   session rejects the complete operation rather than partially saving it
 * - direct correction has no individual-student request/reason control
 * - admins can NEVER take or directly edit attendance (FORBIDDEN) — they act
 *   only through change-request approval, which is the sole admin path
 * - teachers cannot edit sessions older than the edit window, but may create
 *   a missing historical session
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    courseOffering: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import {
  saveSessionAttendance,
  reviewChangeRequest,
  startOfDay,
  daysOld,
  dateOnlyISO,
  TEACHER_EDIT_WINDOW_DAYS,
} from "@/modules/attendance/attendance.service";

type FakeRecord = {
  id: string;
  sessionId: string;
  studentId: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  note: string | null;
  directCorrections: number;
};

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function makeFakeDb(opts: { session?: Record<string, unknown> | null; records?: FakeRecord[] } = {}) {
  const state = {
    session: (opts.session ?? null) as (Record<string, unknown> & { id: string; updateCount: number }) | null,
    records: new Map<string, FakeRecord>(),
    logs: [] as Record<string, unknown>[],
    changeRequests: new Map<string, Record<string, unknown>>(),
  };
  for (const r of opts.records ?? []) state.records.set(`${r.sessionId}:${r.studentId}`, { ...r });
  let recSeq = 100;

  const tx = {
    attendanceSession: {
      findUnique: vi.fn(async ({ where }: { where: { courseOfferingId_attendanceDate?: { courseOfferingId: string; attendanceDate: Date }; id?: string } }) => {
        const s = state.session;
        if (where.id) return s?.id === where.id ? s : null;
        const k = where.courseOfferingId_attendanceDate;
        if (
          s && k &&
          s.courseOfferingId === k.courseOfferingId &&
          +new Date(s.attendanceDate as string | Date) === +new Date(k.attendanceDate)
        ) {
          return s;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.session = { id: "sess-new", updateCount: 0, ...data } as typeof state.session;
        return state.session;
      }),
      update: vi.fn(async ({ data }: { where: unknown; data: { updateCount?: { increment: number } } }) => {
        if (data?.updateCount?.increment && state.session) {
          state.session.updateCount += data.updateCount.increment;
        }
        return state.session;
      }),
      updateMany: vi.fn(async ({ data }: { where: { updateCount?: { lt: number } }; data: { updateCount?: { increment: number } } }) => {
        if (!state.session || (data.updateCount?.increment && state.session.updateCount >= 2)) return { count: 0 };
        if (data.updateCount?.increment) state.session.updateCount += data.updateCount.increment;
        return { count: 1 };
      }),
    },
    attendanceRecord: {
      findUnique: vi.fn(async ({ where }: { where: { sessionId_studentId?: { sessionId: string; studentId: string }; id?: string } }) => {
        if (where.sessionId_studentId) {
          const k = where.sessionId_studentId;
          return state.records.get(`${k.sessionId}:${k.studentId}`) ?? null;
        }
        if (where.id) {
          return [...state.records.values()].find((r) => r.id === where.id) ?? null;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...state.records.values()].filter((record) => where.id.in.includes(record.id))),
      create: vi.fn(async ({ data }: { data: { sessionId: string; studentId: string; status: FakeRecord["status"]; note?: string | null } }) => {
        recSeq += 1;
        const rec: FakeRecord = {
          id: `rec-${recSeq}`,
          sessionId: data.sessionId,
          studentId: data.studentId,
          status: data.status,
          note: data.note ?? null,
          directCorrections: 0,
        };
        state.records.set(`${rec.sessionId}:${rec.studentId}`, rec);
        return rec;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRecord> }) => {
        const rec = [...state.records.values()].find((r) => r.id === where.id);
        if (!rec) throw new Error("record not found in fake");
        Object.assign(rec, data);
        return rec;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: FakeRecord["status"] }; data: Partial<FakeRecord> }) => {
        const rec = [...state.records.values()].find((r) => r.id === where.id && (!where.status || r.status === where.status));
        if (!rec) return { count: 0 };
        Object.assign(rec, data);
        return { count: 1 };
      }),
    },
    attendanceChangeLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const log = { id: `log-${state.logs.length + 1}`, ...data };
        state.logs.push(log);
        return log;
      }),
    },
    attendanceChangeRequest: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.changeRequests.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const req = state.changeRequests.get(where.id);
        if (!req) throw new Error("request not found in fake");
        Object.assign(req, data);
        return req;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const req = state.changeRequests.get(where.id);
        if (!req || req.status !== where.status) return { count: 0 };
        Object.assign(req, data);
        return { count: 1 };
      }),
    },
  };

  prismaMock.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  prismaMock.courseOffering.findUnique.mockResolvedValue({ id: "off-1" });

  return { state, tx };
}

const TEACHER = { actorUserId: "u-teacher", isAdmin: false };
const ADMIN = { actorUserId: "u-admin", isAdmin: true };

function existingSession(days: number, updateCount = 0) {
  return {
    id: "sess-1",
    courseOfferingId: "off-1",
    attendanceDate: startOfDay(daysAgo(days)),
    createdById: "u-teacher",
    updateCount,
  };
}

function rec(sessionId: string, studentId: string, status: FakeRecord["status"], directCorrections = 0): FakeRecord {
  return { id: `rec-${studentId}`, sessionId, studentId, status, note: null, directCorrections };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveSessionAttendance — session creation", () => {
  it("rejects a stale create form when the session was recorded concurrently", async () => {
    makeFakeDb({
      session: existingSession(0),
      records: [rec("sess-1", "stu-1", "PRESENT")],
    });

    await expect(saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(0),
      mode: "create",
      records: [{ studentId: "stu-1", status: "ABSENT" }],
      ...TEACHER,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("creates a missing session with initial logs and does not count creation as an update", async () => {
    const { state, tx } = makeFakeDb({ session: null });

    const res = await saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(0),
      records: [
        { studentId: "stu-1", status: "PRESENT" },
        { studentId: "stu-2", status: "ABSENT" },
      ],
      ...TEACHER,
    });

    expect(res.isNewSession).toBe(true);
    expect(res.createdCount).toBe(2);
    expect(res.updatedCount).toBe(0);
    expect(res.skipped).toEqual([]);
    expect(state.logs).toHaveLength(2);
    expect(state.logs.every((l) => l.oldStatus === null)).toBe(true);
    expect(tx.attendanceSession.update).not.toHaveBeenCalled();
    expect(state.session?.updateCount).toBe(0);
  });

  it("lets a teacher create a missing HISTORICAL session outside the edit window", async () => {
    makeFakeDb({ session: null });

    const res = await saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(30),
      records: [{ studentId: "stu-1", status: "PRESENT" }],
      ...TEACHER,
    });

    expect(res.isNewSession).toBe(true);
    expect(res.createdCount).toBe(1);
  });
});

describe("saveSessionAttendance — edits and the update counter", () => {
  it("bumps updateCount exactly once when one edit touches many records", async () => {
    const { state, tx } = makeFakeDb({
      session: existingSession(1, 1),
      records: [rec("sess-1", "stu-1", "PRESENT"), rec("sess-1", "stu-2", "PRESENT"), rec("sess-1", "stu-3", "PRESENT")],
    });

    const res = await saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(1),
      records: [
        { studentId: "stu-1", status: "ABSENT" },
        { studentId: "stu-2", status: "LATE" },
        { studentId: "stu-3", status: "EXCUSED" },
      ],
      reason: "Corrected from paper register",
      ...TEACHER,
    });

    expect(res.isNewSession).toBe(false);
    expect(res.updatedCount).toBe(3);
    expect(res.skipped).toEqual([]);
    expect(tx.attendanceSession.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.attendanceSession.updateMany).toHaveBeenCalledWith({
      where: { id: "sess-1", updateCount: { lt: 2 } },
      data: { updateCount: { increment: 1 } },
    });
    expect(state.session?.updateCount).toBe(2);
  });

  it("does not bump updateCount when nothing changed", async () => {
    const { tx } = makeFakeDb({
      session: existingSession(0, 1),
      records: [rec("sess-1", "stu-1", "PRESENT")],
    });

    const res = await saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(0),
      records: [{ studentId: "stu-1", status: "PRESENT" }],
      ...TEACHER,
    });

    expect(res.updatedCount).toBe(0);
    expect(res.createdCount).toBe(0);
    expect(tx.attendanceSession.update).not.toHaveBeenCalled();
  });

  it("allows a direct correction without an individual-student reason box", async () => {
    const { state } = makeFakeDb({
      session: existingSession(0),
      records: [rec("sess-1", "stu-1", "PRESENT")],
    });

    const result = await saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(0),
      records: [{ studentId: "stu-1", status: "ABSENT" }],
      ...TEACHER,
    });
    expect(result.updatedCount).toBe(1);
    expect(state.records.get("sess-1:stu-1")?.status).toBe("ABSENT");
  });
});

describe("saveSessionAttendance — correction limits (partial saves)", () => {
  it("rejects the complete multi-student operation when session capacity is exhausted", async () => {
    const { tx } = makeFakeDb({
      session: existingSession(0, 2),
      records: [rec("sess-1", "stu-1", "PRESENT", 0), rec("sess-1", "stu-2", "PRESENT", 0)],
    });

    await expect(saveSessionAttendance({
      courseOfferingId: "off-1",
      attendanceDate: daysAgo(0),
      records: [
        { studentId: "stu-1", status: "ABSENT" },
        { studentId: "stu-2", status: "ABSENT" },
      ],
      reason: "Register correction",
      ...TEACHER,
    })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(tx.attendanceRecord.updateMany).toHaveBeenCalledTimes(2);
  });

  it("rejects admin writes — admins approve change requests instead of editing", async () => {
    const { state, tx } = makeFakeDb({
      session: existingSession(0, 0),
      records: [rec("sess-1", "stu-1", "PRESENT", 2)],
    });

    await expect(
      saveSessionAttendance({
        courseOfferingId: "off-1",
        attendanceDate: daysAgo(0),
        records: [{ studentId: "stu-1", status: "ABSENT" }],
        ...ADMIN,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Nothing was written.
    expect(tx.attendanceRecord.update).not.toHaveBeenCalled();
    expect(tx.attendanceSession.update).not.toHaveBeenCalled();
    expect(state.records.get("sess-1:stu-1")?.status).toBe("PRESENT");
  });
});

describe("saveSessionAttendance — teacher edit window", () => {
  it(`rejects teacher edits older than ${TEACHER_EDIT_WINDOW_DAYS} days`, async () => {
    expect(TEACHER_EDIT_WINDOW_DAYS).toBe(7);
    makeFakeDb({
      session: existingSession(10),
      records: [rec("sess-1", "stu-1", "PRESENT")],
    });

    await expect(
      saveSessionAttendance({
        courseOfferingId: "off-1",
        attendanceDate: daysAgo(10),
        records: [{ studentId: "stu-1", status: "ABSENT" }],
        reason: "Too late",
        ...TEACHER,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("rejects admin writes even for old sessions (no direct admin editing, ever)", async () => {
    makeFakeDb({
      session: existingSession(30, 1),
      records: [rec("sess-1", "stu-1", "PRESENT")],
    });

    await expect(
      saveSessionAttendance({
        courseOfferingId: "off-1",
        attendanceDate: daysAgo(30),
        records: [{ studentId: "stu-1", status: "ABSENT" }],
        ...ADMIN,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects admin creation of a missing session", async () => {
    const { tx } = makeFakeDb({ session: null });

    await expect(
      saveSessionAttendance({
        courseOfferingId: "off-1",
        attendanceDate: daysAgo(0),
        records: [{ studentId: "stu-1", status: "PRESENT" }],
        ...ADMIN,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(tx.attendanceSession.create).not.toHaveBeenCalled();
  });
});

describe("reviewChangeRequest — approvals count as session updates", () => {
  it("bumps updateCount when an approval changes the session", async () => {
    const { state, tx } = makeFakeDb({
      session: existingSession(0, 4),
      records: [rec("sess-1", "stu-1", "PRESENT", 2)],
    });
    state.changeRequests.set("req-1", {
      id: "req-1",
      sessionId: "sess-1",
      status: "PENDING",
      changes: [{ recordId: "rec-stu-1", oldStatus: "PRESENT", newStatus: "ABSENT" }],
      reason: "Verified register",
    });

    const res = await reviewChangeRequest("req-1", { approve: true, reviewedById: "u-admin" });

    expect(res.status).toBe("APPROVED");
    expect(tx.attendanceSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { updateCount: { increment: 1 } },
    });
    expect(state.session?.updateCount).toBe(5);
  });
});

describe("attendance date helpers — timezone safety", () => {
  it("startOfDay truncates to UTC midnight", () => {
    expect(startOfDay(new Date("2026-09-15T18:30:00.000Z")).toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("daysOld counts UTC calendar days", () => {
    expect(daysOld(new Date())).toBe(0);
    expect(daysOld(daysAgo(7))).toBe(7);
  });

  it("dateOnlyISO renders the UTC calendar day without drift", () => {
    expect(dateOnlyISO(new Date("2026-09-15T00:00:00.000Z"))).toBe("2026-09-15");
    expect(dateOnlyISO(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});
