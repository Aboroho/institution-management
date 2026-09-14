export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";
import { getSessionHistory } from "@/modules/attendance/attendance.service";

/**
 * GET /api/v1/attendance/sessions/{sessionId}/history
 *
 * Returns every change-log + related change-request for one AttendanceSession,
 * scoped to its student attendance records. History is immutable and includes
 * who, what, when, why, and whether each change was approval-based.
 *
 * Authorization mirrors `/records`.
 */
export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireAuth();

    const session = await prisma.attendanceSession.findUnique({
      where: { id: params.sessionId },
      select: { id: true, courseOfferingId: true },
    });
    if (!session) throw notFound("Attendance session not found");

    if (auth.role === "TEACHER") {
      await requireActiveTeacherAssignment(auth, session.courseOfferingId);
    } else if (auth.role !== "ADMIN") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403));
    }

    return ok(await getSessionHistory(params.sessionId));
  } catch (e) {
    return fail(e);
  }
}
