export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, myStudent } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getDownloadUrl } from "@/modules/submissions/submissions.service";
import { prisma } from "@/lib/db/prisma";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const s = await prisma.assessmentSubmission.findUnique({ where: { id: params.id }, include: { assessment: true } });
    if (!s) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Submission not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, s.assessment.courseOfferingId);
    else if (auth.role === "STUDENT") {
      const me = await myStudent(auth);
      if (s.studentId !== me.id) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    } else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    return ok(await getDownloadUrl(params.id));
  } catch (e) { return fail(e); }
}
