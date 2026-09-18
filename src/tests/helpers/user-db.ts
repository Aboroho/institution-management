/**
 * Minimal in-memory Prisma stand-in for route-handler tests that touch `User`.
 *
 * It exists so the REAL route handlers and the REAL service logic run against a fake
 * database while still enforcing the two guarantees the tests care about:
 *   - `where` clauses are actually evaluated (so authorization scoping and the
 *     compare-and-swap password update are exercised, not bypassed),
 *   - reads honour the `select` projection (so a leaked `passwordHash` would be
 *     visible in the response and fail the test).
 *
 * It is deliberately small: only the User model and `auditLog.create` are supported,
 * plus the two Prisma error paths (unique constraint / foreign key) that the services
 * translate into friendly conflicts.
 */

export type FakeRole = "ADMIN" | "TEACHER" | "STUDENT";

export interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: FakeRole;
  isActive: boolean;
  isProtectedSeedAdmin: boolean;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  counts?: Partial<Record<string, number>>;
  student?: { id: string } | null;
  teacher?: { id: string } | null;
}

export interface FakeAuditLog {
  actorUserId: string | null;
  action: string;
  entityType: unknown;
  entityId: unknown;
  newValues: unknown;
}

export interface FakePrismaState {
  users: FakeUser[];
  auditLogs: FakeAuditLog[];
  calls: { model: string; method: string; args: unknown }[];
  /** When set, the next `user.create` throws this error (simulates a unique-constraint race). */
  failCreateWith?: unknown;
  /** When set, the next `user.deleteMany` throws this error (simulates a foreign-key restrict). */
  failDeleteWith?: unknown;
  /** When set, the next `user.update` throws this error (simulates a unique-constraint race). */
  failUpdateWith?: unknown;
  /** When set, the next `user.updateMany` reports this count without touching rows. */
  forceUpdateManyCount?: number;
}

export function createFakePrismaState(): FakePrismaState {
  return { users: [], auditLogs: [], calls: [] };
}

type Args = Record<string, unknown>;

function asArgs(value: unknown): Args {
  return (value ?? {}) as Args;
}

function emailConstraint(where: Args): { equals?: string; contains?: string } {
  const email = where.email;
  if (typeof email !== "object" || email === null) return {};
  const constraint = email as Args;
  return {
    equals: typeof constraint.equals === "string" ? constraint.equals.toLowerCase() : undefined,
    contains: typeof constraint.contains === "string" ? constraint.contains.toLowerCase() : undefined,
  };
}

function nameConstraint(where: Args): string | undefined {
  const name = where.name;
  if (typeof name !== "object" || name === null) return undefined;
  const contains = (name as Args).contains;
  return typeof contains === "string" ? contains.toLowerCase() : undefined;
}

/** Evaluates the subset of Prisma `where` shapes used by the user services. */
export function matchesUser(user: FakeUser, where: Args): boolean {
  if (where.id !== undefined && user.id !== where.id) return false;
  if (where.role !== undefined && user.role !== where.role) return false;
  if (where.isActive !== undefined && user.isActive !== where.isActive) return false;
  if (where.isProtectedSeedAdmin !== undefined && user.isProtectedSeedAdmin !== where.isProtectedSeedAdmin) return false;
  if (where.passwordHash !== undefined && user.passwordHash !== where.passwordHash) return false;
  const { equals, contains } = emailConstraint(where);
  if (equals !== undefined && user.email.toLowerCase() !== equals) return false;
  if (contains !== undefined && !user.email.toLowerCase().includes(contains)) return false;
  const nameContains = nameConstraint(where);
  if (nameContains !== undefined && !user.name.toLowerCase().includes(nameContains)) return false;
  const or = where.OR;
  if (Array.isArray(or) && !or.some((clause) => matchesUser(user, asArgs(clause)))) return false;
  return true;
}

function project(user: FakeUser, select?: Args | null): Args {
  if (!select) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      isProtectedSeedAdmin: user.isProtectedSeedAdmin,
      passwordHash: user.passwordHash,
      sessionVersion: user.sessionVersion,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
  const out: Args = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    if (key === "_count") {
      const countSelect = asArgs(asArgs(value).select);
      const counts: Args = {};
      for (const countKey of Object.keys(countSelect)) counts[countKey] = user.counts?.[countKey] ?? 0;
      out._count = counts;
      continue;
    }
    if (key === "student" || key === "teacher") {
      out[key] = user[key] ?? null;
      continue;
    }
    out[key] = (user as unknown as Args)[key];
  }
  return out;
}

