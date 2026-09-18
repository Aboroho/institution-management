import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance-entry change requests: the rules that must hold even when the UI is
 * bypassed (curl, a stale tab, two tabs clicking at once).
 *
 *   - a request may never be filed while the entry still has direct correction
 *     capacity (that is what the quota is for);
 *   - a second request may never be filed while one is PENDING for the same
 *     entry — checked in the transaction AND backed by the partial unique index,
 *     so a concurrent submission loses with a 409 instead of creating two
 *     active requests;
 *   - only the requesting teacher may cancel, only while PENDING;
 *   - cancelling preserves the request and every proposed change (nothing is
 *     deleted) and records the withdrawal as REJECTED + machine-readable marker,
 *     because the frozen schema has no CANCELLED enum value.
 *
 * The service reaches the database through `@/lib/db/prisma`; the fake below
 * implements just the calls it makes (same pattern as `attendance-save.test.ts`).
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    studentEnrollment: { findMany: vi.fn() },
    attendanceChangeRequest: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import {
  cancelChangeRequest,
  createChangeRequest,
  listChangeRequests,
} from "@/modules/attendance/attendance.service";
import { WITHDRAWN_REQUEST_NOTE } from "@/modules/attendance/attendance.types";

type FakeRecord = { id: string; sessionId: string; status: string };

type FakeState = {
  session: Record<string, unknown> | null;
  records: FakeRecord[];
  requests: Map<string, Record<string, unknown>>;
  created: Record<string, unknown>[];
  deleted: string[];
  uniqueViolation: boolean;
};

function makeFakeDb(opts: {
  session?: Record<string, unknown> | null;
  records?: FakeRecord[];
  requests?: Record<string, unknown>[];
  uniqueViolation?: boolean;
} = {}) {
  const state: FakeState = {
    session: opts.session === undefined ? { id: "sess-1", updateCount: 2, courseOfferingId: "off-1" } : opts.session,
    records: opts.records ?? [
      { id: "rec-1", sessionId: "sess-1", status: "PRESENT" },
      { id: "rec-2", sessionId: "sess-1", status: "ABSENT" },
    ],
    requests: new Map((opts.requests ?? []).map((request) => [String(request.id), request])),
    created: [],
    deleted: [],
    uniqueViolation: opts.uniqueViolation ?? false,
  };

  const tx = {
    attendanceSession: {
      findUnique: vi.fn(async () => state.session),
    },
    attendanceRecord: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        state.records.filter((record) => where.id.in.includes(record.id))),
    },
    attendanceChangeRequest: {
      findFirst: vi.fn(async ({ where }: { where: { sessionId?: string; status?: string } }) =>
        [...state.requests.values()].find(
          (request) =>
            (where.sessionId === undefined || request.sessionId === where.sessionId) &&
            (where.status === undefined || request.status === where.status),
        ) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.requests.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.uniqueViolation) {
          // Postgres rejects the second PENDING row for the same session: Prisma
          // surfaces the partial unique index as P2002.
          const error = new Error("Unique constraint failed on AttendanceChangeRequest(sessionId) WHERE status = PENDING");
          (error as { code?: string }).code = "P2002";
          throw error;
        }
        const items = (data.changes as { create: unknown[] }).create;
        const request = {
          id: `req-${state.created.length + 1}`,
          status: "PENDING",
          sessionId: data.sessionId,
          requestedById: data.requestedById,
          reason: data.reason,
          changes: items,
          // Prisma returns the `_count` select, not the nested rows.
          _count: { changes: items.length },
        };
        state.created.push(request);
        state.requests.set(String(request.id), request as Record<string, unknown>);
        return request;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const request = state.requests.get(where.id);
        if (!request || (where.status !== undefined && request.status !== where.status)) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.deleted.push(where.id);
        return { id: where.id };
      }),
      deleteMany: vi.fn(async () => {
        state.deleted.push("*");
        return { count: 0 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const request = state.requests.get(String(where.id));
        if (request) Object.assign(request, data);
        return request ?? null;
      }),
    },
  };

  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (t: unknown) => Promise<unknown>)(tx)
      : Promise.all(arg as Promise<unknown>[]),
  );

  return { state, tx };
}

