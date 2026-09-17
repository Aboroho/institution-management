export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";

/**
 * GET /api/v1/attendance/sessions/{sessionId}/records
 *
 * Student Status for a single AttendanceSession: EVERY student enrolled
 * (ACTIVE) in the offering's section, each annotated with their attendance
 * status for this session. Students enrolled after the session was taken
 * (no AttendanceRecord yet) are included with status NOT_MARKED so the
 * dialog always has the complete section list for frontend roll filtering.
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
      include: {
        courseOffering: {
          select: {
            id: true,
            // Foreign keys are needed to look up the section's ACTIVE enrollments below.
            academicYearId: true, tradeId: true, semesterId: true, shiftId: true, sectionId: true,
            course: { select: { title: true, code: true } },
            section: { select: { name: true } },
            semester: { select: { name: true } },
            trade: { select: { name: true, code: true } },
            shift: { select: { name: true } },
            academicYear: { select: { name: true } },
          },
        },
        records: {
          include: {
            student: { select: { id: true, studentId: true, user: { select: { name: true, email: true } } } },
          },
        },
      },
    });
    if (!session) throw notFound("Attendance session not found");

    if (auth.role === "TEACHER") {
      await requireActiveTeacherAssignment(auth, session.courseOfferingId);
    } else if (auth.role !== "ADMIN") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403));
    }

    const o = session.courseOffering;
    // Complete section roster (never just the recorded subset).
    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        academicYearId: o.academicYearId,
        tradeId: o.tradeId,
        semesterId: o.semesterId,
        shiftId: o.shiftId,
        sectionId: o.sectionId,
        status: "ACTIVE",
      },
      include: {
        student: { select: { id: true, studentId: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: { rollNumber: "asc" },
    });

    const recordByStudent = new Map(
      session.records.map((r: { student: { id: string } }) => [r.student.id, r] as const),
    );

    return ok({
      session: {
        id: session.id,
        attendanceDate: session.attendanceDate.toISOString().slice(0, 10),
        courseOffering: session.courseOffering,
      },
      records: enrollments.map((e: { rollNumber: number; student: { id: string; studentId: string; user: { name: string; email: string } } }) => {
        const r = recordByStudent.get(e.student.id) as
          | { id: string; status: string; note: string | null; directCorrections: number }
          | undefined;
        return {
          id: r?.id ?? null,
          rollNumber: e.rollNumber,
          studentId: e.student.studentId,
          studentName: e.student.user.name,
          studentEmail: e.student.user.email,
          status: r?.status ?? "NOT_MARKED",
          hasRecord: Boolean(r),
          note: r?.note ?? null,
          directCorrections: r?.directCorrections ?? 0,
        };
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
