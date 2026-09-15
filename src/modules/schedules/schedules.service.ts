import { prisma } from "@/lib/db/prisma";
import { notFound, businessRule, conflict } from "@/lib/errors/errors";

export interface ScheduleItemInput {
  weekday: number; startTime: string; endTime: string; room?: string; lab?: string;
}

function assertItem(i: ScheduleItemInput) {
  if (i.weekday < 0 || i.weekday > 6) throw businessRule("weekday must be 0..6");
  if (!/^\d{2}:\d{2}$/.test(i.startTime) || !/^\d{2}:\d{2}$/.test(i.endTime)) {
    throw businessRule("startTime/endTime must be HH:mm");
  }
  if (i.startTime >= i.endTime) throw businessRule("endTime must be after startTime");
}

export async function listSchedules(opts: {
  courseOfferingId?: string; academicYearId?: string; tradeId?: string; semesterId?: string;
  shiftId?: string; sectionId?: string; activeOnly?: boolean;
}) {
  const where: Record<string, unknown> = {};
  if (opts.courseOfferingId) where.courseOfferingId = opts.courseOfferingId;
  if (opts.activeOnly !== false) where.isActive = true;
  if (opts.academicYearId || opts.tradeId || opts.semesterId || opts.shiftId || opts.sectionId) {
    where.courseOffering = {
      ...(opts.academicYearId ? { academicYearId: opts.academicYearId } : {}),
      ...(opts.tradeId ? { tradeId: opts.tradeId } : {}),
      ...(opts.semesterId ? { semesterId: opts.semesterId } : {}),
      ...(opts.shiftId ? { shiftId: opts.shiftId } : {}),
      ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
    };
  }
  return prisma.scheduleVersion.findMany({
    where,
    orderBy: [{ courseOfferingId: "asc" }, { version: "desc" }],
    include: {
      items: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] },
      courseOffering: { include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true } },
    },
  });
}

export async function createScheduleVersion(data: {
  courseOfferingId: string; effectiveFrom: Date; effectiveTo?: Date | null;
  items: ScheduleItemInput[]; createdById?: string;
}) {
  const offering = await prisma.courseOffering.findUnique({ where: { id: data.courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  // Overlap rule: only one active (open) version at a time; new version closes the previous.
  if (data.effectiveTo && data.effectiveTo <= data.effectiveFrom) {
    throw businessRule("effectiveTo must be after effectiveFrom");
  }
  data.items.forEach(assertItem);
  // Overlap within the new version itself.
  for (let a = 0; a < data.items.length; a++) {
    for (let b = a + 1; b < data.items.length; b++) {
      const x = data.items[a], y = data.items[b];
      if (x.weekday === y.weekday && x.startTime < y.endTime && y.startTime < x.endTime) {
        throw conflict("Schedule items overlap on the same weekday");
      }
    }
  }
  return prisma.$transaction(async (tx: any) => {
    const latest = await tx.scheduleVersion.findFirst({
      where: { courseOfferingId: data.courseOfferingId },
      orderBy: { version: "desc" },
    });
    const prevActive = await tx.scheduleVersion.findFirst({
      where: { courseOfferingId: data.courseOfferingId, isActive: true },
    });
    if (prevActive) {
      if (data.effectiveFrom <= prevActive.effectiveFrom) {
        throw businessRule("New version must start after the current version");
      }
      await tx.scheduleVersion.update({
        where: { id: prevActive.id },
        data: { isActive: false, effectiveTo: data.effectiveFrom },
      });
    }
    const version = await tx.scheduleVersion.create({
      data: {
        courseOfferingId: data.courseOfferingId, version: (latest?.version ?? 0) + 1,
        effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo ?? null,
        isActive: true, createdById: data.createdById,
      },
    });
    await tx.scheduleItem.createMany({
      data: data.items.map((i: any) => ({ ...i, scheduleVersionId: version.id })),
    });
    return tx.scheduleVersion.findUnique({ where: { id: version.id }, include: { items: true } });
  });
}

export async function scheduleHistory(courseOfferingId: string) {
  return prisma.scheduleVersion.findMany({
    where: { courseOfferingId },
    orderBy: { version: "desc" },
    include: { items: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] } },
  });
}
