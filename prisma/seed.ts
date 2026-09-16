// DEV/TEST SEED ONLY — clearly-identified seed data, never runtime mock data.
// Production UI queries the real database; this script only bootstraps local/dev environments.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Institution
  let inst = await prisma.institution.findFirst();
  if (!inst) {
    inst = await prisma.institution.create({
      data: { name: "Demo Technical Institute", semesterCount: 8, shiftCount: 2, email: "info@example.edu" },
    });
    console.log("Created institution:", inst.name);
  }

  // Admin — the protected seed/system account (identity + credentials come from env).
  // This script is the ONLY place allowed to mark a user as isSeedAdmin; application
  // APIs read the flag from the database and refuse to modify or delete that account.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@institution.local").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  const flagged = await prisma.user.findFirst({ where: { isSeedAdmin: true } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const created = await prisma.user.create({
      data: {
        email: adminEmail,
        name: process.env.SEED_ADMIN_NAME || "System Administrator",
        role: "ADMIN",
        passwordHash,
        isSeedAdmin: true,
      },
    });
    console.log("Created seed admin:", created.email);
  } else if (existing.role !== "ADMIN") {
    console.warn(`Seed admin email ${adminEmail} exists as role ${existing.role}; refusing to change roles during seeding. Resolve manually.`);
  } else if (!flagged) {
    // Upgrade path: an existing admin matching the configured seed email becomes the
    // protected account (idempotent backfill). Never flags a second account.
    await prisma.user.update({ where: { id: existing.id }, data: { isSeedAdmin: true } });
    console.log("Marked existing admin as protected seed admin:", adminEmail);
  } else if (flagged.id !== existing.id) {
    console.warn("A protected seed admin already exists; the email configured in SEED_ADMIN_EMAIL was NOT auto-promoted. Reconcile SEED_ADMIN_EMAIL deliberately if the recovery account changed.");
  } else {
    console.log("Seed admin already exists:", adminEmail);
  }

  if (process.env.SEED_DEMO !== "true") {
    console.log("SEED_DEMO != true — skipping demo academic data.");
    return;
  }

  // ---- Demo academic skeleton (dev only) ----
  const year = await prisma.academicYear.upsert({
    where: { name: "2026-27" },
    update: {},
    create: { name: "2026-27", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), isActive: true },
  });
  const trade = await prisma.trade.upsert({
    where: { code: "CSE" },
    update: {},
    create: { name: "Computer Science", code: "CSE" },
  });
  const sem1 = await prisma.semester.upsert({
    where: { tradeId_number: { tradeId: trade.id, number: 1 } },
    update: {},
    create: { tradeId: trade.id, number: 1, name: "Semester 1" },
  });
  const sem2 = await prisma.semester.upsert({
    where: { tradeId_number: { tradeId: trade.id, number: 2 } },
    update: {},
    create: { tradeId: trade.id, number: 2, name: "Semester 2" },
  });
  const shift = await prisma.shift.upsert({
    where: { code: "MORNING" },
    update: {},
    create: { name: "Morning", code: "MORNING", startTime: "08:00", endTime: "12:00" },
  });
  const section = await prisma.section.upsert({
    where: { academicYearId_tradeId_semesterId_shiftId_name: { academicYearId: year.id, tradeId: trade.id, semesterId: sem1.id, shiftId: shift.id, name: "A" } },
    update: {},
    create: { academicYearId: year.id, tradeId: trade.id, semesterId: sem1.id, shiftId: shift.id, name: "A", capacity: 50 },
  });
  void sem2;
  const course1 = await prisma.course.upsert({ where: { code: "CSE-101" }, update: {}, create: { code: "CSE-101", title: "Programming Fundamentals", credits: 3 } });
  const course2 = await prisma.course.upsert({ where: { code: "CSE-102" }, update: {}, create: { code: "CSE-102", title: "Digital Electronics", credits: 3 } });

  let curriculum = await prisma.curriculum.findFirst({ where: { tradeId: trade.id, semesterId: sem1.id } });
  if (!curriculum) {
    curriculum = await prisma.curriculum.create({ data: { tradeId: trade.id, semesterId: sem1.id, name: "2026 Curriculum", version: 1 } });
    await prisma.curriculumCourse.createMany({ data: [
      { curriculumId: curriculum.id, courseId: course1.id, order: 0 },
      { curriculumId: curriculum.id, courseId: course2.id, order: 1 },
    ]});
  }

  for (const course of [course1, course2]) {
    await prisma.courseOffering.upsert({
      where: { academicYearId_tradeId_semesterId_shiftId_sectionId_courseId: { academicYearId: year.id, tradeId: trade.id, semesterId: sem1.id, shiftId: shift.id, sectionId: section.id, courseId: course.id } },
      update: {},
      create: { academicYearId: year.id, tradeId: trade.id, semesterId: sem1.id, shiftId: shift.id, sectionId: section.id, courseId: course.id },
    });
  }

  // Demo teacher + assignment
  async function ensureUser(email: string, name: string, role: "TEACHER" | "STUDENT") {
    const e = email.toLowerCase();
    let u = await prisma.user.findUnique({ where: { email: e } });
    if (!u) {
      u = await prisma.user.create({ data: { email: e, name, role, passwordHash: await bcrypt.hash("Demo123!", 12) } });
    }
    return u;
  }
  const tUser = await ensureUser("teacher@example.edu", "Demo Teacher", "TEACHER");
  let teacher = await prisma.teacher.findUnique({ where: { userId: tUser.id } });
  if (!teacher) teacher = await prisma.teacher.create({ data: { userId: tUser.id, employeeId: "TCH-001", joiningDate: new Date() } });
  const offerings = await prisma.courseOffering.findMany({ where: { sectionId: section.id } });
  for (const o of offerings) {
    const has = await prisma.teacherCourseAssignment.findFirst({ where: { courseOfferingId: o.id, isActive: true } });
    if (!has) await prisma.teacherCourseAssignment.create({ data: { courseOfferingId: o.id, teacherId: teacher.id, activeSlot: o.id } });
  }

  // Demo students + enrollments
  for (let i = 1; i <= 3; i++) {
    const sUser = await ensureUser(`student${i}@example.edu`, `Demo Student ${i}`, "STUDENT");
    let student = await prisma.student.findUnique({ where: { userId: sUser.id } });
    if (!student) student = await prisma.student.create({ data: { userId: sUser.id, studentId: `STU-2026-00${i}`, admissionDate: new Date() } });
    const has = await prisma.studentEnrollment.findFirst({ where: { studentId: student.id, academicYearId: year.id, semesterId: sem1.id, status: "ACTIVE" } });
    if (!has) {
      await prisma.studentEnrollment.create({
        data: { studentId: student.id, academicYearId: year.id, tradeId: trade.id, semesterId: sem1.id, shiftId: shift.id, sectionId: section.id, rollNumber: i, status: "ACTIVE" },
      });
    }
  }
  console.log("Demo academic data seeded.");
}

main().finally(() => prisma.$disconnect());
