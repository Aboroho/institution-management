"use client";

/**
 * Attendance editor for one CourseOffering and one calendar date.
 *
 * Three states, all on this page (the teacher never has to jump to the report
 * just to read what was already recorded):
 *
 *   1. no session for the date   → the create form (roster + statuses + Save).
 *   2. session, not editing      → the RECORDED attendance: roll, name, status
 *                                  per student, plus the summary, the date and
 *                                  the offering context.
 *   3. session, editing          → the same roster with editable controls, a
 *                                  live change list, and the correction dialog.
 *
 * Creating is deliberately create-only: if a session exists (or appears while
 * the form is open) the backend answers 409 instead of writing a second entry —
 * the unique (courseOfferingId, attendanceDate) constraint stays the authority.
 *
 * All correction state (capacity used / remaining, edit window, whether a
 * request is pending, what the teacher may do) comes from the backend
 * `permissions` object. This file never counts corrections itself.
 *
 * Light theme only, on purpose: the app has no dark mode, and the previous
 * `dark:` variants here are what made this page look like another product.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Badge, Button, buttonClass, Card, EmptyState, ErrorState, CardListSkeleton, Spinner, cn,
} from "@/components/ui";
import {
  Ban, Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, History, PencilLine, Save,
  Send, Users,
} from "lucide-react";
import { get, post, ApiError } from "@/lib/api/client";
import { CourseOfferingBanner, offeringContextLabel } from "@/components/course-offering-context";
import {
  buildChangeRequestPayload,
  buildCorrectionSavePayload,
  buildNewSessionPayload,
  resolveAttendanceView,
  buildProposedChanges,
  resolveCorrectionAction,
  type ProposedAttendanceChange,
} from "@/modules/attendance/attendance-corrections";
import type { AttendanceEntryState, AttendanceStatusCode, AttendanceSessionStudent } from "@/modules/attendance/attendance.types";
import {
  ATTENDANCE_STATUSES, AttendanceStatusOption, AttendanceStatusPill, AttendanceSummaryChips, isAttendanceStatusCode,
} from "./attendance-status";
import { AttendanceCorrectionDialog, type CorrectionDialogMode } from "./attendance-correction-dialog";
import { AttendancePendingRequestsDialog } from "./attendance-pending-requests-dialog";
import { useAttendanceChangeRequests } from "./use-attendance-change-requests";
import { AttendanceDateBadge, monthYearLabel, weekdayName } from "./date-display";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const pad2 = (value: number) => String(value).padStart(2, "0");

const todayStr = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

/** Calendar-day arithmetic in UTC, matching how the server stores attendance dates. */
const shiftDate = (dateString: string, delta: number) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return todayStr();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

