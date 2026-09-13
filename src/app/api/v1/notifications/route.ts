export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { fail, paginated, parsePagination } from "@/lib/api/response";
import { listMyNotifications } from "@/modules/notifications/notifications.service";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total, unreadCount } = await listMyNotifications(auth.userId, { unreadOnly: s.get("unread") === "true", page, limit });
    return paginated(items, page, limit, total, { unreadCount });
  } catch (e) { return fail(e); }
}
