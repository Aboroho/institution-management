export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { paginated, fail, parsePagination } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const search = req.nextUrl.searchParams;
    const { page, limit, skip } = parsePagination(search);
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
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } }),
    ]);
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}
