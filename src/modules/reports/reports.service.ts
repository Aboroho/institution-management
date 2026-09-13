import { prisma } from "@/lib/db/prisma";
import { computeFinalGrade, type GradableAssessment } from "@/modules/marks/grading.service";

// Server-side aggregation — never ship huge datasets to the browser.
export async function attendanceReport(opts: {
  academicYearId?: string; tradeId?: string; semesterId?: string; shiftId?: string;
  sectionId?: string; courseOfferingId?: string; from?: Date; to?: Date;
}) {
  const offeringWhere: Record<string, unknown> = {};
  for (const k of ["academicYearId", "tradeId", "semesterId", "shiftId", "sectionId"] as const) {
    if (opts[k]) offeringWhere[k] = opts[k];
  }
  if (opts.courseOfferingId) offeringWhere.id = opts.courseOfferingId;
  const offerings = await prisma.courseOffering.findMany({ where: offeringWhere, select: { id: true } });
  const ids = offerings.map((o) => o.id);
  if (!ids.length) return [];

  const sessionWhere: Record<string, unknown> = { courseOfferingId: { in: ids } };
  if (opts.from || opts.to) {
    sessionWhere.attendanceDate = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }
  const sessions = await prisma.attendanceSession.findMany({
    where: sessionWhere,
    include: { records: { include: { student: { include: { user: { select: { name: true } } } } } } },
  });

  const agg = new Map<string, { studentId: string; studentCode: string; name: string; total: number; present: number; absent: number; late: number; excused: number }>();
  for (const s of sessions) {
    for (const r of s.records) {
      if (!agg.has(r.studentId)) {
        agg.set(r.studentId, {
          studentId: r.studentId, studentCode: r.student.studentId, name: r.student.user.name,
          total: 0, present: 0, absent: 0, late: 0, excused: 0,
        });
      }
      const a = agg.get(r.studentId)!;
      a.total += 1;
      if (r.status === "PRESENT") a.present += 1;
      else if (r.status === "ABSENT") a.absent += 1;
      else if (r.status === "LATE") a.late += 1;
      else a.excused += 1;
    }
  }
  return [...agg.values()].map((a) => ({
    ...a,
    percentage: a.total ? Math.round(((a.present + a.late * 0.5 + a.excused * 0.5) / a.total) * 1000) / 10 : 0,
  })).sort((a, b) => a.studentCode.localeCompare(b.studentCode));
}

