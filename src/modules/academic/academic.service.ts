import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule } from "@/lib/errors/errors";

// Institution (single row expected; first row is canonical)
export async function getInstitution() {
  let inst = await prisma.institution.findFirst();
  if (!inst) {
    inst = await prisma.institution.create({ data: { name: "Institution" } });
  }
  return inst;
}

export async function updateInstitution(data: {
  name?: string; logoUrl?: string | null; address?: string | null; phone?: string | null;
  email?: string | null; website?: string | null; semesterCount?: number; shiftCount?: number;
  config?: unknown;
}) {
  const current = await getInstitution();
  return prisma.institution.update({ where: { id: current.id }, data: data as never });
}

// ---- Academic years
export async function listAcademicYears(opts: { includeArchived?: boolean; search?: string; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (!opts.includeArchived) where.isArchived = false;
  if (opts.search) where.name = { contains: opts.search, mode: "insensitive" };
  const [total, items] = await prisma.$transaction([
    prisma.academicYear.count({ where }),
    prisma.academicYear.findMany({ where, orderBy: { startDate: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit }),
  ]);
  return { items, total };
}

export async function createAcademicYear(data: { name: string; startDate: Date; endDate: Date; isActive?: boolean }) {
  if (data.endDate <= data.startDate) throw businessRule("End date must be after start date");
  try {
    const created = await prisma.academicYear.create({ data });
    if (data.isActive) {
      await prisma.academicYear.updateMany({ where: { id: { not: created.id } }, data: { isActive: false } });
    }
    return created;
  } catch (e: unknown) {
    if (String((e as Error)?.message ?? e).includes("Unique constraint")) throw conflict("Academic year name already exists");
    throw e;
  }
}

export async function updateAcademicYear(id: string, data: Partial<{ name: string; startDate: Date; endDate: Date; isActive: boolean; isArchived: boolean }>) {
  const existing = await prisma.academicYear.findUnique({ where: { id } });
  if (!existing) throw notFound("Academic year not found");
  const updated = await prisma.academicYear.update({ where: { id }, data });
  if (data.isActive) {
    await prisma.academicYear.updateMany({ where: { id: { not: id } }, data: { isActive: false } });
  }
  return updated;
}

// ---- Trades
export async function listTrades(opts: { search?: string; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (opts.search) where.OR = [
    { name: { contains: opts.search, mode: "insensitive" } },
    { code: { contains: opts.search, mode: "insensitive" } },
  ];
  const [total, items] = await prisma.$transaction([
    prisma.trade.count({ where }),
    prisma.trade.findMany({ where, orderBy: { name: "asc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: { _count: { select: { semesters: true, sections: true, offerings: true } } } }),
  ]);
  return { items, total };
}

export async function createTrade(data: { name: string; code: string; description?: string }) {
  try {
    return await prisma.trade.create({ data });
  } catch {
    throw conflict("Trade code already exists");
  }
}

export async function updateTrade(id: string, data: Partial<{ name: string; code: string; description: string | null; isActive: boolean }>) {
  const existing = await prisma.trade.findUnique({ where: { id } });
  if (!existing) throw notFound("Trade not found");
  try {
    return await prisma.trade.update({ where: { id }, data });
  } catch {
    throw conflict("Trade code already exists");
  }
}

export async function getTrade(id: string) {
  const t = await prisma.trade.findUnique({
    where: { id },
    include: {
      semesters: { orderBy: { number: "asc" } },
      sections: { take: 50, orderBy: { createdAt: "desc" } },
      offerings: { take: 1 },
      _count: { select: { offerings: true, enrollments: true } },
    },
  });
  if (!t) throw notFound("Trade not found");
  return t;
}

// ---- Semesters (per trade, dynamic count)
export async function listSemesters(tradeId?: string) {
  return prisma.semester.findMany({
    where: tradeId ? { tradeId } : undefined,
    orderBy: [{ tradeId: "asc" }, { number: "asc" }],
    include: { trade: { select: { id: true, name: true, code: true } } },
  });
}

export async function createSemester(data: { tradeId: string; number: number; name: string }) {
  const trade = await prisma.trade.findUnique({ where: { id: data.tradeId } });
  if (!trade) throw notFound("Trade not found");
  try {
    return await prisma.semester.create({ data });
  } catch {
    throw conflict("Semester number already exists for this trade");
  }
}

export async function updateSemester(id: string, data: Partial<{ number: number; name: string; isActive: boolean }>) {
  const existing = await prisma.semester.findUnique({ where: { id } });
  if (!existing) throw notFound("Semester not found");
  try {
    return await prisma.semester.update({ where: { id }, data });
  } catch {
    throw conflict("Semester number already exists for this trade");
  }
}

// ---- Shifts (institution-level, dynamic count)
export async function listShifts() {
  return prisma.shift.findMany({ orderBy: { name: "asc" } });
}

export async function createShift(data: { name: string; code: string; startTime?: string; endTime?: string }) {
  try {
    return await prisma.shift.create({ data });
  } catch {
    throw conflict("Shift code already exists");
  }
}

export async function updateShift(id: string, data: Partial<{ name: string; code: string; startTime: string | null; endTime: string | null; isActive: boolean }>) {
  const existing = await prisma.shift.findUnique({ where: { id } });
  if (!existing) throw notFound("Shift not found");
  try {
    return await prisma.shift.update({ where: { id }, data });
  } catch {
    throw conflict("Shift code already exists");
  }
}

// ---- Sections
export async function listSections(opts: {
  academicYearId?: string; tradeId?: string; semesterId?: string; shiftId?: string;
  search?: string; page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  for (const k of ["academicYearId", "tradeId", "semesterId", "shiftId"] as const) {
    if (opts[k]) where[k] = opts[k];
  }
  if (opts.search) where.name = { contains: opts.search, mode: "insensitive" };
  const [total, items] = await prisma.$transaction([
    prisma.section.count({ where }),
    prisma.section.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        academicYear: { select: { id: true, name: true } },
        trade: { select: { id: true, name: true, code: true } },
        semester: { select: { id: true, name: true, number: true } },
        shift: { select: { id: true, name: true, code: true } },
        _count: { select: { enrollments: true, offerings: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function createSection(data: {
  academicYearId: string; tradeId: string; semesterId: string; shiftId: string; name: string; capacity?: number;
}) {
  // Validate the academic chain exists and semester belongs to trade.
  const [ay, trade, sem, shift] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: data.academicYearId } }),
    prisma.trade.findUnique({ where: { id: data.tradeId } }),
    prisma.semester.findUnique({ where: { id: data.semesterId } }),
    prisma.shift.findUnique({ where: { id: data.shiftId } }),
  ]);
  if (!ay) throw notFound("Academic year not found");
  if (!trade) throw notFound("Trade not found");
  if (!sem) throw notFound("Semester not found");
  if (!shift) throw notFound("Shift not found");
  if (sem.tradeId !== data.tradeId) throw businessRule("Semester does not belong to the selected trade");
  try {
    return await prisma.section.create({ data });
  } catch {
    throw conflict("Section already exists for this academic context");
  }
}

export async function updateSection(id: string, data: Partial<{ name: string; capacity: number | null; isActive: boolean }>) {
  const existing = await prisma.section.findUnique({ where: { id } });
  if (!existing) throw notFound("Section not found");
  // Section academic context is immutable (no mixing years/trades/semesters/shifts).
  return prisma.section.update({ where: { id }, data });
}

export async function getSection(id: string) {
  const s = await prisma.section.findUnique({
    where: { id },
    include: {
      academicYear: true, trade: true, semester: true, shift: true,
      offerings: { include: { course: true }, take: 100 },
      _count: { select: { enrollments: true, offerings: true } },
    },
  });
  if (!s) throw notFound("Section not found");
  return s;
}
