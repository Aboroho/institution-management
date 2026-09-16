// Users / account management — profile self-service and admin management.
// ALL rules (ownership, seed-admin protection, email normalization/uniqueness,
// password hashing + session revocation, safe deletion) live in this service.
// Route handlers only authenticate, authorize (ADMIN gates) and validate input.
import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { businessRule, conflict, forbidden, notFound } from "@/lib/errors/errors";
import { logger } from "@/lib/logging/logger";
import { normalizeEmail, type CreateAdminInput, type PasswordChangeInput, type ProfileUpdateInput } from "@/lib/validation/users";

// ------------------------------------------------------------------ types

/** Server-derived request context for auditing. Never contains credentials. */
export interface ActorContext {
  actorUserId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Public shape of a user account — passwordHash/tokenVersion are never returned. */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  isSeedAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isSeedAdmin: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// ------------------------------------------------------------------ self-service profile

/** Own profile for the /profile pages and header display. */
export async function getMyProfile(userId: string): Promise<SafeUser & { student?: { id: string; studentId: string } | null; teacher?: { id: string; employeeId: string } | null }> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...SAFE_SELECT,
      student: { select: { id: true, studentId: true } },
      teacher: { select: { id: true, employeeId: true } },
    },
  });
  if (!me) throw notFound("User not found");
  return me;
}

/**
 * The protected seed admin cannot modify its own identity fields from the
 * application — its name/email/password are managed via env config + seed.
 * Denied attempts are audited (without credentials).
 */