export function AttendanceTakeForm({
  offeringId,
  offering,
  initialDate,
  lockDate = false,
  backHref,
  backLabel,
  reportHref,
}: {
  offeringId: string;
  offering?: Row;
  initialDate?: string;
  /** Report "Edit" deep link: the date is fixed, only the entry is edited. */
  lockDate?: boolean;
  backHref?: string;
  backLabel?: string;
  reportHref?: string;
}) {
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [draft, setDraft] = useState<Record<string, AttendanceStatusCode>>({});
  const [editing, setEditing] = useState(lockDate);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<CorrectionDialogMode>("direct");
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  // Changing the date must never carry a half-typed draft, a stale message or an
  // open correction dialog over to the other day.
  useEffect(() => {
    setDraft({});
    setMessage("");
    setErrorMessage("");
    setDialogOpen(false);
    setEditing(lockDate);
  }, [date, lockDate]);

  const { data: offeringData, error: offeringError, isLoading: offeringLoading } = useSWR(
    offering ? null : `off-${offeringId}`,
    () => get<Row>(`/course-offerings/${offeringId}`).then((response) => response.data),
  );
  const resolvedOffering = offering ?? offeringData;

  // The single source of truth for "does an entry exist for this date, and what
  // is recorded in it" — including the correction state and the pending request.
  const {
    data: entry,
    error: entryError,
    isLoading: entryLoading,
    mutate: mutateEntry,
  } = useSWR<AttendanceEntryState | null>(
    `t-att-${offeringId}-${date}`,
    () => get<AttendanceEntryState | null>(`/attendance/sessions?courseOfferingId=${encodeURIComponent(offeringId)}&date=${date}`).then((response) => response.data),
  );

  // Pending-request count for the badge. Same endpoint (and same SWR key) as the
  // dialog, so the two can never disagree after a cancel.
  const { pendingCount } = useAttendanceChangeRequests({ courseOfferingId: offeringId, status: "PENDING" });

  const roster = useMemo<AttendanceSessionStudent[]>(() => entry?.roster ?? [], [entry]);
  const permissions = entry?.permissions;
  const hasSession = Boolean(entry?.id);
  const createStudents = useMemo(() => (resolvedOffering?.students as Row[] | undefined) ?? [], [resolvedOffering]);
  const contextLabel = resolvedOffering ? offeringContextLabel(resolvedOffering) : undefined;

  /** Recorded status of a student in the existing entry (read-only view). */
  const recordedStatus = (row: AttendanceSessionStudent): AttendanceStatusCode =>
    isAttendanceStatusCode(row.status) ? row.status : "PRESENT";

  const draftStatus = useCallback(
    (row: AttendanceSessionStudent): AttendanceStatusCode => draft[row.studentPk] ?? recordedStatus(row),
    [draft],
  );

  /** Create-mode draft, defaulting every student to PRESENT (existing behaviour). */
  const createStatus = useCallback(
    (studentPk: string): AttendanceStatusCode => {
      const value = draft[studentPk];
      return isAttendanceStatusCode(value) ? value : "PRESENT";
    },
    [draft],
  );

  /** Which of the three states the page renders (see resolveAttendanceView). */
  const view = resolveAttendanceView({ loading: entryLoading && entry === undefined, hasEntry: hasSession, editing });

  const changes: ProposedAttendanceChange[] = useMemo(
    () => (hasSession ? buildProposedChanges(roster, draft) : []),
    [hasSession, roster, draft],
  );

  const createSummary = useMemo(() => {
    const counts = { total: createStudents.length, present: 0, absent: 0, late: 0, excused: 0 };
    for (const student of createStudents) {
      const status = createStatus(str(student.id));
      if (status === "PRESENT") counts.present += 1;
      else if (status === "ABSENT") counts.absent += 1;
      else if (status === "LATE") counts.late += 1;
      else counts.excused += 1;
    }
    return counts;
  }, [createStudents, createStatus]);

  function setStatus(studentKey: string, status: AttendanceStatusCode) {
    setDraft((current) => ({ ...current, [studentKey]: status }));
    setMessage("");
    setErrorMessage("");
  }

  function markAllPresent() {
    const next: Record<string, AttendanceStatusCode> = {};
    for (const student of createStudents) next[str(student.id)] = "PRESENT";
    setDraft(next);
    setMessage("");
  }

  function beginEdit() {
    setEditing(true);
    setDraft({});
    setMessage("");
    setErrorMessage("");
  }

  function stopEdit() {
    setEditing(false);
    setDraft({});
    setDialogOpen(false);
    setErrorMessage("");
  }

  /**
   * Save from the existing-entry view. The operation (direct correction vs
   * approval request) is decided by the backend permission state, never by a
   * client-side guess; the mutation itself only runs after the dialog confirms.
   */
  function attemptCorrectionSave() {
    if (changes.length === 0) {
      setMessage("No attendance changes to save — every status still matches the recorded entry.");
      return;
    }
    const action = resolveCorrectionAction(permissions, changes.length);
    if (action.kind === "blocked") {
      setErrorMessage(blockedText(action.reason, permissions));
      return;
    }
    setDialogMode(action.kind === "request" ? "request" : "direct");
    setDialogOpen(true);
  }

  async function confirmCorrection(reason: string) {
    if (submitting) return; // guard against double clicks / Enter repeat
    setSubmitting(true);
    setErrorMessage("");
    try {
      if (dialogMode === "request") {
        await post("/attendance/change-requests", buildChangeRequestPayload(str(entry?.id), changes, reason));
        setMessage("Your request was submitted for admin approval with all proposed changes. The attendance entry is unchanged until an admin decides.");
      } else {
        // Only students who ALREADY have a record in this entry can be corrected.
        // A student enrolled after the entry was saved shows as NOT_MARKED and is
        // left to the backend's duplicate-session/roster rules (see saveSession).
        const payload = buildCorrectionSavePayload({
          courseOfferingId: offeringId,
          attendanceDate: date,
          rows: roster.filter((row) => row.hasRecord),
          draft,
        });
        const response = await post<{ updatedCount: number }>(`/attendance/sessions`, { ...payload, reason: reason || undefined });
        setMessage(`Correction saved for ${response.data.updatedCount} student${response.data.updatedCount === 1 ? "" : "s"}.`);
      }
      setDialogOpen(false);
      setEditing(false);
      setDraft({});
      await refreshAttendance();
    } catch (error) {
      // Keep the dialog open so the teacher sees WHY it failed (stale entry,
      // exhausted capacity, a request that appeared meanwhile) and can retry.
      setErrorMessage(error instanceof ApiError ? error.message : "The attendance change could not be saved.");
      if (error instanceof ApiError && (error.code === "CONFLICT" || error.code === "APPROVAL_REQUIRED")) {
        await refreshAttendance();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveNewSession() {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    setErrorMessage("");
    try {
      const response = await post<{ createdCount: number }>(
        "/attendance/sessions",
        // Create-only: the backend converts "a session appeared meanwhile" into a
        // 409 instead of silently editing (or duplicating) the entry.
        buildNewSessionPayload({
          courseOfferingId: offeringId,
          attendanceDate: date,
          students: createStudents.map((student) => ({ studentPk: str(student.id), status: createStatus(str(student.id)) })),
        }),
      );
      setMessage(`Attendance recorded for ${response.data.createdCount} student${response.data.createdCount === 1 ? "" : "s"}.`);
      setDraft({});
      await refreshAttendance();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        // Someone (or another tab) recorded this date already: show the entry.
        await refreshAttendance();
        setMessage("Attendance for this date already existed, so it is shown below instead of being created again.");
      } else {
        setErrorMessage(error instanceof ApiError ? error.message : "Attendance could not be saved.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const refreshAttendance = useCallback(async () => {
    await mutateEntry();
  }, [mutateEntry]);

  if (offeringLoading && !resolvedOffering) return <CardListSkeleton count={2} lines={4} label="Loading course offering" />;
  if (offeringError && !resolvedOffering) return <ErrorState message="Failed to load course offering" />;
  if (entryError) return <ErrorState message="Failed to load attendance for this date" onRetry={() => mutateEntry()} />;

  return (
    <div className="space-y-4">
      {backHref && (
        <a href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-600 underline-offset-2 hover:text-brand-700 hover:underline">
          <ChevronLeft size={14} aria-hidden="true" /> {backLabel ?? "Back"}
        </a>
      )}

      <DateNavigation date={date} setDate={setDate} lockDate={lockDate} />

      {message && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMessage}
        </p>
      )}

      {view === "loading" ? (
        <CardListSkeleton count={3} lines={4} label="Loading attendance roster" />
      ) : view === "create" || !entry ? (
        <NewAttendanceSession
          students={createStudents}
          summary={createSummary}
          statusOf={createStatus}
          onStatus={setStatus}
          onMarkAllPresent={markAllPresent}
          onSave={saveNewSession}
          submitting={submitting}
        />
      ) : view === "editing" ? (
        <EditingAttendance
          entry={entry}
          changes={changes}
          statusOf={draftStatus}
          onStatus={setStatus}
          onReview={stopEdit}
          onSave={attemptCorrectionSave}
          onOpenPending={() => setPendingDialogOpen(true)}
          submitting={submitting}
        />
      ) : (
        <RecordedAttendance
          entry={entry}
          contextLabel={contextLabel}
          reportHref={reportHref}
          pendingCount={pendingCount}
          onEdit={beginEdit}
          onOpenPending={() => setPendingDialogOpen(true)}
        />
      )}

      <AttendanceCorrectionDialog
        open={dialogOpen}
        mode={dialogMode}
        attendanceDate={date}
        offeringLabel={contextLabel}
        changes={changes}
        capacityRemaining={permissions?.correctionCapacityRemaining}
        directCorrectionLimit={permissions?.directCorrectionLimit}
        submitting={submitting}
        errorMessage={errorMessage}
        onClose={() => setDialogOpen(false)}
        onConfirm={confirmCorrection}
      />

      <AttendancePendingRequestsDialog
        open={pendingDialogOpen}
        onClose={() => setPendingDialogOpen(false)}
        courseOfferingId={offeringId}
        {...(entry?.id ? { sessionId: str(entry.id) } : {})}
      />
    </div>
  );
}

function blockedText(reason: string, permissions: AttendanceEntryState["permissions"] | undefined): string {
  if (reason === "PENDING_REQUEST") {
    return "This attendance entry already has a request awaiting admin review, so another one cannot be submitted. Cancel the pending request first.";
  }
  if (reason === "EDIT_WINDOW_CLOSED") {
    return "The teacher edit window has closed for this attendance entry, so no correction or request can be submitted from this screen.";
  }
  return permissions ? "This attendance entry cannot be changed from this screen right now." : "Attendance state could not be loaded.";
}

// ---------------------------------------------------------------- date picker
function DateNavigation({ date, setDate, lockDate }: { date: string; setDate: (value: string) => void; lockDate: boolean }) {
  return (
    <Card className="flex flex-wrap items-center gap-2 p-3">
      <label htmlFor="attendance-date" className="text-sm font-medium text-slate-600">
        Attendance date
      </label>
      <div className="flex items-center gap-2">
        {!lockDate && (
          <Button variant="outline" size="sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
            <ChevronLeft size={15} />
          </Button>
        )}
        <input
          id="attendance-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value || todayStr())}
          disabled={lockDate}
          aria-label="Attendance date"
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500"
        />
        {!lockDate && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDate(todayStr())}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
              <ChevronRight size={15} />
            </Button>
          </>
        )}
      </div>
      <span className="ml-auto text-xs text-slate-500">
        {weekdayName(date)} · {monthYearLabel(date)}
      </span>
    </Card>
  );
}

