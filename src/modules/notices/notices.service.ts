import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";

export async function listNotices(opts: {
  courseOfferingId?: string; teacherId?: string; search?: string; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.courseOfferingId) where.courseOfferingId = opts.courseOfferingId;
  if (opts.teacherId) where.teacherId = opts.teacherId;
  if (opts.search) {
    where.OR = [
      { title: { contains: opts.search, mode: "insensitive" } },
      { content: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const [total, items] = await prisma.$transaction([
    prisma.notification.count?.constructor ? prisma.notice.count({ where }) : prisma.notice.count({ where }),
    prisma.notice.findMany({
      where, orderBy: { publishedAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        courseOffering: { include: { course: true, section: true } },
        teacher: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);
  return { items, total };
}

export async function createNotice(data: {
  courseOfferingId: string; teacherId: string; title: string; content: string; expiresAt?: Date | null;
}) {
  const offering = await prisma.courseOffering.findUnique({ where: { id: data.courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  return prisma.notice.create({ data: { ...data, publishedAt: new Date() } });
}

export async function updateNotice(id: string, data: Partial<{ title: string; content: string; expiresAt: Date | null }>) {
  const existing = await prisma.notice.findUnique({ where: { id } });
  if (!existing) throw notFound("Notice not found");
  return prisma.notice.update({ where: { id }, data });
}

export async function studentNotices(studentId: string) {
  const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId, status: "ACTIVE" } });
  if (!enrollments.length) return [];
  const offerings = await prisma.courseOffering.findMany({
    where: {
      OR: enrollments.map((e) => ({
        academicYearId: e.academicYearId, tradeId: e.tradeId, semesterId: e.semesterId,
        shiftId: e.shiftId, sectionId: e.sectionId,
      })),
    },
    select: { id: true },
  });
  return prisma.notice.findMany({
    where: { courseOfferingId: { in: offerings.map((o) => o.id) } },
    orderBy: { publishedAt: "desc" },
    include: { courseOffering: { include: { course: true, section: true } }, teacher: { include: { user: { select: { name: true } } } } },
  });
}
