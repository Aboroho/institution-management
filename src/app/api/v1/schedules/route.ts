export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, myTeacher, myStudent } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { listSchedules, createScheduleVersion } from "@/modules/schedules/schedules.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    let courseOfferingId = s.get("courseOfferingId") || undefined;
    // Scope teachers to their offerings; students to enrolled offerings.
    if (auth.role === "TEACHER" && !courseOfferingId) {
      const t = await myTeacher(auth);
      const assigns = await prisma.teacherCourseAssignment.findMany({ where: { teacherId: t.id, isActive: true }, select: { courseOfferingId: true } });
      const ids = assigns.map((a: { courseOfferingId: string }) => a.courseOfferingId);
      const all = await listSchedules({ activeOnly: true });
      return ok(all.filter((v: { courseOfferingId: string }) => ids.includes(v.courseOfferingId)));
    }
    if (auth.role === "STUDENT" && !courseOfferingId) {
      const me = await myStudent(auth);
      const ens = await prisma.studentEnrollment.findMany({ where: { studentId: me.id, status: "ACTIVE" } });
      const offs = await prisma.courseOffering.findMany({
        where: { OR: ens.map((e: { academicYearId: string; tradeId: string; semesterId: string; shiftId: string; sectionId: string }) => ({ academicYearId: e.academicYearId, tradeId: e.tradeId, semesterId: e.semesterId, shiftId: e.shiftId, sectionId: e.sectionId })) },
        select: { id: true },
      });
      const ids = offs.map((o: { id: string }) => o.id);
      const all = await listSchedules({ activeOnly: true });
      return ok(all.filter((v: { courseOfferingId: string }) => ids.includes(v.courseOfferingId)));
    }
    return ok(await listSchedules({
      courseOfferingId,
      academicYearId: s.get("academicYearId") || undefined, tradeId: s.get("tradeId") || undefined,
      semesterId: s.get("semesterId") || undefined, shiftId: s.get("shiftId") || undefined,
      sectionId: s.get("sectionId") || undefined, activeOnly: s.get("activeOnly") !== "false",
    }));
  } catch (e) { return fail(e); }
}

const item = z.object({ weekday: z.number().int().min(0).max(6), startTime: z.string(), endTime: z.string(), room: z.string().optional(), lab: z.string().optional() });
const schema = z.object({
  courseOfferingId: z.string().min(1), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().nullable().optional(),
  items: z.array(item).min(1),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createScheduleVersion({ ...body, effectiveTo: body.effectiveTo ?? null, createdById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "schedule.create", entityType: "ScheduleVersion", entityId: created?.id ?? "?", newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
