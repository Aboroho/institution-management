export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta, setSessionCookie, signSessionForUser } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { passwordChangeSchema } from "@/lib/validation/users";
import { changeMyPassword, getMyProfile } from "@/modules/users/users.service";

/**
 * Change own password. Requires the current password; on success tokenVersion is
 * incremented so every previously issued token stops working, and this device
 * receives a freshly signed cookie (it stays signed in). Passwords are never
 * returned or audited. The protected seed admin is rejected by the service.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const input = passwordChangeSchema.parse(await req.json());
    const { tokenVersion } = await changeMyPassword(
      auth.userId,
      { currentPassword: input.currentPassword, newPassword: input.newPassword, confirmPassword: input.confirmPassword },
      { actorUserId: auth.userId, ...requestMeta() },
    );
    const me = await getMyProfile(auth.userId);
    const res = ok({ changed: true });
    const token = await signSessionForUser({
      id: me.id,
      email: me.email,
      name: me.name,
      role: me.role,
      tokenVersion,
    });
    setSessionCookie(res, token);
    return res;
  } catch (e) { return fail(e); }
}
