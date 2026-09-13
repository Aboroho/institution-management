import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule } from "@/lib/errors/errors";
import { hashPassword } from "@/lib/auth/password";

export async function listStudents(opts: {
  search?: string; academicYearId?: string; tradeId?: string; semesterId?: string;
  shiftId?: string; sectionId?: string; status?: string; isActive?: boolean;
  page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  if (opts.search) {
    where.OR = [
      { studentId: { contains: opts.search, mode: "insensitive" } },
      { user: { name: { contains: opts.search, mode: "insensitive" } } },
      { user: { email: { contains: opts.search, mode: "insensitive" } } },
    ];
  }
  const enFilter: Record<string, unknown> = {};
  for (const k of ["academicYearId", "tradeId", "semesterId", "shiftId", "sectionId", "status"] as const) {
    if ((opts as Record<string, unknown>)[k]) enFilter[k] = (opts as Record<string, unknown>)[k];
  }
  if (Object.keys(enFilter).length) where.enrollments = { some: enFilter };
  const [total, items] = await prisma.$transaction([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where, orderBy: { studentId: "asc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
        enrollments: {
          where: { status: "ACTIVE" }, take: 1, orderBy: { enrolledAt: "desc" },
          include: {
            academicYear: { select: { name: true } }, trade: { select: { name: true, code: true } },
            semester: { select: { name: true, number: true } }, shift: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    }),
  ]);
  return { items, total };
}

export async function createStudent(data: {
  name: string; email: string; password: string; studentId: string;
  dateOfBirth?: string; gender?: string; phone?: string; address?: string;
  guardianName?: string; guardianPhone?: string;
}) {
  const email = data.email.toLowerCase().trim();
  const [eu, es] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.student.findUnique({ where: { studentId: data.studentId } }),
  ]);
  if (eu) throw conflict("Email already in use");
  if (es) throw conflict("Student ID already exists");
  const passwordHash = await hashPassword(data.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: data.name, role: "STUDENT", passwordHash } });
    const student = await tx.student.create({
      data: {
        userId: user.id, studentId: data.studentId,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender, phone: data.phone, address: data.address,
        guardianName: data.guardianName, guardianPhone: data.guardianPhone,
        admissionDate: new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return student;
  });
}

export async function getStudent(id: string) {
  const s = await prisma.student.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true, createdAt: true } },
      enrollments: {
        orderBy: { enrolledAt: "desc" },
        include: {
          academicYear: true, trade: true, semester: true, shift: true, section: true,
        },
      },
      promotions: { orderBy: { decidedAt: "desc" }, include: { fromEnrollment: true, toEnrollment: true } },
    },
  });
  if (!s) throw notFound("Student not found");
  return s;
}

export async function updateStudent(id: string, data: Partial<{
  name: string; phone: string | null; address: string | null; guardianName: string | null;
  guardianPhone: string | null; gender: string | null; dateOfBirth: string | null; isActive: boolean;
}>) {
  const s = await prisma.student.findUnique({ where: { id } });
  if (!s) throw notFound("Student not found");
  const { name, isActive, dateOfBirth, ...rest } = data;
  return prisma.$transaction(async (tx) => {
    if (name !== undefined || isActive !== undefined) {
      await tx.user.update({ where: { id: s.userId }, data: {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      }});
    }
    return tx.student.update({
      where: { id },
      data: {
        ...rest,
        ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
  });
}

// ---- Enrollments (history preserved; never overwrite to promote)
export async function listEnrollments(opts: {
  studentId?: string; academicYearId?: string; tradeId?: string; semesterId?: string;
  shiftId?: string; sectionId?: string; status?: string; search?: string; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  for (const k of ["studentId", "academicYearId", "tradeId", "semesterId", "shiftId", "sectionId", "status"] as const) {
    if ((opts as Record<string, unknown>)[k]) where[k] = (opts as Record<string, unknown>)[k];
  }
  if (opts.search) {
    where.OR = [
      { student: { studentId: { contains: opts.search, mode: "insensitive" } } },
      { student: { user: { name: { contains: opts.search, mode: "insensitive" } } } },
    ];
  }
  const [total, items] = await prisma.$transaction([
    prisma.studentEnrollment.count({ where }),
    prisma.studentEnrollment.findMany({
      where, orderBy: { enrolledAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        student: { include: { user: { select: { name: true, email: true } } } },
        academicYear: { select: { name: true } }, trade: { select: { name: true, code: true } },
        semester: { select: { name: true, number: true } }, shift: { select: { name: true } },
        section: { select: { name: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function createEnrollment(data: {
  studentId: string; academicYearId: string; tradeId: string; semesterId: string; shiftId: string; sectionId: string;
}) {
  const student = await prisma.student.findUnique({ where: { id: data.studentId } });
  if (!student) throw notFound("Student not found");
  const section = await prisma.section.findUnique({ where: { id: data.sectionId } });
  if (!section) throw notFound("Section not found");
  if (
    section.academicYearId !== data.academicYearId || section.tradeId !== data.tradeId ||
    section.semesterId !== data.semesterId || section.shiftId !== data.shiftId
  ) {
    throw businessRule("Section does not match the selected academic context");
  }
  // A student cannot hold two ACTIVE enrollments in the same context.
  const existing = await prisma.studentEnrollment.findFirst({
    where: {
      studentId: data.studentId, academicYearId: data.academicYearId,
      tradeId: data.tradeId, semesterId: data.semesterId, status: "ACTIVE",
    },
  });
  if (existing) throw conflict("Student already has an active enrollment in this context");
  try {
    return await prisma.studentEnrollment.create({ data: { ...data, status: "ACTIVE" } });
  } catch {
    throw conflict("Duplicate enrollment");
  }
}

export async function closeEnrollment(id: string, status: "WITHDRAWN" | "TRANSFERRED", endedAt = new Date()) {
  const en = await prisma.studentEnrollment.findUnique({ where: { id } });
  if (!en) throw notFound("Enrollment not found");
  if (en.status !== "ACTIVE") throw businessRule("Only active enrollments can be closed");
  return prisma.studentEnrollment.update({ where: { id }, data: { status, endedAt } });
}
