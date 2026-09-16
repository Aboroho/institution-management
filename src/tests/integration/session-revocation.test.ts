import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session revocation contract with stateless JWTs (the project's chosen auth
 * architecture). The REAL token + session modules run against a fake user store:
 *  - a password change bumps User.tokenVersion, which kills every older cookie;
 *  - a deleted account (e.g. a deleted admin) can no longer authenticate at all;
 *  - deactivated accounts are rejected.
 */
process.env.AUTH_SECRET ??= "session-revocation-test-secret-000000";

interface Row {
  id: string;
  isActive: boolean;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  tokenVersion: number;
}

const users = new Map<string, Row>();

vi.mock("@/lib/db/prisma", () => {
  const facade = {
    user: {
      findUnique: async (args: { where: { id?: string } }) => {
        const u = users.get(String(args.where.id));
        return u ? { ...u } : null;
      },
    },
  };
  return { prisma: facade, default: facade };
});

function withCookie(token: string | null) {
  vi.doMock("next/headers", () => ({
    cookies: () => ({ get: () => (token ? { value: token } : undefined) }),
    headers: () => new Headers(),
  }));
}

async function loadSessionModule() {
  vi.resetModules();
  const { signSession } = await import("@/lib/auth/token");
  return { getAuth: (await import("@/lib/auth/session")).getAuth, signSession };
}

function resetUsers() {
  users.clear();
  users.set("u_admin", { id: "u_admin", isActive: true, role: "ADMIN", tokenVersion: 0 });
  users.set("u_seed", { id: "u_seed", isActive: true, role: "ADMIN", tokenVersion: 0 });
}

beforeEach(resetUsers);

describe("getAuth session validity", () => {
  it("accepts a token whose version matches the user row", async () => {
    withCookie(await (await loadSessionModule()).signSession({ sub: "u_admin", email: "a@x.y", name: "A", role: "ADMIN", tokenVersion: 0 }));
    const { getAuth } = await loadSessionModule();
    const auth = await getAuth();
    expect(auth?.userId).toBe("u_admin");
  });

  it("rejects every older token after a password change (revocation)", async () => {
    const { signSession } = await loadSessionModule();
    const oldToken = await signSession({ sub: "u_admin", email: "a@x.y", name: "A", role: "ADMIN", tokenVersion: 0 });
    const newToken = await signSession({ sub: "u_admin", email: "a@x.y", name: "A", role: "ADMIN", tokenVersion: 1 });

    // The user bumps to tokenVersion 1 (what changeMyPassword does atomically).
    users.set("u_admin", { ...users.get("u_admin")!, tokenVersion: 1 });

    withCookie(oldToken);
    const a1 = await (await loadSessionModule()).getAuth();
    expect(a1).toBeNull(); // other devices are signed out

    withCookie(newToken);
    const a2 = await (await loadSessionModule()).getAuth();
    expect(a2?.userId).toBe("u_admin"); // current device stays signed in
  });

  it("a deleted admin cannot authenticate anymore", async () => {
    const { signSession } = await loadSessionModule();
    const token = await signSession({ sub: "u_gone", email: "gone@x.y", name: "Gone", role: "ADMIN", tokenVersion: 0 });
    users.set("u_gone", { id: "u_gone", isActive: true, role: "ADMIN", tokenVersion: 0 });
    withCookie(token);
    expect((await (await loadSessionModule()).getAuth())?.userId).toBe("u_gone");

    users.delete("u_gone"); // DELETE /users/{id} removed the account (seed admin protection already applied upstream)
    withCookie(token);
    expect(await (await loadSessionModule()).getAuth()).toBeNull();
  });

  it("the seed admin's valid token still authenticates (protection blocks changes, not login)", async () => {
    const { signSession } = await loadSessionModule();
    withCookie(await signSession({ sub: "u_seed", email: "admin@institution.local", name: "S", role: "ADMIN", tokenVersion: 0 }));
    const auth = await (await loadSessionModule()).getAuth();
    expect(auth?.role).toBe("ADMIN");
  });

  it("deactivated accounts are rejected", async () => {
    const { signSession } = await loadSessionModule();
    const token = await signSession({ sub: "u_admin", email: "a@x.y", name: "A", role: "ADMIN", tokenVersion: 0 });
    users.set("u_admin", { ...users.get("u_admin")!, isActive: false });
    withCookie(token);
    expect(await (await loadSessionModule()).getAuth()).toBeNull();
  });
});
