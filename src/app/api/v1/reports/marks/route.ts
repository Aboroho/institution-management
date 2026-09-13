export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { marksReport } from "@/modules/reports/reports.service";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    return ok(await marksReport({
      courseOfferingId: s.get("courseOfferingId") || undefined, assessmentId: s.get("assessmentId") || undefined,
      academicYearId: s.get("academicYearId") || undefined, tradeId: s.get("tradeId") || undefined,
      semesterId: s.get("semesterId") || undefined, shiftId: s.get("shiftId") || undefined,
      sectionId: s.get("sectionId") || undefined,
    }));
  } catch (e) { return fail(e); }
}
