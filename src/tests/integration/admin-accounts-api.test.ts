import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isSessionCurrent } from "@/lib/auth/token";
import {
  createFakePrisma,
  createFakePrismaState,
  foreignKeyError,
  uniqueConstraintError,
  type FakeRole,
  type FakeUser,
} from "../helpers/user-db";

/**
 * Admin account management at the API boundary (`GET/POST /api/v1/admin/users`,
 * `DELETE /api/v1/admin/users/{userId}`).
 *
 * The real route handlers and the real services run against a fake database: listing
 * keeps the existing ADMIN-wide read policy, while creating and deleting admin accounts
 * is scoped to the persisted protected seed admin — normal admins must not be able to
 * create, delete or modify anything here.
 */

const h = vi.hoisted(() => ({
  state: {
    users: [],
    auditLogs: [],
    calls: [],
  } as import("../helpers/user-db").FakePrismaState,
  actorId: null as string | null,
}));

const state = h.state;
const ADMIN_PASSWORD = "Current-Password1";
let passwordHash = "";

function fakeUser(overrides: Partial<FakeUser> & { id: string; email: string }): FakeUser {
  return {
    name: "Test User",
    role: "ADMIN" as FakeRole,
    isActive: true,
    isProtectedSeedAdmin: false,
    passwordHash,
    sessionVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function userById(id: string): FakeUser {
  const found = state.users.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fake user ${id} not found`);
  return found;
}

function callsOf(model: string, method: string) {
  return state.calls.filter((call) => call.model === model && call.method === method);
}

async function loadRoutes(actor: FakeUser | null) {
  h.actorId = actor?.id ?? null;
  vi.resetModules();
  const prisma = createFakePrisma(state);
  vi.doMock("@/lib/db/prisma", () => ({ prisma, default: prisma }));
  vi.doMock("@/lib/auth/session", () => ({
    requireAuth: async () => {
      const current = state.users.find((candidate) => candidate.id === h.actorId);
      if (!current || !current.isActive) {
        const { unauthorized } = await import("@/lib/errors/errors");
        throw unauthorized();
      }
      return {
        session: { sub: current.id, email: current.email, name: current.name, role: current.role, sv: current.sessionVersion },
        userId: current.id,
        role: current.role,
        sessionVersion: current.sessionVersion,
        isProtectedSeedAdmin: current.isProtectedSeedAdmin,
      };
    },
    requestMeta: () => ({ ip: "127.0.0.1", userAgent: "vitest" }),
  }));
  const collection = await import("@/app/api/v1/admin/users/route");
  const member = await import("@/app/api/v1/admin/users/[userId]/route");
  return { collection, member };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deleteRequest(userId: string) {
  return jsonRequest(`http://localhost/api/v1/admin/users/${userId}`, "DELETE");
}

async function errorBody(res: Response) {
  return (await res.json()) as {
    error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
  };
}

const LIST_URL = "http://localhost/api/v1/admin/users";

beforeAll(async () => {
  passwordHash = await hashPassword(ADMIN_PASSWORD);
});

beforeEach(() => {
  state.users = [
    fakeUser({ id: "seed-1", email: "seed@example.edu", name: "Seed Admin", isProtectedSeedAdmin: true }),
    fakeUser({ id: "admin-1", email: "admin@example.edu", name: "Plain Admin" }),
    fakeUser({ id: "admin-history", email: "history@example.edu", name: "Historic Admin", counts: { auditLogs: 4, marksEntered: 2 } }),
    fakeUser({ id: "teacher-1", email: "teacher@example.edu", name: "Tea Cher", role: "TEACHER" }),
    fakeUser({ id: "student-1", email: "student@example.edu", name: "Stu Dent", role: "STUDENT" }),
  ];
  state.auditLogs = [];
  state.calls = [];
  state.failCreateWith = undefined;
  state.failDeleteWith = undefined;
  state.failUpdateWith = undefined;
  state.forceUpdateManyCount = undefined;
});

describe("GET /api/v1/admin/users", () => {
  it("lists administrators for the seed admin, protected account first", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));
    const res = await collection.GET(jsonRequest(LIST_URL, "GET"));
    const text = await res.clone().text();

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; email: string; isProtectedSeedAdmin: boolean }[];
      meta: { total: number; canManage: boolean };
    };
    expect(body.meta.canManage).toBe(true);
    expect(body.data.map((account) => account.id)).toEqual(["seed-1", "admin-1", "admin-history"]);
    expect(body.data[0].isProtectedSeedAdmin).toBe(true);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain(passwordHash);
  });

  it("keeps the existing ADMIN read policy but reports that management is not allowed", async () => {
    const { collection } = await loadRoutes(userById("admin-1"));
    const res = await collection.GET(jsonRequest(LIST_URL, "GET"));
    const body = (await res.json()) as { data: unknown[]; meta: { canManage: boolean } };

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.meta.canManage).toBe(false);
  });

  it("forbids teachers and students", async () => {
    const teacher = await loadRoutes(userById("teacher-1"));
    expect((await teacher.collection.GET(jsonRequest(LIST_URL, "GET"))).status).toBe(403);

    const student = await loadRoutes(userById("student-1"));
    expect((await student.collection.GET(jsonRequest(LIST_URL, "GET"))).status).toBe(403);
  });

  it("rejects unauthenticated callers", async () => {
    const anonymous = await loadRoutes(null);
    expect((await anonymous.collection.GET(jsonRequest(LIST_URL, "GET"))).status).toBe(401);
  });
});

