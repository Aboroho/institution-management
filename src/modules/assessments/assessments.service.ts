import { prisma } from "@/lib/db/prisma";
import { notFound, businessRule } from "@/lib/errors/errors";

export async function listAssessments(opts: {
  courseOfferingId?: string; type?: string; upcoming?: boolean; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.courseOfferingId) where.courseOfferingId = opts.courseOfferingId;
  if (opts.type) where.type = opts.type;
  if (opts.upcoming) where.dueDate = { gte: new Date() };
  const [total, items] = await prisma.$transaction([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        courseOffering: {
          include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true },
        },
        createdBy: { select: { name: true, email: true } },
        _count: { select: { submissions: true, marks: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function createAssessment(data: {
  courseOfferingId: string; title: string; description?: string; type: string;
  totalMarks: number; passMarks: number; submitable?: boolean; countsTowardFinal?: boolean;
  weight?: number | null; dueDate?: Date | null; createdById: string;
}) {
  const offering = await prisma.courseOffering.findUnique({ where: { id: data.courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  if (data.totalMarks <= 0) throw businessRule("totalMarks must be positive");
  if (data.passMarks < 0 || data.passMarks > data.totalMarks) throw businessRule("passMarks must be between 0 and totalMarks");
  if (data.weight !== undefined && data.weight !== null && (data.weight < 0 || data.weight > 100)) {
    throw businessRule("weight must be between 0 and 100");
  }
  // NOTE: no "gradable" field by design — submitable and grading are separate concepts.
  return prisma.assessment.create({
    data: {
      courseOfferingId: data.courseOfferingId, title: data.title, description: data.description,
      type: data.type as never, totalMarks: data.totalMarks, passMarks: data.passMarks,
      submitable: data.submitable ?? false, countsTowardFinal: data.countsTowardFinal ?? true,
      weight: data.weight ?? null, dueDate: data.dueDate ?? null, createdById: data.createdById,
    },
  });
}

export async function getAssessment(id: string) {
  const a = await prisma.assessment.findUnique({
    where: { id },
    include: {
      courseOffering: { include: { course: true, section: true, semester: true, trade: true, academicYear: true, shift: true } },
      createdBy: { select: { name: true, email: true } },
      submissions: { include: { student: { include: { user: { select: { name: true } } } }, file: true } },
      marks: { include: { student: { include: { user: { select: { name: true } } } } } },
    },
  });
  if (!a) throw notFound("Assessment not found");
  return a;
}

export async function updateAssessment(id: string, data: Partial<{
  title: string; description: string | null; type: string; totalMarks: number; passMarks: number;
  submitable: boolean; countsTowardFinal: boolean; weight: number | null; dueDate: Date | null; isPublished: boolean;
}>) {
  const existing = await prisma.assessment.findUnique({ where: { id } });
  if (!existing) throw notFound("Assessment not found");
  const total = data.totalMarks ?? existing.totalMarks;
  const pass = data.passMarks ?? existing.passMarks;
  if (pass < 0 || pass > total) throw businessRule("passMarks must be between 0 and totalMarks");
  return prisma.assessment.update({ where: { id }, data: data as never });
}

export async function studentAssessments(studentId: string) {
  // All assessments for offerings the student is actively enrolled in.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: "ACTIVE" },
  });
  if (!enrollments.length) return [];
  const offerings = await prisma.courseOffering.findMany({
    where: {
      OR: enrollments.map((e: any) => ({
        academicYearId: e.academicYearId, tradeId: e.tradeId, semesterId: e.semesterId,
        shiftId: e.shiftId, sectionId: e.sectionId,
      })),
      isActive: true,
    },
    select: { id: true },
  });
  const ids = offerings.map((o: any) => o.id);
  return prisma.assessment.findMany({
    where: { courseOfferingId: { in: ids }, isPublished: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    include: {
      courseOffering: { include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true } },
      submissions: { where: { studentId } },
      marks: { where: { studentId } },
    },
  });
}
