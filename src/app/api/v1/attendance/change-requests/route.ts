export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { createChangeRequest, listChangeRequests } from "@/modules/attendance/attendance.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listChangeRequests({ status: s.get("status") || undefined, courseOfferingId: s.get("courseOfferingId") || undefined, page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({ recordId: z.string().min(1), newStatus: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]), reason: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    const rec = await prisma.attendanceRecord.findUnique({ where: { id: body.recordId }, include: { session: true } });
    if (!rec) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Attendance record not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, rec.session.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const created = await createChangeRequest({ ...body, requestedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "attendanceChangeRequest.create", entityType: "AttendanceChangeRequest", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
