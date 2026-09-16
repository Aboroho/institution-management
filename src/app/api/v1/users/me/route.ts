export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta, setSessionCookie, signSessionForUser } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { profileUpdateSchema, type ProfileUpdateInput } from "@/lib/validation/users";
import { getMyProfile, updateMyProfile } from "@/modules/users/users.service";

/** Own account summary — always scoped to the authenticated user (no client id). */
export async function GET() {
  try {
    const auth = await requireAuth();
    return ok(await getMyProfile(auth.userId));
  } catch (e) { return fail(e); }
}

/**
 * Change own name and/or email. Ownership is enforced structurally: the target is
 * always auth.userId — the API has no way to address another user's profile (IDOR).
 * The protected seed admin is rejected by the service. On success the session
 * cookie is re-issued so its name/email claims match the new profile.
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const parsed = profileUpdateSchema.parse(await req.json());
    const input: ProfileUpdateInput = { name: parsed.name, email: parsed.email };
    const updated = await updateMyProfile(auth.userId, input, { actorUserId: auth.userId, ...requestMeta() });
    const res = ok(updated);
    const token = await signSessionForUser({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      tokenVersion: auth.session.tokenVersion,
    });
    setSessionCookie(res, token);
    return res;
  } catch (e) { return fail(e); }
}
