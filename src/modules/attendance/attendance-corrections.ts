// Pure attendance-correction helpers shared by the Take Attendance editor, the
// correction dialog and the pending-request dialog.
//
// IMPORTANT: nothing in here computes a correction quota. The only authority for
// "may this teacher still correct directly / must they ask for approval" is the
// backend `permissions` object (derived from AttendanceSession.updateCount in
// `computeAttendancePermissions`). These functions merely map that state onto
// UI operations, so the frontend can never invent a second, conflicting rule.

import {
  ATTENDANCE_STATUSES,
  TEACHER_EDIT_WINDOW_DAYS,
  isWithdrawnChangeRequest,
  type AttendanceRowStatus,
  type AttendanceSessionPermissions,
  type AttendanceStatusCode,
} from "./attendance.types";

export type { AttendanceStatusCode };

export const isAttendanceStatus = (value: unknown): value is AttendanceStatusCode =>
  (ATTENDANCE_STATUSES as readonly unknown[]).includes(value);

/** Minimal roster row shape the diff needs (structurally compatible with the API payload). */
export type RecordedAttendanceRow = {
  /** AttendanceRecord id, null when the student has no record for this entry. */
  id: string | null;
  studentPk: string;
  rollNumber: number | null;
  studentId: string;
  studentName: string;
  status: string;
  hasRecord: boolean;
};

/** A single student-level difference between the recorded entry and the draft. */
export type ProposedAttendanceChange = {
  recordId: string;
  studentPk: string;
  rollNumber: number | null;
  studentId: string;
  studentName: string;
  oldStatus: AttendanceStatusCode;
  newStatus: AttendanceStatusCode;
};

/**
 * Diff the draft against the RECORDED statuses.
 *
 * Only students that already have an AttendanceRecord can produce a correction:
 * an unmarked student of a new entry is handled by the create flow, not here.
 * Rows whose draft equals the recorded status are dropped, which is what keeps
 * "Save" honest — an unchanged edit session submits nothing.
 */
export function buildProposedChanges(
  rows: RecordedAttendanceRow[],
  draft: Record<string, AttendanceRowStatus>,
): ProposedAttendanceChange[] {
  const changes: ProposedAttendanceChange[] = [];
  for (const row of rows) {
    if (!row.hasRecord || !row.id) continue;
    if (!isAttendanceStatus(row.status)) continue;
    const proposed = draft[row.studentPk];
    if (!isAttendanceStatus(proposed)) continue;
    if (proposed === row.status) continue;
    changes.push({
      recordId: row.id,
      studentPk: row.studentPk,
      rollNumber: row.rollNumber,
      studentId: row.studentId,
      studentName: row.studentName,
      oldStatus: row.status,
      newStatus: proposed,
    });
  }
  return changes;
}

/** Count of students that will actually change (the dialog's headline number). */
export const changedStudentCount = (changes: ProposedAttendanceChange[]): number => changes.length;

/**
 * Changes grouped by transition label for the compact "PRESENT → ABSENT x2"
 * summary above the detailed list.
 */
