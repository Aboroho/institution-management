import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors/errors";
import { hashPassword } from "@/lib/auth/password";
import { isForeignKeyConstraintError, isUniqueConstraintError } from "@/lib/db/prisma-errors";
import { normalizeEmail } from "@/lib/validation/common";
import {
  PROTECTED_SEED_ADMIN_DELETE_MESSAGE,
  auditProtectedSeedAdminRejection,
  requireSeedAdminActor,
} from "./seed-admin";

/**
 * Admin account management.
 *
 * Model (see SECURITY.md): listing admins uses the existing ADMIN-wide read policy,
 * while *creating and deleting* admin accounts is scoped to the protected seed admin.
 * That is the narrowest scope that satisfies the requirement and it never widens
 * normal-admin powers. Authorization is re-verified here, from the database, for every
 * mutating call — a route-level check is not assumed.
 *
 * The protected seed admin row can never be the target of a delete: the guard is
 * applied to the freshly loaded row and repeated in the WHERE clause of the write, so a
 * concurrent change cannot slip past it.
 */

export const adminAccountSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isProtectedSeedAdmin: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

export type AdminAccount = Prisma.UserGetPayload<{ select: typeof adminAccountSelect }>;

/** Relations that make a hard delete fail or destroy history. */
const historyCountSelect = {
  auditLogs: true,
  promotionsDecided: true,
  assignmentsCreated: true,
  schedulesCreated: true,
  sessionsCreated: true,
  attendanceLogs: true,
  attendanceReviews: true,
  attendanceSessionRequests: true,
  assessmentsCreated: true,
  marksEntered: true,
  markLogs: true,
  markRequests: true,
  markReviews: true,
  filesUploaded: true,
} as const;

const historyLabels: Record<keyof typeof historyCountSelect, string> = {
  auditLogs: "audit history",
  promotionsDecided: "promotion decisions",
  assignmentsCreated: "teacher assignments",
  schedulesCreated: "schedule versions",
  sessionsCreated: "attendance sessions",
  attendanceLogs: "attendance corrections",
  attendanceReviews: "attendance approvals",
  attendanceSessionRequests: "attendance change requests",
  assessmentsCreated: "assessments",
  marksEntered: "marks",
  markLogs: "mark corrections",
  markRequests: "mark change requests",
  markReviews: "mark approvals",
  filesUploaded: "uploaded files",
};

type HistoryCounts = Record<keyof typeof historyCountSelect, number>;

function historyBlockers(counts: HistoryCounts): string[] {
  return (Object.keys(historyLabels) as (keyof typeof historyCountSelect)[])
    .filter((key) => counts[key] > 0)
    .map((key) => historyLabels[key]);
}

function duplicateEmail(message = "Email already in use") {
  return conflict(message, { fieldErrors: { email: [message] }, formErrors: [message] });
}

/** Paginated admin list: the protected seed admin is always first, then creation order. */
export async function listAdminAccounts(opts: { search?: string; page: number; limit: number }) {
  const where: Prisma.UserWhereInput = { role: "ADMIN" };
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { email: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ isProtectedSeedAdmin: "desc" }, { createdAt: "asc" }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      select: adminAccountSelect,
    }),
  ]);
  return { items, total };
}

export interface CreateAdminAccountInput {
  actorUserId: string;
  name: string;
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a normal ADMIN account. The new account is explicitly NOT a protected seed
 * admin and its role is fixed to ADMIN — neither value comes from the request, so a
 * crafted payload cannot mint a privileged or protected account.
 */
export async function createAdminAccount(input: CreateAdminAccountInput): Promise<AdminAccount> {
  await requireSeedAdminActor({
    actorUserId: input.actorUserId,
    operation: "admin.create",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw duplicateEmail();

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "ADMIN",
        isActive: true,
        isProtectedSeedAdmin: false,
      },
      select: adminAccountSelect,
    });
  } catch (error) {
    // Concurrent creation of the same email: the unique index decides, the loser gets
    // the same friendly field error (never a 500).
    if (isUniqueConstraintError(error, "email")) throw duplicateEmail();
    throw error;
  }
}

