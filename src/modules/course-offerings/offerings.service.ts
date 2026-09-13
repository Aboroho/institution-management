import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule } from "@/lib/errors/errors";

export async function listOfferings(opts: {
  academicYearId?: string; tradeId?: string; semesterId?: string; shiftId?: string;
  sectionId?: string; courseId?: string; teacherId?: string; isActive?: boolean;
  search?: string; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  for (const k of ["academicYearId", "tradeId", "semesterId", "shiftId", "sectionId", "courseId"] as const) {
    if (opts[k]) where[k] = opts[k];
  }
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  if (opts.teacherId) where.assignments = { some: { teacherId: opts.teacherId, isActive: true } };
  if (opts.search) {
    where.OR = [
      { course: { title: { contains: opts.search, mode: "insensitive" } } },
      { course: { code: { contains: opts.search, mode: "insensitive" } } },
      { section: { name: { contains: opts.search, mode: "insensitive" } } },
    ];
  }
  const [total, items] = await prisma.$transaction([
    prisma.courseOffering.count({ where }),
    prisma.courseOffering.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        academicYear: { select: { id: true, name: true } },
        trade: { select: { id: true, name: true, code: true } },
        semester: { select: { id: true, name: true, number: true } },
        shift: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, title: true } },
        assignments: { where: { isActive: true }, include: { teacher: { include: { user: { select: { name: true, email: true } } } } } },
        _count: { select: { sessions: true, assessments: true, notices: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function createOffering(data: {
  academicYearId: string; tradeId: string; semesterId: string; shiftId: string; sectionId: string; courseId: string;
}) {
  const section = await prisma.section.findUnique({ where: { id: data.sectionId } });
  if (!section) throw notFound("Section not found");
  // Section must match the offering context (no mixing).
  if (
    section.academicYearId !== data.academicYearId || section.tradeId !== data.tradeId ||
    section.semesterId !== data.semesterId || section.shiftId !== data.shiftId
  ) {
    throw businessRule("Section does not match the selected academic context");
  }
  const course = await prisma.course.findUnique({ where: { id: data.courseId } });
  if (!course) throw notFound("Course not found");
  try {
    return await prisma.courseOffering.create({ data });
  } catch {
    throw conflict("Course offering already exists for this context");
  }
}

export async function getOffering(id: string) {
  const o = await prisma.courseOffering.findUnique({
    where: { id },
    include: {
      academicYear: true, trade: true, semester: true, shift: true, section: true, course: true,
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: { teacher: { include: { user: { select: { name: true, email: true } } } } },
      },
      schedules: { where: { isActive: true }, include: { items: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] } } },
      _count: { select: { sessions: true, assessments: true, notices: true } },
    },
  });
  if (!o) throw notFound("Course offering not found");
  // Derive students from enrollment (never assigned directly).
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: o.academicYearId, tradeId: o.tradeId, semesterId: o.semesterId,
      shiftId: o.shiftId, sectionId: o.sectionId, status: "ACTIVE",
    },
    include: { student: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { student: { studentId: "asc" } },
  });
  return { ...o, students: enrollments.map((e) => e.student) };
}

export async function updateOffering(id: string, data: Partial<{ isActive: boolean }>) {
  const existing = await prisma.courseOffering.findUnique({ where: { id } });
  if (!existing) throw notFound("Course offering not found");
  return prisma.courseOffering.update({ where: { id }, data });
}

export async function offeringStudents(id: string) {
  const o = await prisma.courseOffering.findUnique({ where: { id } });
  if (!o) throw notFound("Course offering not found");
  return prisma.studentEnrollment.findMany({
    where: {
      academicYearId: o.academicYearId, tradeId: o.tradeId, semesterId: o.semesterId,
      shiftId: o.shiftId, sectionId: o.sectionId, status: "ACTIVE",
    },
    include: { student: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { student: { studentId: "asc" } },
  });
}
