export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { applySessionCookie, sessionTokenFor } from "@/lib/auth/cookies";
import { audit } from "@/lib/audit/audit";
import { updateOwnProfileSchema } from "@/lib/validation/user";
import { getOwnProfile, updateOwnProfile } from "@/modules/users/users.service";

/**
 * Own profile for the authenticated user (STUDENT, TEACHER, ADMIN).
 *
 * There is no `{id}` in the path on purpose: the profile that can be read or written is
 * always the one in the session, so another user's account is not addressable (IDOR is
 * structurally impossible). The protected seed admin is refused by the service, which
 * checks the persisted marker on the user row — client input is never consulted.
 */

export async function GET() {
  try {
    const auth = await requireAuth();
    const profile = await getOwnProfile(auth.userId);
    return ok(profile);
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = updateOwnProfileSchema.parse(await req.json());
    const result = await updateOwnProfile({
      userId: auth.userId,
      name: body.name,
      email: body.email,
      ...requestMeta(),
    });

    // Refresh the caller's cookie so the shell (and the JWT claims) show the new
    // name/email without forcing a re-login. Session epoch is unchanged by a profile
    // edit, so other sessions stay valid.
    const token = await sessionTokenFor({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      sessionVersion: auth.sessionVersion,
    });

    await audit({
      actorUserId: auth.userId,
      action: "user.profile.update",
      entityType: "User",
      entityId: auth.userId,
      oldValues: result.previous,
      newValues: { name: result.user.name, email: result.user.email },
      ...requestMeta(),
    });

    return applySessionCookie(
      ok({ user: result.user, emailChanged: result.emailChanged, sessionRefreshed: true }),
      token,
    );
  } catch (e) {
    return fail(e);
  }
}
