/**
 * Shared Report Domain Types & DTOs
 *
 * Rules:
 * - Pure data types, completely decoupled from Prisma, Next.js, HTTP, React, and browser APIs.
 * - Minimal, serializable, frontend-safe, exporter-safe.
 * - No sensitive data (passwords, tokens, cookies, auth metadata, database internal configs).
 */

export interface ReportDateRange {
  from: string | null; // ISO YYYY-MM-DD or null for full period
  to: string | null;   // ISO YYYY-MM-DD or null for full period
  isFullPeriod: boolean;
  displayText: string; // e.g. "Full Period" or "10 April 2026 – 30 December 2026"
}

export interface AttendanceStatusCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  presentPercentage: number;
  absentPercentage: number;
  latePercentage: number;
  excusedPercentage: number;
}

export type AttendanceDailyStatus = "P" | "A" | "L" | "E" | "-";

export interface AttendanceDayColumn {
  date: string;       // ISO YYYY-MM-DD
  headerLabel: string; // e.g. "Wed, 20 Apr"
}

// -------------------------------------------------------------
// 1. CourseOffering Attendance Report
// -------------------------------------------------------------
export interface CourseOfferingAttendanceMetadata {
  courseOfferingId: string;
  courseName: string;
  courseCode: string;
  trade: string;
  tradeCode: string;
  academicYear: string;
  semester: string;
  shift: string;
  section: string;
  context: string;
  teacherName: string | null;
  totalClasses: number;
  dateRange: ReportDateRange;
  generatedAt: string;
}

export interface CourseOfferingAttendanceStudentRow {
  studentId: string;
  rollNumber: number | null;
  studentName: string;
  totalClasses: number;
  attendanceCount: number; // (totalClasses - absent)
  attendancePercentage: number; // (totalClasses - absent) / totalClasses * 100
  attendanceDisplay: string; // e.g. "70 (70%)"
  counts: AttendanceStatusCounts;
  dailyAttendance?: Record<string, AttendanceDailyStatus>; // key: YYYY-MM-DD
}

export interface CourseOfferingAttendanceReportDTO {
  type: "course-offering-attendance";
  metadata: CourseOfferingAttendanceMetadata;
  dayColumns?: AttendanceDayColumn[];
  students: CourseOfferingAttendanceStudentRow[];
  summary: {
    totalStudents: number;
    totalClasses: number;
    averageAttendancePercentage: number;
  };
}

// -------------------------------------------------------------
// 2. Single Student Attendance Report
// -------------------------------------------------------------
export interface StudentAttendanceMetadata {
  studentId: string;
  studentCode: string;
  studentName: string;
  rollNumber: number | null;
  academicYear: string;
  trade: string;
  tradeCode: string;
  semester: string;
  shift: string;
  section: string;
  dateRange: ReportDateRange;
  generatedAt: string;
}

export interface StudentAttendanceCourseRow {
  courseOfferingId: string;
  courseName: string;
  courseCode: string;
  totalClasses: number;
  attendanceCount: number;
  attendancePercentage: number;
  attendanceDisplay: string;
  counts: AttendanceStatusCounts;
  dailyAttendance?: Record<string, AttendanceDailyStatus>; // key: YYYY-MM-DD
}

export interface StudentAttendanceReportDTO {
  type: "student-attendance";
  metadata: StudentAttendanceMetadata;
  dayColumns?: AttendanceDayColumn[];
  courses: StudentAttendanceCourseRow[];
  summary: {
    totalCourses: number;
    totalClasses: number;
    averageAttendancePercentage: number;
  };
}

// -------------------------------------------------------------
// 3. CourseOffering Assessment Report
// -------------------------------------------------------------
export interface CourseOfferingAssessmentMetadata {
  courseOfferingId: string;
  courseName: string;
  courseCode: string;
  trade: string;
  tradeCode: string;
  academicYear: string;
  semester: string;
  shift: string;
  section: string;
  context: string;
  teacherName: string | null;
  totalAssessments: number;
  dateRange: ReportDateRange;
  generatedAt: string;
}

export interface CourseOfferingAssessmentItemRow {
  assessmentId: string;
  assessmentName: string;
  assessmentType: string; // Class Test, Midterm, etc.
  totalMarks: number;
  passMarks: number;
  countsTowardFinal: boolean;
  date: string | null; // Formatted date e.g. "20 August 2026"
  // If the report is viewed for class-level marks or single student
  // In offering assessment report, we can list assessments and student performances
  averageMarksObtained: number | null;
  averagePercentage: number | null;
  averageMarksDisplay: string; // e.g. "25 (50%)" or "—"
  highestMarks: number | null;
  lowestMarks: number | null;
}

export interface CourseOfferingAssessmentStudentMarksRow {
  studentId: string;
  studentCode: string;
  rollNumber: number | null;
  studentName: string;
  marks: Record<string, {
    marksObtained: number | null;
    totalMarks: number;
    percentage: number | null;
    display: string; // "25 (50%)" or "—"
  }>; // key: assessmentId
  totalObtained: number;
  totalPossible: number;
  overallPercentage: number;
}

export interface CourseOfferingAssessmentReportDTO {
  type: "course-offering-assessment";
  metadata: CourseOfferingAssessmentMetadata;
  assessments: CourseOfferingAssessmentItemRow[];
  students: CourseOfferingAssessmentStudentMarksRow[];
}

// -------------------------------------------------------------
// 4. Student Running-Semester Marks Report
// -------------------------------------------------------------
export interface StudentSemesterMarksMetadata {
  studentId: string;
  studentCode: string;
  studentName: string;
  rollNumber: number | null;
  academicYear: string;
  trade: string;
  tradeCode: string;
  semester: string;
  shift: string;
  section: string;
  totalCourses: number;
  dateRange: ReportDateRange;
  generatedAt: string;
}

export interface StudentSemesterAssessmentItem {
  assessmentId: string;
  assessmentName: string;
  marksObtained: number | null;
  totalMarks: number;
  percentage: number | null;
  marksDisplay: string; // "25 (50%)" or "—"
  assessmentType: string;
  countsTowardFinal: boolean;
  date: string | null; // e.g. "20 August 2026"
}

export interface StudentSemesterCourseGroup {
  courseOfferingId: string;
  courseName: string;
  courseCode: string;
  hasAssessments: boolean;
  assessments: StudentSemesterAssessmentItem[];
  finalSummary?: {
    totalObtained: number;
    totalPossible: number;
    percentage: number;
    grade: string;
    passed: boolean;
  } | null;
}

export interface StudentSemesterMarksReportDTO {
  type: "student-semester-marks";
  metadata: StudentSemesterMarksMetadata;
  courses: StudentSemesterCourseGroup[];
  summary: {
    totalCourses: number;
    totalAssessments: number;
  };
}

export type AnyReportDTO =
  | CourseOfferingAttendanceReportDTO
  | StudentAttendanceReportDTO
  | CourseOfferingAssessmentReportDTO
  | StudentSemesterMarksReportDTO;