export async function marksReport(opts: {
  courseOfferingId?: string; assessmentId?: string; academicYearId?: string; tradeId?: string;
  semesterId?: string; shiftId?: string; sectionId?: string;
}) {
  const assessmentWhere: Record<string, unknown> = {};
  if (opts.assessmentId) assessmentWhere.id = opts.assessmentId;
  if (opts.courseOfferingId) assessmentWhere.courseOfferingId = opts.courseOfferingId;
  else if (opts.academicYearId || opts.tradeId || opts.semesterId || opts.shiftId || opts.sectionId) {
    assessmentWhere.courseOffering = {
      ...(opts.academicYearId ? { academicYearId: opts.academicYearId } : {}),
      ...(opts.tradeId ? { tradeId: opts.tradeId } : {}),
      ...(opts.semesterId ? { semesterId: opts.semesterId } : {}),
      ...(opts.shiftId ? { shiftId: opts.shiftId } : {}),
      ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
    };
  }
  const assessments = await prisma.assessment.findMany({
    where: assessmentWhere,
    include: {
      courseOffering: { include: { course: true, section: true } },
      marks: { include: { student: { include: { user: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return assessments.flatMap((a) =>
    a.marks.map((m: any) => {
      const pct = a.totalMarks ? Math.round((m.marksObtained / a.totalMarks) * 1000) / 10 : 0;
      return {
        assessmentId: a.id, assessmentTitle: a.title, type: a.type,
        course: a.courseOffering.course.title, section: a.courseOffering.section.name,
        studentId: m.studentId, studentCode: m.student.studentId, name: m.student.user.name,
        marksObtained: m.marksObtained, totalMarks: a.totalMarks, percentage: pct,
        pass: m.marksObtained >= a.passMarks,
      };
    })
  );
}

export async function studentFullReport(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      user: { select: { name: true, email: true } },
      enrollments: {
        orderBy: { enrolledAt: "desc" },
        include: { academicYear: true, trade: true, semester: true, shift: true, section: true },
      },
      promotions: { orderBy: { decidedAt: "desc" } },
      marks: { include: { assessment: { include: { courseOffering: { include: { course: true } } } } } },
    },
  });
  if (!student) return null;
  // Attendance per offering
  const records = await prisma.attendanceRecord.findMany({
    where: { studentId },
    include: { session: { include: { courseOffering: { include: { course: true } } } } },
  });
  const byOffering = new Map<string, { course: string; total: number; present: number; absent: number; late: number; excused: number }>();
  for (const r of records) {
    const key = r.session.courseOfferingId;
    if (!byOffering.has(key)) byOffering.set(key, { course: r.session.courseOffering.course.title, total: 0, present: 0, absent: 0, late: 0, excused: 0 });
    const s = byOffering.get(key)!;
    s.total += 1;
    if (r.status === "PRESENT") s.present += 1;
    else if (r.status === "ABSENT") s.absent += 1;
    else if (r.status === "LATE") s.late += 1;
    else s.excused += 1;
  }
  // Final grades grouped by offering
  const byOffAssess = new Map<string, { course: string; items: GradableAssessment[] }>();
  for (const m of student.marks) {
    const key = m.assessment.courseOfferingId;
    if (!byOffAssess.has(key)) byOffAssess.set(key, { course: m.assessment.courseOffering.course.title, items: [] });
    byOffAssess.get(key)!.items.push({
      id: m.assessment.id, totalMarks: m.assessment.totalMarks, passMarks: m.assessment.passMarks,
      countsTowardFinal: m.assessment.countsTowardFinal, weight: m.assessment.weight,
      marksObtained: m.marksObtained,
    });
  }
  const finals = [...byOffAssess.entries()].map(([offeringId, v]) => ({
    offeringId, course: v.course, final: computeFinalGrade(v.items),
  }));
  return { student, attendance: [...byOffAssess.keys()].length, byOffering: [...byOffering.values()], finals };
}

export async function adminDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [
    totalStudents, activeTeachers, activeYear, activeSections, activeOfferings,
    pendingAttendance, pendingMarks, todaySessions,
  ] = await Promise.all([
    prisma.student.count({ where: { isActive: true } }),
    prisma.teacher.count({ where: { isActive: true } }),
    prisma.academicYear.findFirst({ where: { isActive: true } }),
    prisma.section.count({ where: { isActive: true } }),
    prisma.courseOffering.count({ where: { isActive: true } }),
    prisma.attendanceChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.assessmentMarkChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.attendanceSession.findMany({
      where: { attendanceDate: { gte: today, lt: tomorrow } },
      include: { records: true },
    }),
  ]);
  let present = 0, total = 0;
  for (const s of todaySessions) {
    for (const r of s.records) {
      total += 1;
      if (r.status === "PRESENT" || r.status === "LATE") present += 1;
    }
  }
  const recentActivity = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" }, take: 10,
    include: { actor: { select: { name: true } } },
  });
  // Attendance trend: last 14 days.
  const from = new Date(today);
  from.setDate(from.getDate() - 13);
  const sessions = await prisma.attendanceSession.findMany({
    where: { attendanceDate: { gte: from } },
    include: { records: { select: { status: true } } },
  });
  const trendMap = new Map<string, { date: string; total: number; present: number }>();
  for (const s of sessions) {
    const key = s.attendanceDate.toISOString().slice(0, 10);
    if (!trendMap.has(key)) trendMap.set(key, { date: key, total: 0, present: 0 });
    const t = trendMap.get(key)!;
    for (const r of s.records) {
      t.total += 1;
      if (r.status === "PRESENT" || r.status === "LATE") t.present += 1;
    }
  }
  const trend = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({
    date: t.date, percentage: t.total ? Math.round((t.present / t.total) * 1000) / 10 : 0,
  }));
  return {
    totalStudents, activeTeachers, currentAcademicYear: activeYear, activeSections, activeOfferings,
    todayAttendance: { total, present, percentage: total ? Math.round((present / total) * 1000) / 10 : 0 },
    pendingAttendance, pendingMarks, recentActivity, trend,
  };
}

export async function teacherDashboard(teacherId: string) {
  const assignments = await prisma.teacherCourseAssignment.findMany({
    where: { teacherId, isActive: true },
    include: {
      courseOffering: {
        include: {
          course: true, section: true, semester: true,
          assessments: { where: { dueDate: { gte: new Date() } }, orderBy: { dueDate: "asc" }, take: 5 },
          notices: { orderBy: { publishedAt: "desc" }, take: 5 },
          schedules: { where: { isActive: true }, include: { items: true } },
        },
      },
    },
  });
  const today = new Date().getDay();
  const todayClasses = assignments.filter((a) =>
    a.courseOffering.schedules.some((s: any) => s.items.some((i: any) => i.weekday === today))
  ).length;
  return { assignments, todayClasses };
}

export async function studentDashboard(studentId: string) {
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    include: { academicYear: true, trade: true, semester: true, shift: true, section: true },
  });
  const records = await prisma.attendanceRecord.findMany({ where: { studentId } });
  const total = records.length;
  const present = records.filter((r) => r.status === "PRESENT").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const late = records.filter((r) => r.status === "LATE").length;
  const excused = records.filter((r) => r.status === "EXCUSED").length;
  return {
    enrollments,
    attendance: {
      total, present, absent, late, excused,
      percentage: total ? Math.round(((present + late * 0.5 + excused * 0.5) / total) * 1000) / 10 : 0,
    },
  };
}
