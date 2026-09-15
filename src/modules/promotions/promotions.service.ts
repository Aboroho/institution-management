import { prisma } from "@/lib/db/prisma";
import { notFound, businessRule, conflict } from "@/lib/errors/errors";
import { computeFinalGrade, type GradableAssessment } from "@/modules/marks/grading.service";
import { nextSectionRollNumber } from "@/modules/students/roll";
import type { PromotionDecision } from "@prisma/client";

export async function evaluateEligibility(opts: {
  academicYearId: string; tradeId: string; semesterId: string; shiftId?: string; sectionId?: string;
}) {
  const enWhere: Record<string, unknown> = {
    academicYearId: opts.academicYearId, tradeId: opts.tradeId, semesterId: opts.semesterId, status: "ACTIVE",
  };
  if (opts.shiftId) enWhere.shiftId = opts.shiftId;
  if (opts.sectionId) enWhere.sectionId = opts.sectionId;

  const enrollments = await prisma.studentEnrollment.findMany({
    where: enWhere,
    include: { student: { include: { user: { select: { name: true, email: true } } } }, section: true, semester: true },
    orderBy: { student: { studentId: "asc" } },
  });

  const offerings = await prisma.courseOffering.findMany({
    where: {
      academicYearId: opts.academicYearId, tradeId: opts.tradeId, semesterId: opts.semesterId,
      ...(opts.shiftId ? { shiftId: opts.shiftId } : {}),
      ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
      isActive: true,
    },
    include: { course: true, assessments: { include: { marks: true } } },
  });

  return enrollments.map((en) => {
    let passedAll = true;
    let gradedAll = true;
    const perCourse = offerings
      .filter((o) => o.sectionId === en.sectionId)
      .map((o) => {
        const items: GradableAssessment[] = o.assessments.map((a: any) => ({
          id: a.id, totalMarks: a.totalMarks, passMarks: a.passMarks,
          countsTowardFinal: a.countsTowardFinal, weight: a.weight,
          marksObtained: a.marks.find((m: any) => m.studentId === en.studentId)?.marksObtained ?? null,
        }));
        const final = computeFinalGrade(items);
        if (!final.complete) gradedAll = false;
        if (!final.passed) passedAll = false;
        return { offeringId: o.id, course: o.course.title, final };
      });
    const suggested: PromotionDecision = !gradedAll ? "REPEAT" : passedAll ? "PROMOTED" : "REPEAT";
    return {
      enrollmentId: en.id, studentId: en.studentId, rollNumber: en.rollNumber,
      student: en.student, section: en.section, semester: en.semester,
      perCourse, gradedAll, passedAll, suggested,
    };
  });
}

export async function executePromotion(opts: {
  items: { enrollmentId: string; decision: PromotionDecision; reason?: string }[];
  toAcademicYearId?: string; toSemesterId?: string; toShiftId?: string; toSectionId?: string;
  decidedById: string;
}) {
  if (!opts.items.length) throw businessRule("No students selected");
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const item of opts.items) {
      const from = await tx.studentEnrollment.findUnique({ where: { id: item.enrollmentId } });
      if (!from) throw notFound(`Enrollment ${item.enrollmentId} not found`);
      if (from.status !== "ACTIVE") throw conflict(`Enrollment ${item.enrollmentId} is not active (duplicate promotion prevented)`);
      const existing = await tx.studentPromotion.findFirst({ where: { fromEnrollmentId: from.id } });
      if (existing) throw conflict(`Enrollment ${from.id} was already promoted`);

      let toEnrollmentId: string | null = null;
      let toSemesterId: string | null = null;

      if (item.decision === "PROMOTED") {
        // Destination: next semester by number within same trade, same section context unless overridden.
        const semesters = await tx.semester.findMany({ where: { tradeId: from.tradeId }, orderBy: { number: "asc" } });
        const idx = semesters.findIndex((s) => s.id === from.semesterId);
        const next = opts.toSemesterId
          ? await tx.semester.findUnique({ where: { id: opts.toSemesterId } })
          : semesters[idx + 1];
        if (!next) throw businessRule("No next semester available — use COMPLETED for final-semester students");
        if (next.tradeId !== from.tradeId) throw businessRule("Destination semester must belong to the same trade");
        toSemesterId = next.id;
        // Find or require destination section.
        let destSectionId: string;
        if (opts.toSectionId) {
          destSectionId = opts.toSectionId;
        } else {
          const sameName = await tx.section.findFirst({
            where: {
              academicYearId: opts.toAcademicYearId ?? from.academicYearId,
              tradeId: from.tradeId, semesterId: next.id,
              shiftId: opts.toShiftId ?? from.shiftId,
            },
          });
          if (!sameName) throw businessRule("No destination section found for the next semester in this context");
          destSectionId = sameName.id;
        }
        const to = await tx.studentEnrollment.create({
          data: {
            studentId: from.studentId,
            academicYearId: opts.toAcademicYearId ?? from.academicYearId,
            tradeId: from.tradeId, semesterId: next.id,
            shiftId: opts.toShiftId ?? from.shiftId, sectionId: destSectionId,
            // Roll numbers are unique per section; system-created enrollments take the next free one.
            rollNumber: await nextSectionRollNumber(tx, destSectionId),
            status: "ACTIVE",
          },
        });
        toEnrollmentId = to.id;
        await tx.studentEnrollment.update({ where: { id: from.id }, data: { status: "PROMOTED", endedAt: new Date() } });
      } else if (item.decision === "REPEAT") {
        // New ACTIVE enrollment in the same semester (history preserved).
        const to = await tx.studentEnrollment.create({
          data: {
            studentId: from.studentId, academicYearId: from.academicYearId, tradeId: from.tradeId,
            semesterId: from.semesterId, shiftId: from.shiftId, sectionId: from.sectionId,
            rollNumber: await nextSectionRollNumber(tx, from.sectionId), status: "ACTIVE",
          },
        }).catch(() => null);
        if (to) {
          toEnrollmentId = to.id;
          toSemesterId = from.semesterId;
        }
        await tx.studentEnrollment.update({ where: { id: from.id }, data: { status: "REPEATING", endedAt: new Date() } });
      } else {
        const map: Record<string, "FAILED" | "COMPLETED" | "TRANSFERRED" | "WITHDRAWN"> = {
          FAILED: "FAILED", COMPLETED: "COMPLETED", TRANSFERRED: "TRANSFERRED", WITHDRAWN: "WITHDRAWN",
        };
        await tx.studentEnrollment.update({ where: { id: from.id }, data: { status: map[item.decision], endedAt: new Date() } });
      }

      const promo = await tx.studentPromotion.create({
        data: {
          studentId: from.studentId, fromEnrollmentId: from.id, toEnrollmentId,
          fromSemesterId: from.semesterId, toSemesterId,
          decision: item.decision, reason: item.reason, decidedById: opts.decidedById,
        },
      });
      results.push(promo);
    }
    return results;
  });
}

export async function promotionHistory(studentId?: string, page = 1, limit = 25) {
  const where: Record<string, unknown> = {};
  if (studentId) where.studentId = studentId;
  const [total, items] = await prisma.$transaction([
    prisma.studentPromotion.count({ where }),
    prisma.studentPromotion.findMany({
      where, orderBy: { decidedAt: "desc" }, skip: (page - 1) * limit, take: limit,
      include: {
        student: { include: { user: { select: { name: true } } } },
        fromEnrollment: { include: { semester: true, section: true, academicYear: true } },
        toEnrollment: { include: { semester: true, section: true, academicYear: true } },
        decidedBy: { select: { name: true } },
      },
    }),
  ]);
  return { items, total };
}
