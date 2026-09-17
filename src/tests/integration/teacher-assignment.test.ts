import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Business-rule tests for teacher assignment & substitution:
//  - context code derivation in payloads
//  - academic-year status gates assignment/substitution
//  - single active teacher + history preservation
// Requires a real database (DATABASE_URL); skipped otherwise (same as api.smoke).
const hasDb = Boolean(process.env.DATABASE_URL);

type Ctx = {
  prisma: typeof import("@/lib/db/prisma")["prisma"];
  assignments: typeof import("@/modules/teachers/teachers.service");
  offerings: typeof import("@/modules/course-offerings/offerings.service");
  tradeId: string; semesterId: string; yearId: string; shiftId: string; sectionId: string;
  curriculumId: string; courseId: string;
  offeringId: string;
  teacherAId: string; teacherBId: string;
};

const ctx: Partial<Ctx> = {};
const tag = `tatest${Date.now().toString(36)}`;

describe.skipIf(!hasDb)(
  "teacher assignment business rules (requires DATABASE_URL)",
  { timeout: 60000 },
  () => {
    beforeAll(async () => {
      const { prisma } = await import("@/lib/db/prisma");
      const assignments = await import("@/modules/teachers/teachers.service");
      const offerings = await import("@/modules/course-offerings/offerings.service");
      const courses = await import("@/modules/courses/courses.service");
      const { hashPassword } = await import("@/lib/auth/password");

      const trade = await prisma.trade.create({ data: { name: `TA Trade ${tag}`, code: tag, description: null } });
      const semester = await prisma.semester.create({ data: { tradeId: trade.id, number: 2, name: "Semester 2" } });
      const year = await prisma.academicYear.create({
        data: { name: `AY-TA-${tag}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), isActive: true },
      });
      const shift = await prisma.shift.create({ data: { name: "Morning", code: `${tag}-M` } });
      const section = await prisma.section.create({
        data: { academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id, name: "A" },
      });
      const course = await prisma.course.create({ data: { code: `${tag}-DE`, title: "Digital Electronics" } });
      const curriculum = await courses.createCurriculum({
        tradeId: trade.id, semesterId: semester.id, name: `TA Curr ${tag}`, courseIds: [course.id],
      });
      const offering = await offerings.createOffering({
        academicYearId: year.id, tradeId: trade.id, semesterId: semester.id, shiftId: shift.id, sectionId: section.id, courseId: course.id,
      });

      async function mkTeacher(suffix: string) {
        const email = `${tag}.${suffix}@test.local`;
        const user = await prisma.user.create({
          data: { email, name: `Teacher ${suffix}`, role: "TEACHER", passwordHash: await hashPassword("Passw0rd!x") },
        });
        return prisma.teacher.create({
          data: { userId: user.id, employeeId: `${tag}-${suffix}`, department: null, designation: null, phone: null, address: null, joiningDate: new Date() },
        });
      }
      const teacherA = await mkTeacher("A");
      const teacherB = await mkTeacher("B");

      Object.assign(ctx, {
        prisma, assignments, offerings,
        tradeId: trade.id, semesterId: semester.id, yearId: year.id, shiftId: shift.id, sectionId: section.id,
        curriculumId: curriculum.id, courseId: course.id, offeringId: offering.id,
        teacherAId: teacherA.id, teacherBId: teacherB.id,
      });
    });

    afterAll(async () => {
      const p = ctx.prisma;
      if (!p) return;
      await p.teacherCourseAssignment.deleteMany({ where: { courseOfferingId: ctx.offeringId } });
      await p.courseOffering.deleteMany({ where: { tradeId: ctx.tradeId } });
      await p.curriculum.deleteMany({ where: { tradeId: ctx.tradeId } });
      await p.section.deleteMany({ where: { tradeId: ctx.tradeId } });
      await p.semester.deleteMany({ where: { tradeId: ctx.tradeId } });
      await p.shift.deleteMany({ where: { code: { startsWith: tag } } });
      await p.course.deleteMany({ where: { code: { startsWith: tag } } });
      await p.teacher.deleteMany({ where: { employeeId: { startsWith: tag } } });
      await p.user.deleteMany({ where: { email: { startsWith: `${tag}.` } } });
      await p.academicYear.deleteMany({ where: { name: `AY-TA-${tag}` } });
      await p.trade.deleteMany({ where: { code: tag } });
      await p.$disconnect();
    });

    it("lists offerings with the derived context code and real DB id", async () => {
      const { items } = await ctx.offerings!.listOfferings({ academicYearId: ctx.yearId!, page: 1, limit: 10 });
      const mine = items.find((o) => o.id === ctx.offeringId);
      expect(mine).toBeDefined();
      expect(mine!.context).toBe(`Digital Electronics-${tag}-2-M-A`);
      expect(mine!.id).not.toBe(mine!.context); // context is display-only
      expect(mine!.available).toBe(true);
    });

    it("assigns a teacher and exposes the assignment in listAssignments payloads", async () => {
      const created = await ctx.assignments!.assignTeacher({ courseOfferingId: ctx.offeringId!, teacherId: ctx.teacherAId! });
      expect(created.isActive).toBe(true);
      const { items } = await ctx.assignments!.listAssignments({ courseOfferingId: ctx.offeringId!, page: 1, limit: 10 });
      expect(items).toHaveLength(1);
      expect(items[0].teacherId).toBe(ctx.teacherAId);
      expect((items[0] as any).courseOffering.context).toBe(`Digital Electronics-${tag}-2-M-A`);
    });

    it("rejects a second active teacher (duplicate active assignment)", async () => {
      await expect(ctx.assignments!.assignTeacher({ courseOfferingId: ctx.offeringId!, teacherId: ctx.teacherBId! })).rejects.toThrow(
        /already has an active teacher/i
      );
    });

    it("substitutes transactionally: closes old, creates new, preserves history", async () => {
      const { previous, current } = await ctx.assignments!.substituteTeacher({
        courseOfferingId: ctx.offeringId!, newTeacherId: ctx.teacherBId!, reason: "leave",
      });
      expect(previous.teacherId).toBe(ctx.teacherAId);
      expect(current.teacherId).toBe(ctx.teacherBId);
      expect(current.isActive).toBe(true);
      const p = ctx.prisma!;
      const old = await p.teacherCourseAssignment.findUnique({ where: { id: previous.id } });
      expect(old!.isActive).toBe(false);
      expect(old!.endedAt).toBeInstanceOf(Date);
      // Both records remain (history preserved, same offering)
      const all = await p.teacherCourseAssignment.findMany({ where: { courseOfferingId: ctx.offeringId } });
      expect(all).toHaveLength(2);
      const { items } = await ctx.assignments!.listAssignments({ courseOfferingId: ctx.offeringId!, page: 1, limit: 10 });
      expect(items.filter((a) => a.isActive)).toHaveLength(1);
    });

    it("allows re-assigning the previous teacher after substitution", async () => {
      await ctx.assignments!.substituteTeacher({ courseOfferingId: ctx.offeringId!, newTeacherId: ctx.teacherAId!, reason: "back" });
      const { items } = await ctx.assignments!.listAssignments({ courseOfferingId: ctx.offeringId!, page: 1, limit: 10 });
      const active = items.find((a) => a.isActive);
      expect(active?.teacherId).toBe(ctx.teacherAId);
    });

    it("blocks assignment and substitution when the academic year is inactive", async () => {
      const p = ctx.prisma!;
      await p.academicYear.update({ where: { id: ctx.yearId! }, data: { isActive: false } });
      await expect(
        ctx.assignments!.substituteTeacher({ courseOfferingId: ctx.offeringId!, newTeacherId: ctx.teacherBId! })
      ).rejects.toThrow(/academic year is inactive/i);
      // Deactivate the active assignment so a fresh assignment is attempted too.
      await p.teacherCourseAssignment.updateMany({ where: { courseOfferingId: ctx.offeringId!, isActive: true }, data: { isActive: false, activeSlot: null, endedAt: new Date() } });
      await expect(
        ctx.assignments!.assignTeacher({ courseOfferingId: ctx.offeringId!, teacherId: ctx.teacherBId! })
      ).rejects.toThrow(/academic year is inactive/i);
      // New offerings are also blocked in an inactive year.
      await expect(
        ctx.offerings!.createOffering({
          academicYearId: ctx.yearId!, tradeId: ctx.tradeId!, semesterId: ctx.semesterId!, shiftId: ctx.shiftId!, sectionId: ctx.sectionId!, courseId: ctx.courseId!,
        })
      ).rejects.toThrow(/academic year is inactive/i);
      // Offering list now reports the offering as unavailable (derived).
      const { items } = await ctx.offerings!.listOfferings({ academicYearId: ctx.yearId!, page: 1, limit: 10 });
      const mine = items.find((o) => o.id === ctx.offeringId);
      expect(mine!.available).toBe(false);
      expect(mine!.context).toBe(`Digital Electronics-${tag}-2-M-A`); // historical context still shown
      // Historical data remains accessible.
      const history = await p.teacherCourseAssignment.findMany({ where: { courseOfferingId: ctx.offeringId! } });
      expect(history.length).toBeGreaterThanOrEqual(3);
      await p.academicYear.update({ where: { id: ctx.yearId! }, data: { isActive: true } });
    });
  }
);
