import { describe, expect, it } from "vitest";

import {
  buildChangeRequestPayload,
  buildCorrectionSavePayload,
  buildNewSessionPayload,
  buildProposedChanges,
  canCancelChangeRequest,
  changedStudentCount,
  groupChangesByTransition,
  resolveAttendanceView,
  resolveCorrectionAction,
  type RecordedAttendanceRow,
} from "@/modules/attendance/attendance-corrections";
import {
  WITHDRAWN_REQUEST_NOTE,
  computeAttendancePermissions,
  isWithdrawnChangeRequest,
  resolveChangeRequestStatus,
  type AttendanceSessionPermissions,
} from "@/modules/attendance/attendance.types";

/**
 * The rules the Take Attendance page and its confirmation dialog follow.
 *
 * These are the pure decision functions the components call — the dialog content
 * (complete change list, reason only when required) and the payloads that get
 * submitted are derived here, so the behavior is pinned without a browser.
 * None of it computes a quota: `permissions` always comes from the backend.
 */

function row(overrides: Partial<RecordedAttendanceRow> = {}): RecordedAttendanceRow {
  return {
    id: "rec-1",
    studentPk: "stu-1",
    rollNumber: 1,
    studentId: "R1",
    studentName: "Rahim",
    status: "PRESENT",
    hasRecord: true,
    ...overrides,
  };
}

const PERMISSIONS = (overrides: Partial<AttendanceSessionPermissions> = {}): AttendanceSessionPermissions => ({
  directCorrectionLimit: 2,
  correctionsUsed: 0,
  correctionCapacityRemaining: 2,
  withinEditWindow: true,
  canDirectCorrect: true,
  canRequestChange: false,
  hasPendingChangeRequest: false,
  ...overrides,
});

describe("buildProposedChanges — the dialog's change list", () => {
  it("lists every student whose draft differs from the recorded entry", () => {
    const rows = [
      row(),
      row({ id: "rec-2", studentPk: "stu-2", rollNumber: 2, studentId: "R2", studentName: "Karim", status: "ABSENT" }),
      row({ id: "rec-3", studentPk: "stu-3", rollNumber: 3, studentId: "R3", studentName: "Ayna", status: "LATE" }),
    ];

    const changes = buildProposedChanges(rows, { "stu-1": "ABSENT", "stu-2": "PRESENT", "stu-3": "LATE" } as never);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ recordId: "rec-1", studentName: "Rahim", rollNumber: 1, oldStatus: "PRESENT", newStatus: "ABSENT" });
    expect(changes[1]).toMatchObject({ recordId: "rec-2", oldStatus: "ABSENT", newStatus: "PRESENT" });
    expect(changedStudentCount(changes)).toBe(2);
  });

  it("keeps the complete multi-student list (never truncates to the first row)", () => {
    const rows = Array.from({ length: 12 }, (_unused, index) =>
      row({ id: `rec-${index}`, studentPk: `stu-${index}`, rollNumber: index + 1, status: "PRESENT" }),
    );
    const draft: Record<string, "ABSENT"> = {};
    for (const entry of rows) draft[entry.studentPk] = "ABSENT";

    expect(buildProposedChanges(rows, draft)).toHaveLength(12);
  });

  it("ignores unchanged rows, unknown statuses and students without a record", () => {
    const rows = [
      row(),
      row({ id: null, studentPk: "stu-9", status: "NOT_MARKED", hasRecord: false }),
      row({ id: "rec-5", studentPk: "stu-5", status: "PRESENT" }),
    ];

    const changes = buildProposedChanges(rows, { "stu-5": "PRESENT", "stu-9": "ABSENT" } as never);

    expect(changes).toEqual([]);
  });

  it("groups the list by transition for the dialog summary", () => {
    const rows = [
      row({ id: "rec-1", studentPk: "stu-1" }),
      row({ id: "rec-2", studentPk: "stu-2", status: "ABSENT" }),
      row({ id: "rec-3", studentPk: "stu-3", status: "ABSENT" }),
    ];
    const changes = buildProposedChanges(rows, {
      "stu-1": "ABSENT",
      "stu-2": "PRESENT",
      "stu-3": "EXCUSED",
    } as never);

    const groups = groupChangesByTransition(changes);

    // Largest group first, then alphabetical — stable ordering for the chips.
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["ABSENT → EXCUSED", 1],
      ["ABSENT → PRESENT", 1],
      ["PRESENT → ABSENT", 1],
    ]);
  });
});