async function assertSelfModifiable(userId: string, action: string, ctx: ActorContext) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isSeedAdmin: true },
  });
  if (!user) throw notFound("User not found");
  if (user.isSeedAdmin) {
    await audit({
      actorUserId: ctx.actorUserId,
      action: "user.protected.denied",
      entityType: "User",
      entityId: user.id,
      newValues: { reason: `seed_admin_${action}_denied` },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw forbidden("The protected seed-admin account is system-managed and cannot be modified from the application. Adjust SEED_ADMIN_* settings and re-run the seed script if required.");
  }
  return user;
}

/** Change own name and/or email. Ownership is implicit: the target is always the authenticated user. */
export async function updateMyProfile(userId: string, input: ProfileUpdateInput, ctx: ActorContext): Promise<SafeUser> {
  const current = await assertSelfModifiable(userId, "profile_update", ctx);

  const nextName = input.name ?? current.name;
  const nextEmail = input.email ? normalizeEmail(input.email) : current.email;

  if (nextEmail !== current.email) {
    // Friendly pre-check for a clear 409; the DB unique index stays authoritative for races.
    const clash = await prisma.user.findUnique({ where: { email: nextEmail }, select: { id: true } });
    if (clash) throw conflict("That email is already in use by another account");
  }

  let updated: SafeUser;
  try {
    updated = await prisma.user.update({
      where: { id: userId },
      data: { name: nextName, email: nextEmail },
      select: SAFE_SELECT,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Concurrent insert took the address between check and write.
      throw conflict("That email is already in use by another account");
    }
    throw e;
  }

  await audit({
    actorUserId: ctx.actorUserId,
    action: "user.update",
    entityType: "User",
    entityId: userId,
    oldValues: { name: current.name, email: current.email },
    newValues: { name: updated.name, email: updated.email },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

export interface PasswordChangeResult {
  /** New tokenVersion — used to re-issue the current device's session cookie. */
  tokenVersion: number;
}

/**
 * Change own password. Requires the current password (no token-based reset flow
 * exists in this application). Bumps tokenVersion so every previously issued
 * session token is rejected by getAuth — true revocation with stateless JWTs.
 */
export async function changeMyPassword(userId: string, input: PasswordChangeInput, ctx: ActorContext): Promise<PasswordChangeResult> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, isSeedAdmin: true, tokenVersion: true },
  });
  if (!current) throw notFound("User not found");
  if (current.isSeedAdmin) {
    await audit({
      actorUserId: ctx.actorUserId,
      action: "user.protected.denied",
      entityType: "User",
      entityId: userId,
      newValues: { reason: "seed_admin_password_change_denied" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw forbidden("The protected seed-admin account's password is managed via SEED_ADMIN_* settings and the seed script, not the application.");
  }

  const valid = await verifyPassword(input.currentPassword, current.passwordHash);
  if (!valid) {
    // No credentials are recorded — only that a denied attempt happened.
    await audit({
      actorUserId: ctx.actorUserId,
      action: "user.password.denied",
      entityType: "User",
      entityId: userId,
      newValues: { reason: "invalid_current_password" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw forbidden("Current password is incorrect");
  }

  const same = await verifyPassword(input.newPassword, current.passwordHash);
  if (same) throw businessRule("The new password must be different from the current one");

  const passwordHash = await hashPassword(input.newPassword);

  let tokenVersion: number;
  try {
    // Atomic increment: a concurrent change can never lose an invalidation bump.
    const result = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    tokenVersion = result.tokenVersion;
  } catch (e) {
    // Never include request bodies here — no credentials in logs.
    logger.error("password update failed", { userId });
    throw e;
  }

  // Deliberately no values: never audit credentials or hashes.
  await audit({
    actorUserId: ctx.actorUserId,
    action: "user.password.update",
    entityType: "User",
    entityId: userId,
    newValues: { sessionsRevoked: true },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { tokenVersion };
}

// ------------------------------------------------------------------ admin management

export async function listAdminAccounts(opts: { search?: string; page: number; limit: number }) {
  const where: Prisma.UserWhereInput = {
    role: "ADMIN",
    ...(opts.search
      ? { OR: [{ name: { contains: opts.search, mode: "insensitive" } }, { email: { contains: opts.search, mode: "insensitive" } }] }
      : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ isSeedAdmin: "desc" }, { createdAt: "asc" }], skip: (opts.page - 1) * opts.limit, take: opts.limit, select: SAFE_SELECT }),
  ]);
  return { items, total };
}

/**
 * Create an additional ADMIN account. The seed-admin protection is NOT granted:
 * accounts created through the application are normal admins by construction
 * (`isSeedAdmin: false` hardcoded — the client cannot set it; the strict schema
 * rejects the key before it reaches here).
 */
export async function createAdmin(input: CreateAdminInput, ctx: ActorContext): Promise<SafeUser> {
  const email = normalizeEmail(input.email);

  // Friendly pre-check; the unique index remains the authority under races.
  const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (clash) throw conflict("That email is already in use by another account");

  const passwordHash = await hashPassword(input.password);
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to guard against concurrent creation.
      const takenInTx = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (takenInTx) throw conflict("That email is already in use by another account");
      return tx.user.create({
        data: { email, name: input.name, role: "ADMIN", passwordHash, isActive: true, isSeedAdmin: false },
        select: SAFE_SELECT,
      });
    });
    await audit({
      actorUserId: ctx.actorUserId,
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      newValues: { name: created.name, email: created.email, role: "ADMIN", isSeedAdmin: false },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return created;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("That email is already in use by another account");
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw notFound("User not found");
    }
    throw e;
  }
}

/**
 * Human-readable blockers for admins whose records are referenced by history.
 * All relations that must survive the account use onDelete: Restrict, so deletion
 * would either destroy history or fail; we reject with guidance instead (the same
 * contract as student deletion).
 */
async function adminDeletionBlockers(target: { id: string }): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
    select: {
      student: { select: { id: true } },
      teacher: { select: { id: true } },
      _count: {
        select: {
          promotionsDecided: true,
          sessionsCreated: true,
          assessmentsCreated: true,
          marksEntered: true,
          markLogs: true,
          markRequests: true,
          attendanceLogs: true,
          attendanceRequests: true,
          filesUploaded: true,
        },
      },
    },
  });
  const labels: Record<string, string> = {
    promotionsDecided: "promotion decisions",
    sessionsCreated: "attendance sessions",
    assessmentsCreated: "assessments",
    marksEntered: "entered marks",
    markLogs: "mark change history",
    markRequests: "mark change requests",
    attendanceLogs: "attendance change history",
    attendanceRequests: "attendance change requests",
    filesUploaded: "uploaded files",
  };
  const blockers: string[] = [];
  if (user.student) blockers.push("a linked student profile");
  if (user.teacher) blockers.push("a linked teacher profile");
  for (const [key, n] of Object.entries(user._count)) {
    if (Number(n) > 0) blockers.push(labels[key] ?? key);
  }
  return blockers;
}

