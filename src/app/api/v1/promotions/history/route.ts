export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { fail, paginated, parsePagination } from "@/lib/api/response";
import { promotionHistory } from "@/modules/promotions/promotions.service";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await promotionHistory(s.get("studentId") || undefined, page, limit);
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}
