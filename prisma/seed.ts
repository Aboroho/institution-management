// DEV/TEST SEED ONLY — clearly-identified seed data, never runtime mock data.
// Production UI queries the real database; this script only bootstraps local/dev environments.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Log WHERE we are seeding (host/database only — never credentials) so a wrong
// DATABASE_URL is obvious instead of looking like "seed did nothing".
function targetLabel() {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(DATABASE_URL missing or unparseable)";
  }
}

async function main() {
  console.log("Seeding database:", targetLabel());
  // Institution
  let inst = await prisma.institution.findFirst();
  if (!inst) {
    inst = await prisma.institution.create({
      data: { name: "Demo Technical Institute", semesterCount: 8, shiftCount: 2, email: "info@example.edu" },
    });
    console.log("Created institution:", inst.name);
  }

  // ---- Protected seed admin ----
  // The account configured through SEED_ADMIN_* is the ONE protected seed admin. The
  // marker is persisted on the user row (`isProtectedSeedAdmin`, with a partial unique
  // index allowing at most one) because .env alone cannot identify the account after
  // initialization: it is not stored with the row, it can change between deployments,
  // and it cannot be enforced in the database. Only this script writes that marker —
  // no API accepts it as input — so a client can never grant or remove the protection.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@institution.local").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
  const adminName = process.env.SEED_ADMIN_NAME || "System Administrator";
  const resetPassword = process.env.SEED_ADMIN_RESET_PASSWORD === "true";

  const protectedAdmin = await prisma.user.findFirst({
    where: { isProtectedSeedAdmin: true },
    select: { id: true, email: true, role: true, isActive: true },
  });

  if (protectedAdmin) {
    if (protectedAdmin.email !== adminEmail) {
      // SEED_ADMIN_EMAIL was changed after the account was marked. Reassigning the
      // protection here would silently move a security identity, so keep the existing
      // account and tell the operator exactly what to do.
      console.warn(
        `Protected seed admin is already ${protectedAdmin.email}; SEED_ADMIN_EMAIL (${adminEmail}) was ignored. ` +
          "Protection follows the persisted account — change it deliberately (it cannot be changed through the application).",
      );
    } else {
      if (protectedAdmin.role !== "ADMIN" || !protectedAdmin.isActive) {
        await prisma.user.update({
          where: { id: protectedAdmin.id },
          data: { role: "ADMIN", isActive: true },
        });
        console.log("Repaired protected seed admin role/status:", adminEmail);
      }
      if (resetPassword) {
        // Explicit, operator-only credential rotation: the application deliberately
        // cannot change this account's password.
        await prisma.user.update({
          where: { id: protectedAdmin.id },
          data: { passwordHash: await bcrypt.hash(adminPassword, 12), sessionVersion: { increment: 1 } },
        });
        console.log("Rotated protected seed admin password from SEED_ADMIN_PASSWORD:", adminEmail);
      }
      console.log("Protected seed admin already exists:", adminEmail);
    }
  } else {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      // Adopt the configured account (e.g. an admin created before this feature shipped).
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", isActive: true, isProtectedSeedAdmin: true },
      });
      console.log("Marked existing account as the protected seed admin:", adminEmail);
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          role: "ADMIN",
          isActive: true,
          isProtectedSeedAdmin: true,
          passwordHash,
        },
      });
      console.log("Created protected seed admin:", adminEmail);
    }
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

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
