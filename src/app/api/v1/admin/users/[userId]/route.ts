export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { audit } from "@/lib/audit/audit";
import { removeAdminAccount } from "@/modules/users/admin-accounts.service";

/**
 * Removes an admin account. Protected seed admin only (re-verified in the service) and
 * never a protected seed admin target — the guard lives in the service and is repeated
 * in the write's WHERE clause, so hiding buttons is never the security boundary.
 *
 * `mode` is `"deleted"` for an account with no history, or `"deactivated"` when
 * removing the row would destroy history: access is revoked either way, and the
 * preserved record types are reported back so the UI can explain it.
 */
export async function DELETE(req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const result = await removeAdminAccount({
      actorUserId: auth.userId,
      targetUserId: params.userId,
      ...requestMeta(),
    });

    await audit({
      actorUserId: auth.userId,
      action: result.mode === "deleted" ? "admin.delete" : "admin.deactivate",
      entityType: "User",
      entityId: result.user.id,
      oldValues: { name: result.user.name, email: result.user.email, role: "ADMIN" },
      newValues: { mode: result.mode, preservedHistory: result.preservedHistory },
      ...requestMeta(),
    });

    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
