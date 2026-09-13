export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, requireStudentInOffering } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { offeringStudents } from "@/modules/course-offerings/offerings.service";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, params.id);
    else if (auth.role === "STUDENT") await requireStudentInOffering(auth, params.id);
    return ok(await offeringStudents(params.id));
  } catch (e) { return fail(e); }
}