describe("POST /api/v1/admin/users", () => {
  const body = { name: "New Admin", email: "new.admin@example.edu", password: "Initial-Password1" };

  it("lets the protected seed admin create a normal admin account", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));
    const res = await collection.POST(jsonRequest(LIST_URL, "POST", body));
    const text = await res.clone().text();

    expect(res.status).toBe(201);
    const created = (await (await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, email: "second.admin@example.edu" }))).json()) as {
      data: { id: string; email: string; role: string; isActive: boolean; isProtectedSeedAdmin: boolean };
    };

    const first = (await res.json()) as { data: { id: string; email: string; role: string; isActive: boolean; isProtectedSeedAdmin: boolean } };
    expect(first.data).toMatchObject({ email: "new.admin@example.edu", role: "ADMIN", isActive: true, isProtectedSeedAdmin: false });

    // Password is stored as a bcrypt hash — never plaintext, never echoed back.
    const stored = userById(first.data.id);
    expect(stored.passwordHash).not.toBe(body.password);
    expect(await verifyPassword(body.password, stored.passwordHash)).toBe(true);
    expect(text).not.toContain(body.password);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain(stored.passwordHash);

    expect(state.auditLogs.map((log) => log.action)).toContain("admin.create");
    expect(JSON.stringify(state.auditLogs)).not.toContain(body.password);

    // The freshly created account exists with the normal ADMIN role...
    expect(created.data).toMatchObject({ role: "ADMIN", email: "second.admin@example.edu" });

    // ...but it is NOT a seed admin: its own admin-management calls are rejected.
    const newAdmin = userById(created.data.id);
    const asNewAdmin = await loadRoutes(newAdmin);
    const attempt = await asNewAdmin.collection.POST(
      jsonRequest(LIST_URL, "POST", { name: "Third", email: "third@example.edu", password: "Initial-Password1" }),
    );
    expect(attempt.status).toBe(403);
    expect((await errorBody(attempt)).error.code).toBe("FORBIDDEN");
    expect(state.auditLogs.map((log) => log.action)).toContain("admin.manage.rejected");
    // seed admin + original admin + historic admin + the two created accounts — the
    // rejected attempt created nothing.
    expect(state.users.filter((user) => user.role === "ADMIN")).toHaveLength(5);
  });

  it("rejects a normal admin, teacher or student with 403 and creates nothing", async () => {
    for (const actorId of ["admin-1", "teacher-1", "student-1"]) {
      const { collection } = await loadRoutes(userById(actorId));
      const res = await collection.POST(jsonRequest(LIST_URL, "POST", body));
      expect(res.status).toBe(403);
    }
    expect(callsOf("user", "create")).toHaveLength(0);
    expect(state.auditLogs.map((log) => log.action)).toContain("admin.manage.rejected");
  });

  it("rejects unauthenticated callers", async () => {
    const anonymous = await loadRoutes(null);
    expect((await anonymous.collection.POST(jsonRequest(LIST_URL, "POST", body))).status).toBe(401);
    expect(callsOf("user", "create")).toHaveLength(0);
  });

  it("validates name, email and the password policy on the backend", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));

    const weak = await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, password: "short" }));
    expect(weak.status).toBe(422);
    expect((await errorBody(weak)).error.details?.fieldErrors?.password?.[0]).toMatch(/at least 8/i);

    const badEmail = await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, email: "not-an-email" }));
    expect(badEmail.status).toBe(422);

    const blankName = await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, name: "  " }));
    expect(blankName.status).toBe(422);

    expect(callsOf("user", "create")).toHaveLength(0);
  });

  it("never lets the client assign the protected seed-admin flag or another role", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));

    const forgedFlag = await collection.POST(
      jsonRequest(LIST_URL, "POST", { ...body, isProtectedSeedAdmin: true, role: "SUPER_ADMIN", sessionVersion: 5 }),
    );

    expect(forgedFlag.status).toBe(422);
    expect(callsOf("user", "create")).toHaveLength(0);
    expect(state.users.filter((user) => user.isProtectedSeedAdmin)).toHaveLength(1);
  });

  it("rejects a duplicate email (case-insensitively) with a field error", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));
    const res = await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, email: "ADMIN@Example.edu" }));

    expect(res.status).toBe(409);
    const payload = await errorBody(res);
    expect(payload.error.details?.fieldErrors?.email?.[0]).toMatch(/already in use/i);
    expect(callsOf("user", "create")).toHaveLength(0);
  });

  it("handles a concurrent duplicate creation safely (unique-constraint race)", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));
    state.failCreateWith = uniqueConstraintError("email");

    const res = await collection.POST(jsonRequest(LIST_URL, "POST", body));
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error.details?.fieldErrors?.email).toBeTruthy();
  });

  it("normalizes the email before storing it", async () => {
    const { collection } = await loadRoutes(userById("seed-1"));
    await collection.POST(jsonRequest(LIST_URL, "POST", { ...body, email: "  Mixed.Case@Example.EDU " }));
    expect(userById("seed-1")).toBeTruthy();
    expect(state.users.some((user) => user.email === "mixed.case@example.edu")).toBe(true);
  });
});

