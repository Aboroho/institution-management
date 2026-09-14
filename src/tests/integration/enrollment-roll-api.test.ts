import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Roll-number contract at the API boundary (README §6/§34): the roll number is required
 * on every enrollment, a positive whole number within the API's upper bound, and admin
 * authorization runs before anything else.
 *
 * The route suites drive the REAL `POST /api/v1/enrollments` and
 * `PATCH /api/v1/enrollments/{id}` handlers, so dropping `rollNumber` from either route
 * schema fails this file. Only test infrastructure is stubbed: the session module (a fixed
 * actor) and the Prisma client module (a null-returning shim, so no generated client or
 * database is needed — validation rejects run before any query anyway). Request parsing,
 * Zod validation, authorization checks and error mapping are real application code.
 *
 * A final section runs the service + database constraints against a real DATABASE_URL,
 * skipped when absent (same convention as the other integration tests).
 */
const { HAS_DB, actor } = vi.hoisted(() => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  process.env.AUTH_SECRET ??= "enrollment-roll-api-test-secret-0000000000";
  return { HAS_DB: hasDb, actor: { role: "ADMIN" as "ADMIN" | "TEACHER" | "STUDENT" } };
});

/** Every prisma.<model>.<method>() resolves to a null result; the routes under test must not need more. */
function prismaShim(): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get: () =>
      new Proxy({} as Record<string, unknown>, {
        get: () => async () => null,
      }),
  });
}

async function loadRoutes() {
  vi.resetModules();
  vi.doMock("@/lib/db/prisma", () => ({ prisma: prismaShim(), default: prismaShim() }));
  vi.doMock("@/lib/auth/session", () => ({
    requireAuth: async () => ({ userId: "roll-test-actor", role: actor.role, session: { sub: "roll-test-actor" } }),
    requestMeta: () => ({ ip: null, userAgent: null }),
  }));
  const { POST } = await import("@/app/api/v1/enrollments/route");
  const { PATCH } = await import("@/app/api/v1/enrollments/[id]/route");
  return { POST, PATCH };
}

import { NextRequest } from "next/server";

const validContext = {
  studentId: "student-cuid",
  academicYearId: "year-id",
  tradeId: "trade-id",
  semesterId: "semester-id",
  shiftId: "shift-id",
  sectionId: "section-id",
};

function postEnrollment(body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/v1/enrollments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return loadRoutes().then(({ POST }) => POST(req));
}

function patchEnrollment(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/v1/enrollments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return loadRoutes().then(({ PATCH }) => PATCH(req, { params: { id } }));
}

async function errorBody(res: Response) {
  return (await res.json()) as { error: { code: string; message: string; details: { fieldErrors?: Record<string, string[]> } | null } };
}

describe("POST /api/v1/enrollments — roll number is required", () => {
  it.each([
    ["an absent field", {}],
    ["an empty string", { rollNumber: "" }],
    ["whitespace only", { rollNumber: "   " }],
    ["null", { rollNumber: null }],
  ])("rejects %s with 422 and a rollNumber field error", async (_label, extra) => {
    const res = await postEnrollment({ ...validContext, ...extra });
    expect(res.status).toBe(422);
    const body = await errorBody(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.fieldErrors?.rollNumber?.[0]).toBe("Roll number is required");
  });

  it.each([
    [0, "Roll number must be 1 or greater"],
    [-3, "Roll number must be 1 or greater"],
    [1.5, "Roll number must be a whole number"],
    [1_000_000, "Roll number is too large"],
    ["abc", "Roll number must be a number"],
  ])("rejects the invalid value %j with 422", async (rollNumber, message) => {
    const res = await postEnrollment({ ...validContext, rollNumber });
    expect(res.status).toBe(422);
    const body = await errorBody(res);
    expect(body.error.details?.fieldErrors?.rollNumber?.[0]).toContain(message);
  });

  it("accepts a numeric string and proceeds past validation", async () => {
    const res = await postEnrollment({ ...validContext, rollNumber: "12" });
    // Deliberately not 422: the schema let the value through and the handler moved on to
    // the database (a null student from the shim, or a missing row in a real test DB → 404).
    expect(res.status).not.toBe(422);
    expect([404, 201, 409]).toContain(res.status);
  });

  it("enforces admin authorization before validation (teachers get 403)", async () => {
    actor.role = "TEACHER";
    try {
      const res = await postEnrollment({ ...validContext }); // no rollNumber at all — yet 403, not 422
      expect(res.status).toBe(403);
      const body = await errorBody(res);
      expect(body.error.code).toBe("FORBIDDEN");
    } finally {
      actor.role = "ADMIN";
    }
  });
});

