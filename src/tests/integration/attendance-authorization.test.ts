import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Attendance authorization + context scoping at the API boundary.
 *
 * These suites drive the REAL route handlers
 * (`/api/v1/attendance/sessions`, `/sessions/{id}/records`,
 * `/sessions/{id}/history`, `/change-requests`, `/change-requests/{id}/approve`)
 * with a fixed actor and a canned Prisma stub, so the authorization matrix is
 * enforced by application code — not by the test:
 *
 *   ADMIN    view/approve/reject only — never save attendance
 *   TEACHER  must hold an ACTIVE assignment for the offering (IDOR protection)
 *   STUDENT  no attendance operational access at all
 *
 * It also pins the enrollment lookup: roll numbers are resolved from
 * StudentEnrollment using the FULL academic context (all five foreign keys),
 * never `sectionId` alone — the mistake that broke the history endpoint.
 */

type Row = Record<string, unknown>;
type ActorRole = "ADMIN" | "TEACHER" | "STUDENT";

const h = vi.hoisted(() => ({
  state: {
    role: "ADMIN" as ActorRole,
    teacher: null as Row | null,
    assignment: null as Row | null,
    session: null as Row | null,
    record: null as Row | null,
    enrollments: [] as Row[],
    calls: [] as { model: string; method: string; args: unknown }[],
  },
  spies: {
    saveSessionAttendance: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    getSessionHistory: vi.fn(),
    listChangeRequests: vi.fn(),
    createChangeRequest: vi.fn(),
    reviewChangeRequest: vi.fn(),
  },
}));

const { state, spies } = h;

/** Canned offering context: relations for the UI + sc (foreign keys) for lookups. */
const OFFERING_CONTEXT: Row = {
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

const SESSION_ROW: Row = {
  id: "sess-1",
  courseOfferingId: "off-1",
  attendanceDate: new Date("2026-09-15T00:00:00.000Z"),
  courseOffering: OFFERING_CONTEXT,
  records: [
    { id: "rec-1", status: "PRESENT", note: null, directCorrections: 1, student: { id: "stu-1" } },
  ],
};

const ENROLLMENT_ROWS: Row[] = [
  { rollNumber: 1, student: { id: "stu-1", studentId: "STU-001", user: { name: "Rahim", email: "rahim@school.test" } } },
  { rollNumber: 2, student: { id: "stu-2", studentId: "STU-002", user: { name: "Karim", email: "karim@school.test" } } },
];

function prismaStub() {
  const handlers: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {
    teacher: { findUnique: async () => state.teacher },
    teacherCourseAssignment: { findFirst: async () => state.assignment },
    studentEnrollment: { findMany: async () => state.enrollments },
    attendanceSession: { findUnique: async () => state.session },
    attendanceRecord: { findUnique: async () => state.record },
    user: { findMany: async () => [] },
    auditLog: { create: async () => ({ id: "audit-1" }) },
  };
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => async (...args: unknown[]) => {
          const name = String(method);
          state.calls.push({ model, method: name, args: args[0] });
          const handler = handlers[model]?.[name];
          return handler ? handler(...args) : null;
        },
      },
    );
  return new Proxy({}, { get: (_target, model) => modelProxy(String(model)) });
}

function callsOf(model: string, method: string) {
  return state.calls.filter((c) => c.model === model && c.method === method);
}

