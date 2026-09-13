export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, myStudent } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { submitPdf, listSubmissions } from "@/modules/submissions/submissions.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const assessmentId = req.nextUrl.searchParams.get("assessmentId");
    if (!assessmentId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "assessmentId is required", 422)); }
    const a = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!a) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Assessment not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, a.courseOfferingId);
    else if (auth.role === "STUDENT") {
      const me = await myStudent(auth);
      const mine = await prisma.assessmentSubmission.findUnique({ where: { assessmentId_studentId: { assessmentId, studentId: me.id } }, include: { file: true } });
      return ok(mine ? [mine] : []);
    } else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    return ok(await listSubmissions(assessmentId));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "STUDENT") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "Only students can submit assignments", 403)); }
    const me = await myStudent(auth);
    const form = await req.formData();
    const assessmentId = String(form.get("assessmentId") || "");
    const file = form.get("file") as File | null;
    if (!assessmentId || !file) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "assessmentId and file are required", 422)); }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await submitPdf({
      assessmentId, studentId: me.id, uploaderUserId: auth.userId,
      buffer, originalName: file.name, mimeType: file.type || "application/pdf", size: file.size,
    });
    await audit({ actorUserId: auth.userId, action: "submission.create", entityType: "AssessmentSubmission", entityId: result.id, newValues: { assessmentId }, ...requestMeta() });
    return ok(result, undefined, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong";
    if (msg.includes("PDF") || msg.includes("50 MB") || msg.includes("submit")) {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("VALIDATION_ERROR", msg, 422));
    }
    return fail(e);
  }
}
