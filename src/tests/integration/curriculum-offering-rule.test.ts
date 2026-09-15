import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Business-rule tests for curriculum <-> course-offering enforcement.
// Requires a real database (DATABASE_URL); skipped otherwise (same as api.smoke).
const hasDb = Boolean(process.env.DATABASE_URL);

type Ctx = {
  prisma: typeof import("@/lib/db/prisma")["prisma"];
  courses: typeof import("@/modules/courses/courses.service");
  offerings: typeof import("@/modules/course-offerings/offerings.service");
  tradeId: string; semesterId: string; yearId: string; shiftId: string; sectionId: string;
  courseInCurr: string; courseNotInCurr: string; currAId: string; currBId: string;
};

const ctx: Partial<Ctx> = {};
const tag = `currtest${Date.now().toString(36)}`;

describe.skipIf(!hasDb)("curriculum / offering business rules (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    const { prisma } = await import("@/lib/db/prisma");
    const courses = await import("@/modules/courses/courses.service");
    const offerings = await import("@/modules/course-offerings/offerings.service");

    const trade = await prisma.trade.create({ data: { name: `Test Trade ${tag}`, code: tag, description: null } });
    const semester = await prisma.semester.create({ data: { tradeId: trade.id, number: 1, name: "Semester 1" } });
    const year = await prisma.academicYear.create({ data: { name: `AY-${tag}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    const shift = await prisma.shift.create({ data: { name: `Morning ${tag}`, code: tag } });
    const section = await prisma.section.create({ data: { academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id, name: "A" } });
    const c1 = await prisma.course.create({ data: { code: `${tag}-IN`, title: "In curriculum" } });
    const c2 = await prisma.course.create({ data: { code: `${tag}-OUT`, title: "Not in curriculum" } });

    const currA = await courses.createCurriculum({ tradeId: trade.id, semesterId: semester.id, name: `Curr A ${tag}`, courseIds: [c1.id] });
    const currB = await courses.createCurriculum({ tradeId: trade.id, semesterId: semester.id, name: `Curr B ${tag}`, courseIds: [c1.id] });

    Object.assign(ctx, {
      prisma, courses, offerings,
      tradeId: trade.id, semesterId: semester.id, yearId: year.id, shiftId: shift.id, sectionId: section.id,
      courseInCurr: c1.id, courseNotInCurr: c2.id, currAId: currA.id, currBId: currB.id,
    });
  });

  afterAll(async () => {
    if (!ctx.prisma) return;
    const p = ctx.prisma;
    // Children first (Restrict FKs).
    await p.courseOffering.deleteMany({ where: { tradeId: ctx.tradeId } });
    await p.curriculum.deleteMany({ where: { tradeId: ctx.tradeId } });
    await p.section.deleteMany({ where: { tradeId: ctx.tradeId } });
    await p.semester.deleteMany({ where: { tradeId: ctx.tradeId } });
    await p.shift.deleteMany({ where: { code: tag } });
    await p.course.deleteMany({ where: { code: { startsWith: tag } } });
    await p.academicYear.deleteMany({ where: { name: `AY-${tag}` } });
    await p.trade.deleteMany({ where: { code: tag } });
    await p.$disconnect();
  });

  it("keeps exactly one active curriculum per trade + semester", async () => {
    const p = ctx.prisma!;
    const a = await p.curriculum.findUniqueOrThrow({ where: { id: ctx.currAId } });
    const b = await p.curriculum.findUniqueOrThrow({ where: { id: ctx.currBId } });
    // Creating B deactivated A (B was created last with isActive default true).
    expect(b.isActive).toBe(true);
    expect(a.isActive).toBe(false);

    // Re-activating A deactivates B.
    await ctx.courses!.updateCurriculum(ctx.currAId!, { isActive: true });
    const [a2, b2] = await Promise.all([
      p.curriculum.findUniqueOrThrow({ where: { id: ctx.currAId } }),
      p.curriculum.findUniqueOrThrow({ where: { id: ctx.currBId } }),
    ]);
    expect(a2.isActive).toBe(true);
    expect(b2.isActive).toBe(false);
  });

  it("getActiveCurriculum returns the single active curriculum with its courses", async () => {
    const active = await ctx.courses!.getActiveCurriculum(ctx.tradeId!, ctx.semesterId!);
    expect(active?.id).toBe(ctx.currAId);
    expect(active?.courses.map((cc: any) => cc.courseId)).toContain(ctx.courseInCurr);
  });

  it("allows offering a course that IS in the active curriculum", async () => {
    const created = await ctx.offerings!.createOffering({
      academicYearId: ctx.yearId!, tradeId: ctx.tradeId!, semesterId: ctx.semesterId!,
      shiftId: ctx.shiftId!, sectionId: ctx.sectionId!, courseId: ctx.courseInCurr!,
    });
    expect(created.courseId).toBe(ctx.courseInCurr);
  });

  it("rejects offering a course NOT in the active curriculum (BUSINESS_RULE)", async () => {
    await expect(ctx.offerings!.createOffering({
      academicYearId: ctx.yearId!, tradeId: ctx.tradeId!, semesterId: ctx.semesterId!,
      shiftId: ctx.shiftId!, sectionId: ctx.sectionId!, courseId: ctx.courseNotInCurr!,
    })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("rejects offerings when NO active curriculum exists (BUSINESS_RULE)", async () => {
    const p = ctx.prisma!;
    await p.curriculum.updateMany({ where: { tradeId: ctx.tradeId, semesterId: ctx.semesterId }, data: { isActive: false } });
    await expect(ctx.offerings!.createOffering({
      academicYearId: ctx.yearId!, tradeId: ctx.tradeId!, semesterId: ctx.semesterId!,
      shiftId: ctx.shiftId!, sectionId: ctx.sectionId!, courseId: ctx.courseInCurr!,
    })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});
