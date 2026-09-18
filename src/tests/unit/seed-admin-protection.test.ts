import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/errors";
import { createFakePrisma, createFakePrismaState, type FakeRole, type FakeUser } from "../helpers/user-db";

/**
 * The protected seed admin rules in one place.
 *
 * The marker is a persisted column (`User.isProtectedSeedAdmin`) written only by the
 * seed script; these helpers are what every service consults, so "is this account
 * protected?" and "may this actor manage admins?" are decided by server data and never
 * by request input.
 */

const h = vi.hoisted(() => ({
  state: {
    users: [],
    auditLogs: [],
    calls: [],
  } as import("../helpers/user-db").FakePrismaState,
}));

const state = h.state;

function fakeUser(overrides: Partial<FakeUser> & { id: string; email: string }): FakeUser {
  return {
    name: "Test User",
    role: "ADMIN" as FakeRole,
    isActive: true,
    isProtectedSeedAdmin: false,
    passwordHash: "$2a$12$0123456789012345678901uZ1Q7Zx5m5m5m5m5m5m5m5m5m5m5m",
    sessionVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function loadModule() {
  vi.resetModules();
  const prisma = createFakePrisma(state);
  vi.doMock("@/lib/db/prisma", () => ({ prisma, default: prisma }));
  return import("@/modules/users/seed-admin");
}

beforeEach(() => {
  state.users = [
    fakeUser({ id: "seed-1", email: "seed@example.edu", name: "Seed Admin", isProtectedSeedAdmin: true }),
    fakeUser({ id: "admin-1", email: "admin@example.edu", name: "Plain Admin" }),
    fakeUser({ id: "teacher-1", email: "teacher@example.edu", name: "Tea Cher", role: "TEACHER" }),
  ];
  state.auditLogs = [];
  state.calls = [];
});

describe("protected seed admin identification", () => {
  it("reads the persisted marker instead of any client-supplied value", async () => {
    const { isProtectedSeedAdmin } = await loadModule();
    expect(isProtectedSeedAdmin({ isProtectedSeedAdmin: true })).toBe(true);
    expect(isProtectedSeedAdmin({ isProtectedSeedAdmin: false })).toBe(false);
    expect(isProtectedSeedAdmin({})).toBe(false);
    expect(isProtectedSeedAdmin(null)).toBe(false);
  });

  it("blocks profile/password changes for the protected account", async () => {
    const { assertNotProtectedSeedAdmin, PROTECTED_SEED_ADMIN_PROFILE_MESSAGE } = await loadModule();

    const error = (() => {
      try {
        assertNotProtectedSeedAdmin({ id: "seed-1", isProtectedSeedAdmin: true });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).message).toBe(PROTECTED_SEED_ADMIN_PROFILE_MESSAGE);

    expect(() => assertNotProtectedSeedAdmin({ id: "admin-1", isProtectedSeedAdmin: false })).not.toThrow();
  });

  it("finds the protected account, or nothing on an unseeded installation", async () => {
    const { findProtectedSeedAdmin } = await loadModule();
    expect((await findProtectedSeedAdmin())?.id).toBe("seed-1");

    state.users = state.users.filter((user) => !user.isProtectedSeedAdmin);
    expect(await findProtectedSeedAdmin()).toBeNull();
  });
});

describe("admin management authorization", () => {
  it("accepts the protected seed admin", async () => {
    const { requireSeedAdminActor } = await loadModule();
    const actor = await requireSeedAdminActor({ actorUserId: "seed-1", operation: "admin.create" });
    expect(actor).toMatchObject({ id: "seed-1", email: "seed@example.edu" });
  });

  it("rejects a normal admin and audits the attempt", async () => {
    const { requireSeedAdminActor, PROTECTED_SEED_ADMIN_MANAGE_MESSAGE } = await loadModule();

    await expect(requireSeedAdminActor({ actorUserId: "admin-1", operation: "admin.delete" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: PROTECTED_SEED_ADMIN_MANAGE_MESSAGE,
    });

    const entry = state.auditLogs.find((log) => log.action === "admin.manage.rejected");
    expect(entry).toMatchObject({ actorUserId: "admin-1" });
    expect(entry?.newValues).toMatchObject({ operation: "admin.delete", reason: "not_protected_seed_admin" });
  });

  it("rejects teachers and students", async () => {
    const { requireSeedAdminActor } = await loadModule();
    await expect(requireSeedAdminActor({ actorUserId: "teacher-1", operation: "admin.create" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("rejects an unknown or deactivated account, even if it carries the marker", async () => {
    const { requireSeedAdminActor } = await loadModule();

    await expect(requireSeedAdminActor({ actorUserId: "nobody", operation: "admin.create" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    const seed = state.users.find((user) => user.id === "seed-1");
    if (!seed) throw new Error("fixture missing");
    seed.isActive = false;
    await expect(requireSeedAdminActor({ actorUserId: "seed-1", operation: "admin.create" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
