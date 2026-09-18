import { audit } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/errors/errors";

/**
 * Protected seed admin — the single account provisioned from `SEED_ADMIN_*` by
 * `prisma/seed.ts`.
 *
 * Identification is deliberately NOT "the email in .env": the marker lives on the
 * user row (`User.isProtectedSeedAdmin`, migration
 * `20260918120000_protected_seed_admin_session_version`) so it survives restarts,
 * deployments and later .env edits, and only the seed script can write it. These
 * predicates are the single place that decides what "protected" means, so every
 * service, route and UI notice agrees.
 *
 * This module contains no credentials: messages and audit entries only ever carry
 * identifiers and field names.
 */

export const PROTECTED_SEED_ADMIN_BADGE = "Protected Seed Admin";

export const PROTECTED_SEED_ADMIN_PROFILE_MESSAGE =
  "This is the protected seed admin account. Its name, email and password cannot be changed or deleted through the application.";

export const PROTECTED_SEED_ADMIN_DELETE_MESSAGE =
  "The protected seed admin account cannot be deleted through the application.";

export const PROTECTED_SEED_ADMIN_MANAGE_MESSAGE =
  "Only the protected seed admin can create or delete admin accounts.";

export interface SeedAdminActor {
  id: string;
  email: string;
  name: string;
}

export function isProtectedSeedAdmin(
  user: { isProtectedSeedAdmin?: boolean | null } | null | undefined,
): boolean {
  return Boolean(user?.isProtectedSeedAdmin);
}

/**
 * Guard for profile/password changes. Callers pass the freshly loaded row, never a
 * client-supplied flag, so the protection cannot be bypassed by request payloads.
 */
export function assertNotProtectedSeedAdmin(
  user: { id: string; isProtectedSeedAdmin?: boolean | null; email?: string },
  message = PROTECTED_SEED_ADMIN_PROFILE_MESSAGE,
) {
  if (isProtectedSeedAdmin(user)) throw forbidden(message);
}

/**
 * Records a rejected attempt to change or delete the protected seed admin. Audit
 * entries hold identifiers and the attempted operation only — never credentials.
 */
export async function auditProtectedSeedAdminRejection(input: {
  actorUserId: string;
  action: string;
  operation: string;
  targetUserId?: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await audit({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: "User",
    entityId: input.targetUserId ?? input.actorUserId,
    newValues: { operation: input.operation, reason: "protected_seed_admin" },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Resolves the protected seed admin from the database for admin-management actions.
 *
 * Admin account creation/deletion is scoped to the protected seed admin only, which is
 * stricter than the existing policy that lets any admin read user lists. Normal admins
 * therefore keep read access but cannot create, delete or otherwise manage admins.
 */
export async function requireSeedAdminActor(input: {
  actorUserId: string;
  operation: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<SeedAdminActor> {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: { id: true, email: true, name: true, role: true, isActive: true, isProtectedSeedAdmin: true },
  });
  if (!actor || !actor.isActive || actor.role !== "ADMIN" || !actor.isProtectedSeedAdmin) {
    await audit({
      actorUserId: input.actorUserId,
      action: "admin.manage.rejected",
      entityType: "User",
      entityId: input.actorUserId,
      newValues: { operation: input.operation, reason: "not_protected_seed_admin" },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    throw forbidden(PROTECTED_SEED_ADMIN_MANAGE_MESSAGE);
  }
  return { id: actor.id, email: actor.email, name: actor.name };
}

/** The protected seed admin row, or null on an installation that has not been seeded yet. */
export async function findProtectedSeedAdmin() {
  return prisma.user.findFirst({
    where: { isProtectedSeedAdmin: true },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
}