describe("resolveCorrectionAction — what saving an existing entry means", () => {
  it("does nothing when the draft matches the entry", () => {
    expect(resolveCorrectionAction(PERMISSIONS(), 0)).toEqual({ kind: "nothing", requiresReason: false });
  });

  it("saves directly while the backend says capacity remains — no reason required", () => {
    expect(resolveCorrectionAction(PERMISSIONS({ correctionCapacityRemaining: 1, correctionsUsed: 1 }), 3)).toEqual({
      kind: "direct",
      requiresReason: false,
    });
  });

  it("requires a reason only on the approval path", () => {
    const exhausted = PERMISSIONS({
      correctionsUsed: 2,
      correctionCapacityRemaining: 0,
      canDirectCorrect: false,
      canRequestChange: true,
    });

    expect(resolveCorrectionAction(exhausted, 2)).toEqual({ kind: "request", requiresReason: true });
  });

  it("blocks while a request is pending, even if changes are prepared", () => {
    const blocked = PERMISSIONS({
      correctionsUsed: 2,
      correctionCapacityRemaining: 0,
      canDirectCorrect: false,
      canRequestChange: false,
      hasPendingChangeRequest: true,
    });

    expect(resolveCorrectionAction(blocked, 4)).toMatchObject({ kind: "blocked", reason: "PENDING_REQUEST", requiresReason: false });
  });

  it("blocks outside the edit window", () => {
    const closed = PERMISSIONS({ withinEditWindow: false, canDirectCorrect: false, canRequestChange: false });

    expect(resolveCorrectionAction(closed, 1)).toMatchObject({ kind: "blocked", reason: "EDIT_WINDOW_CLOSED" });
  });

  it("blocks when the backend gave no permissions at all", () => {
    expect(resolveCorrectionAction(undefined, 1)).toMatchObject({ kind: "blocked", reason: "NO_PERMISSION" });
  });

  it("mirrors the backend permission computation (no second quota implementation)", () => {
    const server = computeAttendancePermissions({ updateCount: 2, attendanceDateAgeDays: 1, canEdit: true, hasPendingChangeRequest: false });

    expect(resolveCorrectionAction(server, 1)).toEqual({ kind: "request", requiresReason: true });
  });
});

describe("payload builders", () => {
  it("sends a create-only payload when the date has no entry yet", () => {
    const payload = buildNewSessionPayload({
      courseOfferingId: "off-1",
      attendanceDate: "2026-09-18",
      students: [
        { studentPk: "stu-1", status: "PRESENT" },
        { studentPk: "stu-2", status: "ABSENT" },
      ],
    });

    expect(payload).toMatchObject({
      courseOfferingId: "off-1",
      mode: "create",
      records: [
        { studentId: "stu-1", status: "PRESENT" },
        { studentId: "stu-2", status: "ABSENT" },
      ],
    });
    // Calendar day anchored at UTC midnight, matching the server's day arithmetic.
    expect(payload.attendanceDate).toBe("2026-09-18T00:00:00.000Z");
  });

  it("sends mode=edit for a correction and only rows that exist in the entry", () => {
    const payload = buildCorrectionSavePayload({
      courseOfferingId: "off-1",
      attendanceDate: "2026-09-18",
      rows: [row(), row({ id: null, studentPk: "stu-9", status: "NOT_MARKED", hasRecord: false })],
      draft: { "stu-1": "LATE", "stu-9": "PRESENT" } as never,
    });

    expect(payload.mode).toBe("edit");
    expect(payload.records).toEqual([{ studentId: "stu-1", status: "LATE" }]);
  });

  it("submits one entry-level request containing the whole change set", () => {
    const changes = buildProposedChanges([row(), row({ id: "rec-2", studentPk: "stu-2", status: "ABSENT" })], {
      "stu-1": "ABSENT",
      "stu-2": "PRESENT",
    } as never);

    const payload = buildChangeRequestPayload("sess-1", changes, "  Register was mis-copied  ");

    expect(payload).toEqual({
      sessionId: "sess-1",
      reason: "Register was mis-copied",
      changes: [
        { recordId: "rec-1", newStatus: "ABSENT" },
        { recordId: "rec-2", newStatus: "PRESENT" },
      ],
    });
  });
});

