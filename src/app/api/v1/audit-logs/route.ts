export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { fail, paginated, parsePagination } from "@/lib/api/response";
import { listAuditLogs } from "@/modules/audit/audit.service";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listAuditLogs({
      actor: s.get("actor") || undefined, action: s.get("action") || undefined, entityType: s.get("entity") || undefined,
      from: s.get("from") ? new Date(s.get("from") as string) : undefined,
      to: s.get("to") ? new Date(s.get("to") as string) : undefined, page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}
