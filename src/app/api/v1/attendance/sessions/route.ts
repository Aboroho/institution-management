export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { saveSessionAttendance, getSession, listSessions } from "@/modules/attendance/attendance.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    const courseOfferingId = s.get("courseOfferingId");
    if (!courseOfferingId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "courseOfferingId is required", 422)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const date = s.get("date");
    if (date) return ok(await getSession(courseOfferingId, new Date(date)));
    return ok(await listSessions(courseOfferingId, {
      from: s.get("from") ? new Date(s.get("from") as string) : undefined,
      to: s.get("to") ? new Date(s.get("to") as string) : undefined,
    }));
  } catch (e) { return fail(e); }
}

const schema = z.object({
  courseOfferingId: z.string().min(1), attendanceDate: z.coerce.date(),
  records: z.array(z.object({ studentId: z.string().min(1), status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]), note: z.string().optional() })).min(1),
  reason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, body.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const result = await saveSessionAttendance({ ...body, actorUserId: auth.userId, isAdmin: auth.role === "ADMIN" });
    await audit({ actorUserId: auth.userId, action: "attendance.save", entityType: "AttendanceSession", entityId: result.sessionId, newValues: { courseOfferingId: body.courseOfferingId, count: body.records.length }, ...requestMeta() });
    return ok(result);
  } catch (e) { return fail(e); }
}
