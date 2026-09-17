import { prisma } from "@/lib/db/prisma";
import { notFound, businessRule } from "@/lib/errors/errors";
import {
  type CourseOfferingAttendanceReportDTO,
  type StudentAttendanceReportDTO,
  type CourseOfferingAssessmentReportDTO,
  type StudentSemesterMarksReportDTO,
  type CourseOfferingAssessmentItemRow,
  type CourseOfferingAssessmentStudentMarksRow,
  type StudentSemesterCourseGroup,
  type StudentSemesterAssessmentItem,
  type AttendanceDailyStatus,
  type AttendanceDayColumn,
} from "./reporting.types";
import {
  calculateAttendanceValue,
  calculateStatusCounts,
  buildReportDateRange,
  formatFullDate,
  formatDayColumnLabel,
} from "./reporting.utils";
import { computeFinalGrade, type GradableAssessment } from "@/modules/marks/grading.service";

export interface AttendanceReportParams {
  from?: string;
  to?: string;
  includeDayWise?: boolean;
}

export interface MarksReportParams {
  from?: string;
  to?: string;
}

/**
 * 1. CourseOffering Complete Attendance Report
 */
export async function generateCourseOfferingAttendanceReport(
  courseOfferingId: string,
  params: AttendanceReportParams = {}
): Promise<CourseOfferingAttendanceReportDTO> {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: courseOfferingId },
    select: {
      id: true,
      academicYearId: true,
      tradeId: true,
      semesterId: true,
      shiftId: true,
      sectionId: true,
      course: { select: { title: true, code: true } },
      trade: { select: { name: true, code: true } },
      academicYear: { select: { name: true } },
      semester: { select: { name: true, number: true } },
      shift: { select: { name: true } },
      section: { select: { name: true } },
      assignments: {
        where: { isActive: true },
        select: { teacher: { select: { user: { select: { name: true } } } } },
        take: 1,
      },
    },
  });

  if (!offering) throw notFound("Course offering not found");

  const dateRange = buildReportDateRange(params.from, params.to);

  // Validate dates if both provided
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from) {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) throw businessRule("Invalid from date");
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) throw businessRule("Invalid to date");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw businessRule("From date cannot be after To date");
  }

  // 1. Fetch sessions in range
  const sessionWhere: Record<string, unknown> = {
    courseOfferingId,
  };
  if (fromDate || toDate) {
    sessionWhere.attendanceDate = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  const sessions = await prisma.attendanceSession.findMany({
    where: sessionWhere,
    select: {
      id: true,
      attendanceDate: true,
    },
    orderBy: { attendanceDate: "asc" },
  });

  const totalClasses = sessions.length;
  const sessionIds = sessions.map((s) => s.id);

  // Day columns (if day-wise enabled)
  let dayColumns: AttendanceDayColumn[] | undefined;
  if (params.includeDayWise) {
    dayColumns = sessions.map((s) => {
      const dateStr = s.attendanceDate.toISOString().slice(0, 10);
      return {
        date: dateStr,
        headerLabel: formatDayColumnLabel(dateStr),
      };
    });
  }

  // 2. Fetch enrolled active students for this offering's context
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      status: "ACTIVE",
    },
    select: {
      rollNumber: true,
      student: {
        select: {
          id: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: { rollNumber: "asc" },
  });

  // 3. Fetch attendance records for these sessions
  // Explicit select to avoid any sensitive user/auth data
  const records = sessionIds.length > 0
    ? await prisma.attendanceRecord.findMany({
        where: { sessionId: { in: sessionIds } },
        select: {
          studentId: true,
          sessionId: true,
          status: true,
          session: { select: { attendanceDate: true } },
        },
      })
    : [];

  // Group records by student
  const studentRecordsMap = new Map<
    string,
    {
      present: number;
      absent: number;
      late: number;
      excused: number;
      daily: Record<string, AttendanceDailyStatus>;
    }
  >();

  for (const r of records) {
    let entry = studentRecordsMap.get(r.studentId);
    if (!entry) {
      entry = { present: 0, absent: 0, late: 0, excused: 0, daily: {} };
      studentRecordsMap.set(r.studentId, entry);
    }
    if (r.status === "PRESENT") entry.present += 1;
    else if (r.status === "ABSENT") entry.absent += 1;
    else if (r.status === "LATE") entry.late += 1;
    else if (r.status === "EXCUSED") entry.excused += 1;

    if (params.includeDayWise) {
      const dStr = r.session.attendanceDate.toISOString().slice(0, 10);
      let statusLetter: AttendanceDailyStatus = "-";
      if (r.status === "PRESENT") statusLetter = "P";
      else if (r.status === "ABSENT") statusLetter = "A";
      else if (r.status === "LATE") statusLetter = "L";
      else if (r.status === "EXCUSED") statusLetter = "E";
      entry.daily[dStr] = statusLetter;
    }
  }

  let sumPercentage = 0;
  const studentRows = enrollments.map((en) => {
    const sEntry = studentRecordsMap.get(en.student.id) || {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      daily: {},
    };

    const attVal = calculateAttendanceValue(totalClasses, sEntry.absent);
    sumPercentage += attVal.percentage;

    const counts = calculateStatusCounts(
      totalClasses,
      sEntry.present,
      sEntry.absent,
      sEntry.late,
      sEntry.excused
    );

    const row: CourseOfferingAttendanceReportDTO["students"][number] = {
      studentId: en.student.id,
      rollNumber: en.rollNumber,
      studentName: en.student.user.name,
      totalClasses,
      attendanceCount: attVal.count,
      attendancePercentage: attVal.percentage,
      attendanceDisplay: attVal.display,
      counts,
    };

    if (params.includeDayWise) {
      row.dailyAttendance = sEntry.daily;
    }
    return row;
  });

  const avgPct =
    studentRows.length > 0
      ? Math.round((sumPercentage / studentRows.length) * 10) / 10
      : 0;

  const teacherName = offering.assignments[0]?.teacher?.user?.name ?? null;
  const context = `${offering.course.code} — ${offering.section.name} (${offering.shift.name})`;

  return {
    type: "course-offering-attendance",
    metadata: {
      courseOfferingId: offering.id,
      courseName: offering.course.title,
      courseCode: offering.course.code,
      trade: offering.trade.name,
      tradeCode: offering.trade.code,
      academicYear: offering.academicYear.name,
      semester: offering.semester.name,
      shift: offering.shift.name,
      section: offering.section.name,
      context,
      teacherName,
      totalClasses,
      dateRange,
      generatedAt: new Date().toISOString(),
    },
    ...(dayColumns ? { dayColumns } : {}),
    students: studentRows,
    summary: {
      totalStudents: studentRows.length,
      totalClasses,
      averageAttendancePercentage: avgPct,
    },
  };
}

