// Pure type/constant module so the test suite can import these without
// loading Prisma (which is unavailable in the test sandbox).

export const TEACHER_EDIT_WINDOW_DAYS = 7;
export const TEACHER_DIRECT_CORRECTIONS = 2;

export const DEFAULT_ATTENDANCE_PAGE_SIZE = 20;
export const MAX_ATTENDANCE_PAGE_SIZE = 100;

export type AttendanceSessionSummary = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
};

/**
 * Academic context of the CourseOffering an attendance session belongs to.
 *
 * Both the foreign-key scalars (academicYearId, tradeId, ...) and the resolved
 * relations are part of the payload: the scalar keys are what the server-side
 * queries need for enrollment lookups, while the relations provide the human
 * readable labels. Code must never assume a scalar FK is present unless the
 * query selected it (see `getSessionHistory`).
 */
export type AttendanceOfferingContext = {
  id: string;
  academicYearId: string;
  tradeId: string;
  semesterId: string;
  shiftId: string;
  sectionId: string;
  course: { title: string; code: string };
  section: { name: string };
  semester: { name: string };
  trade: { name: string; code: string };
  shift: { name: string };
  academicYear: { name: string };
};

export type AttendanceReportItem = {
  id: string;
  courseOfferingId: string;
  /** ISO yyyy-mm-dd. */
  attendanceDate: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  summary: AttendanceSessionSummary;
  /**
   * Number of edit operations (saves / approved change requests) that changed
   * at least one record AFTER the session was created. Initial creation is
   * excluded, and one save touching many students counts as ONE update.
   */
  updateCount: number;
};

export type AttendanceHistoryEntry = {
  id: string;
  recordId: string;
  oldStatus: string | null;
  newStatus: string;
  reason: string;
  timestamp: string;
  changedBy: { id: string; name: string; email: string; role: string };
  changeType: "INITIAL_ENTRY" | "CORRECTION";
  viaApproval: boolean;
  relatedChangeRequest: null | {
    id: string;
    status: string;
    requestedBy: { id: string; name: string; role: string };
    reviewedBy: { id: string; name: string; role: string } | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  };
};

export type AttendanceHistoryStudent = {
  recordId: string;
  studentId: string;
  /** Roll within the offering's section (from enrollment). Null if unresolved. */
  rollNumber: number | null;
  name: string;
  email: string;
  currentStatus: string;
  directCorrections: number;
};

export type AttendanceHistoryPayload = {
  session: {
    id: string;
    attendanceDate: string;
    courseOffering: AttendanceOfferingContext;
  };
  students: AttendanceHistoryStudent[];
  history: AttendanceHistoryEntry[];
};

/** One student row of the Student Status view for a single session. */
export type AttendanceSessionStudent = {
  /** AttendanceRecord id, or null when the student has no record yet. */
  id: string | null;
  rollNumber: number | null;
  studentId: string;
  studentName: string;
  studentEmail: string;
  /** AttendanceStatus, or NOT_MARKED when the student has no record yet. */
  status: string;
  hasRecord: boolean;
  note: string | null;
  directCorrections: number;
};

export type AttendanceSessionRosterPayload = {
  session: {
    id: string;
    attendanceDate: string;
    courseOffering: AttendanceOfferingContext;
  };
  /** Every ACTIVE student of the offering's section, ordered by roll. */
  records: AttendanceSessionStudent[];
};
