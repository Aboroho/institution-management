export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { forbidden } from "@/lib/errors/errors";
import { listEligibleNoticeRecipients } from "@/modules/notices/notices.service";

export async function GET(_: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") throw forbidden("Only staff can select notice recipients");
    return ok(await listEligibleNoticeRecipients(auth));
  } catch (error) {
    return fail(error);
  }
}
