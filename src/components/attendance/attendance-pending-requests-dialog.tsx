"use client";

/**
 * Teacher-facing "Pending Update Requests" dialog.
 *
 * The point of this screen is that a teacher can read EXACTLY what an admin is
 * being asked to approve: the attendance date, the course offering, when the
 * request was submitted, the reason, the request status and every affected
 * student with their previous -> proposed status. A bare "request pending" note
 * is not enough to review a correction you filed yesterday.
 *
 * Cancellation lives here too (entry level — never per student, because a
 * request always covers the complete change set of one attendance entry).
 * `canCancel` comes from the backend; the confirm step explains that cancelling
 * only withdraws the request and that the request itself is kept for auditing.
 */

import { useState } from "react";
import {
  Badge, Button, Card, Dialog, EmptyState, ErrorState, LoadingSkeleton, Spinner, Textarea, cn,
} from "@/components/ui";
import { Ban, Clock3, Inbox } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { offeringContextLabel, offeringParts } from "@/components/course-offering-context";
import { AttendanceChangeList } from "./attendance-change-list";
import { AttendanceDateBadge, monthYearLabel, weekdayName } from "./date-display";
import {
  cancelAttendanceChangeRequest,
  useAttendanceChangeRequests,
  useAttendanceRevalidate,
} from "./use-attendance-change-requests";
import type { AttendanceChangeRequestRow, AttendanceRequestDisplayStatus } from "@/modules/attendance/attendance.types";

