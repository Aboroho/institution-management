export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, requireStudentInOffering } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { generateCourseOfferingAssessmentReport } from "@/modules/reporting/reporting.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { courseOfferingId: string } }
) {
  try {
    const auth = await requireAuth();
    // Authorize: Admin or assigned teacher or enrolled student
    if (auth.role === "ADMIN") {
      // Admin is authorized
    } else if (auth.role === "TEACHER") {
      await requireActiveTeacherAssignment(auth, params.courseOfferingId);
    } else if (auth.role === "STUDENT") {
      await requireStudentInOffering(auth, params.courseOfferingId);
    }

    const searchParams = req.nextUrl.searchParams;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    const report = await generateCourseOfferingAssessmentReport(
      params.courseOfferingId,
      { from, to }
    );

    return ok(report);
  } catch (e) {
    return fail(e);
  }
}
