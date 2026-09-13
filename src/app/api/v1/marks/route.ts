export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { saveMarks, assessmentMarks } from "@/modules/marks/marks.service";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/notify";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const assessmentId = req.nextUrl.searchParams.get("assessmentId");
    if (!assessmentId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "assessmentId is required", 422)); }
    const a = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!a) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Assessment not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, a.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    return ok(await assessmentMarks(assessmentId));
  } catch (e) { return fail(e); }
}

const schema = z.object({
  assessmentId: z.string().min(1),
  marks: z.array(z.object({ studentId: z.string().min(1), marksObtained: z.number().min(0) })).min(1),
  reason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    const a = await prisma.assessment.findUnique({ where: { id: body.assessmentId } });
    if (!a) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Assessment not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, a.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const results = await saveMarks({ ...body, actorUserId: auth.userId, isAdmin: auth.role === "ADMIN" });
    await audit({ actorUserId: auth.userId, action: "marks.save", entityType: "Assessment", entityId: body.assessmentId, newValues: { count: results.length }, ...requestMeta() });
    // Notify students about published marks.
    const students = await prisma.student.findMany({ where: { id: { in: body.marks.map((m) => m.studentId) } }, select: { userId: true } });
    await notify({ recipientIds: students.map((s) => s.userId), type: "MARK_PUBLISHED", title: `Marks published: ${a.title}`,
      message: `Your marks for ${a.title} have been published.`, resourceType: "Assessment", resourceId: a.id });
    return ok(results);
  } catch (e) { return fail(e); }
}
