export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { markAllRead } from "@/modules/notifications/notifications.service";

export async function POST() {
  try {
    const auth = await requireAuth();
    return ok(await markAllRead(auth.userId));
  } catch (e) { return fail(e); }
}
