"use client";

/**
 * The change list shared by the correction confirmation dialog and the pending
 * request dialog. Both must show exactly the same thing — who changes from what
 * to what — so the rendering lives here once instead of being restyled per
 * screen (which is how the two views used to disagree).
 */

import { groupChangesByTransition } from "@/modules/attendance/attendance-corrections";
import { cn, EmptyState, Badge } from "@/components/ui";
import { AttendanceStatusTransition } from "./attendance-status";

/**
 * Both the draft diff (correction dialog) and a stored request's proposals
 * (pending dialog) satisfy this shape; `recordId` is only used for keys.
 */
export type AttendanceChangeRow = {
  recordId?: string;
  rollNumber: number | null;
  studentId: string;
  studentName: string;
  oldStatus: string;
  newStatus: string;
};

/** "PRESENT → ABSENT ×2" chips, so a 30-student edit is scannable at a glance. */
export function AttendanceChangeTotals({
  changes,
  className,
}: {
  changes: AttendanceChangeRow[];
  className?: string;
}) {
  const groups = groupChangesByTransition(changes);
  if (groups.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} aria-label="Changes grouped by status transition">
      {groups.map((group) => (
        <Badge key={`${group.oldStatus}-${group.newStatus}`} tone="slate">
          {group.oldStatus} → {group.newStatus}
          <span className="ml-1 font-semibold text-slate-900">×{group.count}</span>
        </Badge>
      ))}
    </div>
  );
}

/**
 * Full per-student list. `role="list"` + explicit text (roll, name, both
 * statuses) keeps it readable for screen readers and on a 360px screen, where
 * the row wraps instead of scrolling sideways.
 */
export function AttendanceChangeList({
  changes,
  emptyMessage,
  className,
}: {
  changes: AttendanceChangeRow[];
  emptyMessage?: string;
  className?: string;
}) {
  if (changes.length === 0) {
    return <EmptyState title={emptyMessage ?? "No changes"} />;
  }
  return (
    <ul role="list" className={cn("divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white", className)}>
      {changes.map((change) => (
        <li
          key={`${change.recordId ?? change.studentId}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm"
        >
          <span className="inline-flex min-w-[52px] shrink-0 items-center gap-1 text-xs font-semibold text-slate-500">
            <span className="text-slate-400">Roll</span>
            <span className="font-mono text-slate-700">{change.rollNumber ?? "—"}</span>
          </span>
          <span className="min-w-[8rem] flex-1">
            <span className="block font-medium text-slate-800">{change.studentName}</span>
            <span className="block font-mono text-[11px] text-slate-500">{change.studentId || "—"}</span>
          </span>
          <AttendanceStatusTransition from={change.oldStatus} to={change.newStatus} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}
