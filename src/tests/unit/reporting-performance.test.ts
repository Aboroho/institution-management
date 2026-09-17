import { describe, it, expect } from "vitest";
import { BrowserXlsxExporter } from "@/modules/reporting/exporters/browser-xlsx-exporter";
import type {
  CourseOfferingAttendanceReportDTO,
  CourseOfferingAssessmentReportDTO,
} from "@/modules/reporting/reporting.types";

describe("Reporting Performance & Scale Limits", () => {
  it("generates XLSX for 400 students x 180 classes (72,000 cells) within reasonable time", async () => {
    const studentCount = 400;
    const classCount = 180;

    const dayColumns = Array.from({ length: classCount }, (_, i) => ({
      date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
      headerLabel: `Day ${i + 1}`,
    }));

    const sampleDaily: Record<string, "P" | "A" | "L" | "E"> = {};
    for (const col of dayColumns) {
      sampleDaily[col.date] = "P";
    }

    const students = Array.from({ length: studentCount }, (_, i) => ({
      studentId: `st-${i + 1}`,
      rollNumber: i + 1,
      studentName: `Student Full Name ${i + 1}`,
      totalClasses: classCount,
      attendanceCount: classCount - 10,
      attendancePercentage: Math.round(((classCount - 10) / classCount) * 1000) / 10,
      attendanceDisplay: `${classCount - 10} (${Math.round(((classCount - 10) / classCount) * 1000) / 10}%)`,
      counts: {
        present: classCount - 12,
        absent: 10,
        late: 2,
        excused: 0,
        presentPercentage: 93.3,
        absentPercentage: 5.6,
        latePercentage: 1.1,
        excusedPercentage: 0,
      },
      dailyAttendance: sampleDaily,
    }));

    const largeAttendanceReport: CourseOfferingAttendanceReportDTO = {
      type: "course-offering-attendance",
      metadata: {
        courseOfferingId: "co-large",
        courseName: "Large Scale Digital Systems",
        courseCode: "LSDS-401",
        trade: "Computer Science",
        tradeCode: "CS",
        academicYear: "2026-27",
        semester: "Semester 4",
        shift: "Morning",
        section: "A",
        context: "LSDS-401 — A (Morning)",
        teacherName: "Senior Professor",
        totalClasses: classCount,
        dateRange: {
          from: null,
          to: null,
          isFullPeriod: true,
          displayText: "Full Period",
        },
        generatedAt: new Date().toISOString(),
      },
      dayColumns,
      students,
      summary: {
        totalStudents: studentCount,
        totalClasses: classCount,
        averageAttendancePercentage: 94.4,
      },
    };

    const startTime = performance.now();
    const exporter = new BrowserXlsxExporter();
    const file = await exporter.export(largeAttendanceReport);
    const duration = performance.now() - startTime;

    expect(file.size).toBeGreaterThan(10000);
    // Even in JS sandbox, 400 x 180 should finish within a few seconds
    expect(duration).toBeLessThan(15000);
  });
});