// ---------------------------------------------------------------- create form
function NewAttendanceSession({
  students,
  summary,
  statusOf,
  onStatus,
  onMarkAllPresent,
  onSave,
  submitting,
}: {
  students: Row[];
  summary: { total: number; present: number; absent: number; late: number; excused: number };
  statusOf: (studentPk: string) => AttendanceStatusCode;
  onStatus: (studentPk: string, status: AttendanceStatusCode) => void;
  onMarkAllPresent: () => void;
  onSave: () => void;
  submitting: boolean;
}) {
  if (students.length === 0) {
    return <EmptyState title="No students enrolled" hint="Enroll students in this section before taking attendance." />;
  }
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Take attendance</h2>
            <p className="mt-1 text-sm text-slate-500">No attendance is recorded for this date yet. Choose one status per student, then save.</p>
          </div>
          <Badge tone="violet">New entry</Badge>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <AttendanceSummaryChips summary={summary} />
        <Button variant="secondary" size="sm" onClick={onMarkAllPresent}>
          <Users size={14} aria-hidden="true" /> Mark all present
        </Button>
      </div>

      <RosterList
        rows={students.map((student) => ({
          studentPk: str(student.id),
          label: str((student.user as Row | undefined)?.name) || str(student.studentId),
          rollNumber: (student.rollNumber as number | null | undefined) ?? null,
          studentId: str(student.studentId),
          status: statusOf(str(student.id)),
        }))}
        onStatus={onStatus}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <p className="text-xs text-slate-500">{students.length} student{students.length === 1 ? "" : "s"} in this section.</p>
        <Button onClick={onSave} disabled={submitting}>
          {submitting ? <Spinner /> : <Save size={15} aria-hidden="true" />} Save attendance
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- read-only view
function RecordedAttendance({
  entry,
  contextLabel,
  reportHref,
  pendingCount,
  onEdit,
  onOpenPending,
}: {
  entry: AttendanceEntryState;
  contextLabel?: string;
  reportHref?: string;
  pendingCount: number;
  onEdit: () => void;
  onOpenPending: () => void;
}) {
  const permissions = entry.permissions;
  const canEdit = permissions.canDirectCorrect || permissions.canRequestChange;
  const unmarked = entry.roster.filter((row) => !row.hasRecord).length;
  const dateLabel = entry.attendanceDate;

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <AttendanceDateBadge iso={dateLabel} size="sm" />
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Attendance recorded</h2>
              <Badge tone="green">
                <span className="flex items-center gap-1"><Check size={12} aria-hidden="true" /> {entry.summary.total} recorded</span>
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {weekdayName(dateLabel)} · {monthYearLabel(dateLabel)}
              {contextLabel ? ` · ${contextLabel}` : ""}
            </p>
            <AttendanceSummaryChips
              className="mt-3"
              summary={{ total: entry.summary.total, present: entry.summary.present, absent: entry.summary.absent, late: entry.summary.late, excused: entry.summary.excused }}
              unmarked={unmarked}
            />
          </div>
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {canEdit && (
              <Button size="sm" onClick={onEdit}>
                <PencilLine size={14} aria-hidden="true" /> Edit attendance
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onOpenPending}>
              <ClipboardList size={14} aria-hidden="true" />
              Pending update requests
              {pendingCount > 0 && (
                <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">
                  {pendingCount}
                </span>
              )}
            </Button>
            {reportHref && (
              <a href={reportHref} className={buttonClass("ghost", "sm")}>
                <History size={14} aria-hidden="true" /> View attendance report
              </a>
            )}
          </div>
        </div>

        {!canEdit && (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            {permissions.hasPendingChangeRequest
              ? "Corrections are closed while a request for this entry is awaiting review. Open the pending request to inspect or cancel it."
              : permissions.withinEditWindow
                ? "This entry cannot be corrected from your account any more; an admin review would be needed."
                : `The teacher edit window has closed for ${dateLabel}, so the entry is read-only.`}
          </p>
        )}

        {entry.pendingChangeRequest && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <Clock3 size={15} aria-hidden="true" />
              A request for this entry is awaiting admin review
              <button type="button" onClick={onOpenPending} className="font-semibold text-amber-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                View pending request
              </button>
            </p>
            <p className="mt-1 text-[13px]">
              {entry.pendingChangeRequest.changeCount} student change{entry.pendingChangeRequest.changeCount === 1 ? "" : "s"} · submitted{" "}
              {new Date(entry.pendingChangeRequest.createdAt).toLocaleString()} · “{entry.pendingChangeRequest.reason}”
            </p>
            <p className="mt-1 text-xs text-amber-800">Another request cannot be filed while this one is pending; cancel it first if the proposal was wrong.</p>
          </div>
        )}
      </Card>

      <RecordedRoster entry={entry} />
    </>
  );
}

