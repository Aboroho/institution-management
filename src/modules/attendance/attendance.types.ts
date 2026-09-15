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
  name: string;
  email: string;
  currentStatus: string;
  directCorrections: number;
};

export type AttendanceHistoryPayload = {
  session: {
    id: string;
    attendanceDate: string;
    courseOffering: { id: string; course: { title: string; code: string }; section: { name: string } };
  };
  students: AttendanceHistoryStudent[];
  history: AttendanceHistoryEntry[];
};
