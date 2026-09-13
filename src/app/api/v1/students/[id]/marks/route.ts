export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireStudentSelf } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { studentOfferingGrades } from "@/modules/marks/marks.service";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN") await requireStudentSelf(auth, params.id);
    return ok(await studentOfferingGrades(params.id));
  } catch (e) { return fail(e); }
}
