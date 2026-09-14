export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { validationError } from "@/lib/errors/errors";
import { getActiveCurriculum } from "@/modules/courses/courses.service";

// NOTE: static segment "active" takes precedence over [id]; this returns the single
// active curriculum (with its courses) for a trade + semester, or null data if none.
export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const tradeId = req.nextUrl.searchParams.get("tradeId");
    const semesterId = req.nextUrl.searchParams.get("semesterId");
    if (!tradeId || !semesterId) {
      throw validationError("tradeId and semesterId are required");
    }
    return ok(await getActiveCurriculum(tradeId, semesterId));
  } catch (e) { return fail(e); }
}