describe("PATCH /api/v1/enrollments/{id} — corrections require a valid roll", () => {
  it("rejects an absent roll number with 422", async () => {
    const res = await patchEnrollment("enrollment-id", {});
    expect(res.status).toBe(422);
    const json = await errorBody(res);
    expect(json.error.details?.fieldErrors?.rollNumber?.[0]).toBe("Roll number is required");
  });

  it.each([[{ rollNumber: "" }], [{ rollNumber: null }], [{ rollNumber: 2.5 }], [{ rollNumber: 0 }]])(
    "rejects body %j with 422",
    async (body) => {
      const res = await patchEnrollment("enrollment-id", body);
      expect(res.status).toBe(422);
      const json = await errorBody(res);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.details?.fieldErrors?.rollNumber).toBeDefined();
    },
  );
});

// ---- Service + database guarantees (README §1.6: important invariants live in the database).
// Real DB required; skipped otherwise. The prisma shim must not leak into this suite, and the
// session module no longer needs faking because these call the service layer directly.
type AcademicContext = { academicYearId: string; tradeId: string; semesterId: string; shiftId: string };
type Ctx = {
  prisma: import("@prisma/client").PrismaClient;
  students: typeof import("@/modules/students/students.service");
  sectionA: string;
  sectionB: string;
  studentA: string;
  studentB: string;
  context: AcademicContext;
};
const ctx: Partial<Ctx> = {};
const tag = `rolltest${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)("createEnrollment + StudentEnrollment constraints (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    vi.doUnmock("@/lib/db/prisma");
    vi.doUnmock("@/lib/auth/session");
    vi.resetModules();
    const { prisma } = await import("@/lib/db/prisma");
    const students = await import("@/modules/students/students.service");

    const year = await prisma.academicYear.create({ data: { name: `AY-${tag}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    const trade = await prisma.trade.create({ data: { name: `Test Trade ${tag}`, code: tag } });
    const semester = await prisma.semester.create({ data: { tradeId: trade.id, number: 1, name: "Semester 1" } });
    const shift = await prisma.shift.create({ data: { name: `Morning ${tag}`, code: tag } });
    const sectionA = await prisma.section.create({ data: { academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id, name: "A" } });
    const sectionB = await prisma.section.create({ data: { academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id, name: "B" } });

    const mkStudent = async (n: number) => {
      const user = await prisma.user.create({ data: { email: `${tag}${n}@test.invalid`, name: `Roll Test ${n}`, passwordHash: "not-a-real-hash", role: "STUDENT" } });
      const student = await prisma.student.create({ data: { userId: user.id, studentId: `RT-${tag}-${n}` } });
      return student.id;
    };

    Object.assign(ctx, {
      prisma, students,
      studentA: await mkStudent(1),
      studentB: await mkStudent(2),
      sectionA: sectionA.id, sectionB: sectionB.id,
      context: { academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id },
    });
  });

  afterAll(async () => {
    if (!ctx.prisma) return;
    const p = ctx.prisma;
    await p.studentEnrollment.deleteMany({ where: { studentId: { in: [ctx.studentA!, ctx.studentB!] } } });
    for (const id of [ctx.studentA!, ctx.studentB!]) {
      const s = await p.student.findUnique({ where: { id }, select: { userId: true } });
      await p.student.delete({ where: { id } });
      if (s) await p.user.delete({ where: { id: s.userId } });
    }
    await p.section.deleteMany({ where: { academicYear: { name: `AY-${tag}` } } });
    await p.semester.deleteMany({ where: { trade: { code: tag } } });
    await p.shift.deleteMany({ where: { code: tag } });
    await p.trade.deleteMany({ where: { code: tag } });
    await p.academicYear.deleteMany({ where: { name: `AY-${tag}` } });
    await p.$disconnect();
  });

  it("rejects a duplicate roll number inside the same section with a field-specific 409", async () => {
    await ctx.students!.createEnrollment({ ...ctx.context!, studentId: ctx.studentA!, sectionId: ctx.sectionA!, rollNumber: 7 });
    await expect(
      ctx.students!.createEnrollment({ ...ctx.context!, studentId: ctx.studentB!, sectionId: ctx.sectionA!, rollNumber: 7 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { fieldErrors: { rollNumber: [expect.stringContaining("already used in section")] } },
    });
  });

  it("allows the same roll number in a different section", async () => {
    await expect(
      ctx.students!.createEnrollment({ ...ctx.context!, studentId: ctx.studentB!, sectionId: ctx.sectionB!, rollNumber: 7 }),
    ).resolves.toMatchObject({ rollNumber: 7 });
  });

  it("the database unique index also catches inserts that skip the service pre-check", async () => {
    const p = ctx.prisma!;
    await expect(
      p.studentEnrollment.create({ data: { ...ctx.context!, studentId: ctx.studentB!, sectionId: ctx.sectionA!, rollNumber: 7 } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("nextAvailableRollNumber returns the number after the highest one in use", async () => {
    await ctx.students!.createEnrollment({ ...ctx.context!, studentId: ctx.studentA!, sectionId: ctx.sectionB!, rollNumber: 12 });
    await expect(ctx.students!.nextAvailableRollNumber(ctx.sectionB!)).resolves.toBe(13);
  });
});
