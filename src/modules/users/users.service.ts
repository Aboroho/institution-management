import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isUniqueConstraintError } from "@/lib/db/prisma-errors";
import { normalizeEmail, passwordMinLength } from "@/lib/validation/common";
import {
  PROTECTED_SEED_ADMIN_PROFILE_MESSAGE,
  auditProtectedSeedAdminRejection,
  isProtectedSeedAdmin,
} from "./seed-admin";

/**
 * Self-service profile and password management for STUDENT, TEACHER and ADMIN users.
 *
 * Ownership is expressed in the API shape: every function takes the id of the
 * *authenticated* user (from the session), never an id from the request body, so one
 * account can never address another account's profile (no IDOR surface). The protected
 * seed admin is rejected here as well as in the UI: the row itself is the source of
 * truth for that decision.
 */

/** Response-safe user shape. `passwordHash` is deliberately not selectable here. */
export const userProfileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isProtectedSeedAdmin: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, studentId: true } },
  teacher: { select: { id: true, employeeId: true } },
} as const satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof userProfileSelect }>;

function duplicateEmail(message = "Email already in use") {
  return conflict(message, { fieldErrors: { email: [message] }, formErrors: [message] });
}

export async function getOwnProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userProfileSelect });
  if (!user) throw notFound("User not found");
  return user;
}

/**
 * Uniqueness check that also covers rows whose email predates normalization.
 * The database's `User.email` unique index is the final authority; a later race is
 * turned into the same friendly conflict by the caller.
 */
async function assertEmailAvailable(email: string, ignoreUserId?: string) {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing && existing.id !== ignoreUserId) throw duplicateEmail();
}

export interface ProfileUpdateInput {
  userId: string;
  name: string;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ProfileUpdateResult {
  user: UserProfile;
  previous: { name: string; email: string };
  emailChanged: boolean;
}

/**
 * Updates the caller's own name and email.
 *
 * The write is limited to those two columns — role, isActive, isProtectedSeedAdmin and
 * sessionVersion are not part of the input type and not part of the update, and the
 * request schema is strict, so a crafted payload cannot reach them (mass assignment).
 */
export async function updateOwnProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  const current = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, isActive: true, isProtectedSeedAdmin: true },
  });
  if (!current) throw notFound("User not found");
  if (!current.isActive) throw forbidden("This account is inactive. Contact an administrator.");

  if (isProtectedSeedAdmin(current)) {
    await auditProtectedSeedAdminRejection({
      actorUserId: input.userId,
      action: "seed_admin.update.rejected",
      operation: "profile.update",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw forbidden(PROTECTED_SEED_ADMIN_PROFILE_MESSAGE);
  }

  await assertEmailAvailable(email, current.id);

  let updated: UserProfile;
  try {
    updated = await prisma.user.update({
      where: { id: current.id },
      data: { name, email },
      select: userProfileSelect,
    });
  } catch (error) {
    // Two accounts may attempt the same email at the same instant; the unique index
    // decides and the loser gets the same field error as the pre-check.
    if (isUniqueConstraintError(error, "email")) throw duplicateEmail();
    throw error;
  }

  return {
    user: updated,
    previous: { name: current.name, email: current.email },
    emailChanged: current.email !== email,
  };
}

export interface PasswordChangeInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PasswordChangeResult {
  userId: string;
  /** The new session epoch: all previously issued tokens for this account are stale. */
  sessionVersion: number;
}

function fieldError(field: string, message: string) {
  return { fieldErrors: { [field]: [message] }, formErrors: [] };
}

/**
 * Changes the caller's own password after verifying the current one with bcrypt.
 *
 * Concurrency: the update is a compare-and-swap on the password hash that was just
 * verified (`updateMany` with `passwordHash` in the WHERE clause). If another request
 * changed the password in between, the update matches no row and the caller gets a
 * conflict instead of silently overwriting the other change — two concurrent changes
 * can never both "succeed". The same write bumps `sessionVersion`, which invalidates
 * every session token issued before it.
 */
export async function changeOwnPassword(input: PasswordChangeInput): Promise<PasswordChangeResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, isActive: true, isProtectedSeedAdmin: true, sessionVersion: true },
  });
  if (!user) throw notFound("User not found");
  if (!user.isActive) throw forbidden("This account is inactive. Contact an administrator.");

  if (isProtectedSeedAdmin(user)) {
    await auditProtectedSeedAdminRejection({
      actorUserId: input.userId,
      action: "seed_admin.password_change.rejected",
      operation: "password.change",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw forbidden(PROTECTED_SEED_ADMIN_PROFILE_MESSAGE);
  }

  // Re-check the policy in the service as well: the route schema is the user-facing
  // validation, this keeps the rule true for every caller.
  if (input.newPassword.length < passwordMinLength) {
    throw validationError("Password does not meet the password policy", {
      fieldErrors: { newPassword: [`Password must be at least ${passwordMinLength} characters`] },
      formErrors: [],
    });
  }
  if (input.newPassword !== input.confirmPassword) {
    throw validationError("New password and confirmation do not match", {
      fieldErrors: { confirmPassword: ["New password and confirmation do not match"] },
      formErrors: [],
    });
  }

  const currentMatches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw validationError("Current password is incorrect", fieldError("currentPassword", "Current password is incorrect"));
  }
  if (input.newPassword === input.currentPassword) {
    throw validationError(
      "New password must be different from the current password",
      fieldError("newPassword", "New password must be different from the current password"),
    );
  }

  const passwordHash = await hashPassword(input.newPassword);
  const updated = await prisma.user.updateMany({
    where: { id: user.id, passwordHash: user.passwordHash, isProtectedSeedAdmin: false },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw conflict("This password was changed by another request. Sign in again and retry.");
  }

  // Read the epoch back instead of assuming `previous + 1`: another request (e.g. an
  // admin removing the account) may have bumped it concurrently, and the session the
  // caller is about to receive must match what is stored.
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
  return { userId: user.id, sessionVersion: fresh?.sessionVersion ?? user.sessionVersion + 1 };
}
