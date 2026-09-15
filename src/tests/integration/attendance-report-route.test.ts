import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance Report contract for the admin attendance browser
 * (`/admin/attendance` → "Attendance Report" tab).
 *
 * The browser drills down with real API data (academic year → trade → semester
 * → shift → section → course offering) and then renders
 * `GET /api/v1/course-offerings/{id}/attendance/sessions`. This file drives the
 * REAL route handler plus the REAL `listAttendanceReport` service, stubbing
 * only the session module (a fixed actor) and the Prisma client module — so the
 * route's authorization, query parsing and pagination metadata are real
 * application code (same convention as `enrollment-roll-api.test.ts`).
 *
 * Pinned here:
 *   - ADMIN reads any offering's report (that is the admin inspection route),
 *   - STUDENT is rejected (403) and a TEACHER without an active assignment is
 *     rejected (403) — the report is never a back door around scoping,
 *   - page / pageSize / from / to are forwarded to the database,
 *   - page size is capped and the day filter is normalized to UTC midnight,
 *   - the payload carries the per-session summary + stored update count and the
 *     pagination meta the UI pager relies on (`meta.total`).
 */

const { actor, prismaMock } = vi.hoisted(() => {
  process.env.AUTH_SECRET ??= "attendance-report-route-test-secret-0000";
  return {
    actor: { role: "ADMIN" as "ADMIN" | "TEACHER" | "STUDENT" },
    prismaMock: {
      $transaction: vi.fn(),
      attendanceSession: { count: vi.fn(), findMany: vi.fn() },
      attendanceRecord: { groupBy: vi.fn() },
      attendanceChangeLog: { findMany: vi.fn() },
      teacher: { findUnique: vi.fn() },
      teacherCourseAssignment: { findFirst: vi.fn() },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: async () => ({ userId: "report-actor", role: actor.role, session: { sub: "report-actor" } }),
  requestMeta: () => ({ ip: null, userAgent: null }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/course-offerings/[id]/attendance/sessions/route";

const OFFERING_ID = "offering-1";

function reportRequest(query = "", offeringId = OFFERING_ID) {
  return new NextRequest(
    `http://localhost/api/v1/course-offerings/${offeringId}/attendance/sessions${query}`,
  );
}

const call = (query = "", offeringId = OFFERING_ID) =>
  GET(reportRequest(query, offeringId), { params: { id: offeringId } });

/** Two sessions with DB-aggregated summaries, as the service reads them. */
function stubReportRows() {
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prismaMock),
  );
  prismaMock.attendanceSession.count.mockResolvedValue(2);
  prismaMock.attendanceSession.findMany.mockResolvedValue([
    {
      id: "s-new",
      courseOfferingId: OFFERING_ID,
      attendanceDate: new Date("2026-09-15T00:00:00.000Z"),
      createdById: "teacher-user",
      createdAt: new Date("2026-09-15T08:00:00.000Z"),
      updatedAt: new Date("2026-09-15T09:30:00.000Z"),
      updateCount: 1,
    },
    {
      id: "s-old",
      courseOfferingId: OFFERING_ID,
      attendanceDate: new Date("2026-09-14T00:00:00.000Z"),
      createdById: "teacher-user",
      createdAt: new Date("2026-09-14T08:00:00.000Z"),
      updatedAt: new Date("2026-09-14T08:00:00.000Z"),
      updateCount: 0,
    },
  ]);
  prismaMock.attendanceRecord.groupBy.mockResolvedValue([
    { sessionId: "s-new", status: "PRESENT", _count: { _all: 38 } },
    { sessionId: "s-new", status: "ABSENT", _count: { _all: 2 } },
    { sessionId: "s-new", status: "LATE", _count: { _all: 1 } },
    { sessionId: "s-old", status: "PRESENT", _count: { _all: 41 } },
  ]);
}

type ReportBody = {
  data: { id: string; attendanceDate: string; updateCount: number; summary: Record<string, number> }[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  error?: { code: string; message: string };
};

async function body(res: Response) {
  return (await res.json()) as ReportBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  actor.role = "ADMIN";
  stubReportRows();
});

describe("GET /api/v1/course-offerings/{id}/attendance/sessions — admin report", () => {
  it("returns the paginated session report with summaries and update counts", async () => {
    const res = await call();
    expect(res.status).toBe(200);

    const json = await body(res);
    expect(json.data.map((i) => i.id)).toEqual(["s-new", "s-old"]);
    expect(json.data[0].attendanceDate).toBe("2026-09-15");
    expect(json.data[0].summary).toEqual({ total: 41, present: 38, absent: 2, late: 1, excused: 0 });
    expect(json.data[0].updateCount).toBe(1);
    expect(json.data[1].summary).toEqual({ total: 41, present: 41, absent: 0, late: 0, excused: 0 });
    expect(json.data[1].updateCount).toBe(0);
  });

  it("reports pagination meta the UI pager needs (meta.total stays the DB count)", async () => {
    const res = await call("?page=2&pageSize=10");
    const json = await body(res);

    expect(json.meta).toEqual({ page: 2, limit: 10, total: 2, totalPages: 1 });
    // page/pageSize reach the database as skip/take.
    const args = prismaMock.attendanceSession.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 10, take: 10 });
  });

  it("uses the default page size of 20 and the newest-date-first order", async () => {
    await call();
    const args = prismaMock.attendanceSession.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 0, take: 20, orderBy: { attendanceDate: "desc" } });
  });

  it("rejects a page size above the documented maximum instead of silently clamping", async () => {
    const res = await call("?pageSize=500");
    expect(res.status).toBe(422);
    expect(prismaMock.attendanceSession.findMany).not.toHaveBeenCalled();
  });

  it("accepts the maximum page size", async () => {
    await call("?pageSize=100");
    const args = prismaMock.attendanceSession.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it("scopes the report to the offering in the URL", async () => {
    await call("", "offering-42");
    const args = prismaMock.attendanceSession.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ courseOfferingId: "offering-42" });
  });

  it("passes the date range through as UTC-midnight day bounds", async () => {
    await call("?from=2026-09-01&to=2026-09-15");
    const args = prismaMock.attendanceSession.findMany.mock.calls[0][0];
    expect(args.where.attendanceDate.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(args.where.attendanceDate.lte.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("rejects an invalid date range instead of returning the whole report", async () => {
    const res = await call("?from=not-a-date");
    expect(res.status).toBe(422);
  });

  it("keeps an empty report well-formed (no sessions → empty list, real total)", async () => {
    prismaMock.attendanceSession.count.mockResolvedValue(0);
    prismaMock.attendanceSession.findMany.mockResolvedValue([]);

    const json = await body(await call());
    expect(json.data).toEqual([]);
    expect(json.meta.total).toBe(0);
    // No sessions → no aggregation query needed.
    expect(prismaMock.attendanceRecord.groupBy).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/course-offerings/{id}/attendance/sessions — access control", () => {
  it("rejects students (admins inspect, teachers are scoped)", async () => {
    actor.role = "STUDENT";
    const res = await call();
    expect(res.status).toBe(403);
    expect(prismaMock.attendanceSession.findMany).not.toHaveBeenCalled();
  });

  it("rejects a teacher with no active assignment on that offering", async () => {
    actor.role = "TEACHER";
    prismaMock.teacher.findUnique.mockResolvedValue({ id: "t1", userId: "report-actor", isActive: true });
    prismaMock.teacherCourseAssignment.findFirst.mockResolvedValue(null);

    const res = await call();
    expect(res.status).toBe(403);
    expect(prismaMock.attendanceSession.findMany).not.toHaveBeenCalled();
  });

  it("allows a teacher who is actively assigned", async () => {
    actor.role = "TEACHER";
    prismaMock.teacher.findUnique.mockResolvedValue({ id: "t1", userId: "report-actor", isActive: true });
    prismaMock.teacherCourseAssignment.findFirst.mockResolvedValue({ id: "a1", isActive: true });

    const res = await call();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toHaveLength(2);
  });
});
