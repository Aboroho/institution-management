export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { audit } from "@/lib/audit/audit";
import { createAdminAccountSchema } from "@/lib/validation/user";
import { createAdminAccount, listAdminAccounts } from "@/modules/users/admin-accounts.service";

/**
 * Admin accounts.
 *
 * GET  — any ADMIN (unchanged read policy: admins may already list users).
 * POST — the protected seed admin only; the service re-verifies that from the
 *        database. `meta.canManage` lets the UI hide actions it cannot use, but the
 *        backend is what enforces it.
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const { page, limit } = parsePagination(req.nextUrl.searchParams);
    const { items, total } = await listAdminAccounts({
      search: req.nextUrl.searchParams.get("search") || undefined,
      page,
      limit,
    });
    return paginated(items, page, limit, total, { canManage: auth.isProtectedSeedAdmin });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = createAdminAccountSchema.parse(await req.json());
    const created = await createAdminAccount({
      actorUserId: auth.userId,
      name: body.name,
      email: body.email,
      password: body.password,
      ...requestMeta(),
    });

    await audit({
      actorUserId: auth.userId,
      action: "admin.create",
      entityType: "User",
      entityId: created.id,
      newValues: {
        name: created.name,
        email: created.email,
        role: created.role,
        isProtectedSeedAdmin: created.isProtectedSeedAdmin,
      },
      ...requestMeta(),
    });

    return ok(created, undefined, 201);
  } catch (e) {
    return fail(e);
  }
}
