"use client";

import React from "react";
import { getAttendanceThreshold } from "@/modules/reporting/reporting.utils";

interface AttendancePercentageBarProps {
  percentage: number;
  showLabel?: boolean;
  className?: string;
  heightClass?: string;
}

export function AttendancePercentageBar({
  percentage,
  showLabel = false,
  className = "",
  heightClass = "h-2.5",
}: AttendancePercentageBarProps) {
  const threshold = getAttendanceThreshold(percentage);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`relative w-full flex-1 overflow-hidden rounded-full bg-slate-100 ${heightClass}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${threshold.twBgClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className={`text-xs font-semibold ${threshold.twTextClass} min-w-[3rem] text-right`}>
          {Math.round(clamped * 10) / 10}%
        </span>
      )}
    </div>
  );
}

export function AttendanceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      <span className="font-semibold text-slate-700">Attendance Ranges:</span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-red-600" />
        0–39% (Critical)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-yellow-500" />
        40–59% (Low)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-amber-700" />
        60–79% (Moderate)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-green-600" />
        80–100% (Good)
      </span>
    </div>
  );
}
