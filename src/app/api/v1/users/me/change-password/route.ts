export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { applySessionCookie, sessionTokenFor } from "@/lib/auth/cookies";
import { audit } from "@/lib/audit/audit";
import { changeOwnPasswordSchema } from "@/lib/validation/user";
import { changeOwnPassword, getOwnProfile } from "@/modules/users/users.service";

/**
 * Password change for the authenticated user.
 *
 * Unauthenticated callers are stopped by `requireAuth`. The current password is
 * verified with bcrypt against the stored hash, the new password is validated against
 * the shared password policy, and the write bumps `sessionVersion`: every token issued
 * before the change (including an attacker's copy of this user's cookie) is now stale,
 * while the caller receives a freshly signed cookie and stays signed in.
 *
 * Nothing in the response or in the audit entry contains a password or a hash.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = changeOwnPasswordSchema.parse(await req.json());

    const result = await changeOwnPassword({
      userId: auth.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      confirmPassword: body.confirmPassword,
      ...requestMeta(),
    });

    const profile = await getOwnProfile(auth.userId);
    const token = await sessionTokenFor({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      sessionVersion: result.sessionVersion,
    });

    await audit({
      actorUserId: auth.userId,
      action: "user.password.change",
      entityType: "User",
      entityId: auth.userId,
      newValues: { sessionVersion: result.sessionVersion },
      ...requestMeta(),
    });

    return applySessionCookie(ok({ changed: true, sessionVersion: result.sessionVersion }), token);
  } catch (e) {
    return fail(e);
  }
}
