export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, requireStudentInOffering } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getAssessment, updateAssessment } from "@/modules/assessments/assessments.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const a = await getAssessment(params.id);
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, a.courseOfferingId);
    else if (auth.role === "STUDENT") await requireStudentInOffering(auth, a.courseOfferingId);
    return ok(a);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  title: z.string().min(1).optional(), description: z.string().nullable().optional(),
  type: z.enum(["ASSIGNMENT", "CLASS_TEST", "MIDTERM", "FINAL_EXAM", "PRACTICAL", "QUIZ", "OTHER"]).optional(),
  totalMarks: z.number().positive().optional(), passMarks: z.number().min(0).optional(),
  submitable: z.boolean().optional(), countsTowardFinal: z.boolean().optional(),
  weight: z.number().min(0).max(100).nullable().optional(), dueDate: z.coerce.date().nullable().optional(),
  isPublished: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const a = await getAssessment(params.id);
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, a.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const body = schema.parse(await req.json());
    const updated = await updateAssessment(params.id, body);
    await audit({ actorUserId: auth.userId, action: "assessment.update", entityType: "Assessment", entityId: params.id, newValues: body, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