export function createFakePrisma(state: FakePrismaState) {
  function record(model: string, method: string, args: unknown) {
    state.calls.push({ model, method, args });
  }

  const clock = () => new Date("2026-09-18T12:00:00.000Z");

  const user = {
    findUnique: async (args: Args) => {
      record("user", "findUnique", args);
      const where = asArgs(args.where);
      const found = state.users.find((candidate) => candidate.id === where.id);
      if (!found) return null;
      return project(found, args.select as Args | null);
    },
    findFirst: async (args: Args) => {
      record("user", "findFirst", args);
      const where = asArgs(args.where);
      const found = state.users.find((candidate) => matchesUser(candidate, where));
      if (!found) return null;
      return project(found, args.select as Args | null);
    },
    findMany: async (args: Args) => {
      record("user", "findMany", args);
      const where = asArgs(args.where);
      return state.users
        .filter((candidate) => matchesUser(candidate, where))
        .map((candidate) => project(candidate, args.select as Args | null));
    },
    count: async (args: Args) => {
      record("user", "count", args);
      const where = asArgs(args.where);
      return state.users.filter((candidate) => matchesUser(candidate, where)).length;
    },
    create: async (args: Args) => {
      record("user", "create", args);
      if (state.failCreateWith !== undefined) {
        const error = state.failCreateWith;
        state.failCreateWith = undefined;
        throw error;
      }
      const data = asArgs(args.data);
      const created: FakeUser = {
        id: `user-${state.users.length + 1}`,
        email: String(data.email),
        name: String(data.name),
        role: data.role as FakeRole,
        isActive: data.isActive !== false,
        isProtectedSeedAdmin: data.isProtectedSeedAdmin === true,
        passwordHash: String(data.passwordHash),
        sessionVersion: 0,
        createdAt: clock(),
        updatedAt: clock(),
      };
      state.users.push(created);
      return project(created, args.select as Args | null);
    },
    update: async (args: Args) => {
      record("user", "update", args);
      if (state.failUpdateWith !== undefined) {
        const error = state.failUpdateWith;
        state.failUpdateWith = undefined;
        throw error;
      }
      const where = asArgs(args.where);
      const found = state.users.find((candidate) => candidate.id === where.id);
      if (!found) throw new Error("user not found");
      Object.assign(found, asArgs(args.data));
      found.updatedAt = clock();
      return project(found, args.select as Args | null);
    },
    updateMany: async (args: Args) => {
      record("user", "updateMany", args);
      if (state.forceUpdateManyCount !== undefined) {
        const count = state.forceUpdateManyCount;
        state.forceUpdateManyCount = undefined;
        return { count };
      }
      const where = asArgs(args.where);
      const data = asArgs(args.data);
      const targets = state.users.filter((candidate) => matchesUser(candidate, where));
      for (const target of targets) {
        const increment = asArgs(data.sessionVersion);
        const incrementBy = typeof increment.increment === "number" ? increment.increment : 0;
        const { sessionVersion: _ignored, ...rest } = data;
        Object.assign(target, rest);
        target.sessionVersion += incrementBy;
        target.updatedAt = clock();
      }
      return { count: targets.length };
    },
    deleteMany: async (args: Args) => {
      record("user", "deleteMany", args);
      if (state.failDeleteWith !== undefined) {
        const error = state.failDeleteWith;
        state.failDeleteWith = undefined;
        throw error;
      }
      const where = asArgs(args.where);
      const targets = state.users.filter((candidate) => matchesUser(candidate, where));
      state.users = state.users.filter((candidate) => !targets.includes(candidate));
      return { count: targets.length };
    },
  };

  const auditLog = {
    create: async (args: Args) => {
      record("auditLog", "create", args);
      const data = asArgs(args.data);
      state.auditLogs.push({
        actorUserId: (data.actorUserId as string | null | undefined) ?? null,
        action: String(data.action),
        entityType: data.entityType,
        entityId: data.entityId,
        newValues: data.newValues,
      });
      return { id: `audit-${state.auditLogs.length}` };
    },
  };

  const client = {
    user,
    auditLog,
    $transaction: async (input: unknown) =>
      Array.isArray(input)
        ? Promise.all(input as Promise<unknown>[])
        : (input as (tx: unknown) => Promise<unknown>)(client),
  };

  return client;
}

/** Prisma-shaped error for a unique constraint violation (e.g. duplicate email). */
export function uniqueConstraintError(field: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: [field] },
  });
}

/** Prisma-shaped error for a restricted foreign key (dependent rows exist). */
export function foreignKeyError() {
  return Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
}