/**
 * Delete a normal ADMIN account. The protected seed admin can NEVER be deleted
 * — checked before and re-checked inside the transaction, whatever the actor's role.
 * Returns the removed account's safe summary for auditing.
 */
export async function deleteAdmin(targetUserId: string, ctx: ActorContext): Promise<{ id: string; name: string; email: string; role: Role }> {
  if (targetUserId === ctx.actorUserId) {
    throw businessRule("You cannot delete your own account while signed in");
  }
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, role: true, isSeedAdmin: true },
  });
  if (!target) throw notFound("Admin account not found");
  if (target.role !== "ADMIN") {
    throw businessRule("Admin accounts only: student and teacher accounts are managed from their own pages");
  }
  await guardSeedAdmin(target, ctx, "delete");

  const blockers = await adminDeletionBlockers(target);
  if (blockers.length) {
    throw conflict(
      `This admin cannot be deleted because ${blockers.join(", ")} reference the account. Historical records are permanent; contact the system administrator to deactivate the account instead.`,
      { blockers },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read protection state inside the transaction: a concurrent update can
      // never turn the delete into a seed-admin deletion.
      const fresh = await tx.user.findUnique({ where: { id: targetUserId }, select: { isSeedAdmin: true } });
      if (!fresh) throw notFound("Admin account not found");
      if (fresh.isSeedAdmin) throw forbidden(SEED_ADMIN_DELETE_MESSAGE);
      await tx.user.delete({ where: { id: targetUserId } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      // A dependent record appeared between the count check and the delete.
      throw conflict("This admin cannot be deleted because new records now reference the account. Historical records are permanent.");
    }
    throw e;
  }

  await audit({
    actorUserId: ctx.actorUserId,
    action: "user.delete",
    entityType: "User",
    entityId: target.id,
    oldValues: { name: target.name, email: target.email, role: target.role },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { id: target.id, name: target.name, email: target.email, role: target.role };
}

const SEED_ADMIN_DELETE_MESSAGE =
  "The protected seed-admin account cannot be deleted. It is the system-managed recovery administrator.";

async function guardSeedAdmin(target: { id: string; isSeedAdmin: boolean }, ctx: ActorContext, verb: "delete" | "modify") {
  if (!target.isSeedAdmin) return;
  await audit({
    actorUserId: ctx.actorUserId,
    action: "user.protected.denied",
    entityType: "User",
    entityId: target.id,
    newValues: { reason: `seed_admin_${verb}_denied` },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  throw forbidden(
    verb === "delete"
      ? SEED_ADMIN_DELETE_MESSAGE
      : "The protected seed-admin account cannot be modified from the application.",
  );
}

/**
 * Shared check used by every mutation that targets a user other than the actor.
 * Exposed for reuse (e.g. future admin-edit flows) so the protection can never
 * be forgotten: it reads state from the database, never from the client.
 */
export async function assertTargetNotSeedAdmin(targetUserId: string, ctx: ActorContext, verb: "delete" | "modify" = "modify") {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, isSeedAdmin: true } });
  if (!target) throw notFound("User not found");
  await guardSeedAdmin(target, ctx, verb);
}
