export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { markRead } from "@/modules/notifications/notifications.service";

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    return ok(await markRead(auth.userId, params.id));
  } catch (e) { return fail(e); }
}