export function groupChangesByTransition(
  // Statuses are strings (not the enum) because the same grouping is used for a
  // local draft diff and for proposals loaded from a stored request.
  changes: Array<{ oldStatus: string; newStatus: string }>,
): {
  label: string;
  oldStatus: string;
  newStatus: string;
  count: number;
}[] {
  const buckets = new Map<string, { label: string; oldStatus: string; newStatus: string; count: number }>();
  for (const change of changes) {
    const key = `${change.oldStatus}->${change.newStatus}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { label: `${change.oldStatus} → ${change.newStatus}`, oldStatus: change.oldStatus, newStatus: change.newStatus, count: 1 });
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type CorrectionAction =
  /** Draft is identical to the recorded entry — nothing to submit. */
  | { kind: "nothing"; requiresReason: false }
  /** Backend still allows a direct correction; no approval, no mandatory reason. */
  | { kind: "direct"; requiresReason: false }
  /** Correction capacity is exhausted: one request for the whole entry + reason. */
  | { kind: "request"; requiresReason: true }
  /** Neither path is open (edit window closed, request pending, or not permitted). */
  | { kind: "blocked"; requiresReason: false; reason: BlockedReason };

export type BlockedReason = "NO_PERMISSION" | "EDIT_WINDOW_CLOSED" | "PENDING_REQUEST";

const BLOCKED_MESSAGES: Record<BlockedReason, string> = {
  NO_PERMISSION: "You are not allowed to change this attendance entry.",
  EDIT_WINDOW_CLOSED: `The ${TEACHER_EDIT_WINDOW_DAYS}-day teacher edit window has closed for this attendance entry, so neither a direct correction nor an approval request can be submitted.`,
  PENDING_REQUEST: "This attendance entry already has a request awaiting admin review. Cancel that request first, or wait for the decision.",
};

export const blockedMessage = (reason: BlockedReason): string => BLOCKED_MESSAGES[reason];

/**
 * Which operation the Save button performs. Straight mapping of the backend
 * permission flags — no local counters, no "half" the rule implemented twice.
 */
export function resolveCorrectionAction(
  permissions: AttendanceSessionPermissions | undefined,
  changeCount: number,
): CorrectionAction {
  if (changeCount === 0) return { kind: "nothing", requiresReason: false };
  if (!permissions) return { kind: "blocked", requiresReason: false, reason: "NO_PERMISSION" };
  if (permissions.hasPendingChangeRequest) {
    return { kind: "blocked", requiresReason: false, reason: "PENDING_REQUEST" };
  }
  if (permissions.canDirectCorrect) return { kind: "direct", requiresReason: false };
  if (permissions.canRequestChange) return { kind: "request", requiresReason: true };
  if (!permissions.withinEditWindow) {
    return { kind: "blocked", requiresReason: false, reason: "EDIT_WINDOW_CLOSED" };
  }
  return { kind: "blocked", requiresReason: false, reason: "NO_PERMISSION" };
}

/**
 * Which view the Take Attendance page renders. Extracted from the component so
 * the rule "show the create form ONLY when no entry exists; otherwise show the
 * recorded attendance" is pinned by a test instead of living in JSX.
 *
 *   loading   - the entry state has not arrived yet (the page must not guess
 *               "no entry": guessing is what produced duplicate sessions on
 *               slow networks)
 *   create    - no session for this offering + date
 *   recorded  - a session exists: show its statuses, summary and context
 *   editing   - a session exists and the teacher activated the correction form
 */
export type AttendanceView = "loading" | "create" | "recorded" | "editing";

export function resolveAttendanceView(opts: { loading: boolean; hasEntry: boolean; editing: boolean }): AttendanceView {
  if (opts.loading && !opts.hasEntry) return "loading";
  if (!opts.hasEntry) return "create";
  return opts.editing ? "editing" : "recorded";
}

export type ChangeRequestLike = {
  id: string;
  status: string;
  reviewNote?: string | null;
  requestedById?: string;
};

/**
 * A teacher may withdraw only their own request while it is still PENDING.
 * A withdrawn row is stored as REJECTED + marker, so it must not be cancellable
 * twice. The backend repeats this check (plus the atomic status guard).
 */
export function canCancelChangeRequest(request: ChangeRequestLike, actorUserId: string | undefined): boolean {
  if (request.status !== "PENDING") return false;
  if (isWithdrawnChangeRequest(request)) return false;
  if (!actorUserId) return false;
  return request.requestedById === undefined || request.requestedById === actorUserId;
}

/** Payload for POST /attendance/change-requests (entry level, never per student). */
export function buildChangeRequestPayload(
  sessionId: string,
  changes: ProposedAttendanceChange[],
  reason: string,
): { sessionId: string; reason: string; changes: { recordId: string; newStatus: AttendanceStatusCode }[] } {
  return {
    sessionId,
    reason: reason.trim(),
    changes: changes.map((change) => ({ recordId: change.recordId, newStatus: change.newStatus })),
  };
}

/**
 * Payload for POST /attendance/sessions when NO entry exists yet.
 *
 * `mode: "create"` is the contract that protects the unique
 * (courseOfferingId, attendanceDate) constraint: the backend refuses to
 * silently edit a session that appeared while the form was open and answers
 * 409 instead, so a double submit can never duplicate or overwrite an entry.
 */
export function buildNewSessionPayload(opts: {
  courseOfferingId: string;
  attendanceDate: string;
  students: { studentPk: string; status: AttendanceStatusCode }[];
}): {
  courseOfferingId: string;
  attendanceDate: string;
  mode: "create";
  records: { studentId: string; status: AttendanceStatusCode }[];
} {
  return {
    courseOfferingId: opts.courseOfferingId,
    attendanceDate: new Date(`${opts.attendanceDate}T00:00:00.000Z`).toISOString(),
    mode: "create",
    records: opts.students.map((student) => ({ studentId: student.studentPk, status: student.status })),
  };
}

/** Payload for POST /attendance/sessions (mode=edit) from a draft of the whole entry. */
export function buildCorrectionSavePayload(opts: {
  courseOfferingId: string;
  attendanceDate: string;
  rows: RecordedAttendanceRow[];
  draft: Record<string, AttendanceRowStatus>;
}): {
  courseOfferingId: string;
  attendanceDate: string;
  mode: "edit";
  records: { studentId: string; status: AttendanceStatusCode }[];
} {
  // Only students that already have an AttendanceRecord may appear in an edit:
  // the backend rejects a save that would insert a record into an existing
  // entry (the roster may have changed since it was taken), so sending an
  // unmarked student would fail the WHOLE operation.
  const records = opts.rows
    .filter((row) => row.hasRecord && row.id)
    .map((row) => ({ studentId: row.studentPk, status: opts.draft[row.studentPk] }))
    .filter((entry): entry is { studentId: string; status: AttendanceStatusCode } => isAttendanceStatus(entry.status));
  return {
    courseOfferingId: opts.courseOfferingId,
    // Attendance dates are calendar days; anchor them at UTC midnight so the
    // server's startOfDay() sees the same day the teacher picked.
    attendanceDate: new Date(`${opts.attendanceDate}T00:00:00.000Z`).toISOString(),
    mode: "edit" as const,
    records,
  };
}
