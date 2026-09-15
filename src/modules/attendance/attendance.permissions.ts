// Pure attendance permission matrix — no Prisma imports so unit tests can
// exercise the role rules without a database.
//
// Business rule summary:
//   Teacher takes and edits attendance (within quota/rules).
//   Admin does NOT take or directly edit attendance.
//   Admin only monitors attendance and approves/rejects change requests.

export type AttendanceRole = "ADMIN" | "TEACHER" | "STUDENT";

export type AttendanceAction =
  | "viewSessions"
  | "viewStudentData"
  | "viewHistory"
  | "takeAttendance"
  | "editAttendance"
  | "requestChange"
  | "approveChange"
  | "rejectChange";

const MATRIX: Record<AttendanceAction, Record<AttendanceRole, boolean>> = {
  // View attendance sessions
  viewSessions: { ADMIN: true, TEACHER: true, STUDENT: false },
  // View student attendance data
  viewStudentData: { ADMIN: true, TEACHER: true, STUDENT: false },
  // View attendance history
  viewHistory: { ADMIN: true, TEACHER: true, STUDENT: false },
  // Take attendance (operational, teacher-only)
  takeAttendance: { ADMIN: false, TEACHER: true, STUDENT: false },
  // Edit attendance directly (teacher-only, within quota)
  editAttendance: { ADMIN: false, TEACHER: true, STUDENT: false },
  // Submit an attendance change request when quota is reached
  requestChange: { ADMIN: false, TEACHER: true, STUDENT: false },
  // Approve / reject attendance change requests (admin-only)
  approveChange: { ADMIN: true, TEACHER: false, STUDENT: false },
  rejectChange: { ADMIN: true, TEACHER: false, STUDENT: false },
};

/** Pure matrix lookup. API routes must still verify teacher assignment (IDOR). */
export function canPerform(action: AttendanceAction, role: AttendanceRole): boolean {
  return MATRIX[action]?.[role] ?? false;
}

export const canViewSessions = (role: AttendanceRole) => canPerform("viewSessions", role);
export const canViewStudentData = (role: AttendanceRole) => canPerform("viewStudentData", role);
export const canViewHistory = (role: AttendanceRole) => canPerform("viewHistory", role);
export const canTakeAttendance = (role: AttendanceRole) => canPerform("takeAttendance", role);
export const canEditAttendance = (role: AttendanceRole) => canPerform("editAttendance", role);
export const canRequestChange = (role: AttendanceRole) => canPerform("requestChange", role);
export const canApproveChange = (role: AttendanceRole) => canPerform("approveChange", role);
export const canRejectChange = (role: AttendanceRole) => canPerform("rejectChange", role);

/**
 * Frontend roll-number filter (pure, case/format tolerant).
 * Trims whitespace and matches substring on the stringified roll.
 */
export function filterByRoll<T extends { rollNumber: number | string | null | undefined }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if (r.rollNumber === null || r.rollNumber === undefined) return false;
    return String(r.rollNumber).toLowerCase().includes(q);
  });
}