describe("request status + cancellation eligibility", () => {
  it("maps the frozen schema's REJECTED + marker back to CANCELLED", () => {
    expect(resolveChangeRequestStatus({ status: "PENDING" })).toBe("PENDING");
    expect(resolveChangeRequestStatus({ status: "APPROVED" })).toBe("APPROVED");
    expect(resolveChangeRequestStatus({ status: "REJECTED", reviewNote: "Not supported" })).toBe("REJECTED");
    expect(resolveChangeRequestStatus({ status: "REJECTED", reviewNote: WITHDRAWN_REQUEST_NOTE })).toBe("CANCELLED");
    expect(isWithdrawnChangeRequest({ status: "REJECTED", reviewNote: `${WITHDRAWN_REQUEST_NOTE} extra words` })).toBe(true);
    expect(isWithdrawnChangeRequest({ status: "PENDING", reviewNote: WITHDRAWN_REQUEST_NOTE })).toBe(false);
  });

  it("only the owner may cancel, and only while pending", () => {
    const pending = { id: "req-1", status: "PENDING", requestedById: "teacher-1" };

    expect(canCancelChangeRequest(pending, "teacher-1")).toBe(true);
    expect(canCancelChangeRequest(pending, "teacher-2")).toBe(false);
    expect(canCancelChangeRequest(pending, undefined)).toBe(false);
    expect(canCancelChangeRequest({ ...pending, status: "APPROVED" }, "teacher-1")).toBe(false);
    expect(canCancelChangeRequest({ ...pending, status: "REJECTED", reviewNote: WITHDRAWN_REQUEST_NOTE }, "teacher-1")).toBe(false);
  });

  it("a server-computed canCancel flag is what the UI renders", () => {
    // The dialog hides the action for rows the backend says are not cancellable;
    // it never re-derives ownership from the local user object.
    expect(canCancelChangeRequest({ id: "req-1", status: "PENDING", requestedById: "teacher-1" }, "teacher-1")).toBe(true);
  });
});

describe("resolveAttendanceView — recorded attendance instead of a link", () => {
  it("shows the create form only while no entry exists for the date", () => {
    expect(resolveAttendanceView({ loading: false, hasEntry: false, editing: false })).toBe("create");
  });

  it("never guesses 'no entry' while the state is loading (that is how duplicates appear)", () => {
    expect(resolveAttendanceView({ loading: true, hasEntry: false, editing: false })).toBe("loading");
  });

  it("displays the recorded entry when one exists, and only edits on request", () => {
    expect(resolveAttendanceView({ loading: false, hasEntry: true, editing: false })).toBe("recorded");
    expect(resolveAttendanceView({ loading: false, hasEntry: true, editing: true })).toBe("editing");
  });

  it("falls back to the recorded view once loading finished with an entry", () => {
    expect(resolveAttendanceView({ loading: true, hasEntry: true, editing: false })).toBe("recorded");
  });
});
