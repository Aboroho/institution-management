export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
import { recordHistory } from "@/modules/attendance/attendance.service";

/**
 * GET /api/v1/attendance/records/{id} — single record + its change history.
 *
 * Authorization (IDOR-safe):
 *   ADMIN -> any record (institution-wide inspection)
 *   TEACHER -> only records in offerings with an ACTIVE assignment
 *   STUDENT -> forbidden
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role === "STUDENT") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403));
    }
    if (auth.role === "TEACHER") {
      const rec = await prisma.attendanceRecord.findUnique({
        where: { id: params.id },
        select: { session: { select: { courseOfferingId: true } } },
      });
      if (!rec) {
        const { AppError } = await import("@/lib/errors/errors");
        return fail(new AppError("NOT_FOUND", "Attendance record not found", 404));
      }
      // Never trust the client-supplied record ID — verify assignment to the
      // offering that owns the session before returning anything.
      await requireActiveTeacherAssignment(auth, rec.session.courseOfferingId);
    }
    return ok(await recordHistory(params.id));
  } catch (e) { return fail(e); }
}