describe("DELETE /api/v1/admin/users/{userId}", () => {
  it("lets the seed admin delete an admin account that has no history", async () => {
    const { member } = await loadRoutes(userById("seed-1"));
    const res = await member.DELETE(deleteRequest("admin-1"), { params: { userId: "admin-1" } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mode: string; user: { email: string } } };
    expect(body.data.mode).toBe("deleted");
    expect(body.data.user.email).toBe("admin@example.edu");

    // The row is gone: the same lookup `getAuth` performs finds nothing, so every
    // session token that admin held is unusable.
    expect(state.users.some((user) => user.id === "admin-1")).toBe(false);
    expect(state.auditLogs.map((log) => log.action)).toContain("admin.delete");
  });

  it("deactivates (instead of deleting) an admin that has history, and revokes access", async () => {
    const beforeVersion = userById("admin-history").sessionVersion;
    const { member } = await loadRoutes(userById("seed-1"));
    const res = await member.DELETE(deleteRequest("admin-history"), { params: { userId: "admin-history" } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mode: string; preservedHistory: string[] } };
    expect(body.data.mode).toBe("deactivated");
    expect(body.data.preservedHistory.join(" ")).toMatch(/audit history/i);

    const after = userById("admin-history");
    expect(after.isActive).toBe(false);
    expect(after.sessionVersion).toBe(beforeVersion + 1);
    // Existing tokens stop matching the stored epoch, and the account is inactive, so
    // `getAuth` refuses them.
    expect(isSessionCurrent({ sv: beforeVersion }, after)).toBe(false);
    expect(state.auditLogs.map((log) => log.action)).toContain("admin.deactivate");
  });

  it("falls back to deactivation when a dependent record appears during the delete", async () => {
    const { member } = await loadRoutes(userById("seed-1"));
    state.failDeleteWith = foreignKeyError();

    const res = await member.DELETE(deleteRequest("admin-1"), { params: { userId: "admin-1" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mode: string } };
    expect(body.data.mode).toBe("deactivated");
    expect(userById("admin-1").isActive).toBe(false);
  });

  it("never allows the protected seed admin to be deleted — not even by itself", async () => {
    const { member } = await loadRoutes(userById("seed-1"));
    const res = await member.DELETE(deleteRequest("seed-1"), { params: { userId: "seed-1" } });

    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.message).toMatch(/protected seed admin/i);
    expect(callsOf("user", "deleteMany")).toHaveLength(0);
    expect(userById("seed-1")).toMatchObject({ isActive: true, isProtectedSeedAdmin: true });
    expect(state.auditLogs.map((log) => log.action)).toContain("seed_admin.delete.rejected");
  });

  it("does not let a normal admin delete the protected seed admin or anyone else", async () => {
    const { member } = await loadRoutes(userById("admin-1"));

    const againstSeed = await member.DELETE(deleteRequest("seed-1"), { params: { userId: "seed-1" } });
    expect(againstSeed.status).toBe(403);

    const againstPeer = await member.DELETE(deleteRequest("admin-history"), { params: { userId: "admin-history" } });
    expect(againstPeer.status).toBe(403);

    expect(callsOf("user", "deleteMany")).toHaveLength(0);
    expect(callsOf("user", "updateMany")).toHaveLength(0);
    expect(userById("admin-history").isActive).toBe(true);
    expect(state.auditLogs.map((log) => log.action)).toContain("admin.manage.rejected");
  });

  it("forbids teachers and students entirely", async () => {
    const teacher = await loadRoutes(userById("teacher-1"));
    expect((await teacher.member.DELETE(deleteRequest("admin-1"), { params: { userId: "admin-1" } })).status).toBe(403);

    const student = await loadRoutes(userById("student-1"));
    expect((await student.member.DELETE(deleteRequest("admin-1"), { params: { userId: "admin-1" } })).status).toBe(403);

    expect(userById("admin-1").isActive).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const anonymous = await loadRoutes(null);
    const res = await anonymous.member.DELETE(deleteRequest("admin-1"), { params: { userId: "admin-1" } });
    expect(res.status).toBe(401);
    expect(userById("admin-1").isActive).toBe(true);
  });

  it("returns 404 for an unknown account and 422 for a non-admin target", async () => {
    const { member } = await loadRoutes(userById("seed-1"));

    const missing = await member.DELETE(deleteRequest("does-not-exist"), { params: { userId: "does-not-exist" } });
    expect(missing.status).toBe(404);

    const notAnAdmin = await member.DELETE(deleteRequest("student-1"), { params: { userId: "student-1" } });
    expect(notAnAdmin.status).toBe(422);
    expect((await errorBody(notAnAdmin)).error.details?.fieldErrors?.userId).toBeTruthy();
    expect(state.users.some((user) => user.id === "student-1")).toBe(true);
  });
});