const DISPLAY_STATUS_META: Record<AttendanceRequestDisplayStatus, { label: string; tone: "amber" | "green" | "red" | "slate" }> = {
  PENDING: { label: "Awaiting admin review", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected by admin", tone: "red" },
  // The schema enum has no CANCELLED value (schema freeze), so a withdrawn
  // request is REJECTED + marker and rendered under its real meaning.
  CANCELLED: { label: "Cancelled by you", tone: "slate" },
};

export function AttendancePendingRequestsDialog({
  open,
  onClose,
  courseOfferingId,
  sessionId,
  title = "Pending attendance update requests",
}: {
  open: boolean;
  onClose: () => void;
  courseOfferingId?: string;
  /** Narrow to one attendance entry (used from the report row actions). */
  sessionId?: string;
  title?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const revalidate = useAttendanceRevalidate();
  const { items, pendingCount, isLoading, error, mutate } = useAttendanceChangeRequests(
    open
      ? {
          ...(courseOfferingId ? { courseOfferingId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(showAll ? {} : { status: "PENDING" as const }),
        }
      : null,
  );

  return (
    <Dialog open={open} title={title} wide onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            {showAll
              ? "Every request for this attendance area, newest first."
              : `Requests an admin has not decided yet${pendingCount ? ` — ${pendingCount} pending` : ""}.`}
          </p>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Request filter">
            <FilterButton active={!showAll} onClick={() => setShowAll(false)}>Pending</FilterButton>
            <FilterButton active={showAll} onClick={() => setShowAll(true)}>All requests</FilterButton>
          </div>
        </div>

        {isLoading && items.length === 0 ? (
          <LoadingSkeleton rows={3} />
        ) : error ? (
          <ErrorState message="Could not load your attendance update requests." onRetry={() => mutate()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={showAll ? "No update requests yet" : "Nothing is awaiting review"}
            hint={
              showAll
                ? "Requests you submit for an attendance entry appear here, including cancelled ones."
                : "When a correction needs admin approval, submit it from Take Attendance and it will appear here."
            }
            action={
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <Inbox size={14} aria-hidden="true" /> No pending request to act on
              </span>
            }
          />
        ) : (
          <ul role="list" className="space-y-3">
            {items.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                onDone={async () => {
                  await mutate();
                  await revalidate({ ...(courseOfferingId ? { courseOfferingId } : {}), ...(sessionId ? { sessionId } : {}) });
                }}
              />
            ))}
          </ul>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 py-1 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function RequestCard({ request, onDone }: { request: AttendanceChangeRequestRow; onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const statusMeta = DISPLAY_STATUS_META[request.displayStatus] ?? DISPLAY_STATUS_META.PENDING;
  const submittedAt = formatDateTime(request.createdAt);
  const parts = offeringParts(request.session.courseOffering);
  const contextLabel = offeringContextLabel(request.session.courseOffering);
  const affected = request.changeCount || request.changes.length;

  async function confirmCancel() {
    if (busy) return; // duplicate clicks must not fire two requests
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      await cancelAttendanceChangeRequest(request.id, note);
      setNote("");
      setMessage("Request cancelled. It was withdrawn from admin review; the attendance entry itself was not modified.");
      setConfirming(false);
      await onDone();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : "The request could not be cancelled. Please try again.",
      );
      // The admin may have decided in the meantime: re-read so the card shows
      // the real final state instead of a stale "pending".
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <AttendanceDateBadge iso={request.session.attendanceDate} size="sm" />
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-semibold text-slate-800">
              {weekdayName(request.session.attendanceDate)} · {monthYearLabel(request.session.attendanceDate)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {parts.courseTitle || "Attendance entry"}
              {contextLabel && contextLabel !== parts.courseTitle ? ` · ${contextLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={statusMeta.tone}>
              <span className="flex items-center gap-1">
                <Clock3 size={12} aria-hidden="true" />
                {statusMeta.label}
              </span>
            </Badge>
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">
              {affected} student{affected === 1 ? "" : "s"} affected
            </span>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Meta label="Submitted">{submittedAt}</Meta>
          <Meta label="Submitted by">{request.requestedBy?.name || "—"}</Meta>
          <Meta label="Reviewed">
            {request.reviewedAt ? `${formatDateTime(request.reviewedAt)}${request.reviewedBy?.name ? ` · ${request.reviewedBy.name}` : ""}` : "Not reviewed yet"}
          </Meta>
        </dl>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason given to the admin</p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{request.reason}</p>
          {request.reviewNote && (
            <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
              <span className="font-semibold">Admin note:</span> {request.reviewNote}
            </p>
          )}
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Proposed changes ({request.changes.length})
          </p>
          {request.changes.length === 0 ? (
            <p className="text-sm text-slate-500">No student-level proposals were stored for this request.</p>
          ) : (
            <AttendanceChangeList changes={request.changes} />
          )}
        </div>

        {message && (
          <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">
            {message}
          </p>
        )}
        {errorMessage && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {errorMessage}
          </p>
        )}

        {request.canCancel && !confirming && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">
              {`Request ${request.id.slice(0, 8)} · cancelling withdraws it from admin review. The attendance records stay as they are.`}
            </p>
            <Button variant="outline" size="sm" onClick={() => { setConfirming(true); setErrorMessage(""); }}>
              <Ban size={14} aria-hidden="true" /> Cancel request
            </Button>
          </div>
        )}

        {confirming && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/70 p-3">
            <p className="text-sm font-semibold text-red-900">Cancel this attendance update request?</p>
            <p className="mt-1 text-sm text-red-800">
              Cancelling withdraws the request from admin review. The {request.changes.length} proposed change
              {request.changes.length === 1 ? "" : "s"} will not be applied, and the attendance entry keeps its
              current statuses. The request and its proposals stay in the history for auditing.
            </p>
            <label htmlFor={`cancel-note-${request.id}`} className="mt-2 block text-xs font-medium text-slate-600">
              Note for the admin (optional)
            </label>
            <Textarea
              id={`cancel-note-${request.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="e.g. Corrected directly within the remaining capacity"
              className="mt-1 bg-white"
            />
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setConfirming(false); setNote(""); }} disabled={busy}>
                Keep request
              </Button>
              <Button variant="danger" size="sm" onClick={confirmCancel} disabled={busy}>
                {busy && <Spinner />} {busy ? "Cancelling…" : "Confirm cancel request"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700">{children}</dd>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Inline status chip for a request, reused by the Take Attendance callout so the
 * wording matches the dialog ("Cancelled by you", never a bare "REJECTED" for a
 * withdrawal).
 */
export function AttendanceRequestStatusBadge({ status }: { status: AttendanceRequestDisplayStatus }) {
  const meta = DISPLAY_STATUS_META[status] ?? DISPLAY_STATUS_META.PENDING;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
