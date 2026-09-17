/**
 * Centralized Attendance Thresholds & Utilities
 *
 * Ranges:
 * 0–39%     Red
 * 40–59%    Yellow
 * 60–79%    Brown
 * 80–100%   Green
 */

export type AttendanceBand = "red" | "yellow" | "brown" | "green";

export interface AttendanceThresholdDef {
  band: AttendanceBand;
  label: string;
  min: number;
  max: number;
  hexColor: string;       // For PDF & XLSX
  bgHexColor: string;     // For light background
  textColor: string;      // Tailwind / hex
  twBgClass: string;      // CSS class for horizontal bar
  twTextClass: string;    // CSS text color
}

export const ATTENDANCE_THRESHOLDS: readonly AttendanceThresholdDef[] = [
  {
    band: "red",
    label: "0–39%",
    min: 0,
    max: 39.999,
    hexColor: "#DC2626", // Red-600
    bgHexColor: "#FEE2E2",
    textColor: "#991B1B",
    twBgClass: "bg-red-600",
    twTextClass: "text-red-700",
  },
  {
    band: "yellow",
    label: "40–59%",
    min: 40,
    max: 59.999,
    hexColor: "#EAB308", // Yellow-500
    bgHexColor: "#FEF9C3",
    textColor: "#854D0E",
    twBgClass: "bg-yellow-500",
    twTextClass: "text-yellow-700",
  },
  {
    band: "brown",
    label: "60–79%",
    min: 60,
    max: 79.999,
    hexColor: "#A16207", // Amber-700 / Brown
    bgHexColor: "#FEF3C7",
    textColor: "#78350F",
    twBgClass: "bg-amber-700",
    twTextClass: "text-amber-800",
  },
  {
    band: "green",
    label: "80–100%",
    min: 80,
    max: 100,
    hexColor: "#16A34A", // Green-600
    bgHexColor: "#DCFCE7",
    textColor: "#166534",
    twBgClass: "bg-green-600",
    twTextClass: "text-green-700",
  },
] as const;

export function getAttendanceThreshold(percentage: number): AttendanceThresholdDef {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0));
  for (const t of ATTENDANCE_THRESHOLDS) {
    if (clamped <= t.max || t.max === 100) {
      if (clamped >= t.min) return t;
    }
  }
  return ATTENDANCE_THRESHOLDS[0];
}

/**
 * Attendance formula required by specification:
 * Attendance = (Total Classes - Absent) / Total Classes × 100
 *
 * Note: If Total Classes is 0, attendance is 0 (or 100 if no classes held? 0 is safer).
 */
export function calculateAttendanceValue(totalClasses: number, absent: number): {
  count: number;
  percentage: number;
  display: string;
} {
  if (totalClasses <= 0) {
    return { count: 0, percentage: 0, display: "0 (0%)" };
  }
  const count = Math.max(0, totalClasses - absent);
  const percentage = Math.round((count / totalClasses) * 1000) / 10;
  return {
    count,
    percentage,
    display: `${count} (${percentage}%)`,
  };
}

/**
 * Format status counts and percentages
 */
export function calculateStatusCounts(
  totalClasses: number,
  present: number,
  absent: number,
  late: number,
  excused: number
) {
  const round = (num: number) => (totalClasses > 0 ? Math.round((num / totalClasses) * 1000) / 10 : 0);
  return {
    present,
    absent,
    late,
    excused,
    presentPercentage: round(present),
    absentPercentage: round(absent),
    latePercentage: round(late),
    excusedPercentage: round(excused),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats a Date or ISO string into "20 August 2026"
 */
export function formatFullDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Formats a Date or ISO string into "Wed, 20 Apr"
 */
export function formatDayColumnLabel(dateStr: string): string {
  // dateStr is expected to be YYYY-MM-DD
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dayName = DAY_NAMES[d.getUTCDay()];
  const day = d.getUTCDate();
  const month = SHORT_MONTH_NAMES[d.getUTCMonth()];
  return `${dayName}, ${day} ${month}`;
}

/**
 * Construct ReportDateRange helper
 */
export function buildReportDateRange(from?: string | null, to?: string | null): {
  from: string | null;
  to: string | null;
  isFullPeriod: boolean;
  displayText: string;
} {
  const cleanFrom = from?.trim() || null;
  const cleanTo = to?.trim() || null;
  if (!cleanFrom && !cleanTo) {
    return {
      from: null,
      to: null,
      isFullPeriod: true,
      displayText: "Full Period",
    };
  }
  const fromFormatted = cleanFrom ? formatFullDate(cleanFrom) : null;
  const toFormatted = cleanTo ? formatFullDate(cleanTo) : null;
  let displayText = "Full Period";
  if (fromFormatted && toFormatted) {
    displayText = `${fromFormatted} – ${toFormatted}`;
  } else if (fromFormatted) {
    displayText = `From ${fromFormatted}`;
  } else if (toFormatted) {
    displayText = `Until ${toFormatted}`;
  }
  return {
    from: cleanFrom,
    to: cleanTo,
    isFullPeriod: false,
    displayText,
  };
}

/**
 * Sanitize filename strings
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
