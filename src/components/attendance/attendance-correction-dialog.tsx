"use client";

/**
 * Confirmation dialog for an attendance correction.
 *
 * The reason box deliberately lives HERE instead of permanently occupying space
 * on the attendance page: it is only rendered when the workflow actually
 * requires it (an approval request), and the teacher reviews the complete change
 * list — roll, name, previous status, proposed status — before anything is sent.
 *
 * Opening the dialog never submits. The mutation only runs from the confirm
 * button, which is disabled while a request is in flight so repeated clicks
 * cannot create two corrections (or two approval requests).
 */

import { useEffect, useState } from "react";
import { Button, Dialog, FieldError, Textarea, cn } from "@/components/ui";
import { AlertTriangle, CheckCircle2, Send, ShieldCheck } from "lucide-react";
import { AttendanceChangeList, AttendanceChangeTotals } from "./attendance-change-list";
import type { ProposedAttendanceChange } from "@/modules/attendance/attendance-corrections";

export type CorrectionDialogMode = "direct" | "request";

export function AttendanceCorrectionDialog({
  open,
  mode,
  attendanceDate,
  offeringLabel,
  changes,
  capacityRemaining,
  directCorrectionLimit,
  submitting,
  errorMessage,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** "direct" applies immediately, "request" goes to the admin approval queue. */
  mode: CorrectionDialogMode;
  attendanceDate: string;
  offeringLabel?: string;
  changes: ProposedAttendanceChange[];
  capacityRemaining?: number;
  directCorrectionLimit?: number;
  submitting: boolean;
  errorMessage?: string;
  onClose: () => void;
  /** Receives the trimmed reason; only ever called from the confirm button. */
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  // A fresh dialog per opening: a reason typed into an abandoned attempt must not
  // leak into the next confirmation.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setTouched(false);
  }, [open]);

  const requiresReason = mode === "request";
  const reasonMissing = requiresReason && reason.trim().length === 0;
  const affected = changes.length;
  const canConfirm = affected > 0 && !submitting && !reasonMissing;

  // Never drop the dialog mid-flight (Escape / backdrop), otherwise a successful
  // save can look like a lost form to the teacher.
  function requestClose() {
    if (submitting) return;
    onClose();
  }

  async function confirm() {
    if (!canConfirm) {
      if (reasonMissing) setTouched(true);
      return;
    }
    await onConfirm(reason.trim());
  }

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={mode === "request" ? "Request admin approval for this attendance entry" : "Confirm attendance correction"}
    >
      <div className="space-y-4">
        <div
          className={cn(
            "rounded-lg border p-3 text-sm",
            mode === "request" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
          )}
          role="status"
        >
          <p className="flex items-start gap-2 font-semibold">
            {mode === "request" ? (
              <Send size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span>{mode === "request" ? "Send these changes to an admin for approval" : "Apply this correction directly"}</span>
          </p>
          <p className="mt-1 text-[13px] font-normal">
            {mode === "request"
              ? "Nothing changes until an admin approves the request. The complete change set below is reviewed as one unit."
              : "This writes to the attendance entry immediately and counts as one correction operation for this entry, no matter how many students it touches."}
          </p>
        </div>

        <div className="text-sm text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">{attendanceDate}</span>
            {offeringLabel ? <span className="text-slate-500"> · {offeringLabel}</span> : null}
          </p>
          <p className="mt-1">
            <span className="font-semibold text-slate-800">{affected}</span> student{affected === 1 ? "" : "s"} will change status.
            {typeof capacityRemaining === "number" && typeof directCorrectionLimit === "number" && (
              <span className="text-slate-500">
                {" "}Direct correction capacity after this save: {Math.max(0, capacityRemaining - (mode === "direct" ? 1 : 0))} of{" "}
                {directCorrectionLimit}.
              </span>
            )}
          </p>
          <AttendanceChangeTotals changes={changes} className="mt-2" />
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-slate-200">
          <AttendanceChangeList changes={changes} className="rounded-none border-0" emptyMessage="No changes were prepared." />
        </div>

        {requiresReason && (
          <div>
            <label htmlFor="attendance-change-reason" className="mb-1 block text-sm font-medium text-slate-700">
              Reason for the request <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="attendance-change-reason"
              value={reason}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-required="true"
              aria-invalid={touched && reasonMissing}
              placeholder="Explain why these attendance statuses must change — the admin reviews this request on your behalf."
            />
            <p className="mt-1 text-xs text-slate-500">The reason applies to the whole change set, not to one student.</p>
            {touched && reasonMissing && <FieldError error="A reason is required so the admin can review the request." />}
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck size={14} aria-hidden="true" />
            {mode === "request"
              ? "An admin decision is required before the entry changes."
              : "Every change is written to the immutable attendance history."}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={requestClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              loading={submitting}
              loadingText={mode === "request" ? "Submitting…" : "Saving…"}
            >
              {mode === "request"
                ? `Submit ${affected} change${affected === 1 ? "" : "s"} for approval`
                : `Save ${affected} correction${affected === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
