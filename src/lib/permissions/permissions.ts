import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound } from "@/lib/errors/errors";
import type { AuthContext } from "@/lib/auth/session";

// Central authorization helpers. Backend is authoritative — never trust client IDs.

export function requireAdmin(auth: AuthContext) {
  if (auth.role !== "ADMIN") throw forbidden("Admin access required");
}

export async function requireActiveTeacherAssignment(
  auth: AuthContext,
  courseOfferingId: string
) {
  if (auth.role === "ADMIN") return { isAdmin: true as const };
  if (auth.role !== "TEACHER") throw forbidden();
  const teacher = await prisma.teacher.findUnique({ where: { userId: auth.userId } });
  if (!teacher || !teacher.isActive) throw forbidden();
  const assignment = await prisma.teacherCourseAssignment.findFirst({
    where: { courseOfferingId, teacherId: teacher.id, isActive: true },
  });
  if (!assignment) throw forbidden("You are not assigned to this course offering");
  return { isAdmin: false as const, teacher, assignment };
}

export async function requireStudentSelf(auth: AuthContext, studentId: string) {
  if (auth.role === "ADMIN") {
    const s = await prisma.student.findUnique({ where: { id: studentId } });
    if (!s) throw notFound("Student not found");
    return { isAdmin: true as const, student: s };
  }
  if (auth.role !== "STUDENT") throw forbidden();
  const me = await prisma.student.findUnique({ where: { userId: auth.userId } });
  if (!me || me.id !== studentId) throw forbidden("You can only access your own data");
  return { isAdmin: false as const, student: me };
}

export async function myStudent(auth: AuthContext) {
  if (auth.role !== "STUDENT") throw forbidden();
  const me = await prisma.student.findUnique({ where: { userId: auth.userId } });
  if (!me || !me.isActive) throw forbidden("Student profile not found");
  return me;
}

export async function myTeacher(auth: AuthContext) {
  if (auth.role !== "TEACHER") throw forbidden();
  const t = await prisma.teacher.findUnique({ where: { userId: auth.userId } });
  if (!t || !t.isActive) throw forbidden("Teacher profile not found");
  return t;
}

/** Students enrolled (ACTIVE) in the section of a course offering. */
export async function offeringStudentIds(courseOfferingId: string): Promise<string[]> {
  const offering = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      status: "ACTIVE",
    },
    select: { studentId: true },
  });
  return enrollments.map((e) => e.studentId);
}

export async function requireStudentInOffering(auth: AuthContext, courseOfferingId: string) {
  if (auth.role === "ADMIN") return;
  if (auth.role === "TEACHER") {
    await requireActiveTeacherAssignment(auth, courseOfferingId);
    return;
  }
  const me = await myStudent(auth);
  const offering = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  const en = await prisma.studentEnrollment.findFirst({
    where: {
      studentId: me.id,
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      status: "ACTIVE",
    },
  });
  if (!en) throw forbidden("You are not enrolled in this course offering");
}
