import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

/**
 * Account-management contract at the API boundary (profile self-service + admin
 * management + seed-admin protection). The REAL route handlers and the REAL
 * users service run against an in-memory fake of the Prisma client and a mocked
 * session, so no database is required. Authn/authz, ownership, validation,
 * normalization, protection rules, session refresh and audit behaviour are all
 * exercised end-to-end.
 */
type Role = "ADMIN" | "TEACHER" | "STUDENT";

interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  isActive: boolean;
  isSeedAdmin: boolean;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
  student: { id: string; studentId: string } | null;
  teacher: { id: string; employeeId: string } | null;
  counts: Record<string, number>;
}

interface State {
  users: FakeUser[];
  audit: { action: string; entityType?: string; entityId?: string; oldValues?: unknown; newValues?: unknown; actorUserId?: string | null }[];
  cookieSets: string[];
  actor: { userId: string; role: Role; anonymous: boolean };
  /** When true, the fake reports a user as seed admin only INSIDE a $transaction callback. */
  flipSeedOnlyInsideTx: string | null;
  txDepth: number;
  failNextCreate: Error | null;
}

/** Non-reversible fake hash so tests can prove hashes never leak and are not plaintext. */
function fakeHash(p: string): string {
  let h = 5381;
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
  return `fakehash$${h}`;
}
const INIT_HASH = fakeHash("Init1234!");

const state: State = {
  users: [],
  audit: [],
  cookieSets: [],
  actor: { userId: "", role: "STUDENT", anonymous: false },
  flipSeedOnlyInsideTx: null,
  txDepth: 0,
  failNextCreate: null,
};

function mkUser(over: Partial<FakeUser> & { id: string; email: string; name: string; role: Role }): FakeUser {
  return {
    passwordHash: INIT_HASH,
    isActive: true,
    isSeedAdmin: false,
    tokenVersion: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    student: null,
    teacher: null,
    counts: {},
    ...over,
  };
}

function seedUsers(): FakeUser[] {
  return [
    mkUser({ id: "u_seed", email: "admin@institution.local", name: "System Administrator", role: "ADMIN", isSeedAdmin: true }),
    mkUser({ id: "u_admin", email: "alice.admin@example.edu", name: "Alice Admin", role: "ADMIN" }),
    mkUser({ id: "u_teacher", email: "teacher@example.edu", name: "Tina Teacher", role: "TEACHER", teacher: { id: "t1", employeeId: "TCH-001" } }),
    mkUser({ id: "u_student", email: "student@example.edu", name: "Sam Student", role: "STUDENT", student: { id: "s1", studentId: "STU-2026-001" } }),
  ];
}

function project(u: FakeUser, select?: Record<string, unknown>): Record<string, unknown> {
  if (!select) return { ...u };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (key === "_count") {
      const wanted = (select._count as { select?: Record<string, unknown> })?.select ?? {};
      out._count = Object.fromEntries(Object.keys(wanted).map((k) => [k, u.counts[k] ?? 0]));
    } else if (key in u) {
      out[key] = (u as unknown as Record<string, unknown>)[key];
    }
  }
  return out;
}

function matches(u: FakeUser, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR" && Array.isArray(v)) {
      const any = v.some((clause) => {
        const c = clause as Record<string, { contains?: string }>;
        return Object.entries(c).every(([field, cond]) =>
          typeof cond.contains === "string" && String(u[field as keyof FakeUser] ?? "").toLowerCase().includes(cond.contains.toLowerCase()),
        );
      });
      if (!any) return false;
    } else if (k === "id" || k === "email" || k === "role" || k === "isSeedAdmin") {
      if (u[k as keyof FakeUser] !== v) return false;
    } else {
      throw new Error(`fake prisma: unsupported where key ${k}`);
    }
  }
  return true;
}