async function loadRoutes(role: ActorRole) {
  state.role = role;
  vi.resetModules();
  vi.doMock("@/lib/db/prisma", () => ({ prisma: prismaStub(), default: prismaStub() }));
  vi.doMock("@/lib/auth/session", () => ({
    requireAuth: async () => ({ userId: "actor-1", role: state.role, session: { sub: "actor-1" } }),
    requestMeta: () => ({ ip: null, userAgent: null }),
  }));
  // The route handlers under test keep their real logic; only the attendance
  // service functions are replaced (their DB work is exercised elsewhere).
  vi.doMock("@/modules/attendance/attendance.service", () => ({
    attendanceOfferingContextSelect: {
      id: true,
      academicYearId: true,
      tradeId: true,
      semesterId: true,
      shiftId: true,
      sectionId: true,
      course: { select: { title: true, code: true } },
      section: { select: { name: true } },
      semester: { select: { name: true } },
      trade: { select: { name: true, code: true } },
      shift: { select: { name: true } },
      academicYear: { select: { name: true } },
    },
    dateOnlyISO: (d: Date) => d.toISOString().slice(0, 10),
    saveSessionAttendance: spies.saveSessionAttendance,
    listSessions: spies.listSessions,
    getSession: spies.getSession,
    getSessionHistory: spies.getSessionHistory,
    listChangeRequests: spies.listChangeRequests,
    createChangeRequest: spies.createChangeRequest,
    reviewChangeRequest: spies.reviewChangeRequest,
    listAttendanceReport: vi.fn(),
  }));

  const sessions = await import("@/app/api/v1/attendance/sessions/route");
  const records = await import("@/app/api/v1/attendance/sessions/[sessionId]/records/route");
  const history = await import("@/app/api/v1/attendance/sessions/[sessionId]/history/route");
  const changeRequests = await import("@/app/api/v1/attendance/change-requests/route");
  const approve = await import("@/app/api/v1/attendance/change-requests/[id]/approve/route");
  return { sessions, records, history, changeRequests, approve };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const SAVE_BODY = {
  courseOfferingId: "off-1",
  attendanceDate: "2026-09-15",
  records: [{ studentId: "stu-1", status: "PRESENT" }],
};

async function errorBody(res: Response) {
  return (await res.json()) as { error: { code: string; message: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.teacher = { id: "teacher-1", userId: "actor-1", isActive: true };
  state.assignment = null;
  state.session = SESSION_ROW;
  state.record = { id: "rec-1", status: "PRESENT", session: { courseOfferingId: "off-1" } };
  state.enrollments = ENROLLMENT_ROWS;
  spies.saveSessionAttendance.mockResolvedValue({ sessionId: "sess-1", isNewSession: true, createdCount: 1, updatedCount: 0, skipped: [] });
  spies.listSessions.mockResolvedValue([]);
  spies.getSession.mockResolvedValue(null);
  spies.getSessionHistory.mockResolvedValue({ session: { id: "sess-1" }, students: [], history: [] });
  spies.listChangeRequests.mockResolvedValue({ items: [], total: 0 });
  spies.createChangeRequest.mockResolvedValue({ id: "req-1" });
  spies.reviewChangeRequest.mockResolvedValue({ id: "req-1", status: "APPROVED" });
});

describe("POST /api/v1/attendance/sessions — admin is read-only", () => {
  it("rejects an ADMIN save with 403 and never reaches the service", async () => {
    const { sessions } = await loadRoutes("ADMIN");
    const res = await sessions.POST(jsonRequest("http://localhost/api/v1/attendance/sessions", "POST", SAVE_BODY));

    expect(res.status).toBe(403);
    const body = await errorBody(res);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toMatch(/read-only/i);
    expect(spies.saveSessionAttendance).not.toHaveBeenCalled();
  });

  it("rejects a STUDENT with 403", async () => {
    const { sessions } = await loadRoutes("STUDENT");
    const res = await sessions.POST(jsonRequest("http://localhost/api/v1/attendance/sessions", "POST", SAVE_BODY));
    expect(res.status).toBe(403);
    expect(spies.saveSessionAttendance).not.toHaveBeenCalled();
  });

  it("rejects a TEACHER without an active assignment for the offering (IDOR)", async () => {
    state.assignment = null;
    const { sessions } = await loadRoutes("TEACHER");
    const res = await sessions.POST(jsonRequest("http://localhost/api/v1/attendance/sessions", "POST", SAVE_BODY));
    expect(res.status).toBe(403);
    expect(spies.saveSessionAttendance).not.toHaveBeenCalled();
  });

  it("allows the ASSIGNED teacher to save (isAdmin is always false)", async () => {
    state.assignment = { id: "asg-1", courseOfferingId: "off-1", teacherId: "teacher-1", isActive: true };
    const { sessions } = await loadRoutes("TEACHER");
    const res = await sessions.POST(jsonRequest("http://localhost/api/v1/attendance/sessions", "POST", SAVE_BODY));

    expect(res.status).toBe(200);
    expect(spies.saveSessionAttendance).toHaveBeenCalledTimes(1);
    expect(spies.saveSessionAttendance.mock.calls[0][0]).toMatchObject({
      courseOfferingId: "off-1",
      actorUserId: "actor-1",
      isAdmin: false,
    });
  });
});

describe("GET /api/v1/attendance/sessions/{id}/records — Student Status", () => {
  it("forbids STUDENT", async () => {
    const { records } = await loadRoutes("STUDENT");
    const res = await records.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/records", "GET"), { params: { sessionId: "sess-1" } });
    expect(res.status).toBe(403);
  });

  it("forbids a teacher who is not assigned to the offering of the session", async () => {
    state.assignment = null;
    const { records } = await loadRoutes("TEACHER");
    const res = await records.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/records", "GET"), { params: { sessionId: "sess-1" } });
    expect(res.status).toBe(403);
  });

  it("returns the complete section roster to an ADMIN, including unmarked students", async () => {
    const { records } = await loadRoutes("ADMIN");
    const res = await records.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/records", "GET"), { params: { sessionId: "sess-1" } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { records: { studentId: string; rollNumber: number; status: string; hasRecord: boolean }[] } };
    expect(body.data.records).toHaveLength(2);
    expect(body.data.records[0]).toMatchObject({ studentId: "STU-001", rollNumber: 1, status: "PRESENT", hasRecord: true });
    // stu-2 has no AttendanceRecord for this session yet.
    expect(body.data.records[1]).toMatchObject({ studentId: "STU-002", rollNumber: 2, status: "NOT_MARKED", hasRecord: false });
  });

  it("scopes the enrollment lookup by the full academic context, never sectionId alone", async () => {
    const { records } = await loadRoutes("ADMIN");
    await records.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/records", "GET"), { params: { sessionId: "sess-1" } });

    const [call] = callsOf("studentEnrollment", "findMany");
    expect(call).toBeDefined();
    expect(call.args).toMatchObject({
      where: {
        academicYearId: "year-1",
        tradeId: "trade-1",
        semesterId: "sem-1",
        shiftId: "shift-1",
        sectionId: "sec-1",
        status: "ACTIVE",
      },
      orderBy: { rollNumber: "asc" },
    });
  });
});

describe("GET /api/v1/attendance/sessions/{id}/history — session-scoped history", () => {
  it("forbids a teacher who is not assigned to the offering", async () => {
    state.assignment = null;
    const { history } = await loadRoutes("TEACHER");
    const res = await history.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/history", "GET"), { params: { sessionId: "sess-1" } });
    expect(res.status).toBe(403);
    expect(spies.getSessionHistory).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to read the immutable change log of any session", async () => {
    const { history } = await loadRoutes("ADMIN");
    const res = await history.GET(jsonRequest("http://localhost/api/v1/attendance/sessions/sess-1/history", "GET"), { params: { sessionId: "sess-1" } });
    expect(res.status).toBe(200);
    expect(spies.getSessionHistory).toHaveBeenCalledWith("sess-1");
  });
});

describe("Attendance change requests — teacher files, admin reviews", () => {
  it("GET is admin-only", async () => {
    const { changeRequests } = await loadRoutes("TEACHER");
    const res = await changeRequests.GET(jsonRequest("http://localhost/api/v1/attendance/change-requests?status=PENDING", "GET"));
    expect(res.status).toBe(403);
    expect(spies.listChangeRequests).not.toHaveBeenCalled();
  });

  it("GET rejects an unknown status filter with 422 (no unchecked enum coercion)", async () => {
    const { changeRequests } = await loadRoutes("ADMIN");
    const res = await changeRequests.GET(jsonRequest("http://localhost/api/v1/attendance/change-requests?status=SOMETHING_ELSE", "GET"));
    expect(res.status).toBe(422);
    expect(spies.listChangeRequests).not.toHaveBeenCalled();
  });

  it("POST forbids ADMIN (admins approve; they never file requests)", async () => {
    const { changeRequests } = await loadRoutes("ADMIN");
    const res = await changeRequests.POST(jsonRequest("http://localhost/api/v1/attendance/change-requests", "POST", { recordId: "rec-1", newStatus: "ABSENT", reason: "Wrong" }));
    expect(res.status).toBe(403);
    expect(spies.createChangeRequest).not.toHaveBeenCalled();
  });

  it("POST forbids a teacher who is not assigned to the record's offering", async () => {
    state.assignment = null;
    const { changeRequests } = await loadRoutes("TEACHER");
    const res = await changeRequests.POST(jsonRequest("http://localhost/api/v1/attendance/change-requests", "POST", { recordId: "rec-1", newStatus: "ABSENT", reason: "Wrong" }));
    expect(res.status).toBe(403);
    expect(spies.createChangeRequest).not.toHaveBeenCalled();
  });

  it("POST lets the assigned teacher file a request", async () => {
    state.assignment = { id: "asg-1", courseOfferingId: "off-1", teacherId: "teacher-1", isActive: true };
    const { changeRequests } = await loadRoutes("TEACHER");
    const res = await changeRequests.POST(jsonRequest("http://localhost/api/v1/attendance/change-requests", "POST", { recordId: "rec-1", newStatus: "ABSENT", reason: "Wrong" }));
    expect(res.status).toBe(201);
    expect(spies.createChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ recordId: "rec-1", newStatus: "ABSENT", requestedById: "actor-1" }));
  });

  it("POST /approve is admin-only", async () => {
    const { approve } = await loadRoutes("TEACHER");
    const res = await approve.POST(jsonRequest("http://localhost/api/v1/attendance/change-requests/req-1/approve", "POST", {}), { params: { id: "req-1" } });
    expect(res.status).toBe(403);
    expect(spies.reviewChangeRequest).not.toHaveBeenCalled();
  });

  it("POST /approve lets an ADMIN approve (the only admin path that changes attendance)", async () => {
    const { approve } = await loadRoutes("ADMIN");
    const res = await approve.POST(jsonRequest("http://localhost/api/v1/attendance/change-requests/req-1/approve", "POST", {}), { params: { id: "req-1" } });
    expect(res.status).toBe(200);
    expect(spies.reviewChangeRequest).toHaveBeenCalledWith("req-1", expect.objectContaining({ approve: true, reviewedById: "actor-1" }));
  });
});