function RecordedRoster({ entry }: { entry: AttendanceEntryState }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-700">Recorded attendance</h3>
        <p className="text-xs text-slate-500">
          {entry.roster.length} student{entry.roster.length === 1 ? "" : "s"} · correction {entry.permissions.correctionsUsed} of{" "}
          {entry.permissions.directCorrectionLimit} used
        </p>
      </div>
      {entry.roster.length === 0 ? (
        <EmptyState title="No students in this section" hint="The entry exists but the section roster is empty." />
      ) : (
        <ul role="list" className="divide-y divide-slate-100">
          {entry.roster.map((row) => (
            <li key={row.studentPk || row.studentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="inline-flex w-[4.5rem] shrink-0 items-baseline gap-1 text-xs text-slate-500">
                <span className="text-slate-400">Roll</span>
                <span className="font-mono font-medium text-slate-700">{row.rollNumber ?? "—"}</span>
              </span>
              <span className="min-w-[8rem] flex-1">
                <span className="block font-medium text-slate-800">{row.studentName || row.studentId}</span>
                <span className="block font-mono text-[11px] text-slate-500">{row.studentId || "—"}</span>
              </span>
              {row.note && <span className="text-xs text-slate-500">“{row.note}”</span>}
              <AttendanceStatusPill status={row.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- edit view
function EditingAttendance({
  entry,
  changes,
  statusOf,
  onStatus,
  onReview,
  onSave,
  onOpenPending,
  submitting,
}: {
  entry: AttendanceEntryState;
  changes: ProposedAttendanceChange[];
  statusOf: (row: AttendanceSessionStudent) => AttendanceStatusCode;
  onStatus: (studentPk: string, status: AttendanceStatusCode) => void;
  onReview: () => void;
  onSave: () => void;
  onOpenPending: () => void;
  submitting: boolean;
}) {
  const permissions = entry.permissions;
  const action = resolveCorrectionAction(permissions, changes.length);
  const changedCount = changes.length;
  const rows = entry.roster;

  const headline =
    action.kind === "request"
      ? "Approval required: this entry has used its direct corrections, so the complete change set below is sent to an admin as one request."
      : action.kind === "blocked" && action.reason === "PENDING_REQUEST"
        ? "A request for this entry is still awaiting review. Cancel it before proposing another change."
        : action.kind === "blocked"
          ? blockedText(action.reason, permissions)
          : `Direct correction mode: ${permissions.correctionCapacityRemaining} of ${permissions.directCorrectionLimit} correction operation${permissions.directCorrectionLimit === 1 ? "" : "s"} left for this entry.`;

  return (
    <>
      <Card className={cn("p-3.5 text-sm", action.kind === "blocked" ? "border-slate-200 bg-slate-50 text-slate-700" : "border-blue-200 bg-blue-50 text-blue-900")}>
        <p className="flex flex-wrap items-start justify-between gap-2">
          <span className="max-w-prose">{headline}</span>
          {action.kind === "blocked" && permissions.hasPendingChangeRequest && (
            <Button variant="outline" size="sm" onClick={onOpenPending}>
              <ClipboardList size={14} aria-hidden="true" /> Open pending request
            </Button>
          )}
        </p>
      </Card>

      <RosterList
        rows={rows.map((row) => ({
          studentPk: row.studentPk,
          label: row.studentName || row.studentId,
          rollNumber: row.rollNumber,
          studentId: row.studentId,
          status: statusOf(row),
          recorded: row.hasRecord ? row.status : "NOT_MARKED",
        }))}
        onStatus={onStatus}
        disabled={!permissions.canDirectCorrect && !permissions.canRequestChange}
        changedStudentIds={new Set(changes.map((change) => change.studentPk))}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <p className="text-xs text-slate-500" role="status">
          {changedCount === 0
            ? "Select a different status to start a correction."
            : `${changedCount} student${changedCount === 1 ? "" : "s"} changed from the recorded entry.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onReview} disabled={submitting}>
            {changedCount > 0 ? <><Ban size={14} aria-hidden="true" /> Discard changes</> : <><History size={14} aria-hidden="true" /> Back to view</>}
          </Button>
          <Button size="sm" onClick={onSave} disabled={submitting || action.kind === "blocked" || changedCount === 0}>
            {submitting ? <Spinner /> : action.kind === "request" ? <Send size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {action.kind === "request" ? "Request change for approval" : "Save attendance"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- roster rows
type RosterRow = {
  studentPk: string;
  label: string;
  rollNumber: number | null;
  studentId: string;
  /** Status currently selected in the draft. */
  status: AttendanceStatusCode;
  /** Recorded status, shown so the teacher can compare while editing. */
  recorded?: string;
};

function RosterList({
  rows,
  onStatus,
  disabled,
  changedStudentIds,
}: {
  rows: RosterRow[];
  onStatus: (studentPk: string, status: AttendanceStatusCode) => void;
  disabled?: boolean;
  changedStudentIds?: Set<string>;
}) {
  return (
    <div role="list" aria-label="Student attendance statuses" className="space-y-2">
      {rows.map((row, index) => {
        const value = row.status;
        const groupName = `attendance-status-${row.studentPk || index}`;
        const changed = changedStudentIds?.has(row.studentPk) ?? false;
        return (
          <Card key={`${row.studentPk || row.studentId}-${index}`} className={cn("p-3", changed && "border-blue-300 ring-1 ring-blue-100")}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-slate-800">{row.label}</span>
              <span className="text-[11px] font-medium text-slate-500">
                Roll {row.rollNumber ?? "—"} · {row.studentId || "—"}
              </span>
              {changed && <Badge tone="blue">Changed</Badge>}
              {row.recorded && (
                <span className="ml-auto text-[11px] text-slate-500">
                  {row.recorded === "NOT_MARKED" ? (
                    <span className="font-medium text-amber-700">not marked in this entry</span>
                  ) : (
                    <>
                      recorded: <span className="font-medium capitalize">{row.recorded.toLowerCase()}</span>
                    </>
                  )}
                </span>
              )}
            </div>
            <fieldset>
              <legend className="sr-only">Attendance status for {row.label}</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
                {ATTENDANCE_STATUSES.map((status) => (
                  <AttendanceStatusOption
                    key={status}
                    status={status}
                    name={groupName}
                    checked={value === status}
                    disabled={disabled}
                    onChange={() => onStatus(row.studentPk, status)}
                    studentLabel={row.label}
                  />
                ))}
              </div>
            </fieldset>
          </Card>
        );
      })}
    </div>
  );
}
