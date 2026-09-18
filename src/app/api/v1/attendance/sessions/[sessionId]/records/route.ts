export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";
import { getSessionRoster } from "@/modules/attendance/attendance.service";

/**
 * GET /api/v1/attendance/sessions/{sessionId}/records
 *
 * Student Status for a single AttendanceSession: EVERY student enrolled
 * (ACTIVE) in the offering's section, each annotated with their attendance
 * status for this session. Students enrolled after the session was taken
 * (no AttendanceRecord yet) are included with status NOT_MARKED so the
 * dialog always has the complete section list for frontend roll filtering.
 *
 * The roster itself is built by `getSessionRoster` — the same service the Take
 * Attendance page uses for its read-only view — so the two screens cannot
 * drift apart.
 *
 * Authorization:
 *   ADMIN -> any session (institution-wide inspection)
 *   TEACHER -> must be currently assigned to the offering the session belongs to
 *   STUDENT -> forbidden
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

    return ok(await getSessionRoster(params.sessionId));
  } catch (e) {
    return fail(e);
  }
}
