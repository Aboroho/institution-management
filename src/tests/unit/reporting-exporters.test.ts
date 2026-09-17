import { describe, it, expect } from "vitest";
import { BrowserXlsxExporter } from "@/modules/reporting/exporters/browser-xlsx-exporter";
import { BrowserPdfExporter } from "@/modules/reporting/exporters/browser-pdf-exporter";
import { DefaultExporterRegistry } from "@/modules/reporting/exporters/exporter.registry";
import { generateExportFilename } from "@/modules/reporting/exporters/filename";
import type {
  CourseOfferingAttendanceReportDTO,
  StudentAttendanceReportDTO,
  CourseOfferingAssessmentReportDTO,
  StudentSemesterMarksReportDTO,
} from "@/modules/reporting/reporting.types";

const mockAttendanceReport: CourseOfferingAttendanceReportDTO = {
  type: "course-offering-attendance",
  metadata: {
    courseOfferingId: "co-1",
    courseName: "Digital Electronics",
    courseCode: "EC-101",
    trade: "Electronics",
    tradeCode: "EC",
    academicYear: "2026-27",
    semester: "Semester 2",
    shift: "Morning",
    section: "A",
    context: "EC-101 — A (Morning)",
    teacherName: "John Doe",
    totalClasses: 20,
    dateRange: {
      from: null,
      to: null,
      isFullPeriod: true,
      displayText: "Full Period",
    },
    generatedAt: "2026-09-17T10:00:00.000Z",
  },
  students: [
    {
      studentId: "st-1",
      rollNumber: 1,
      studentName: "Rifat",
      totalClasses: 20,
      attendanceCount: 18,
      attendancePercentage: 90,
      attendanceDisplay: "18 (90%)",
      counts: {
        present: 18,
        absent: 2,
        late: 0,
        excused: 0,
        presentPercentage: 90,
        absentPercentage: 10,
        latePercentage: 0,
        excusedPercentage: 0,
      },
    },
  ],
  summary: {
    totalStudents: 1,
    totalClasses: 20,
    averageAttendancePercentage: 90,
  },
};

const mockStudentSemesterMarksReport: StudentSemesterMarksReportDTO = {
  type: "student-semester-marks",
  metadata: {
    studentId: "st-1",
    studentCode: "2026001",
    studentName: "Rifat",
    rollNumber: 1,
    academicYear: "2026-27",
    trade: "Electronics",
    tradeCode: "EC",
    semester: "Semester 2",
    shift: "Morning",
    section: "A",
    totalCourses: 1,
    dateRange: {
      from: null,
      to: null,
      isFullPeriod: true,
      displayText: "Full Period",
    },
    generatedAt: "2026-09-17T10:00:00.000Z",
  },
  courses: [
    {
      courseOfferingId: "co-1",
      courseName: "Digital Electronics",
      courseCode: "EC-101",
      hasAssessments: true,
      assessments: [
        {
          assessmentId: "as-1",
          assessmentName: "Class Test 1",
          marksObtained: 25,
          totalMarks: 50,
          percentage: 50,
          marksDisplay: "25 (50%)",
          assessmentType: "Class Test",
          countsTowardFinal: true,
          date: "20 August 2026",
        },
      ],
      finalSummary: {
        totalObtained: 25,
        totalPossible: 50,
        percentage: 50,
        grade: "C+",
        passed: true,
      },
    },
  ],
  summary: {
    totalCourses: 1,
    totalAssessments: 1,
  },
};

describe("Report Exporters Architecture", () => {
  it("formats sanitized export filenames correctly according to specification", () => {
    const fnXlsx = generateExportFilename(mockAttendanceReport, "xlsx");
    expect(fnXlsx).toBe("attendance-Digital-Electronics-EC-Semester2-M-A.xlsx");

    const fnPdf = generateExportFilename(mockAttendanceReport, "pdf");
    expect(fnPdf).toBe("attendance-Digital-Electronics-EC-Semester2-M-A.pdf");

    const marksFn = generateExportFilename(mockStudentSemesterMarksReport, "pdf");
    expect(marksFn).toBe("student-marks-Semester2.pdf");
  });

  it("passes the same report DTO to Browser XLSX exporter and outputs valid binary data", async () => {
    const exporter = new BrowserXlsxExporter();
    const result = await exporter.export(mockAttendanceReport);

    expect(result.filename).toContain(".xlsx");
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(result.size).toBeGreaterThan(0);
    expect(result.data instanceof Uint8Array ? result.data.byteLength : result.size).toBe(result.size);
  });

  it("passes the same report DTO to Browser PDF exporter and outputs valid binary data", async () => {
    const exporter = new BrowserPdfExporter();
    const result = await exporter.export(mockAttendanceReport);

    expect(result.filename).toContain(".pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.size).toBeGreaterThan(0);
  });

  it("prevents day-wise attendance export to PDF with an explicit error", async () => {
    const exporter = new BrowserPdfExporter();
    const dayWiseReport: CourseOfferingAttendanceReportDTO = {
      ...mockAttendanceReport,
      dayColumns: [{ date: "2026-04-20", headerLabel: "Mon, 20 Apr" }],
    };

    await expect(exporter.export(dayWiseReport)).rejects.toThrow(
      /Day-wise attendance is not supported in PDF format/
    );
  });

  it("allows day-wise attendance export to XLSX without error", async () => {
    const exporter = new BrowserXlsxExporter();
    const dayWiseReport: CourseOfferingAttendanceReportDTO = {
      ...mockAttendanceReport,
      dayColumns: [{ date: "2026-04-20", headerLabel: "Mon, 20 Apr" }],
      students: [
        {
          ...mockAttendanceReport.students[0],
          dailyAttendance: { "2026-04-20": "P" },
        },
      ],
    };

    const result = await exporter.export(dayWiseReport);
    expect(result.size).toBeGreaterThan(0);
  });

  it("retrieves registered exporters from the centralized exporter registry", () => {
    const registry = DefaultExporterRegistry.getInstance();
    const xlsxExporter = registry.getExporter("xlsx", "browser");
    const pdfExporter = registry.getExporter("pdf", "browser");

    expect(xlsxExporter.format).toBe("xlsx");
    expect(pdfExporter.format).toBe("pdf");
  });
});
