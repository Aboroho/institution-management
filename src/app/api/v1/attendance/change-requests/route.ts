export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import {
  countPendingChangeRequests,
  createChangeRequest,
  listChangeRequests,
} from "@/modules/attendance/attendance.service";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";
import { notifyAdmins } from "@/lib/notifications/notify";
import { audit } from "@/lib/audit/audit";

const listSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  courseOfferingId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
});

/**
 * GET /api/v1/attendance/change-requests
 *
 * Reads attendance-entry change requests WITH their complete per-student
 * proposal list, so a teacher can see exactly what is awaiting approval:
 * date, offering, submission time, reason, status and every
 * previous -> proposed status.
 *
 * Authorization:
 *   ADMIN   -> the whole institution (approval queue)
 *   TEACHER -> ONLY their own requests. `requestedById` is taken from the
 *              authenticated session and is not a query parameter, so an
 *              unscoped list (or another teacher's request) is unreachable.
 *   STUDENT -> forbidden
 *
 * `meta.pendingCount` carries the backend's count of still-pending requests
 * for the caller (narrowed by courseOfferingId when given), which is what the
 * "Pending Update Requests" badge renders.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403));
    }
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const filters = listSchema.parse({
      status: s.get("status") || undefined,
      courseOfferingId: s.get("courseOfferingId") || undefined,
      sessionId: s.get("sessionId") || undefined,
    });
    const isTeacher = auth.role === "TEACHER";
    const { items, total } = await listChangeRequests({
      ...filters,
      page,
      limit,
      ...(isTeacher ? { requestedById: auth.userId } : {}),
      actorUserId: auth.userId,
    });
    const pendingCount = await countPendingChangeRequests({
      ...(isTeacher ? { requestedById: auth.userId } : {}),
      ...(filters.courseOfferingId ? { courseOfferingId: filters.courseOfferingId } : {}),
    });
    return paginated(items, page, limit, total, { pendingCount });
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

/**
 * POST /api/v1/attendance/change-requests
 *
 * Creates one entry-level request for the complete change set. The service
 * re-validates authorization inputs, quota, staleness AND the "no second
 * pending request for the same entry" rule (backed by the partial unique
 * index), so repeated clicks or two tabs racing each other cannot both become
 * active.
 */
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
