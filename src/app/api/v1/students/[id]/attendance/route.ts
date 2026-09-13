export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireStudentSelf } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { studentAttendanceSummary } from "@/modules/attendance/attendance.service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN") await requireStudentSelf(auth, params.id);
    const courseOfferingId = req.nextUrl.searchParams.get("courseOfferingId") || undefined;
    return ok(await studentAttendanceSummary(params.id, courseOfferingId));
  } catch (e) { return fail(e); }
}
