import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sessionCookieName, verifySession } from "@/lib/auth/token";
import {
  createFakePrisma,
  createFakePrismaState,
  uniqueConstraintError,
  type FakeRole,
  type FakeUser,
} from "../helpers/user-db";

/**
 * Profile + password management at the API boundary.
 *
 * These suites drive the REAL route handlers (`GET/PATCH /api/v1/users/me` and
 * `POST /api/v1/users/me/change-password`) against a fake database and a session stub
 * that mirrors `getAuth` (inactive accounts are unauthorized). Everything else — Zod
 * validation, ownership, seed-admin protection, bcrypt verification, the
 * compare-and-swap password write and the session rotation — is the production code.
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
const PASSWORD = "Current-Password1";

let passwordHash = "";

function fakeUser(overrides: Partial<FakeUser> & { id: string; email: string }): FakeUser {
  return {
    name: "Test User",
    role: "STUDENT" as FakeRole,
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
  // Session stub with the same decision rules as the real `getAuth` (the account is
  // re-read on every request; inactive accounts are unauthorized).
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
  const me = await import("@/app/api/v1/users/me/route");
  const changePassword = await import("@/app/api/v1/users/me/change-password/route");
  return { me, changePassword };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorBody(res: Response) {
  return (await res.json()) as {
    error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
  };
}

async function sessionCookie(res: Response) {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${sessionCookieName()}=([^;]+)`));
  return match?.[1] ?? null;
}

const ME_URL = "http://localhost/api/v1/users/me";
const PASSWORD_URL = "http://localhost/api/v1/users/me/change-password";

beforeAll(async () => {
  // Real bcrypt hashing (cost 12) — computed once so the tests stay fast while the
  // verification path remains the production one.
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  state.users = [
    fakeUser({ id: "student-1", email: "student@example.edu", name: "Stu Dent", role: "STUDENT" }),
    fakeUser({ id: "teacher-1", email: "teacher@example.edu", name: "Tea Cher", role: "TEACHER" }),
    fakeUser({ id: "admin-1", email: "admin@example.edu", name: "Ad Min", role: "ADMIN" }),
    fakeUser({
      id: "seed-1",
      email: "seed@example.edu",
      name: "Seed Admin",
      role: "ADMIN",
      isProtectedSeedAdmin: true,
    }),
    fakeUser({ id: "student-2", email: "other@example.edu", name: "Other Student", role: "STUDENT" }),
  ];
  state.auditLogs = [];
  state.calls = [];
  state.failCreateWith = undefined;
  state.failDeleteWith = undefined;
  state.failUpdateWith = undefined;
  state.forceUpdateManyCount = undefined;
});

describe("GET /api/v1/users/me", () => {
  it("returns the caller's own profile without any credential material", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    const res = await me.GET();
    const text = await res.clone().text();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; isProtectedSeedAdmin: boolean } };
    expect(body.data.id).toBe("student-1");
    expect(body.data.isProtectedSeedAdmin).toBe(false);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain(passwordHash);
  });

  it("exposes the protected marker so the UI can render the read-only view", async () => {
    const { me } = await loadRoutes(userById("seed-1"));
    const body = (await (await me.GET()).json()) as { data: { isProtectedSeedAdmin: boolean } };
    expect(body.data.isProtectedSeedAdmin).toBe(true);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const { me } = await loadRoutes(null);
    const res = await me.GET();
    expect(res.status).toBe(401);
    expect((await errorBody(res)).error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /api/v1/users/me", () => {
  it.each([
    ["STUDENT", "student-1"],
    ["TEACHER", "teacher-1"],
    ["ADMIN", "admin-1"],
  ])("lets a %s update their own name and email", async (role, userId) => {
    const actor = userById(userId);
    const { me } = await loadRoutes(actor);

    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Updated Name", email: "  Updated@Example.COM " }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { id: string; name: string; email: string; role: string }; emailChanged: boolean } };
    expect(body.data.user).toMatchObject({ id: actor.id, name: "Updated Name", email: "updated@example.com", role });
    expect(body.data.emailChanged).toBe(true);

    // Only the two allowed columns are written, always for the session user.
    const update = callsOf("user", "update").at(-1);
    expect(update?.args).toMatchObject({ where: { id: actor.id }, data: { name: "Updated Name", email: "updated@example.com" } });

    // Protected fields are untouched in the database.
    expect(userById(actor.id)).toMatchObject({ role, isActive: true, isProtectedSeedAdmin: false });
  });

  it("normalizes the email (trim + lowercase) before storing it", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Stu Dent", email: "MiXeD@Example.EDU" }));
    expect(userById("student-1").email).toBe("mixed@example.edu");
  });

  it("rotates the session cookie so the shell shows the new identity immediately", async () => {
    const { me } = await loadRoutes(userById("teacher-1"));
    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "New Teacher Name", email: "new.teacher@example.edu" }));

    const token = await sessionCookie(res);
    expect(token).toBeTruthy();
    const payload = await verifySession(token as string);
    expect(payload).toMatchObject({ sub: "teacher-1", name: "New Teacher Name", email: "new.teacher@example.edu", role: "TEACHER", sv: 0 });
  });

  it("cannot be pointed at another user's profile (IDOR)", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    const res = await me.PATCH(
      jsonRequest(ME_URL, "PATCH", { id: "student-2", userId: "student-2", name: "Hacked", email: "hacked@example.edu" }),
    );

    // The strict schema rejects unknown keys outright; nothing is written at all.
    expect(res.status).toBe(422);
    expect(callsOf("user", "update")).toHaveLength(0);
    expect(userById("student-2")).toMatchObject({ name: "Other Student", email: "other@example.edu" });
  });

  it("rejects crafted role / protected-status fields instead of mass-assigning them", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    const res = await me.PATCH(
      jsonRequest(ME_URL, "PATCH", {
        name: "Stu Dent",
        email: "student@example.edu",
        role: "ADMIN",
        isProtectedSeedAdmin: true,
        sessionVersion: 99,
        isActive: true,
      }),
    );

    expect(res.status).toBe(422);
    expect((await errorBody(res)).error.code).toBe("VALIDATION_ERROR");
    expect(callsOf("user", "update")).toHaveLength(0);
    expect(userById("student-1")).toMatchObject({ role: "STUDENT", isProtectedSeedAdmin: false, sessionVersion: 0 });
  });

  it("refuses the protected seed admin and audits the rejected attempt", async () => {
    const { me } = await loadRoutes(userById("seed-1"));
    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Renamed", email: "renamed@example.edu" }));

    expect(res.status).toBe(403);
    const body = await errorBody(res);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toMatch(/protected seed admin/i);
    expect(callsOf("user", "update")).toHaveLength(0);
    expect(userById("seed-1")).toMatchObject({ name: "Seed Admin", email: "seed@example.edu" });
    expect(state.auditLogs.map((log) => log.action)).toContain("seed_admin.update.rejected");
  });

  it("rejects a duplicate email with a field error", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Stu Dent", email: "teacher@example.edu" }));

    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details?.fieldErrors?.email?.[0]).toMatch(/already in use/i);
  });

  it("rejects a duplicate that differs only by letter case", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Stu Dent", email: "TEACHER@example.edu" }));
    expect(res.status).toBe(409);
  });

  it("turns a unique-constraint race into the same friendly conflict", async () => {
    const { me } = await loadRoutes(userById("student-1"));
    // The availability pre-check passes (the email is free) but the write loses the
    // race, e.g. because the other account was created in between.
    state.failUpdateWith = uniqueConstraintError("email");

    const res = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Stu Dent", email: "fresh@example.edu" }));

    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details?.fieldErrors?.email?.[0]).toMatch(/already in use/i);
  });

  it("validates the input server-side (independent of the browser)", async () => {
    const actor = userById("student-1");
    const { me } = await loadRoutes(actor);

    const invalidEmail = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Stu Dent", email: "not-an-email" }));
    expect(invalidEmail.status).toBe(422);
    expect((await errorBody(invalidEmail)).error.details?.fieldErrors?.email).toBeTruthy();

    const blankName = await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "   ", email: "student@example.edu" }));
    expect(blankName.status).toBe(422);

    expect(callsOf("user", "update")).toHaveLength(0);
    expect(userById("student-1").email).toBe("student@example.edu");
  });

  it("rejects unauthenticated and deactivated accounts with 401", async () => {
    const anonymous = await loadRoutes(null);
    expect((await anonymous.me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "X", email: "x@example.edu" }))).status).toBe(401);

    const inactive = userById("student-1");
    inactive.isActive = false;
    const { me } = await loadRoutes(inactive);
    expect((await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "X", email: "x@example.edu" }))).status).toBe(401);
  });

  it("records an audit entry for the change without secrets", async () => {
    const { me } = await loadRoutes(userById("admin-1"));
    await me.PATCH(jsonRequest(ME_URL, "PATCH", { name: "Renamed Admin", email: "renamed.admin@example.edu" }));

    const entry = state.auditLogs.find((log) => log.action === "user.profile.update");
    expect(entry).toBeTruthy();
    expect(entry?.actorUserId).toBe("admin-1");
    expect(JSON.stringify(entry)).not.toContain(passwordHash);
  });
});

describe("POST /api/v1/users/me/change-password", () => {
  const newPassword = "Brand-New-Password2";

  it("changes the password when the current one is correct and rotates the session", async () => {
    const actor = userById("student-1");
    const previousHash = actor.passwordHash;
    const { changePassword } = await loadRoutes(actor);

    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword, confirmPassword: newPassword }),
    );
    const text = await res.clone().text();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { changed: boolean; sessionVersion: number } };
    expect(body.data).toMatchObject({ changed: true, sessionVersion: 1 });

    // Stored as a bcrypt hash, never plaintext, and the old credentials stop working.
    expect(actor.passwordHash).not.toBe(newPassword);
    expect(await verifyPassword(newPassword, actor.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, actor.passwordHash)).toBe(false);
    expect(actor.sessionVersion).toBe(1);

    // Compare-and-swap on the hash that was verified, with the protected flag pinned.
    const write = callsOf("user", "updateMany").at(-1);
    expect(write?.args).toMatchObject({
      where: { id: actor.id, passwordHash: previousHash, isProtectedSeedAdmin: false },
    });
    expect(JSON.stringify(write?.args)).not.toContain(newPassword);

    // The caller stays signed in with a freshly issued epoch; other tokens are stale.
    const token = await sessionCookie(res);
    const payload = await verifySession(token as string);
    expect(payload?.sv).toBe(1);

    // No credential material anywhere in the response.
    expect(text).not.toContain(newPassword);
    expect(text).not.toContain(previousHash);

    const audits = state.auditLogs.map((log) => log.action);
    expect(audits).toContain("user.password.change");
    expect(JSON.stringify(state.auditLogs)).not.toContain(newPassword);
    expect(JSON.stringify(state.auditLogs)).not.toContain(passwordHash);
  });

  it("rejects a wrong current password with a field error and writes nothing", async () => {
    const { changePassword } = await loadRoutes(userById("student-1"));
    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: "Wrong-Password", newPassword, confirmPassword: newPassword }),
    );

    expect(res.status).toBe(422);
    const body = await errorBody(res);
    expect(body.error.details?.fieldErrors?.currentPassword?.[0]).toMatch(/incorrect/i);
    expect(callsOf("user", "updateMany")).toHaveLength(0);
    expect(userById("student-1").sessionVersion).toBe(0);
  });

  it("requires the confirmation to match", async () => {
    const { changePassword } = await loadRoutes(userById("student-1"));
    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword, confirmPassword: "Something-Else1" }),
    );

    expect(res.status).toBe(422);
    expect(callsOf("user", "updateMany")).toHaveLength(0);
  });

  it("enforces the password policy and rejects an unchanged password", async () => {
    const { changePassword } = await loadRoutes(userById("student-1"));

    const weak = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword: "short", confirmPassword: "short" }),
    );
    expect(weak.status).toBe(422);
    expect((await errorBody(weak)).error.details?.fieldErrors?.newPassword?.[0]).toMatch(/at least 8/i);

    const tooLong = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", {
        currentPassword: PASSWORD,
        newPassword: "a".repeat(80),
        confirmPassword: "a".repeat(80),
      }),
    );
    expect(tooLong.status).toBe(422);

    const unchanged = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD }),
    );
    expect(unchanged.status).toBe(422);

    expect(callsOf("user", "updateMany")).toHaveLength(0);
  });

  it("refuses the protected seed admin and audits the rejected attempt", async () => {
    const { changePassword } = await loadRoutes(userById("seed-1"));
    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword, confirmPassword: newPassword }),
    );

    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.message).toMatch(/protected seed admin/i);
    expect(callsOf("user", "updateMany")).toHaveLength(0);
    expect(userById("seed-1").passwordHash).toBe(passwordHash);
    expect(state.auditLogs.map((log) => log.action)).toContain("seed_admin.password_change.rejected");
  });

  it("fails closed when a concurrent request already changed the password", async () => {
    const actor = userById("student-1");
    const { changePassword } = await loadRoutes(actor);
    state.forceUpdateManyCount = 0; // the compare-and-swap matched no row

    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword, confirmPassword: newPassword }),
    );

    expect(res.status).toBe(409);
    expect((await errorBody(res)).error.code).toBe("CONFLICT");
    expect(actor.sessionVersion).toBe(0);
    expect(await sessionCookie(res)).toBeNull();
  });

  it("rejects unauthenticated callers with 401", async () => {
    const { changePassword } = await loadRoutes(null);
    const res = await changePassword.POST(
      jsonRequest(PASSWORD_URL, "POST", { currentPassword: PASSWORD, newPassword, confirmPassword: newPassword }),
    );
    expect(res.status).toBe(401);
    expect(callsOf("user", "updateMany")).toHaveLength(0);
  });
});
