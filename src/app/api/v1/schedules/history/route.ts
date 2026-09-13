export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { scheduleHistory } from "@/modules/schedules/schedules.service";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const courseOfferingId = req.nextUrl.searchParams.get("courseOfferingId");
    if (!courseOfferingId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "courseOfferingId is required", 422)); }
    return ok(await scheduleHistory(courseOfferingId));
  } catch (e) { return fail(e); }
}
