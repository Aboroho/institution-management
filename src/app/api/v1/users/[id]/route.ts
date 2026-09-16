export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { deleteAdmin } from "@/modules/users/users.service";

const paramsSchema = z.object({ id: z.string().min(1, "Required") });

/**
 * Delete a normal ADMIN account (admin management). The service re-verifies the
 * target exists, is an ADMIN, is NOT the protected seed admin (again inside the
 * transaction), has no history that would be destroyed, and that the actor is not
 * deleting themselves. Attempts against the seed admin return 403 and are audited.
 */
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const { id } = paramsSchema.parse(params);
    const deleted = await deleteAdmin(id, { actorUserId: auth.userId, ...requestMeta() });
    return ok({ id: deleted.id, deleted: true });
  } catch (e) { return fail(e); }
}
