export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { paginated, fail, parsePagination, ok } from "@/lib/api/response";
import { createAdminSchema } from "@/lib/validation/users";
import { createAdmin, listAdminAccounts } from "@/modules/users/users.service";
import { prisma } from "@/lib/db/prisma";

/**
 * User directory for admins. `?adminsOnly=true` returns the admin-management view
 * (ADMIN accounts only, seed admin first, includes the protected flag).
 * Password hashes are never selected.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const search = req.nextUrl.searchParams;
    const { page, limit, skip } = parsePagination(search);
    if (search.get("adminsOnly") === "true") {
      const { items, total } = await listAdminAccounts({ search: search.get("search") || undefined, page, limit });
      return paginated(items, page, limit, total);
    }
    const role = search.get("role") || undefined;
    const q = search.get("search") || undefined;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (q) where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
    const [total, items] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit,
        select: { id: true, email: true, name: true, role: true, isActive: true, isSeedAdmin: true, createdAt: true } }),
    ]);
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

/**
 * Create an additional ADMIN account (admin management). Any authenticated ADMIN may
 * create normal admins per this application's flat admin permission model; the created
 * account always has role=ADMIN and NEVER the protected seed-admin status. Client-supplied
 * role/id/isActive/isSeedAdmin are rejected by the strict schema and ignored defensively.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const input = createAdminSchema.parse(await req.json());
    const created = await createAdmin(
      { name: input.name, email: input.email, password: input.password },
      { actorUserId: auth.userId, ...requestMeta() },
    );
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
