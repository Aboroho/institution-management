export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { generateCourseOfferingAttendanceReport } from "@/modules/reporting/reporting.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { courseOfferingId: string } }
) {
  try {
    const auth = await requireAuth();
    // Authorize: Admin or assigned teacher
    await requireActiveTeacherAssignment(auth, params.courseOfferingId);

    const searchParams = req.nextUrl.searchParams;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const includeDayWise = searchParams.get("includeDayWise") === "true";

    const report = await generateCourseOfferingAttendanceReport(
      params.courseOfferingId,
      { from, to, includeDayWise }
    );

    return ok(report);
  } catch (e) {
    return fail(e);
  }
}