export interface AdminRemovalResult {
  mode: "deleted" | "deactivated";
  user: { id: string; email: string; name: string };
  /** Record types that made removal unsafe; empty for a hard delete. */
  preservedHistory: string[];
}

async function deactivateAdminAccount(
  target: { id: string; email: string; name: string },
  preservedHistory: string[],
): Promise<AdminRemovalResult> {
  const updated = await prisma.user.updateMany({
    where: { id: target.id, isProtectedSeedAdmin: false },
    data: { isActive: false, sessionVersion: { increment: 1 } },
  });
  if (updated.count !== 1) {
    // Only possible if the row became the protected seed admin in between.
    throw forbidden(PROTECTED_SEED_ADMIN_DELETE_MESSAGE);
  }
  return { mode: "deactivated", user: { id: target.id, email: target.email, name: target.name }, preservedHistory };
}

/**
 * Removes an admin account on behalf of the protected seed admin.
 *
 * - The protected seed admin can never be deleted (by anybody, including itself).
 * - A normal admin with no academic/audit history is deleted outright.
 * - A normal admin that already has history is deactivated instead: existing audit,
 *   marks, attendance and assignment rows keep their actor attribution, and access is
 *   revoked immediately (isActive=false plus a sessionVersion bump invalidates every
 *   token already issued for that account).
 *
 * Which of the two happened is returned so the UI can explain the outcome.
 */
export async function removeAdminAccount(input: {
  actorUserId: string;
  targetUserId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<AdminRemovalResult> {
  await requireSeedAdminActor({
    actorUserId: input.actorUserId,
    operation: "admin.delete",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isProtectedSeedAdmin: true,
      student: { select: { id: true } },
      teacher: { select: { id: true } },
      _count: { select: historyCountSelect },
    },
  });
  if (!target) throw notFound("Admin account not found");

  if (target.isProtectedSeedAdmin) {
    await auditProtectedSeedAdminRejection({
      actorUserId: input.actorUserId,
      action: "seed_admin.delete.rejected",
      operation: "admin.delete",
      targetUserId: target.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw forbidden(PROTECTED_SEED_ADMIN_DELETE_MESSAGE);
  }

  if (target.role !== "ADMIN") {
    throw validationError("Only admin accounts can be removed here.", {
      fieldErrors: { userId: ["Only admin accounts can be removed here."] },
      formErrors: [],
    });
  }

  const blockers = historyBlockers(target._count);
  if (target.student) blockers.push("student profile");
  if (target.teacher) blockers.push("teacher profile");
  if (blockers.length) return deactivateAdminAccount(target, blockers);

  try {
    // Re-read inside the transaction: the guards and the delete must be one unit, so
    // an account cannot be protected (or gain history) between them.
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUnique({
        where: { id: target.id },
        select: { id: true, role: true, isProtectedSeedAdmin: true },
      });
      if (!fresh) throw notFound("Admin account not found");
      if (fresh.isProtectedSeedAdmin) {
        await auditProtectedSeedAdminRejection({
          actorUserId: input.actorUserId,
          action: "seed_admin.delete.rejected",
          operation: "admin.delete",
          targetUserId: fresh.id,
          ip: input.ip,
          userAgent: input.userAgent,
        });
        throw forbidden(PROTECTED_SEED_ADMIN_DELETE_MESSAGE);
      }
      if (fresh.role !== "ADMIN") {
        throw validationError("Only admin accounts can be removed here.", {
          fieldErrors: { userId: ["Only admin accounts can be removed here."] },
          formErrors: [],
        });
      }
      const removed = await tx.user.deleteMany({ where: { id: target.id, isProtectedSeedAdmin: false } });
      if (removed.count !== 1) throw notFound("Admin account not found");
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      // A dependent record appeared between the count and the delete (someone used the
      // account in the meantime). Never force a destructive delete: deactivate instead
      // so the system stays consistent and history is preserved.
      return deactivateAdminAccount(target, ["related records"]);
    }
    throw error;
  }

  return { mode: "deleted", user: { id: target.id, email: target.email, name: target.name }, preservedHistory: [] };
}