function buildFacade() {
  const findUnique = (args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<Record<string, unknown> | null> => {
    const found = state.users.find((u) => matches(u, args.where));
    if (!found) return Promise.resolve(null);
    // Race simulation: a concurrent transaction flags this account as the seed
    // admin right between the pre-check and the in-transaction re-read.
    if (state.flipSeedOnlyInsideTx && state.txDepth > 0 && found.id === state.flipSeedOnlyInsideTx) {
      found.isSeedAdmin = true;
    }
    return Promise.resolve(project(found, args.select));
  };
  const facade = {
    user: {
      findUnique,
      findUniqueOrThrow: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const found = await findUnique(args);
        if (!found) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "5.22.0" });
        return found;
      },
      findFirst: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const found = state.users.find((u) => matches(u, args.where));
        return found ? project(found, args.select) : null;
      },
      findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: unknown; skip?: number; take?: number }) => {
        let rows = state.users.filter((u) => matches(u, args.where));
        const order = args.orderBy as { isSeedAdmin?: string; createdAt?: string } | undefined;
        if (order?.isSeedAdmin) rows = [...rows].sort((a, b) => (b.isSeedAdmin ? 1 : 0) - (a.isSeedAdmin ? 1 : 0));
        if (order?.createdAt === "asc") rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const skip = args.skip ?? 0;
        return rows.slice(skip, args.take ? skip + args.take : undefined).map((u) => project(u, args.select));
      },
      count: async (args: { where?: Record<string, unknown> }) => state.users.filter((u) => matches(u, args.where)).length,
      create: async (args: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        if (state.failNextCreate) {
          const err = state.failNextCreate;
          state.failNextCreate = null;
          throw err;
        }
        const email = String(args.data.email);
        if (state.users.some((u) => u.email === email)) {
          throw new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on: ${email}`, { code: "P2002", clientVersion: "5.22.0" });
        }
        const created = mkUser({
          id: `u_new_${state.users.length}`,
          email,
          name: String(args.data.name),
          role: args.data.role as Role,
          passwordHash: String(args.data.passwordHash),
          isActive: args.data.isActive !== undefined ? Boolean(args.data.isActive) : true,
          isSeedAdmin: args.data.isSeedAdmin !== undefined ? Boolean(args.data.isSeedAdmin) : false,
        });
        state.users.push(created);
        return project(created, args.select);
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const target = state.users.find((u) => matches(u, args.where));
        if (!target) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "5.22.0" });
        for (const [k, v] of Object.entries(args.data)) {
          if (k === "tokenVersion" && typeof v === "object" && v !== null && "increment" in (v as Record<string, unknown>)) {
            target.tokenVersion += Number((v as { increment: number }).increment);
          } else {
            (target as unknown as Record<string, unknown>)[k] = v;
          }
        }
        target.updatedAt = new Date();
        return project(target, args.select);
      },
      delete: async (args: { where: Record<string, unknown> }) => {
        const idx = state.users.findIndex((u) => matches(u, args.where));
        if (idx === -1) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "5.22.0" });
        return state.users.splice(idx, 1)[0];
      },
    },
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") {
        state.txDepth += 1;
        try {
          return await (arg as (tx: unknown) => Promise<unknown>)(facade);
        } finally {
          state.txDepth -= 1;
        }
      }
      if (Array.isArray(arg)) return Promise.all(arg);
      throw new Error("fake $transaction: bad arg");
    },
  };
  return facade;
}

async function loadRoutes() {
  vi.resetModules();
  state.audit = [];
  state.cookieSets = [];
  vi.doMock("@/lib/db/prisma", () => {
    const facade = buildFacade();
    return { prisma: facade, default: facade };
  });
  vi.doMock("@/lib/audit/audit", () => ({
    audit: async (input: State["audit"][number]) => {
      state.audit.push(input);
    },
  }));
  vi.doMock("@/lib/auth/password", () => ({
    hashPassword: async (p: string) => fakeHash(p),
    verifyPassword: async (p: string, h: string) => h === fakeHash(p),
    assertPasswordStrength: () => undefined,
  }));
  vi.doMock("@/lib/auth/session", async () => {
    const { unauthorized } = await import("@/lib/errors/errors");
    const requireAuth = async () => {
      if (state.actor.anonymous) throw unauthorized();
      return {
        userId: state.actor.userId,
        role: state.actor.role,
        session: { sub: state.actor.userId, email: "", name: "", role: state.actor.role, tokenVersion: 0 },
      };
    };
    return {
      requireAuth,
      getAuth: requireAuth,
      requestMeta: () => ({ ip: "203.0.113.7", userAgent: "account-tests" }),
      setSessionCookie: (_res: unknown, token: string) => {
        state.cookieSets.push(token);
      },
      signSessionForUser: async (u: { tokenVersion: number }) => `fresh-token-v${u.tokenVersion}`,
    };
  });
  const me = await import("@/app/api/v1/users/me/route");
  const pw = await import("@/app/api/v1/users/me/change-password/route");
  const users = await import("@/app/api/v1/users/route");
  const byId = await import("@/app/api/v1/users/[id]/route");
  return { GET_ME: me.GET, PATCH_ME: me.PATCH, POST_PW: pw.POST, GET_USERS: users.GET, POST_USERS: users.POST, DELETE_USER: byId.DELETE };
}

function req(method: "POST" | "PATCH" | "GET", path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asUser(id: string, role: Role) {
  state.actor = { userId: id, role, anonymous: false };
}
function anonymous() {
  state.actor = { userId: "", role: "STUDENT", anonymous: true };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
function errorOf(body: Record<string, unknown>): { code: string; message: string; details: { fieldErrors?: Record<string, string[]> } | null } {
  return body.error as never;
}
function findUser(id: string): FakeUser {
  const u = state.users.find((x) => x.id === id);
  if (!u) throw new Error(`user ${id} missing from fake db`);
  return u;
}
const expectNoCredentials = () => {
  const dump = JSON.stringify(state.audit);
  expect(dump).not.toContain("fakehash");
  expect(dump).not.toContain("NewSecret123!");
  expect(dump).not.toContain("currentPassword");
};

beforeEach(() => {
  state.users = seedUsers();
  state.flipSeedOnlyInsideTx = null;
  state.failNextCreate = null;
});

// ------------------------------------------------------------------ own profile

describe("PATCH /users/me — change own name/email", () => {
  it.each([
    ["student", "u_student", "Sam Renamed"],
    ["teacher", "u_teacher", "Tina Renamed"],
    ["normal admin", "u_admin", "Alice Renamed"],
  ])("%s can change their own name", async (_label, id, name) => {
    asUser(id, id === "u_admin" ? "ADMIN" : id === "u_teacher" ? "TEACHER" : "STUDENT");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { name }));
    expect(res.status).toBe(200);
    expect(findUser(id).name).toBe(name);
    const body = await json(res);
    expect(body.data).toMatchObject({ name, isSeedAdmin: false });
    expect(body).not.toHaveProperty("passwordHash");
    expect(state.audit.some((a) => a.action === "user.update")).toBe(true);
    expectNoCredentials();
    // session cookie is re-issued so the app shows the fresh identity
    expect(state.cookieSets.length).toBe(1);
  });

  it("the seed admin cannot change its own name (403 + audited denial)", async () => {
    asUser("u_seed", "ADMIN");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { name: "Pwned" }));
    expect(res.status).toBe(403);
    expect(errorOf(await json(res)).code).toBe("FORBIDDEN");
    expect(findUser("u_seed").name).toBe("System Administrator");
    expect(state.audit.some((a) => a.action === "user.protected.denied")).toBe(true);
    expectNoCredentials();
  });

  it("normal admin can change their own email — normalized like login, relationships preserved", async () => {
    asUser("u_admin", "ADMIN");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { email: "  Alice.Adm1N@Example.EDU  " }));
    expect(res.status).toBe(200);
    const updated = findUser("u_admin");
    expect(updated.email).toBe("alice.adm1n@example.edu"); // stored lowercased, no new row
    expect(updated.id).toBe("u_admin"); // user ID stable — same account
    expect(state.users.filter((u) => u.role === "ADMIN" && u.id === "u_admin")).toHaveLength(1);
  });

  it("case variants of an existing email are rejected as duplicates (409)", async () => {
    asUser("u_teacher", "TEACHER");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { email: "ADMIN@Institution.Local" }));
    expect(res.status).toBe(409);
    expect(errorOf(await json(res)).code).toBe("CONFLICT");
    expect(findUser("u_teacher").email).toBe("teacher@example.edu");
    expect(state.users).toHaveLength(4); // no duplicate account was created
  });

  it("rejects malformed emails and empty updates with field errors", async () => {
    asUser("u_student", "STUDENT");
    const { PATCH_ME } = await loadRoutes();
    const bad = await PATCH_ME(req("PATCH", "/api/v1/users/me", { email: "nope" }));
    expect(bad.status).toBe(422);
    const empty = await PATCH_ME(req("PATCH", "/api/v1/users/me", {}));
    expect(empty.status).toBe(422);
  });

  it("client-side role manipulation fails (422) and does not touch the DB", async () => {
    asUser("u_student", "STUDENT");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { name: "Escalator", role: "ADMIN" }));
    expect(res.status).toBe(422);
    const body = errorOf(await json(res));
    expect(body.details?.fieldErrors?.role?.join(" ")).toMatch(/system-managed/i);
    expect(findUser("u_student").role).toBe("STUDENT");
  });

  it("client-side isSeedAdmin spoofing fails (422) and does not touch the DB", async () => {
    asUser("u_admin", "ADMIN");
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { name: "Fake Seed", isSeedAdmin: true }));
    expect(res.status).toBe(422);
    const body = errorOf(await json(res));
    expect(body.details?.fieldErrors?.isSeedAdmin?.join(" ")).toMatch(/system-managed/i);
    expect(findUser("u_admin").isSeedAdmin).toBe(false);
  });

  it("unauthenticated profile updates are 401 (IDOR has no surface: the route only edits auth.userId)", async () => {
    anonymous();
    const { PATCH_ME } = await loadRoutes();
    const res = await PATCH_ME(req("PATCH", "/api/v1/users/me", { name: "Ghost" }));
    expect(res.status).toBe(401);
  });
});

// ------------------------------------------------------------------ password

describe("POST /users/me/change-password", () => {
  const change = { currentPassword: "Init1234!", newPassword: "NewSecret123!", confirmPassword: "NewSecret123!" };

  it.each([["student", "u_student", "STUDENT"], ["teacher", "u_teacher", "TEACHER"], ["normal admin", "u_admin", "ADMIN"]] as const)(
    "%s can change their own password and revokes other sessions",
    async (_label, id, role) => {
      asUser(id, role);
      const { POST_PW } = await loadRoutes();
      const res = await POST_PW(req("POST", "/api/v1/users/me/change-password", change));
      expect(res.status).toBe(200);
      const user = findUser(id);
      expect(user.passwordHash).toBe(fakeHash("NewSecret123!")); // hashed, never plaintext
      expect(user.tokenVersion).toBe(1); // prior tokens are now rejected by getAuth
      expect(state.cookieSets).toEqual(["fresh-token-v1"]); // current device re-issued
      const dump = JSON.stringify(state.audit);
      expectNoCredentials();
      expect(dump).not.toContain("NewSecret123!");
      expect(state.audit.some((a) => a.action === "user.password.update")).toBe(true);
    },
  );

  it("rejects an incorrect current password (403) and audited without credentials", async () => {
    asUser("u_student", "STUDENT");
    const { POST_PW } = await loadRoutes();
    const res = await POST_PW(req("POST", "/api/v1/users/me/change-password", { ...change, currentPassword: "WrongPass1" }));
    expect(res.status).toBe(403);
    expect(errorOf(await json(res)).message).toMatch(/incorrect/i);
    expect(findUser("u_student").passwordHash).toBe(INIT_HASH);
    expect(state.audit.some((a) => a.action === "user.password.denied")).toBe(true);
    expectNoCredentials();
  });

  it("the seed admin cannot change its own password (403)", async () => {
    asUser("u_seed", "ADMIN");
    const { POST_PW } = await loadRoutes();
    const res = await POST_PW(req("POST", "/api/v1/users/me/change-password", change));
    expect(res.status).toBe(403);
    expect(findUser("u_seed").passwordHash).toBe(INIT_HASH);
    expect(findUser("u_seed").tokenVersion).toBe(0);
    expect(state.audit.some((a) => a.action === "user.protected.denied")).toBe(true);
  });

  it("validates confirmation and the existing minimum-length policy", async () => {
    asUser("u_student", "STUDENT");
    const { POST_PW } = await loadRoutes();
    const mismatch = await POST_PW(req("POST", "/api/v1/users/me/change-password", { ...change, confirmPassword: "Different12!" }));
    expect(mismatch.status).toBe(422);
    expect(errorOf(await json(mismatch)).details?.fieldErrors?.confirmPassword?.join(" ")).toMatch(/do not match/i);
    const weak = await POST_PW(req("POST", "/api/v1/users/me/change-password", { ...change, newPassword: "short", confirmPassword: "short" }));
    expect(weak.status).toBe(422);
    expect(errorOf(await json(weak)).details?.fieldErrors?.newPassword?.join(" ")).toMatch(/at least 8/i);
  });

  it("rejects re-using the current password as the new one", async () => {
    asUser("u_student", "STUDENT");
    const { POST_PW } = await loadRoutes();
    const res = await POST_PW(req("POST", "/api/v1/users/me/change-password", { currentPassword: "Init1234!", newPassword: "Init1234!", confirmPassword: "Init1234!" }));
    expect(res.status).toBe(422);
    expect(errorOf(await json(res)).message).toMatch(/different/i);
  });

  it("password endpoints cannot be driven by client state (401 when anonymous)", async () => {
    anonymous();
    const { POST_PW } = await loadRoutes();
    const res = await POST_PW(req("POST", "/api/v1/users/me/change-password", change));
    expect(res.status).toBe(401);
  });
});

// ------------------------------------------------------------------ GET /users/me

describe("GET /users/me", () => {
  it("returns the own safe profile including the protected flag", async () => {
    asUser("u_seed", "ADMIN");
    const { GET_ME } = await loadRoutes();
    const res = await GET_ME();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toMatchObject({ id: "u_seed", isSeedAdmin: true, role: "ADMIN" });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });
  it("is 401 for anonymous callers", async () => {
    anonymous();
    const { GET_ME } = await loadRoutes();
    const res = await GET_ME();
    expect(res.status).toBe(401);
  });
});

// ------------------------------------------------------------------ admin management

describe("GET /users?adminsOnly=true — admin management list", () => {
  it("lists ADMIN accounts with the protection flag and never exposes hashes", async () => {
    asUser("u_admin", "ADMIN");
    const { GET_USERS } = await loadRoutes();
    const res = await GET_USERS(req("GET", "/api/v1/users?adminsOnly=true"));
    expect(res.status).toBe(200);
    const body = await json(res);
    const rows = body.data as { id: string; isSeedAdmin: boolean; role: Role }[];
    expect(rows.map((r) => r.id)).toEqual(["u_seed", "u_admin"]); // protected first
    expect(rows.every((r) => r.role === "ADMIN")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("fakehash");
  });
  it("rejects non-admins (403) and anonymous (401)", async () => {
    asUser("u_student", "STUDENT");
    const { GET_USERS } = await loadRoutes();
    expect((await GET_USERS(req("GET", "/api/v1/users?adminsOnly=true"))).status).toBe(403);
    anonymous();
    const { GET_USERS: g2 } = await loadRoutes();
    expect((await g2(req("GET", "/api/v1/users?adminsOnly=true"))).status).toBe(401);
  });
});

describe("POST /users — admin creation", () => {
  const newAdmin = { name: "Bob Admin", email: "Bob.Admin@Example.EDU", password: "Str0ngPass!" };

  it("the seed admin can create another admin with role ADMIN and no protected status", async () => {
    asUser("u_seed", "ADMIN");
    const { POST_USERS, GET_USERS } = await loadRoutes();
    const res = await POST_USERS(req("POST", "/api/v1/users", newAdmin));
    expect(res.status).toBe(201);
    const created = state.users[state.users.length - 1];
    expect(created.role).toBe("ADMIN");
    expect(created.email).toBe("bob.admin@example.edu");
    expect(created.isSeedAdmin).toBe(false); // created admins are normal admins
    expect(created.passwordHash.startsWith("fakehash$")).toBe(true);
    expect(created.passwordHash).not.toContain(newAdmin.password); // stored hashed, not plaintext
    expect(state.audit.some((a) => a.action === "user.create")).toBe(true);
    expectNoCredentials();
    // The new admin receives the same application-wide ADMIN authorization:
    // acting as the created user, the admin management list is accessible.
    state.actor = { userId: created.id, role: "ADMIN", anonymous: false };
    const as = await GET_USERS(req("GET", "/api/v1/users?adminsOnly=true"));
    expect(as.status).toBe(200);
  });

  it("a normal admin can also create admins (existing flat admin model)", async () => {
    asUser("u_admin", "ADMIN");
    const { POST_USERS } = await loadRoutes();
    const res = await POST_USERS(req("POST", "/api/v1/users", newAdmin));
    expect(res.status).toBe(201);
    // and the created admin receives the same ADMIN authorization the application defines
    expect(state.users[state.users.length - 1].role).toBe("ADMIN");
  });

  it("students and teachers cannot create admins (403)", async () => {
    asUser("u_student", "STUDENT");
    const { POST_USERS } = await loadRoutes();
    expect((await POST_USERS(req("POST", "/api/v1/users", newAdmin))).status).toBe(403);
    asUser("u_teacher", "TEACHER");
    const { POST_USERS: post2 } = await loadRoutes();
    expect((await post2(req("POST", "/api/v1/users", newAdmin))).status).toBe(403);
  });

  it("cannot fake elevated roles or seed-admin status at creation time (422, nothing created)", async () => {
    asUser("u_seed", "ADMIN");
    const { POST_USERS } = await loadRoutes();
    for (const extra of [{ role: "TEACHER" }, { isSeedAdmin: true }, { isActive: false }, { permissions: ["all"] }]) {
      const res = await POST_USERS(req("POST", "/api/v1/users", { ...newAdmin, ...extra }));
      expect(res.status).toBe(422);
    }
    expect(state.users).toHaveLength(4);
  });

  it("duplicate emails are rejected (pre-check and unique-index race both → 409)", async () => {
    asUser("u_admin", "ADMIN");
    const { POST_USERS } = await loadRoutes();
    const dup = await POST_USERS(req("POST", "/api/v1/users", { ...newAdmin, email: "teacher@example.edu" }));
    expect(dup.status).toBe(409);
    expect(errorOf(await json(dup)).code).toBe("CONFLICT");

    // simulate a concurrent insert landing between the pre-check and the write
    state.failNextCreate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on: race", { code: "P2002", clientVersion: "5.22.0" });
    const raced = await POST_USERS(req("POST", "/api/v1/users", { ...newAdmin, email: "race@example.edu" }));
    expect(raced.status).toBe(409);
    expectNoCredentials();
  });
});

describe("DELETE /users/{id} — admin deletion", () => {
  it("a normal admin can delete another normal admin", async () => {
    asUser("u_admin", "ADMIN");
    const { DELETE_USER } = await loadRoutes();
    // create a disposable admin first, then delete it
    state.users.push(mkUser({ id: "u_gone", email: "gone@example.edu", name: "Bye Admin", role: "ADMIN" }));
    const ok = await DELETE_USER(req("GET", "/"), { params: { id: "u_gone" } });
    expect(ok.status).toBe(200);
    expect(state.users.find((u) => u.id === "u_gone")).toBeUndefined();
    expect(state.audit.some((a) => a.action === "user.delete")).toBe(true);
    expectNoCredentials();
  });

  it("nobody can delete the seed admin — not a normal admin, not even the seed admin itself (403)", async () => {
    asUser("u_admin", "ADMIN");
    const { DELETE_USER } = await loadRoutes();
    const res = await DELETE_USER(req("GET", "/"), { params: { id: "u_seed" } });
    expect(res.status).toBe(403);
    const body = errorOf(await json(res));
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toMatch(/cannot be deleted/i);
    expect(state.users.find((u) => u.id === "u_seed")).toBeDefined();
    expect(state.audit.some((a) => a.action === "user.protected.denied")).toBe(true);

    asUser("u_seed", "ADMIN");
    const { DELETE_USER: del2 } = await loadRoutes();
    // self-delete is blocked outright; even without that, seed protection stands
    expect((await del2(req("GET", "/"), { params: { id: "u_seed" } })).status).toBe(422);
    expect(state.users.find((u) => u.id === "u_seed")).toBeDefined();
  });

  it("concurrent flag changes cannot bypass seed protection (re-checked inside the transaction)", async () => {
    asUser("u_admin", "ADMIN");
    state.users.push(mkUser({ id: "u_sneaky", email: "sneaky@example.edu", name: "Seedy", role: "ADMIN" }));
    state.flipSeedOnlyInsideTx = "u_sneaky"; // looks deletable outside, protected inside
    const { DELETE_USER } = await loadRoutes();
    const res = await DELETE_USER(req("GET", "/"), { params: { id: "u_sneaky" } });
    expect(res.status).toBe(403);
    expect(state.users.find((u) => u.id === "u_sneaky")).toBeDefined();
  });

  it("students and teachers receive 403 before anything is touched", async () => {
    asUser("u_student", "STUDENT");
    const { DELETE_USER } = await loadRoutes();
    const res = await DELETE_USER(req("GET", "/"), { params: { id: "u_admin" } });
    expect(res.status).toBe(403);
    expect(state.users.find((u) => u.id === "u_admin")).toBeDefined();
  });

  it("self-deletion is rejected; non-admin targets are rejected; missing targets 404", async () => {
    asUser("u_admin", "ADMIN");
    const { DELETE_USER } = await loadRoutes();
    expect((await DELETE_USER(req("GET", "/"), { params: { id: "u_admin" } })).status).toBe(422);
    expect((await DELETE_USER(req("GET", "/"), { params: { id: "u_student" } })).status).toBe(422);
    const missing = await DELETE_USER(req("GET", "/"), { params: { id: "u_ghost" } });
    expect(missing.status).toBe(404);
  });

  it("admins with preserved history are not deletable — clear 409, account intact", async () => {
    asUser("u_seed", "ADMIN");
    state.users.push(
      mkUser({ id: "u_busy", email: "busy@example.edu", name: "Busy Admin", role: "ADMIN", counts: { assessmentsCreated: 2, marksEntered: 5 } }),
    );
    const { DELETE_USER } = await loadRoutes();
    const res = await DELETE_USER(req("GET", "/"), { params: { id: "u_busy" } });
    expect(res.status).toBe(409);
    const err = errorOf(await json(res));
    expect(err.message).toMatch(/cannot be deleted/i);
    expect((err.details as { blockers: string[] }).blockers).toEqual(["assessments", "entered marks"]);
    expect(state.users.find((u) => u.id === "u_busy")).toBeDefined();
  });

  it("deleted admins can no longer be found or referenced (account truly removed)", async () => {
    asUser("u_seed", "ADMIN");
    state.users.push(mkUser({ id: "u_ex", email: "ex@example.edu", name: "Ex Admin", role: "ADMIN" }));
    const { DELETE_USER } = await loadRoutes();
    await DELETE_USER(req("GET", "/"), { params: { id: "u_ex" } });
    expect(state.users.find((u) => u.id === "u_ex")).toBeUndefined();
    expect(state.users.filter((u) => u.email === "ex@example.edu")).toHaveLength(0);
  });
});
