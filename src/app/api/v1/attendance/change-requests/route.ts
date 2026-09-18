export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { createChangeRequest, listChangeRequests } from "@/modules/attendance/attendance.service";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";
import { notifyAdmins } from "@/lib/notifications/notify";
import { audit } from "@/lib/audit/audit";

const listSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  courseOfferingId: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const filters = listSchema.parse({
      status: s.get("status") || undefined,
      courseOfferingId: s.get("courseOfferingId") || undefined,
    });
    const { items, total } = await listChangeRequests({ ...filters, page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const changeSchema = z.object({
  recordId: z.string().min(1),
  newStatus: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
});
const schema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().trim().min(1, "Reason is required"),
  changes: z.array(changeSchema).min(1),
}).superRefine((value, context) => {
  const ids = new Set(value.changes.map((change) => change.recordId));
  if (ids.size !== value.changes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["changes"], message: "Each attendance record may appear only once" });
  }
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "TEACHER") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", auth.role === "ADMIN" ? "Admins review attendance change requests; they do not submit them." : "Only assigned teachers can request attendance changes", 403));
    }
    const body = schema.parse(await req.json());

    const session = await prisma.attendanceSession.findUnique({ where: { id: body.sessionId }, select: { courseOfferingId: true } });
    if (!session) throw notFound("Attendance session not found");
    // Assignment is resolved from the authenticated user, never from a body
    // teacherId or client-provided permission flag.
    await requireActiveTeacherAssignment(auth, session.courseOfferingId);

    const created = await createChangeRequest({ ...body, requestedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "attendanceChangeRequest.create", entityType: "AttendanceChangeRequest", entityId: created.id, newValues: created, ...requestMeta() });
    await notifyAdmins({
      type: "PENDING_APPROVAL",
      title: "Attendance entry change awaiting approval",
      message: "A teacher submitted a multi-student attendance correction that requires admin approval.",
      resourceType: "AttendanceChangeRequest",
      resourceId: created.id,
    });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