/**
 * 2. Single Student Attendance Report
 */
export async function generateStudentAttendanceReport(
  studentId: string,
  params: AttendanceReportParams = {}
): Promise<StudentAttendanceReportDTO> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      studentId: true,
      user: { select: { name: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: {
          rollNumber: true,
          academicYearId: true,
          tradeId: true,
          semesterId: true,
          shiftId: true,
          sectionId: true,
          academicYear: { select: { name: true } },
          trade: { select: { name: true, code: true } },
          semester: { select: { name: true } },
          shift: { select: { name: true } },
          section: { select: { name: true } },
        },
        take: 1,
      },
    },
  });

  if (!student) throw notFound("Student not found");
  const currentEnrollment = student.enrollments[0];
  if (!currentEnrollment) {
    throw businessRule("Student has no active enrollment");
  }

  const dateRange = buildReportDateRange(params.from, params.to);
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from) {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) throw businessRule("Invalid from date");
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) throw businessRule("Invalid to date");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw businessRule("From date cannot be after To date");
  }

  // Find offerings matching student's current enrollment
  const offerings = await prisma.courseOffering.findMany({
    where: {
      academicYearId: currentEnrollment.academicYearId,
      tradeId: currentEnrollment.tradeId,
      semesterId: currentEnrollment.semesterId,
      shiftId: currentEnrollment.shiftId,
      sectionId: currentEnrollment.sectionId,
      isActive: true,
    },
    select: {
      id: true,
      course: { select: { title: true, code: true } },
    },
    orderBy: { course: { title: "asc" } },
  });

  const offeringIds = offerings.map((o) => o.id);

  // Find sessions for these offerings in date range
  const sessionWhere: Record<string, unknown> = {
    courseOfferingId: { in: offeringIds },
  };
  if (fromDate || toDate) {
    sessionWhere.attendanceDate = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  const sessions = await prisma.attendanceSession.findMany({
    where: sessionWhere,
    select: {
      id: true,
      courseOfferingId: true,
      attendanceDate: true,
    },
    orderBy: { attendanceDate: "asc" },
  });

  const sessionMapByOffering = new Map<string, string[]>();
  const allUniqueDates = new Set<string>();
  for (const s of sessions) {
    const list = sessionMapByOffering.get(s.courseOfferingId) || [];
    list.push(s.id);
    sessionMapByOffering.set(s.courseOfferingId, list);
    allUniqueDates.add(s.attendanceDate.toISOString().slice(0, 10));
  }

  const sortedDates = [...allUniqueDates].sort();
  let dayColumns: AttendanceDayColumn[] | undefined;
  if (params.includeDayWise) {
    dayColumns = sortedDates.map((dStr) => ({
      date: dStr,
      headerLabel: formatDayColumnLabel(dStr),
    }));
  }

  // Fetch student's attendance records in these sessions
  const sessionIds = sessions.map((s) => s.id);
  const records = sessionIds.length > 0
    ? await prisma.attendanceRecord.findMany({
        where: {
          studentId,
          sessionId: { in: sessionIds },
        },
        select: {
          sessionId: true,
          status: true,
          session: { select: { courseOfferingId: true, attendanceDate: true } },
        },
      })
    : [];

  const offeringRecordsMap = new Map<
    string,
    {
      present: number;
      absent: number;
      late: number;
      excused: number;
      daily: Record<string, AttendanceDailyStatus>;
    }
  >();

  for (const r of records) {
    const offId = r.session.courseOfferingId;
    let entry = offeringRecordsMap.get(offId);
    if (!entry) {
      entry = { present: 0, absent: 0, late: 0, excused: 0, daily: {} };
      offeringRecordsMap.set(offId, entry);
    }
    if (r.status === "PRESENT") entry.present += 1;
    else if (r.status === "ABSENT") entry.absent += 1;
    else if (r.status === "LATE") entry.late += 1;
    else if (r.status === "EXCUSED") entry.excused += 1;

    if (params.includeDayWise) {
      const dStr = r.session.attendanceDate.toISOString().slice(0, 10);
      let statusLetter: AttendanceDailyStatus = "-";
      if (r.status === "PRESENT") statusLetter = "P";
      else if (r.status === "ABSENT") statusLetter = "A";
      else if (r.status === "LATE") statusLetter = "L";
      else if (r.status === "EXCUSED") statusLetter = "E";
      entry.daily[dStr] = statusLetter;
    }
  }

  let totalClassesAllCourses = 0;
  let sumPercentage = 0;

  const courses: StudentAttendanceReportDTO["courses"] = offerings.map((o) => {
    const totalClasses = sessionMapByOffering.get(o.id)?.length || 0;
    totalClassesAllCourses += totalClasses;
    const rEntry = offeringRecordsMap.get(o.id) || {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      daily: {},
    };

    const attVal = calculateAttendanceValue(totalClasses, rEntry.absent);
    sumPercentage += attVal.percentage;

    const counts = calculateStatusCounts(
      totalClasses,
      rEntry.present,
      rEntry.absent,
      rEntry.late,
      rEntry.excused
    );

    const row: StudentAttendanceReportDTO["courses"][number] = {
      courseOfferingId: o.id,
      courseName: o.course.title,
      courseCode: o.course.code,
      totalClasses,
      attendanceCount: attVal.count,
      attendancePercentage: attVal.percentage,
      attendanceDisplay: attVal.display,
      counts,
    };

    if (params.includeDayWise) {
      row.dailyAttendance = rEntry.daily;
    }
    return row;
  });

  const avgPct =
    courses.length > 0
      ? Math.round((sumPercentage / courses.length) * 10) / 10
      : 0;

  return {
    type: "student-attendance",
    metadata: {
      studentId: student.id,
      studentCode: student.studentId,
      studentName: student.user.name,
      rollNumber: currentEnrollment.rollNumber,
      academicYear: currentEnrollment.academicYear.name,
      trade: currentEnrollment.trade.name,
      tradeCode: currentEnrollment.trade.code,
      semester: currentEnrollment.semester.name,
      shift: currentEnrollment.shift.name,
      section: currentEnrollment.section.name,
      dateRange,
      generatedAt: new Date().toISOString(),
    },
    ...(dayColumns ? { dayColumns } : {}),
    courses,
    summary: {
      totalCourses: courses.length,
      totalClasses: totalClassesAllCourses,
      averageAttendancePercentage: avgPct,
    },
  };
}

