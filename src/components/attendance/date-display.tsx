"use client";
// Visual date presentation for attendance entries. Distinctive yet professional:
//   15
//   Tuesday
//   September 2026
//
// Pure presentational component — never use fake dates. The component is fed
// by a real yyyy-mm-dd string returned from the Attendance Report API.

import React from "react";
import { cn } from "@/components/ui";

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseISODate(iso: string): { year: number; month: number; day: number; weekday: number } | null {
  // Parse yyyy-mm-dd without timezone drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  // Verify the date didn't roll over (catches Feb 30, etc.).
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const weekday = dt.getUTCDay();
  return { year, month, day, weekday };
}

export function weekdayName(iso: string): string {
  const p = parseISODate(iso);
  return p ? WEEKDAY_LONG[p.weekday] : "";
}

export function monthYearLabel(iso: string): string {
  const p = parseISODate(iso);
  return p ? `${MONTH_LONG[p.month - 1]} ${p.year}` : "";
}

export function AttendanceDateBadge({
  iso,
  className,
  size = "md",
}: {
  iso: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const p = parseISODate(iso);
  if (!p) {
    return <span className={cn("text-sm text-slate-400", className)}>—</span>;
  }
  const dims = {
    sm: { box: "min-w-[58px] px-2.5 py-1", day: "text-xl", wk: "text-[10px]", my: "text-[10px]" },
    md: { box: "min-w-[76px] px-3 py-2", day: "text-3xl", wk: "text-[11px]", my: "text-[11px]" },
    lg: { box: "min-w-[96px] px-4 py-3", day: "text-4xl", wk: "text-xs", my: "text-xs" },
  }[size];
  // Distinct yet professional — gradient slate/indigo. Colour-blind safe.
  return (
    <div
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 via-white to-violet-50 text-indigo-800 ring-1 ring-indigo-200",
        dims.box,
        className,
      )}
      aria-label={`${WEEKDAY_LONG[p.weekday]} ${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year}`}
    >
      <span className={cn("font-bold leading-none", dims.day)} aria-hidden="true">
        {p.day}
      </span>
      <span className={cn("mt-1 font-medium uppercase tracking-wide text-indigo-600", dims.wk)}>
        {WEEKDAY_LONG[p.weekday].slice(0, 3)}
      </span>
      <span className={cn("mt-0.5 text-slate-500", dims.my)}>
        {MONTH_LONG[p.month - 1].slice(0, 3)} {p.year}
      </span>
    </div>
  );
}
