import { describe, it, expect } from "vitest";
import {
  calculateAttendanceValue,
  calculateStatusCounts,
  getAttendanceThreshold,
  ATTENDANCE_THRESHOLDS,
  buildReportDateRange,
  formatDayColumnLabel,
} from "@/modules/reporting/reporting.utils";

describe("Reporting Utils & Attendance Calculation Domain Rules", () => {
  it("calculates attendance accurately: (Total Classes - Absent) / Total Classes * 100", () => {
    // Specification example: Total Class = 100, Absent = 30 => Attendance = 70, 70%
    const res = calculateAttendanceValue(100, 30);
    expect(res.count).toBe(70);
    expect(res.percentage).toBe(70);
    expect(res.display).toBe("70 (70%)");
  });

  it("handles 0 total classes gracefully", () => {
    const res = calculateAttendanceValue(0, 0);
    expect(res.count).toBe(0);
    expect(res.percentage).toBe(0);
    expect(res.display).toBe("0 (0%)");
  });

  it("calculates status counts and percentages accurately without inventing data", () => {
    const counts = calculateStatusCounts(50, 40, 5, 3, 2);
    expect(counts.present).toBe(40);
    expect(counts.absent).toBe(5);
    expect(counts.late).toBe(3);
    expect(counts.excused).toBe(2);
    expect(counts.presentPercentage).toBe(80);
    expect(counts.absentPercentage).toBe(10);
    expect(counts.latePercentage).toBe(6);
    expect(counts.excusedPercentage).toBe(4);
  });

  it("correctly maps attendance percentages to centralized threshold bands", () => {
    // 0–39% Red
    expect(getAttendanceThreshold(0).band).toBe("red");
    expect(getAttendanceThreshold(39.9).band).toBe("red");

    // 40–59% Yellow
    expect(getAttendanceThreshold(40).band).toBe("yellow");
    expect(getAttendanceThreshold(59.9).band).toBe("yellow");

    // 60–79% Brown
    expect(getAttendanceThreshold(60).band).toBe("brown");
    expect(getAttendanceThreshold(79.9).band).toBe("brown");

    // 80–100% Green
    expect(getAttendanceThreshold(80).band).toBe("green");
    expect(getAttendanceThreshold(100).band).toBe("green");
  });

  it("defaults date range to Full Period when parameters are omitted", () => {
    const range = buildReportDateRange();
    expect(range.isFullPeriod).toBe(true);
    expect(range.displayText).toBe("Full Period");
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
  });

  it("formats day column label into 'Wed, 20 Apr' format", () => {
    // 2026-04-22 is Wednesday (or check 2026-04-20)
    // 2026-04-20 is Monday, 2026-04-22 is Wednesday
    const label = formatDayColumnLabel("2026-04-22");
    expect(label).toBe("Wed, 22 Apr");
  });
});