/**
 * 3. CourseOffering Complete Assessment Report
 */
export async function generateCourseOfferingAssessmentReport(
  courseOfferingId: string,
  params: MarksReportParams = {}
): Promise<CourseOfferingAssessmentReportDTO> {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: courseOfferingId },
    select: {
      id: true,
      academicYearId: true,
      tradeId: true,
      semesterId: true,
      shiftId: true,
      sectionId: true,
      course: { select: { title: true, code: true } },
      trade: { select: { name: true, code: true } },
      academicYear: { select: { name: true } },
      semester: { select: { name: true } },
      shift: { select: { name: true } },
      section: { select: { name: true } },
      assignments: {
        where: { isActive: true },
        select: { teacher: { select: { user: { select: { name: true } } } } },
        take: 1,
      },
    },
  });

  if (!offering) throw notFound("Course offering not found");

  const dateRange = buildReportDateRange(params.from, params.to);
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from) {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) throw businessRule("Invalid from date");
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) throw businessRule("Invalid to date");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw businessRule("From date cannot be after To date");
  }

  const assessmentWhere: Record<string, unknown> = {
    courseOfferingId,
  };
  if (fromDate || toDate) {
    assessmentWhere.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  const assessments = await prisma.assessment.findMany({
    where: assessmentWhere,
    select: {
      id: true,
      title: true,
      type: true,
      totalMarks: true,
      passMarks: true,
      countsTowardFinal: true,
      dueDate: true,
      createdAt: true,
      marks: {
        select: {
          studentId: true,
          marksObtained: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Enrolled students
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      status: "ACTIVE",
    },
    select: {
      rollNumber: true,
      student: {
        select: {
          id: true,
          studentId: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: { rollNumber: "asc" },
  });

  const typeLabels: Record<string, string> = {
    ASSIGNMENT: "Assignment",
    CLASS_TEST: "Class Test",
    MIDTERM: "Midterm",
    FINAL_EXAM: "Final Exam",
    PRACTICAL: "Practical",
    QUIZ: "Quiz",
    OTHER: "Other",
  };

  const assessmentItemRows: CourseOfferingAssessmentItemRow[] = assessments.map((a) => {
    const validMarks = a.marks.map((m) => m.marksObtained);
    const hasMarks = validMarks.length > 0;
    const avgMarks = hasMarks
      ? Math.round((validMarks.reduce((sum, v) => sum + v, 0) / validMarks.length) * 10) / 10
      : null;
    const avgPct =
      avgMarks !== null && a.totalMarks > 0
        ? Math.round((avgMarks / a.totalMarks) * 1000) / 10
        : null;

    const formattedDate = formatFullDate(a.dueDate || a.createdAt);

    return {
      assessmentId: a.id,
      assessmentName: a.title,
      assessmentType: typeLabels[a.type] || a.type,
      totalMarks: a.totalMarks,
      passMarks: a.passMarks,
      countsTowardFinal: a.countsTowardFinal,
      date: formattedDate,
      averageMarksObtained: avgMarks,
      averagePercentage: avgPct,
      averageMarksDisplay: avgMarks !== null ? `${avgMarks} (${avgPct}%)` : "—",
      highestMarks: hasMarks ? Math.max(...validMarks) : null,
      lowestMarks: hasMarks ? Math.min(...validMarks) : null,
    };
  });

  // Build matrix for students
  const studentRows: CourseOfferingAssessmentStudentMarksRow[] = enrollments.map((en) => {
    const studentMarks: Record<string, {
      marksObtained: number | null;
      totalMarks: number;
      percentage: number | null;
      display: string;
    }> = {};

    let totalObt = 0;
    let totalPoss = 0;

    for (const a of assessments) {
      const markEntry = a.marks.find((m) => m.studentId === en.student.id);
      const obtained = markEntry ? markEntry.marksObtained : null;
      const pct = obtained !== null && a.totalMarks > 0
        ? Math.round((obtained / a.totalMarks) * 1000) / 10
        : null;
      const display = obtained !== null ? `${obtained} (${pct}%)` : "—";

      studentMarks[a.id] = {
        marksObtained: obtained,
        totalMarks: a.totalMarks,
        percentage: pct,
        display,
      };

      if (obtained !== null) {
        totalObt += obtained;
      }
      totalPoss += a.totalMarks;
    }

    const overallPct = totalPoss > 0 ? Math.round((totalObt / totalPoss) * 1000) / 10 : 0;

    return {
      studentId: en.student.id,
      studentCode: en.student.studentId,
      rollNumber: en.rollNumber,
      studentName: en.student.user.name,
      marks: studentMarks,
      totalObtained: totalObt,
      totalPossible: totalPoss,
      overallPercentage: overallPct,
    };
  });

  const teacherName = offering.assignments[0]?.teacher?.user?.name ?? null;
  const context = `${offering.course.code} — ${offering.section.name} (${offering.shift.name})`;

  return {
    type: "course-offering-assessment",
    metadata: {
      courseOfferingId: offering.id,
      courseName: offering.course.title,
      courseCode: offering.course.code,
      trade: offering.trade.name,
      tradeCode: offering.trade.code,
      academicYear: offering.academicYear.name,
      semester: offering.semester.name,
      shift: offering.shift.name,
      section: offering.section.name,
      context,
      teacherName,
      totalAssessments: assessments.length,
      dateRange,
      generatedAt: new Date().toISOString(),
    },
    assessments: assessmentItemRows,
    students: studentRows,
  };
}

/**
 * 4. Student Running-Semester Marks Report
 */
export async function generateStudentSemesterMarksReport(
  studentId: string,
  params: MarksReportParams = {}
): Promise<StudentSemesterMarksReportDTO> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      studentId: true,
      user: { select: { name: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: {
          rollNumber: true,
          academicYearId: true,
          tradeId: true,
          semesterId: true,
          shiftId: true,
          sectionId: true,
          academicYear: { select: { name: true } },
          trade: { select: { name: true, code: true } },
          semester: { select: { name: true } },
          shift: { select: { name: true } },
          section: { select: { name: true } },
        },
        take: 1,
      },
    },
  });

  if (!student) throw notFound("Student not found");
  const currentEnrollment = student.enrollments[0];
  if (!currentEnrollment) {
    throw businessRule("Student has no active running semester enrollment");
  }

  const dateRange = buildReportDateRange(params.from, params.to);
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from) {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) throw businessRule("Invalid from date");
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) throw businessRule("Invalid to date");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw businessRule("From date cannot be after To date");
  }

  // Offerings in student's running semester
  const offerings = await prisma.courseOffering.findMany({
    where: {
      academicYearId: currentEnrollment.academicYearId,
      tradeId: currentEnrollment.tradeId,
      semesterId: currentEnrollment.semesterId,
      shiftId: currentEnrollment.shiftId,
      sectionId: currentEnrollment.sectionId,
      isActive: true,
    },
    select: {
      id: true,
      course: { select: { title: true, code: true } },
      assessments: {
        where: {
          ...(fromDate || toDate
            ? {
                createdAt: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          type: true,
          totalMarks: true,
          passMarks: true,
          countsTowardFinal: true,
          weight: true,
          dueDate: true,
          createdAt: true,
          marks: {
            where: { studentId },
            select: { marksObtained: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { course: { title: "asc" } },
  });

  const typeLabels: Record<string, string> = {
    ASSIGNMENT: "Assignment",
    CLASS_TEST: "Class Test",
    MIDTERM: "Midterm",
    FINAL_EXAM: "Final Exam",
    PRACTICAL: "Practical",
    QUIZ: "Quiz",
    OTHER: "Other",
  };

  let totalAssessmentsCount = 0;

  const courses: StudentSemesterCourseGroup[] = offerings.map((off) => {
    const hasAssessments = off.assessments.length > 0;
    totalAssessmentsCount += off.assessments.length;

    const assessmentItems: StudentSemesterAssessmentItem[] = off.assessments.map((a) => {
      const markEntry = a.marks[0];
      const obtained = markEntry !== undefined ? markEntry.marksObtained : null;
      const pct = obtained !== null && a.totalMarks > 0
        ? Math.round((obtained / a.totalMarks) * 1000) / 10
        : null;
      const display = obtained !== null ? `${obtained} (${pct}%)` : "—";
      const formattedDate = formatFullDate(a.dueDate || a.createdAt);

      return {
        assessmentId: a.id,
        assessmentName: a.title,
        marksObtained: obtained,
        totalMarks: a.totalMarks,
        percentage: pct,
        marksDisplay: display,
        assessmentType: typeLabels[a.type] || a.type,
        countsTowardFinal: a.countsTowardFinal,
        date: formattedDate,
      };
    });

    // Compute final summary using grading service
    let finalSummary = null;
    if (hasAssessments) {
      const gradableItems: GradableAssessment[] = off.assessments.map((a) => ({
        id: a.id,
        totalMarks: a.totalMarks,
        passMarks: a.passMarks,
        countsTowardFinal: a.countsTowardFinal,
        weight: a.weight,
        marksObtained: a.marks[0]?.marksObtained ?? null,
      }));
      const gradeRes = computeFinalGrade(gradableItems);
      finalSummary = {
        totalObtained: gradeRes.totalObtained,
        totalPossible: gradeRes.totalPossible,
        percentage: gradeRes.percentage,
        grade: gradeRes.grade,
        passed: gradeRes.passed,
      };
    }

    return {
      courseOfferingId: off.id,
      courseName: off.course.title,
      courseCode: off.course.code,
      hasAssessments,
      assessments: assessmentItems,
      finalSummary,
    };
  });

  return {
    type: "student-semester-marks",
    metadata: {
      studentId: student.id,
      studentCode: student.studentId,
      studentName: student.user.name,
      rollNumber: currentEnrollment.rollNumber,
      academicYear: currentEnrollment.academicYear.name,
      trade: currentEnrollment.trade.name,
      tradeCode: currentEnrollment.trade.code,
      semester: currentEnrollment.semester.name,
      shift: currentEnrollment.shift.name,
      section: currentEnrollment.section.name,
      totalCourses: courses.length,
      dateRange,
      generatedAt: new Date().toISOString(),
    },
    courses,
    summary: {
      totalCourses: courses.length,
      totalAssessments: totalAssessmentsCount,
    },
  };
}
