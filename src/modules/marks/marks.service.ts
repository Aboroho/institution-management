import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule, approvalRequired } from "@/lib/errors/errors";
import { computeFinalGrade, type GradableAssessment } from "./grading.service";

export const MARK_DIRECT_CORRECTIONS = 2;

export async function saveMarks(opts: {
  assessmentId: string; marks: { studentId: string; marksObtained: number }[];
  actorUserId: string; isAdmin: boolean; reason?: string;
}) {
  const assessment = await prisma.assessment.findUnique({ where: { id: opts.assessmentId } });
  if (!assessment) throw notFound("Assessment not found");
  for (const m of opts.marks) {
    if (m.marksObtained < 0 || m.marksObtained > assessment.totalMarks) {
      throw businessRule(`Marks must be between 0 and ${assessment.totalMarks}`);
    }
  }
  return prisma.$transaction(async (tx: any) => {
    const results = [];
    for (const m of opts.marks) {
      const existing = await tx.assessmentMark.findUnique({
        where: { assessmentId_studentId: { assessmentId: opts.assessmentId, studentId: m.studentId } },
      });
      if (!existing) {
        const created = await tx.assessmentMark.create({
          data: { assessmentId: opts.assessmentId, studentId: m.studentId, marksObtained: m.marksObtained, enteredById: opts.actorUserId },
        });
        await tx.assessmentMarkChangeLog.create({
          data: { markId: created.id, oldMarks: null, newMarks: m.marksObtained, changedById: opts.actorUserId, reason: "Initial entry" },
        });
        results.push(created);
      } else if (existing.marksObtained !== m.marksObtained) {
        if (!opts.isAdmin) {
          if (existing.directCorrections >= MARK_DIRECT_CORRECTIONS) {
            throw approvalRequired("Admin approval required", { markId: existing.id });
          }
          if (!opts.reason) throw businessRule("Reason is required for mark correction");
        }
        const updated = await tx.assessmentMark.update({
          where: { id: existing.id },
          data: {
            marksObtained: m.marksObtained,
            directCorrections: opts.isAdmin ? existing.directCorrections : existing.directCorrections + 1,
          },
        });
        await tx.assessmentMarkChangeLog.create({
          data: {
            markId: existing.id, oldMarks: existing.marksObtained, newMarks: m.marksObtained,
            changedById: opts.actorUserId, reason: opts.reason ?? "Admin correction",
          },
        });
        results.push(updated);
      } else {
        results.push(existing);
      }
    }
    return results;
  });
}

export async function assessmentMarks(assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) throw notFound("Assessment not found");
  return prisma.assessmentMark.findMany({
    where: { assessmentId },
    include: { student: { include: { user: { select: { name: true } } } } },
    orderBy: { student: { studentId: "asc" } },
  });
}

export async function markHistory(markId: string) {
  const mark = await prisma.assessmentMark.findUnique({
    where: { id: markId },
    include: {
      changeLogs: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true, email: true } } } },
      changeRequests: { orderBy: { createdAt: "desc" } },
      assessment: true,
      student: { include: { user: { select: { name: true } } } },
    },
  });
  if (!mark) throw notFound("Mark not found");
  return mark;
}

export async function createMarkChangeRequest(data: { markId: string; newMarks: number; reason: string; requestedById: string }) {
  const mark = await prisma.assessmentMark.findUnique({ where: { id: data.markId }, include: { assessment: true } });
  if (!mark) throw notFound("Mark not found");
  if (data.newMarks < 0 || data.newMarks > mark.assessment.totalMarks) throw businessRule("Marks out of range");
  if (!data.reason?.trim()) throw businessRule("Reason is required");
  if (mark.marksObtained === data.newMarks) throw businessRule("New marks equal current marks");
  const pending = await prisma.assessmentMarkChangeRequest.findFirst({ where: { markId: data.markId, status: "PENDING" } });
  if (pending) throw conflict("A pending request already exists for this mark");
  return prisma.assessmentMarkChangeRequest.create({
    data: { markId: data.markId, oldMarks: mark.marksObtained, newMarks: data.newMarks, reason: data.reason, requestedById: data.requestedById },
  });
}

export async function listMarkChangeRequests(opts: { status?: string; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  const [total, items] = await prisma.$transaction([
    prisma.assessmentMarkChangeRequest.count({ where }),
    prisma.assessmentMarkChangeRequest.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        mark: {
          include: {
            student: { include: { user: { select: { name: true } } } },
            assessment: {
              include: {
                courseOffering: {
                  include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true },
                },
              },
            },
          },
        },
        requestedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function reviewMarkChangeRequest(id: string, opts: { approve: boolean; reviewedById: string; reviewNote?: string }) {
  return prisma.$transaction(async (tx: any) => {
    const req = await tx.assessmentMarkChangeRequest.findUnique({ where: { id } });
    if (!req) throw notFound("Change request not found");
    if (req.status !== "PENDING") throw businessRule("Request already reviewed");
    const mark = await tx.assessmentMark.findUnique({ where: { id: req.markId } });
    if (!mark) throw notFound("Mark not found");
    if (opts.approve) {
      if (mark.marksObtained !== req.oldMarks) throw conflict("Mark changed since request was created");
      await tx.assessmentMark.update({ where: { id: mark.id }, data: { marksObtained: req.newMarks } });
      await tx.assessmentMarkChangeLog.create({
        data: { markId: mark.id, oldMarks: req.oldMarks, newMarks: req.newMarks, changedById: opts.reviewedById, reason: `Approved: ${req.reason}` },
      });
    }
    return tx.assessmentMarkChangeRequest.update({
      where: { id },
      data: { status: opts.approve ? "APPROVED" : "REJECTED", reviewedById: opts.reviewedById, reviewedAt: new Date(), reviewNote: opts.reviewNote },
    });
  });
}

// Final grades per offering for a student (via GradingService).
export async function studentOfferingGrades(studentId: string) {
  const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId, status: "ACTIVE" } });
  if (!enrollments.length) return [];
  const offerings = await prisma.courseOffering.findMany({
    where: {
      OR: enrollments.map((e: any) => ({
        academicYearId: e.academicYearId, tradeId: e.tradeId, semesterId: e.semesterId,
        shiftId: e.shiftId, sectionId: e.sectionId,
      })),
      isActive: true,
    },
    include: {
      course: true, section: true, semester: true, trade: true, shift: true, academicYear: true,
      assessments: { include: { marks: { where: { studentId } } } },
    },
  });
  return offerings.map((o: any) => {
    const items: GradableAssessment[] = o.assessments.map((a: any) => ({
      id: a.id, totalMarks: a.totalMarks, passMarks: a.passMarks,
      countsTowardFinal: a.countsTowardFinal, weight: a.weight,
      marksObtained: a.marks[0]?.marksObtained ?? null,
    }));
    const result = computeFinalGrade(items);
    return {
      offering: {
        id: o.id, course: o.course, section: o.section, semester: o.semester,
        trade: o.trade, shift: o.shift, academicYear: o.academicYear,
      },
      assessments: o.assessments.map((a: any) => ({
        id: a.id, title: a.title, type: a.type, totalMarks: a.totalMarks, passMarks: a.passMarks,
        weight: a.weight, countsTowardFinal: a.countsTowardFinal,
        marksObtained: a.marks[0]?.marksObtained ?? null,
      })),
      final: result,
    };
  });
}
