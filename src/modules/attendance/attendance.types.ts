// Pure type/constant module so the test suite can import these without
// loading Prisma (which is unavailable in the test sandbox).

export const TEACHER_EDIT_WINDOW_DAYS = 7;
export const TEACHER_DIRECT_CORRECTIONS = 2;

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
export type AttendanceStatusCode = (typeof ATTENDANCE_STATUSES)[number];
/** `NOT_MARKED` is a display-only state for a student with no AttendanceRecord. */
export type AttendanceRowStatus = AttendanceStatusCode | "NOT_MARKED";

export const CHANGE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ChangeRequestStatusCode = (typeof CHANGE_REQUEST_STATUSES)[number];

/**
 * The display status of a change request.
 *
 * The database enum `ChangeRequestStatus` only has PENDING / APPROVED /
 * REJECTED and this feature is explicitly forbidden from touching the schema.
 * A teacher withdrawal is therefore stored as REJECTED plus a machine-readable
 * marker in `reviewNote` (the same technique the
 * `20260918100000_attendance_entry_change_requests` migration used to close
 * superseded pending rows). Nothing is deleted: the request row and every
 * `AttendanceChangeRequestItem` stay intact for auditing, and the freed
 * PENDING slot is what re-enables a new request for the entry.
 */
export type AttendanceRequestDisplayStatus = ChangeRequestStatusCode | "CANCELLED";

export const WITHDRAWN_REQUEST_NOTE =
  "Withdrawn by the requesting teacher before admin review.";

/** True when a REJECTED row is actually a teacher cancellation, not an admin rejection. */
export function isWithdrawnChangeRequest(request: {
  status: string;
  reviewNote?: string | null;
}): boolean {
  return request.status === "REJECTED" && (request.reviewNote ?? "").startsWith(WITHDRAWN_REQUEST_NOTE);
}

export function resolveChangeRequestStatus(request: {
  status: string;
  reviewNote?: string | null;
}): AttendanceRequestDisplayStatus {
  if (isWithdrawnChangeRequest(request)) return "CANCELLED";
  return (CHANGE_REQUEST_STATUSES as readonly string[]).includes(request.status)
    ? (request.status as ChangeRequestStatusCode)
    : "REJECTED";
}

export type AttendanceSessionPermissions = {
  directCorrectionLimit: number;
  correctionsUsed: number;
  correctionCapacityRemaining: number;
  withinEditWindow: boolean;
  canDirectCorrect: boolean;
  canRequestChange: boolean;
  hasPendingChangeRequest: boolean;
};

/**
 * The ONLY authority for what a teacher may do with an attendance entry is the
 * backend. This helper derives the permission object from the stored session
 * counters; the frontend reuses the same shape for rendering but never
 * recomputes a quota of its own.
 */
export function computeAttendancePermissions(input: {
  updateCount: number;
  attendanceDateAgeDays: number;
  canEdit: boolean;
  hasPendingChangeRequest: boolean;
  directCorrectionLimit?: number;
}): AttendanceSessionPermissions {
  const limit = input.directCorrectionLimit ?? TEACHER_DIRECT_CORRECTIONS;
  const correctionsUsed = Math.max(0, Math.floor(input.updateCount));
  const capacityRemaining = Math.max(0, limit - correctionsUsed);
  const withinEditWindow = input.attendanceDateAgeDays <= TEACHER_EDIT_WINDOW_DAYS;
  return {
    directCorrectionLimit: limit,
    correctionsUsed,
    correctionCapacityRemaining: capacityRemaining,
    withinEditWindow,
    canDirectCorrect: input.canEdit && withinEditWindow && capacityRemaining > 0,
    canRequestChange: input.canEdit && capacityRemaining === 0 && !input.hasPendingChangeRequest,
    hasPendingChangeRequest: input.hasPendingChangeRequest,
  };
}

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
  /**
   * Authoritative correction state of the entry, computed server-side from
   * `updateCount`, the session age and the caller's role. Optional because the
   * listing is shared with read-only consumers; when present, the report must
   * render THIS instead of guessing from `updateCount`.
   */
  permissions?: AttendanceSessionPermissions;
  /** Pending approval request of this entry (at most one per entry). */
  pendingChangeRequest?: {
    id: string;
    reason: string;
    status: ChangeRequestStatusCode;
    displayStatus: AttendanceRequestDisplayStatus;
    createdAt: string;
    changeCount: number;
  } | null;
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
  operationId?: string | null;
  requestId?: string | null;
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
  /**
   * `Student.id` primary key. Attendance saves address students by this key
   * (AttendanceRecord.studentId), while `studentId` below is the human roll /
   * admission number for display — the two are different columns in the schema.
   */
  studentPk: string;
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
  /** Present/Absent/Late/Excused counts of the recorded rows. */
  summary?: AttendanceSessionSummary;
};

/**
 * Everything the Take Attendance page needs for one CourseOffering + date, in
 * a single response: the recorded entry, its summary, the authoritative
 * correction state and the pending request (if any).
 */
export type AttendanceEntryState = {
  id: string;
  courseOfferingId: string;
  /** ISO yyyy-mm-dd of the AttendanceSession. */
  attendanceDate: string;
  updateCount: number;
  note: string | null;
  summary: AttendanceSessionSummary;
  /** Complete section roster with the recorded status merged in. */
  roster: AttendanceSessionStudent[];
  permissions: AttendanceSessionPermissions;
  /** The single pending request of this entry, if one exists. */
  pendingChangeRequest: {
    id: string;
    reason: string;
    status: ChangeRequestStatusCode;
    displayStatus: AttendanceRequestDisplayStatus;
    createdAt: string;
    changeCount: number;
  } | null;
};

/** One student-level proposal inside a change request. */
export type AttendanceChangeRequestChange = {
  id: string;
  recordId: string;
  studentId: string;
  rollNumber: number | null;
  studentName: string;
  studentEmail: string;
  oldStatus: AttendanceStatusCode;
  newStatus: AttendanceStatusCode;
};

/** A change request as rendered by the teacher's pending-request dialog. */
export type AttendanceChangeRequestRow = {
  id: string;
  sessionId: string;
  requestedById: string;
  reason: string;
  status: ChangeRequestStatusCode;
  displayStatus: AttendanceRequestDisplayStatus;
  /** True when this REJECTED row is a teacher cancellation, not an admin rejection. */
  withdrawn: boolean;
  changeCount: number;
  /** Server-computed: still PENDING and owned by the caller. The UI never guesses. */
  canCancel: boolean;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  requestedBy: { id: string; name: string; email: string };
  reviewedBy: { id: string; name: string; email: string } | null;
  session: {
    id: string;
    /** ISO yyyy-mm-dd of the AttendanceSession the request targets. */
    attendanceDate: string;
    /** Raw CourseOffering row + relations; labels are derived by the UI helpers. */
    courseOffering?: Record<string, unknown>;
  };
  changes: AttendanceChangeRequestChange[];
};
