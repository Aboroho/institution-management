export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment, myTeacher, myStudent } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listNotices, createNotice, studentNotices } from "@/modules/notices/notices.service";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/notify";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    if (auth.role === "STUDENT") {
      const me = await myStudent(auth);
      return ok(await studentNotices(me.id));
    }
    if (auth.role === "TEACHER") {
      const t = await myTeacher(auth);
      const { page, limit } = parsePagination(s);
      const { items, total } = await listNotices({ courseOfferingId: s.get("courseOfferingId") || undefined, teacherId: t.id, search: s.get("search") || undefined, page, limit });
      // Also include notices in own offerings from predecessors (history preserved).
      const assigns = await prisma.teacherCourseAssignment.findMany({ where: { teacherId: t.id, isActive: true }, select: { courseOfferingId: true } });
      const own = new Set(assigns.map((a) => a.courseOfferingId));
      const scoped = items.filter((n) => own.has(n.courseOfferingId));
      return paginated(scoped, page, limit, scoped.length);
    }
    const { page, limit } = parsePagination(s);
    const { items, total } = await listNotices({ courseOfferingId: s.get("courseOfferingId") || undefined, search: s.get("search") || undefined, page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({ courseOfferingId: z.string().min(1), title: z.string().min(1), content: z.string().min(1), expiresAt: z.coerce.date().nullable().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    let teacherId: string;
    if (auth.role === "TEACHER") {
      const t = await myTeacher(auth);
      await requireActiveTeacherAssignment(auth, body.courseOfferingId);
      teacherId = t.id;
    } else if (auth.role === "ADMIN") {
      // Admin posts on behalf: use first active assignment's teacher or fail.
      const a = await prisma.teacherCourseAssignment.findFirst({ where: { courseOfferingId: body.courseOfferingId, isActive: true } });
      if (!a) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("BUSINESS_RULE", "No active teacher for this offering", 422)); }
      teacherId = a.teacherId;
    } else { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const created = await createNotice({ ...body, expiresAt: body.expiresAt ?? null, teacherId });
    await audit({ actorUserId: auth.userId, action: "notice.create", entityType: "Notice", entityId: created.id, newValues: created, ...requestMeta() });
    const offering = await prisma.courseOffering.findUnique({ where: { id: body.courseOfferingId } });
    if (offering) {
      const ens = await prisma.studentEnrollment.findMany({
        where: { academicYearId: offering.academicYearId, tradeId: offering.tradeId, semesterId: offering.semesterId, shiftId: offering.shiftId, sectionId: offering.sectionId, status: "ACTIVE" },
        include: { student: { select: { userId: true } } },
      });
      await notify({ recipientIds: ens.map((e) => e.student.userId), type: "NEW_NOTICE", title: `New notice: ${created.title}`,
        message: created.content.slice(0, 200), resourceType: "Notice", resourceId: created.id });
    }
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
