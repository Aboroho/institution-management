import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule } from "@/lib/errors/errors";
import { hashPassword } from "@/lib/auth/password";
import { withOfferingContext } from "@/lib/course-offering-context";

type OfferingForAssignment = {
  id: string;
  isActive: boolean;
  academicYear: { isActive: boolean };
};

/**
 * Backend guard for assignment operations:
 *  - the offering must exist and be active;
 *  - its Academic Year must be active. An offering in an inactive year is
 *    "inactive/unavailable" by derivation (see offeringAvailable) and must not
 *    accept new assignments or substitutions, even if its own flag is true.
 * Historical data on such offerings stays accessible — this only blocks NEW operations.
 */
export function assertOfferingAssignable(offering: OfferingForAssignment) {
  if (!offering.isActive) {
    throw businessRule("Course offering is inactive — activate it before assigning a teacher");
  }
  if (!offering.academicYear.isActive) {
    throw businessRule(
      "The academic year is inactive — new teacher assignments and substitutions are not available for this course offering"
    );
  }
}

export async function listTeachers(opts: { search?: string; isActive?: boolean; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  if (opts.search) {
    where.OR = [
      { employeeId: { contains: opts.search, mode: "insensitive" } },
      { user: { name: { contains: opts.search, mode: "insensitive" } } },
      { user: { email: { contains: opts.search, mode: "insensitive" } } },
    ];
  }
  const [total, items] = await prisma.$transaction([
    prisma.teacher.count({ where }),
    prisma.teacher.findMany({
      where, orderBy: { employeeId: "asc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
        assignments: { where: { isActive: true }, include: { courseOffering: { include: { course: true, section: true } } } },
      },
    }),
  ]);
  return { items, total };
}

export async function createTeacher(data: {
  name: string; email: string; password: string; employeeId: string;
  department?: string; designation?: string; phone?: string; address?: string;
}) {
  const email = data.email.toLowerCase().trim();
  const [eu, et] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.teacher.findUnique({ where: { employeeId: data.employeeId } }),
  ]);
  if (eu) throw conflict("Email already in use");
  if (et) throw conflict("Employee ID already exists");
  const passwordHash = await hashPassword(data.password);
  return prisma.$transaction(async (tx: any) => {
    const user = await tx.user.create({ data: { email, name: data.name, role: "TEACHER", passwordHash } });
    return tx.teacher.create({
      data: {
        userId: user.id, employeeId: data.employeeId, department: data.department,
        designation: data.designation, phone: data.phone, address: data.address, joiningDate: new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });
}

export async function getTeacher(id: string) {
  const t = await prisma.teacher.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true, createdAt: true } },
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: {
          courseOffering: {
            include: {
              course: true, academicYear: true, trade: true, semester: true, shift: true, section: true,
            },
          },
        },
      },
    },
  });
  if (!t) throw notFound("Teacher not found");
  return t;
}

export async function updateTeacher(id: string, data: Partial<{
  name: string; department: string | null; designation: string | null; phone: string | null;
  address: string | null; isActive: boolean;
}>) {
  const t = await prisma.teacher.findUnique({ where: { id } });
  if (!t) throw notFound("Teacher not found");
  const { name, isActive, ...rest } = data;
  return prisma.$transaction(async (tx: any) => {
    if (name !== undefined || isActive !== undefined) {
      await tx.user.update({ where: { id: t.userId }, data: {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      }});
    }
    return tx.teacher.update({ where: { id }, data: { ...rest, ...(isActive !== undefined ? { isActive } : {}) } });
  });
}

// ---- Assignments
export async function listAssignments(opts: {
  teacherId?: string; courseOfferingId?: string; isActive?: boolean; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.teacherId) where.teacherId = opts.teacherId;
  if (opts.courseOfferingId) where.courseOfferingId = opts.courseOfferingId;
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  const [total, items] = await prisma.$transaction([
    prisma.teacherCourseAssignment.count({ where }),
    prisma.teacherCourseAssignment.findMany({
      where, orderBy: { assignedAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        teacher: { include: { user: { select: { name: true, email: true } } } },
        courseOffering: { include: { course: true, section: true, semester: true, trade: true, academicYear: true, shift: true } },
      },
    }),
  ]);
  // Expose the derived `context` code + `available` flag on every offering
  // referenced by an assignment (centralized list + dialogs).
  return { items: items.map((a) => ({ ...a, courseOffering: withOfferingContext(a.courseOffering) })), total };
}

export async function assignTeacher(data: { courseOfferingId: string; teacherId: string; assignedById?: string; reason?: string }) {
  const [offering, teacher] = await Promise.all([
    prisma.courseOffering.findUnique({
      where: { id: data.courseOfferingId },
      include: { academicYear: { select: { isActive: true } } },
    }),
    prisma.teacher.findUnique({ where: { id: data.teacherId } }),
  ]);
  if (!offering) throw notFound("Course offering not found");
  assertOfferingAssignable(offering);
  if (!teacher || !teacher.isActive) throw notFound("Teacher not found or inactive");
  const current = await prisma.teacherCourseAssignment.findFirst({
    where: { courseOfferingId: data.courseOfferingId, isActive: true },
  });
  if (current) throw conflict("Course offering already has an active teacher. Use substitution.");
  try {
    return await prisma.teacherCourseAssignment.create({
      data: {
        courseOfferingId: data.courseOfferingId, teacherId: data.teacherId,
        assignedById: data.assignedById, reason: data.reason,
        activeSlot: data.courseOfferingId, // DB-enforced single active teacher
      },
    });
  } catch {
    throw conflict("Concurrent assignment conflict — an active teacher already exists");
  }
}

/**
 * Substitution (transactional): close old active assignment, create replacement.
 * History (attendance, marks, notices, audit) is preserved with original attribution.
 */
export async function substituteTeacher(data: {
  courseOfferingId: string; newTeacherId: string; assignedById?: string; reason?: string;
}) {
  const teacher = await prisma.teacher.findUnique({ where: { id: data.newTeacherId } });
  if (!teacher || !teacher.isActive) throw notFound("Replacement teacher not found or inactive");
  const offering = await prisma.courseOffering.findUnique({
    where: { id: data.courseOfferingId },
    include: { academicYear: { select: { isActive: true } } },
  });
  if (!offering) throw notFound("Course offering not found");
  assertOfferingAssignable(offering);

  return prisma.$transaction(async (tx: any) => {
    const current = await tx.teacherCourseAssignment.findFirst({
      where: { courseOfferingId: data.courseOfferingId, isActive: true },
    });
    if (!current) throw businessRule("No active assignment to substitute");
    if (current.teacherId === data.newTeacherId) throw businessRule("Replacement teacher is already assigned");
    await tx.teacherCourseAssignment.update({
      where: { id: current.id },
      data: { isActive: false, activeSlot: null, endedAt: new Date(), reason: data.reason ?? current.reason },
    });
    try {
      const next = await tx.teacherCourseAssignment.create({
        data: {
          courseOfferingId: data.courseOfferingId, teacherId: data.newTeacherId,
          assignedById: data.assignedById, reason: data.reason,
          activeSlot: data.courseOfferingId,
        },
      });
      return { previous: current, current: next };
    } catch {
      throw conflict("Concurrent substitution conflict");
    }
  }, { isolationLevel: "Serializable" });
}
