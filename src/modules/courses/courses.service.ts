import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule } from "@/lib/errors/errors";

// ---- Courses (reusable across years)
export async function listCourses(opts: { search?: string; isActive?: boolean; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (opts.search) where.OR = [
    { title: { contains: opts.search, mode: "insensitive" } },
    { code: { contains: opts.search, mode: "insensitive" } },
  ];
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  const [total, items] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({ where, orderBy: { code: "asc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: { _count: { select: { offerings: true, curriculumCourses: true } } } }),
  ]);
  return { items, total };
}

export async function createCourse(data: { code: string; title: string; description?: string; credits?: number }) {
  try {
    return await prisma.course.create({ data });
  } catch {
    throw conflict("Course code already exists");
  }
}

export async function updateCourse(id: string, data: Partial<{ code: string; title: string; description: string | null; credits: number | null; isActive: boolean }>) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) throw notFound("Course not found");
  try {
    return await prisma.course.update({ where: { id }, data });
  } catch {
    throw conflict("Course code already exists");
  }
}

export async function getCourse(id: string) {
  const c = await prisma.course.findUnique({
    where: { id },
    include: {
      curriculumCourses: { include: { curriculum: { include: { trade: true, semester: true } } } },
      offerings: {
        take: 50, orderBy: { createdAt: "desc" },
        include: { academicYear: true, trade: true, semester: true, shift: true, section: true },
      },
    },
  });
  if (!c) throw notFound("Course not found");
  return c;
}

// ---- Curricula (Trade + Semester -> Courses, versioned)
export async function listCurricula(opts: { tradeId?: string; semesterId?: string }) {
  const where: Record<string, unknown> = {};
  if (opts.tradeId) where.tradeId = opts.tradeId;
  if (opts.semesterId) where.semesterId = opts.semesterId;
  return prisma.curriculum.findMany({
    where, orderBy: [{ tradeId: "asc" }, { semesterId: "asc" }, { version: "desc" }],
    include: {
      trade: { select: { id: true, name: true, code: true } },
      semester: { select: { id: true, name: true, number: true } },
      _count: { select: { courses: true } },
    },
  });
}

export async function createCurriculum(data: {
  tradeId: string; semesterId: string; name: string; courseIds?: string[]; isActive?: boolean;
}) {
  const sem = await prisma.semester.findUnique({ where: { id: data.semesterId } });
  if (!sem) throw notFound("Semester not found");
  if (sem.tradeId !== data.tradeId) throw businessRule("Semester does not belong to the selected trade");
  const latest = await prisma.curriculum.findFirst({
    where: { tradeId: data.tradeId, semesterId: data.semesterId },
    orderBy: { version: "desc" },
  });
  const version = (latest?.version ?? 0) + 1;
  const isActive = data.isActive ?? true;
  return prisma.$transaction(async (tx) => {
    // Business rule: only ONE active curriculum per trade + semester.
    if (isActive) {
      await tx.curriculum.updateMany({
        where: { tradeId: data.tradeId, semesterId: data.semesterId, isActive: true },
        data: { isActive: false },
      });
    }
    const cur = await tx.curriculum.create({
      data: { tradeId: data.tradeId, semesterId: data.semesterId, name: data.name, version, isActive },
    });
    if (data.courseIds?.length) {
      await tx.curriculumCourse.createMany({
        data: data.courseIds.map((courseId, i) => ({ curriculumId: cur.id, courseId, order: i })),
        skipDuplicates: true,
      });
    }
    return cur;
  });
}

/** The single active curriculum for a trade + semester (or null if none). */
export async function getActiveCurriculum(tradeId: string, semesterId: string) {
  return prisma.curriculum.findFirst({
    where: { tradeId, semesterId, isActive: true },
    orderBy: { version: "desc" },
    include: {
      trade: { select: { id: true, name: true, code: true } },
      semester: { select: { id: true, name: true, number: true } },
      courses: { orderBy: { order: "asc" }, include: { course: true } },
    },
  });
}

export async function getCurriculum(id: string) {
  const c = await prisma.curriculum.findUnique({
    where: { id },
    include: {
      trade: true, semester: true,
      courses: { orderBy: { order: "asc" }, include: { course: true } },
    },
  });
  if (!c) throw notFound("Curriculum not found");
  return c;
}

export async function updateCurriculum(id: string, data: Partial<{ name: string; isActive: boolean }>) {
  const existing = await prisma.curriculum.findUnique({ where: { id } });
  if (!existing) throw notFound("Curriculum not found");
  // Business rule: only ONE active curriculum per trade + semester.
  // Activating this one deactivates every other curriculum of the same trade + semester.
  if (data.isActive === true) {
    return prisma.$transaction(async (tx) => {
      await tx.curriculum.updateMany({
        where: { tradeId: existing.tradeId, semesterId: existing.semesterId, isActive: true, id: { not: id } },
        data: { isActive: false },
      });
      return tx.curriculum.update({ where: { id }, data });
    });
  }
  return prisma.curriculum.update({ where: { id }, data });
}

export async function addCurriculumCourse(curriculumId: string, courseId: string) {
  const cur = await prisma.curriculum.findUnique({ where: { id: curriculumId } });
  if (!cur) throw notFound("Curriculum not found");
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound("Course not found");
  const max = await prisma.curriculumCourse.findFirst({ where: { curriculumId }, orderBy: { order: "desc" } });
  try {
    return await prisma.curriculumCourse.create({
      data: { curriculumId, courseId, order: (max?.order ?? -1) + 1 },
    });
  } catch {
    throw conflict("Course already in curriculum");
  }
}

export async function removeCurriculumCourse(curriculumId: string, courseId: string) {
  const cc = await prisma.curriculumCourse.findUnique({
    where: { curriculumId_courseId: { curriculumId, courseId } },
  });
  if (!cc) throw notFound("Curriculum course not found");
  await prisma.curriculumCourse.delete({ where: { id: cc.id } });
  return { ok: true };
}
