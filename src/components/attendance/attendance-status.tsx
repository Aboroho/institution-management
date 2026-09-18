"use client";

/**
 * Shared attendance status visuals.
 *
 * Single source of truth for how a status looks on ANY attendance screen (Take
 * Attendance read-only view, the editing rows, the correction dialog, the
 * pending-request dialog, the report). Light theme only, on purpose: the rest
 * of the EMS app has no dark mode, and the previous `dark:` variants on this
 * page were what made it look like a different product.
 *
 * Colors follow the app-wide `StatusBadge` tokens (present = emerald,
 * absent = red, late = amber, excused = blue) and every status also carries an
 * icon AND its label, so status is never communicated by color alone.
 */

import { Check, Clock3, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { cn } from "@/components/ui";
import { Badge } from "@/components/ui";
import { ATTENDANCE_STATUSES, type AttendanceStatusCode } from "@/modules/attendance/attendance.types";

export { ATTENDANCE_STATUSES };
export type { AttendanceStatusCode };

export type AttendanceStatusMeta = {
  label: string;
  Icon: typeof UserCheck;
  /** Read-only chip (matches Badge tones). */
  chip: string;
  /** Unselected option in a status picker. */
  option: string;
  /** Selected option in a status picker. */
  optionSelected: string;
};

export const attendanceStatusMeta: Record<AttendanceStatusCode, AttendanceStatusMeta> = {
  PRESENT: {
    label: "Present",
    Icon: UserCheck,
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    option: "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/60",
    optionSelected: "border-emerald-500 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500",
  },
  ABSENT: {
    label: "Absent",
    Icon: UserX,
    chip: "border-red-200 bg-red-50 text-red-800",
    option: "border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:bg-red-50/60",
    optionSelected: "border-red-500 bg-red-50 text-red-900 ring-1 ring-red-500",
  },
  LATE: {
    label: "Late",
    Icon: Clock3,
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    option: "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50/60",
    optionSelected: "border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500",
  },
  EXCUSED: {
    label: "Excused",
    Icon: ShieldCheck,
    chip: "border-blue-200 bg-blue-50 text-blue-800",
    option: "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50/60",
    optionSelected: "border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500",
  },
};

const NOT_MARKED_META = {
  label: "Not marked",
  chip: "border-slate-200 bg-slate-50 text-slate-500",
};

export const isAttendanceStatusCode = (value: unknown): value is AttendanceStatusCode =>
  (ATTENDANCE_STATUSES as readonly unknown[]).includes(value);

/** Read-only status chip: icon + label + color. */
export function AttendanceStatusPill({
  status,
  size = "md",
  className,
}: {
  status: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!isAttendanceStatusCode(status)) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border font-medium",
          NOT_MARKED_META.chip,
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
          className,
        )}
      >
        {NOT_MARKED_META.label}
      </span>
    );
  }
  const meta = attendanceStatusMeta[status];
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        meta.chip,
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
        className,
      )}
    >
      <Icon size={size === "sm" ? 12 : 14} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** "ABSENT → PRESENT" indicator used by the correction + pending-request dialogs. */
export function AttendanceStatusTransition({
  from,
  to,
  className,
}: {
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <AttendanceStatusPill status={from} size="sm" />
      <span aria-hidden="true" className="text-slate-400">→</span>
      <span className="sr-only">changed to</span>
      <AttendanceStatusPill status={to} size="sm" />
    </span>
  );
}

/**
 * One selectable status of one student.
 *
 * A real radio input (visually hidden) keeps native form semantics, group
 * keyboard behaviour and screen-reader announcements; the surrounding label is
 * the tap target. Height is 40px on touch widths and 36px from `sm` up, which
 * stays comfortably tappable without the old 48px rows.
 */
export function AttendanceStatusOption({
  status,
  name,
  checked,
  onChange,
  disabled,
  studentLabel,
}: {
  status: AttendanceStatusCode;
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Student name used for the accessible label, e.g. "Late for Rahim". */
  studentLabel: string;
}) {
  const meta = attendanceStatusMeta[status];
  const Icon = meta.Icon;
  return (
    <label
      className={cn(
        "relative flex min-h-10 select-none items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition sm:min-h-9 sm:text-sm",
        checked ? meta.optionSelected : meta.option,
        disabled && "cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white",
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-1",
      )}
    >
      <input
        type="radio"
        name={name}
        value={status}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
        aria-label={`${meta.label} for ${studentLabel}`}
      />
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{meta.label}</span>
      {checked && <Check size={14} aria-hidden="true" className="ml-auto shrink-0" />}
    </label>
  );
}

/** Present/Absent/Late/Excused counters (+ unmarked, when the roster has gaps). */
export function AttendanceSummaryChips({
  summary,
  unmarked,
  className,
}: {
  summary: { total: number; present: number; absent: number; late: number; excused: number };
  unmarked?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Attendance summary">
      <Badge tone="slate">Total {summary.total}</Badge>
      <Badge tone="green">
        <span className="flex items-center gap-1"><UserCheck size={12} aria-hidden="true" /> Present {summary.present}</span>
      </Badge>
      <Badge tone="red">
        <span className="flex items-center gap-1"><UserX size={12} aria-hidden="true" /> Absent {summary.absent}</span>
      </Badge>
      <Badge tone="amber">
        <span className="flex items-center gap-1"><Clock3 size={12} aria-hidden="true" /> Late {summary.late}</span>
      </Badge>
      <Badge tone="blue">
        <span className="flex items-center gap-1"><ShieldCheck size={12} aria-hidden="true" /> Excused {summary.excused}</span>
      </Badge>
      {unmarked ? <Badge tone="slate">Not marked {unmarked}</Badge> : null}
    </div>
  );
}
