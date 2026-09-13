export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, myStudent } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listAssessments, createAssessment, studentAssessments } from "@/modules/assessments/assessments.service";
import { notify } from "@/lib/notifications/notify";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    if (auth.role === "STUDENT") {
      const me = await myStudent(auth);
      return ok(await studentAssessments(me.id));
    }
    const { page, limit } = parsePagination(s);
    const courseOfferingId = s.get("courseOfferingId") || undefined;
    if (auth.role === "TEACHER" && courseOfferingId) await requireActiveTeacherAssignment(auth, courseOfferingId);
    const { items, total } = await listAssessments({
      courseOfferingId, type: s.get("type") || undefined,
      upcoming: s.get("upcoming") === "true", page, limit,
    });
    // Teachers see only their own offerings' assessments.
    if (auth.role === "TEACHER" && !courseOfferingId) {
      const assigns = await prisma.teacherCourseAssignment.findMany({
        where: { teacher: { userId: auth.userId }, isActive: true }, select: { courseOfferingId: true },
      });
      const ids = new Set(assigns.map((a) => a.courseOfferingId));
      return paginated(items.filter((a) => ids.has(a.courseOfferingId)), page, limit, total);
    }
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  courseOfferingId: z.string().min(1), title: z.string().min(1), description: z.string().optional(),
  type: z.enum(["ASSIGNMENT", "CLASS_TEST", "MIDTERM", "FINAL_EXAM", "PRACTICAL", "QUIZ", "OTHER"]),
  totalMarks: z.number().positive(), passMarks: z.number().min(0),
  submitable: z.boolean().optional(), countsTowardFinal: z.boolean().optional(),
  weight: z.number().min(0).max(100).nullable().optional(), dueDate: z.coerce.date().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, body.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const created = await createAssessment({ ...body, weight: body.weight ?? null, dueDate: body.dueDate ?? null, createdById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "assessment.create", entityType: "Assessment", entityId: created.id, newValues: created, ...requestMeta() });
    // Notify enrolled students.
    const offering = await prisma.courseOffering.findUnique({ where: { id: created.courseOfferingId } });
    if (offering) {
      const ens = await prisma.studentEnrollment.findMany({
        where: { academicYearId: offering.academicYearId, tradeId: offering.tradeId, semesterId: offering.semesterId, shiftId: offering.shiftId, sectionId: offering.sectionId, status: "ACTIVE" },
        include: { student: { select: { userId: true } } },
      });
      await notify({ recipientIds: ens.map((e) => e.student.userId), type: "NEW_ASSIGNMENT", title: `New assessment: ${created.title}`,
        message: `A new ${created.type.toLowerCase().replace(/_/g, " ")} has been published.`, resourceType: "Assessment", resourceId: created.id });
    }
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
