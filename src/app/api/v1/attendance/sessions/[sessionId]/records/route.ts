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
 * Detailed student attendance for a single AttendanceSession. Used by both the
 * "Edit" workflow and the history inspector.
 *
 * Authorization:
 *   ADMIN -> any session
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
            id: true, sectionId: true,
            course: { select: { title: true, code: true } },
            section: { select: { name: true } },
            semester: { select: { name: true } },
            trade: { select: { name: true, code: true } },
            shift: { select: { name: true } },
            academicYear: { select: { name: true } },
          },
        },
        records: {
          orderBy: { student: { studentId: "asc" } },
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

    // Roll numbers live on the enrollment (unique per section), not on the
    // student — resolve them so the status view can show roll order.
    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        sectionId: session.courseOffering.sectionId,
        studentId: { in: session.records.map((r: { student: { id: string } }) => r.student.id) },
      },
      select: { studentId: true, rollNumber: true, status: true },
    });
    const rollByStudent = new Map<string, number>();
    for (const e of enrollments) {
      if (!rollByStudent.has(e.studentId) || e.status === "ACTIVE") {
        rollByStudent.set(e.studentId, e.rollNumber);
      }
    }

    return ok({
      session: {
        id: session.id,
        attendanceDate: session.attendanceDate.toISOString().slice(0, 10),
        courseOffering: session.courseOffering,
      },
      records: session.records.map((r: { id: string; status: string; note: string | null; directCorrections: number; student: { id: string; studentId: string; user: { name: string; email: string } } }) => ({
        id: r.id,
        rollNumber: rollByStudent.get(r.student.id) ?? null,
        studentId: r.student.studentId,
        studentName: r.student.user.name,
        studentEmail: r.student.user.email,
        status: r.status,
        note: r.note,
        directCorrections: r.directCorrections,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