const TEACHER = "teacher-user";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.studentEnrollment.findMany.mockResolvedValue([]);
  prismaMock.attendanceChangeRequest.count.mockResolvedValue(0);
  prismaMock.attendanceChangeRequest.findMany.mockResolvedValue([]);
});

describe("createChangeRequest — quota and duplicate-request guards", () => {
  it("rejects a request while the entry still has direct correction capacity", async () => {
    const { state } = makeFakeDb({
      session: { id: "sess-1", updateCount: 1, courseOfferingId: "off-1" },
      records: [{ id: "rec-1", sessionId: "sess-1", status: "PRESENT" }],
    });

    await expect(
      createChangeRequest({
        sessionId: "sess-1",
        changes: [{ recordId: "rec-1", newStatus: "ABSENT" }],
        reason: "Register correction",
        requestedById: TEACHER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(state.created).toHaveLength(0);
  });

  it("rejects a second request while one is already pending for the entry", async () => {
    const { state } = makeFakeDb({
      requests: [{ id: "req-open", sessionId: "sess-1", status: "PENDING", requestedById: TEACHER, reason: "First" }],
    });

    await expect(
      createChangeRequest({
        sessionId: "sess-1",
        changes: [{ recordId: "rec-1", newStatus: "ABSENT" }],
        reason: "Second attempt",
        requestedById: TEACHER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409, message: expect.stringMatching(/already has a request awaiting admin review/i) });

    expect(state.created).toHaveLength(0);
    // The pre-existing pending request is untouched — no silent replacement.
    expect(state.requests.get("req-open")?.status).toBe("PENDING");
  });

  it("answers 409 when two submissions race and the unique index rejects the loser", async () => {
    // The service's own findFirst sees no pending row (both submissions started
    // at the same time); the partial unique index is what actually serialises
    // them, and P2002 must be translated into the same meaningful conflict.
    makeFakeDb({ uniqueViolation: true });

    await expect(
      createChangeRequest({
        sessionId: "sess-1",
        changes: [{ recordId: "rec-1", newStatus: "ABSENT" }],
        reason: "Racing submission",
        requestedById: TEACHER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409, message: expect.stringMatching(/already has a request awaiting admin review/i) });
  });

  it("requires a reason and a non-empty change set", async () => {
    makeFakeDb();

    await expect(
      createChangeRequest({ sessionId: "sess-1", changes: [{ recordId: "rec-1", newStatus: "ABSENT" }], reason: "   ", requestedById: TEACHER }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    await expect(createChangeRequest({ sessionId: "sess-1", changes: [], reason: "Why", requestedById: TEACHER })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects proposals that no longer match the recorded status (stale draft)", async () => {
    const { state } = makeFakeDb({ records: [{ id: "rec-1", sessionId: "sess-1", status: "ABSENT" }] });

    await expect(
      createChangeRequest({
        sessionId: "sess-1",
        // The teacher's draft still says ABSENT -> ABSENT: nothing to approve.
        changes: [{ recordId: "rec-1", newStatus: "ABSENT" }],
        reason: "Stale tab",
        requestedById: TEACHER,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(state.created).toHaveLength(0);
  });

  it("rejects records that belong to a different attendance entry", async () => {
    const { state } = makeFakeDb({ records: [{ id: "rec-x", sessionId: "sess-other", status: "PRESENT" }] });

    await expect(
      createChangeRequest({
        sessionId: "sess-1",
        changes: [{ recordId: "rec-x", newStatus: "ABSENT" }],
        reason: "Wrong entry",
        requestedById: TEACHER,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(state.created).toHaveLength(0);
  });

  it("stores the complete multi-student change set as one entry-level request", async () => {
    const { state } = makeFakeDb();

    const created = await createChangeRequest({
      sessionId: "sess-1",
      changes: [
        { recordId: "rec-1", newStatus: "ABSENT" },
        { recordId: "rec-2", newStatus: "PRESENT" },
      ],
      reason: "Two students were mis-marked",
      requestedById: TEACHER,
    });

    expect(created).toMatchObject({ status: "PENDING", displayStatus: "PENDING", changeCount: 2, canCancel: true });
    const stored = state.requests.get(String((created as { id: string }).id));
    expect((stored?.changes as unknown[]).length).toBe(2);
    // previous -> proposed is stored per student, so the teacher can re-read it later.
    expect(stored?.changes).toEqual([
      { recordId: "rec-1", oldStatus: "PRESENT", newStatus: "ABSENT" },
      { recordId: "rec-2", oldStatus: "ABSENT", newStatus: "PRESENT" },
    ]);
  });
});

describe("cancelChangeRequest — withdraw your own pending request", () => {
  function pendingRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: "req-1",
      sessionId: "sess-1",
      requestedById: TEACHER,
      status: "PENDING",
      reason: "Wrong statuses",
      reviewNote: null,
      reviewedById: null,
      reviewedAt: null,
      _count: { changes: 2 },
      ...overrides,
    };
  }

  it("closes the request without deleting it or its proposals", async () => {
    const { state, tx } = makeFakeDb({ requests: [pendingRequest()] });

    const result = await cancelChangeRequest("req-1", { actorUserId: TEACHER });

    expect(result).toMatchObject({ id: "req-1", displayStatus: "CANCELLED", changeCount: 2 });
    const stored = state.requests.get("req-1")!;
    // No CANCELLED enum exists in the frozen schema: REJECTED + marker.
    expect(stored.status).toBe("REJECTED");
    expect(String(stored.reviewNote).startsWith(WITHDRAWN_REQUEST_NOTE)).toBe(true);
    // Nothing was removed — request row and audit history survive.
    expect(tx.attendanceChangeRequest.delete).not.toHaveBeenCalled();
    expect(tx.attendanceChangeRequest.deleteMany).not.toHaveBeenCalled();
    expect(state.deleted).toEqual([]);
    expect(stored._count).toEqual({ changes: 2 });
  });

  it("appends an optional teacher note after the marker (marker stays detectable)", async () => {
    const { state } = makeFakeDb({ requests: [pendingRequest()] });

    await cancelChangeRequest("req-1", { actorUserId: TEACHER, note: "Handled during class" });

    expect(String(state.requests.get("req-1")!.reviewNote)).toBe(`${WITHDRAWN_REQUEST_NOTE} Handled during class`);
  });

  it("refuses to cancel another teacher's request", async () => {
    const { state } = makeFakeDb({ requests: [pendingRequest({ requestedById: "someone-else" })] });

    await expect(cancelChangeRequest("req-1", { actorUserId: TEACHER })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(state.requests.get("req-1")!.status).toBe("PENDING");
  });

  it("refuses to cancel an approved request (the admin decision stands)", async () => {
    const { tx } = makeFakeDb({ requests: [pendingRequest({ status: "APPROVED", reviewedById: "admin-1" })] });

    await expect(cancelChangeRequest("req-1", { actorUserId: TEACHER })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/already been approved/i),
    });
    expect(tx.attendanceChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to cancel an already rejected request", async () => {
    const { tx } = makeFakeDb({ requests: [pendingRequest({ status: "REJECTED", reviewNote: "Not supported" })] });

    await expect(cancelChangeRequest("req-1", { actorUserId: TEACHER })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.attendanceChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to cancel twice (a withdrawn row is no longer pending)", async () => {
    const { tx } = makeFakeDb({
      requests: [pendingRequest({ status: "REJECTED", reviewNote: WITHDRAWN_REQUEST_NOTE })],
    });

    await expect(cancelChangeRequest("req-1", { actorUserId: TEACHER })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.attendanceChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("returns a conflict when an admin reviewed the request mid-cancel (race)", async () => {
    // The row still reads PENDING when it is SELECTed, but the guarded UPDATE
    // (`WHERE status = 'PENDING'`) matches zero rows because the admin's
    // transaction committed in between — exactly what must be reported.
    const { state } = makeFakeDb({ requests: [pendingRequest()] });
    let firstWrite = true;
    (state.requests.get("req-1") as { status: string }).status = "PENDING";
    prismaMock.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const requests = state.requests;
      return fn({
        attendanceSession: { findUnique: async () => state.session },
        attendanceChangeRequest: {
          findUnique: async () => requests.get("req-1") ?? null,
          updateMany: async () => {
            if (firstWrite) {
              firstWrite = false;
              Object.assign(requests.get("req-1")!, { status: "APPROVED", reviewedById: "admin-1" });
            }
            return { count: 0 }; // admin won the row; our conditional update matched nothing
          },
        },
      });
    });

    await expect(cancelChangeRequest("req-1", { actorUserId: TEACHER })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/reviewed by an admin while you were cancelling/i),
    });
    expect(state.requests.get("req-1")!.status).toBe("APPROVED");
  });

  it("404s for a request id that does not exist", async () => {
    makeFakeDb({ requests: [] });
    await expect(cancelChangeRequest("missing", { actorUserId: TEACHER })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listChangeRequests — server-side cancel eligibility", () => {
  it("marks only the caller's own pending request as cancellable", async () => {
    const row = {
      id: "req-1",
      sessionId: "sess-1",
      requestedById: TEACHER,
      reason: "Fix three statuses",
      status: "PENDING",
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      createdAt: new Date("2026-09-16T09:00:00.000Z"),
      requestedBy: { id: TEACHER, name: "T", email: "t@school" },
      reviewedBy: null,
      session: {
        id: "sess-1",
        attendanceDate: new Date("2026-09-15T00:00:00.000Z"),
        courseOffering: {
          id: "off-1",
          academicYearId: "y1",
          tradeId: "t1",
          semesterId: "sm1",
          shiftId: "sh1",
          sectionId: "se1",
          course: { code: "C1", title: "Course" },
        },
      },
      changes: [
        { id: "i1", recordId: "rec-1", oldStatus: "PRESENT", newStatus: "ABSENT", record: { student: { id: "stu-1", studentId: "R1", user: { name: "A", email: "a@x" } } } },
        { id: "i2", recordId: "rec-2", oldStatus: "ABSENT", newStatus: "PRESENT", record: { student: { id: "stu-2", studentId: "R2", user: { name: "B", email: "b@x" } } } },
      ],
    };
    prismaMock.attendanceChangeRequest.count.mockResolvedValue(1);
    prismaMock.attendanceChangeRequest.findMany.mockResolvedValue([row]);

    const asOwner = await listChangeRequests({ page: 1, limit: 25, actorUserId: TEACHER });
    expect(asOwner.items[0]).toMatchObject({ canCancel: true, displayStatus: "PENDING", changeCount: 2 });
    expect(asOwner.items[0].changes).toHaveLength(2);

    const asStranger = await listChangeRequests({ page: 1, limit: 25, actorUserId: "other-user" });
    expect(asStranger.items[0].canCancel).toBe(false);
  });

  it("reports a withdrawn row as CANCELLED, not as an admin rejection", async () => {
    prismaMock.attendanceChangeRequest.count.mockResolvedValue(1);
    prismaMock.attendanceChangeRequest.findMany.mockResolvedValue([
      {
        id: "req-2",
        sessionId: "sess-1",
        requestedById: TEACHER,
        reason: "Withdrawn",
        status: "REJECTED",
        reviewNote: WITHDRAWN_REQUEST_NOTE,
        reviewedAt: new Date("2026-09-16T10:00:00.000Z"),
        reviewedById: TEACHER,
        createdAt: new Date("2026-09-16T09:00:00.000Z"),
        requestedBy: { id: TEACHER, name: "T", email: "t@school" },
        reviewedBy: { id: TEACHER, name: "T", email: "t@school" },
        session: {
          id: "sess-1",
          attendanceDate: new Date("2026-09-15T00:00:00.000Z"),
          courseOffering: { id: "off-1", academicYearId: "y", tradeId: "t", semesterId: "s", shiftId: "sh", sectionId: "se", course: { code: "C", title: "T" } },
        },
        changes: [],
      },
    ]);

    const res = await listChangeRequests({ page: 1, limit: 25, actorUserId: TEACHER });

    expect(res.items[0]).toMatchObject({ status: "REJECTED", displayStatus: "CANCELLED", withdrawn: true, canCancel: false });
  });
});
