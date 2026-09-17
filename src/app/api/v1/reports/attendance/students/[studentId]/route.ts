export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireStudentSelf } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { generateStudentAttendanceReport } from "@/modules/reporting/reporting.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { studentId: string } }
) {
  try {
    const auth = await requireAuth();
    // Authorize: Admin or own student ID
    await requireStudentSelf(auth, params.studentId);

    const searchParams = req.nextUrl.searchParams;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const includeDayWise = searchParams.get("includeDayWise") === "true";

    const report = await generateStudentAttendanceReport(
      params.studentId,
      { from, to, includeDayWise }
    );

    return ok(report);
  } catch (e) {
    return fail(e);
  }
}
