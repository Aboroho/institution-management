import ExcelJS from "exceljs";
import type {
  ReportExporter,
  ExportFormat,
  ExportRuntime,
  ExportOptions,
  GeneratedReportFile,
} from "./exporter.interface";
import type {
  AnyReportDTO,
  CourseOfferingAttendanceReportDTO,
  StudentAttendanceReportDTO,
  CourseOfferingAssessmentReportDTO,
  StudentSemesterMarksReportDTO,
} from "../reporting.types";
import { generateExportFilename } from "./filename";
import { getAttendanceThreshold } from "../reporting.utils";

export class BrowserXlsxExporter implements ReportExporter<AnyReportDTO> {
  readonly format: ExportFormat = "xlsx";
  readonly runtime: ExportRuntime = "browser";

  async export(
    report: AnyReportDTO,
    options?: Partial<ExportOptions>
  ): Promise<GeneratedReportFile> {
    const filename = options?.filename || generateExportFilename(report, "xlsx");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Educational Management System (EMS)";
    workbook.created = new Date();

    switch (report.type) {
      case "course-offering-attendance":
        this.buildCourseOfferingAttendanceSheet(workbook, report);
        break;
      case "student-attendance":
        this.buildStudentAttendanceSheet(workbook, report);
        break;
      case "course-offering-assessment":
        this.buildCourseOfferingAssessmentSheet(workbook, report);
        break;
      case "student-semester-marks":
        this.buildStudentSemesterMarksSheet(workbook, report);
        break;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const uint8 = new Uint8Array(buffer);

    return {
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: uint8,
      size: uint8.byteLength,
    };
  }

  // -------------------------------------------------------------
  // Helpers for common styles
  // -------------------------------------------------------------
  private styleTitleBlock(
    sheet: ExcelJS.Worksheet,
    title: string,
    metadataRows: [string, string][]
  ) {
    // Title
    const titleRow = sheet.addRow([title]);
    titleRow.font = { bold: true, size: 16, color: { argb: "1E293B" } };
    sheet.addRow([]);

    // Metadata
    metadataRows.forEach(([key, val]) => {
      const row = sheet.addRow([key, val]);
      row.getCell(1).font = { bold: true, size: 10, color: { argb: "475569" } };
      row.getCell(2).font = { size: 10, color: { argb: "0F172A" } };
    });
    sheet.addRow([]);
  }

  private styleTableHeader(row: ExcelJS.Row, bgArgb = "F1F5F9") {
    row.font = { bold: true, size: 10, color: { argb: "1E293B" } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgArgb },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "CBD5E1" } },
        bottom: { style: "medium", color: { argb: "94A3B8" } },
        left: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } },
      };
    });
  }

  private applyCellBorders(row: ExcelJS.Row) {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "E2E8F0" } },
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
        left: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } },
      };
      if (!cell.alignment) {
        cell.alignment = { vertical: "middle" };
      }
    });
  }

  // -------------------------------------------------------------
  // 1. CourseOffering Attendance
  // -------------------------------------------------------------
  private buildCourseOfferingAttendanceSheet(
    wb: ExcelJS.Workbook,
    report: CourseOfferingAttendanceReportDTO
  ) {
    const isWide = !!report.dayColumns && report.dayColumns.length > 0;
    const sheet = wb.addWorksheet("Attendance Report", {
      pageSetup: {
        orientation: isWide ? "landscape" : "portrait",
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: isWide ? 0 : 1,
        fitToHeight: 0,
      },
    });

    const meta = report.metadata;
    this.styleTitleBlock(sheet, "Course Offering Attendance Report", [
      ["Course:", `${meta.courseName} (${meta.courseCode})`],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Academic Year:", meta.academicYear],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Context:", meta.context],
      ["Teacher:", meta.teacherName || "Unassigned"],
      ["Total Classes:", String(meta.totalClasses)],
      ["Date Range:", meta.dateRange.displayText],
      ["Generated At:", meta.generatedAt.slice(0, 19).replace("T", " ")],
    ]);

    // Legend
    if (isWide) {
      const legRow = sheet.addRow(["Daily Legend:", "P = Present", "A = Absent", "L = Late", "E = Excused"]);
      legRow.font = { italic: true, size: 9, color: { argb: "64748B" } };
      sheet.addRow([]);
    }

    const headers = [
      "Roll",
      "Student Name",
      "Attendance",
      "Present",
      "Absent",
      "Late",
      "Excused",
    ];

    if (report.dayColumns) {
      for (const col of report.dayColumns) {
        headers.push(col.headerLabel);
      }
    }

    const headerRow = sheet.addRow(headers);
    this.styleTableHeader(headerRow);

    // Freeze panes below header
    sheet.views = [
      { state: "frozen", xSplit: 2, ySplit: headerRow.number },
    ];

    for (const student of report.students) {
      const rowValues: (string | number)[] = [
        student.rollNumber ?? "—",
        student.studentName,
        student.attendanceDisplay,
        student.counts.present,
        student.counts.absent,
        student.counts.late,
        student.counts.excused,
      ];

      if (report.dayColumns && student.dailyAttendance) {
        for (const col of report.dayColumns) {
          rowValues.push(student.dailyAttendance[col.date] || "-");
        }
      }

      const row = sheet.addRow(rowValues);
      this.applyCellBorders(row);

      // Alignments & coloring
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
      row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(7).alignment = { horizontal: "center", vertical: "middle" };

      // Highlight attendance band
      const threshold = getAttendanceThreshold(student.attendancePercentage);
      const colorMap: Record<string, string> = {
        red: "FEE2E2",
        yellow: "FEF9C3",
        brown: "FEF3C7",
        green: "DCFCE7",
      };
      row.getCell(3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: colorMap[threshold.band] || "FFFFFF" },
      };

      if (report.dayColumns) {
        for (let c = 8; c <= headers.length; c++) {
          const val = row.getCell(c).value;
          row.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
          if (val === "P") {
            row.getCell(c).font = { color: { argb: "15803D" }, bold: true };
          } else if (val === "A") {
            row.getCell(c).font = { color: { argb: "B91C1C" }, bold: true };
          } else if (val === "L") {
            row.getCell(c).font = { color: { argb: "B45309" } };
          } else if (val === "E") {
            row.getCell(c).font = { color: { argb: "4338CA" } };
          }
        }
      }
    }

    // Set column widths
    sheet.getColumn(1).width = 10;
    sheet.getColumn(2).width = 28;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 12;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 12;
    if (report.dayColumns) {
      for (let i = 0; i < report.dayColumns.length; i++) {
        sheet.getColumn(8 + i).width = 12;
      }
    }

    // Auto-filter
    sheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: headers.length },
    };
  }

  // -------------------------------------------------------------
  // 2. Student Attendance
  // -------------------------------------------------------------
  private buildStudentAttendanceSheet(
    wb: ExcelJS.Workbook,
    report: StudentAttendanceReportDTO
  ) {
    const isWide = !!report.dayColumns && report.dayColumns.length > 0;
    const sheet = wb.addWorksheet("Student Attendance", {
      pageSetup: {
        orientation: isWide ? "landscape" : "portrait",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: isWide ? 0 : 1,
        fitToHeight: 0,
      },
    });

    const meta = report.metadata;
    this.styleTitleBlock(sheet, "Student Attendance Report", [
      ["Student Name:", meta.studentName],
      ["Student ID:", meta.studentCode],
      ["Roll Number:", meta.rollNumber !== null ? String(meta.rollNumber) : "—"],
      ["Academic Year:", meta.academicYear],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Date Range:", meta.dateRange.displayText],
      ["Generated At:", meta.generatedAt.slice(0, 19).replace("T", " ")],
    ]);

    if (isWide) {
      const legRow = sheet.addRow(["Daily Legend:", "P = Present", "A = Absent", "L = Late", "E = Excused"]);
      legRow.font = { italic: true, size: 9, color: { argb: "64748B" } };
      sheet.addRow([]);
    }

    const headers = [
      "Course Name",
      "Total Class",
      "Attendance",
      "Present",
      "Absent",
      "Late",
      "Excused",
    ];

    if (report.dayColumns) {
      for (const col of report.dayColumns) {
        headers.push(col.headerLabel);
      }
    }

    const headerRow = sheet.addRow(headers);
    this.styleTableHeader(headerRow);

    sheet.views = [
      { state: "frozen", xSplit: 1, ySplit: headerRow.number },
    ];

    for (const course of report.courses) {
      const rowValues: (string | number)[] = [
        course.courseName,
        course.totalClasses,
        course.attendanceDisplay,
        course.counts.present,
        course.counts.absent,
        course.counts.late,
        course.counts.excused,
      ];

      if (report.dayColumns && course.dailyAttendance) {
        for (const col of report.dayColumns) {
          rowValues.push(course.dailyAttendance[col.date] || "-");
        }
      }

      const row = sheet.addRow(rowValues);
      this.applyCellBorders(row);

      row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
      row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(7).alignment = { horizontal: "center", vertical: "middle" };

      const threshold = getAttendanceThreshold(course.attendancePercentage);
      const colorMap: Record<string, string> = {
        red: "FEE2E2",
        yellow: "FEF9C3",
        brown: "FEF3C7",
        green: "DCFCE7",
      };
      row.getCell(3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: colorMap[threshold.band] || "FFFFFF" },
      };

      if (report.dayColumns) {
        for (let c = 8; c <= headers.length; c++) {
          const val = row.getCell(c).value;
          row.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
          if (val === "P") row.getCell(c).font = { color: { argb: "15803D" }, bold: true };
          else if (val === "A") row.getCell(c).font = { color: { argb: "B91C1C" }, bold: true };
          else if (val === "L") row.getCell(c).font = { color: { argb: "B45309" } };
          else if (val === "E") row.getCell(c).font = { color: { argb: "4338CA" } };
        }
      }
    }

    sheet.getColumn(1).width = 32;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 12;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 12;
    if (report.dayColumns) {
      for (let i = 0; i < report.dayColumns.length; i++) {
        sheet.getColumn(8 + i).width = 12;
      }
    }

    sheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: headers.length },
    };
  }

  // -------------------------------------------------------------
  // 3. CourseOffering Assessment
  // -------------------------------------------------------------
  private buildCourseOfferingAssessmentSheet(
    wb: ExcelJS.Workbook,
    report: CourseOfferingAssessmentReportDTO
  ) {
    const sheet = wb.addWorksheet("Assessment Report", {
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const meta = report.metadata;
    this.styleTitleBlock(sheet, "Course Offering Assessment Report", [
      ["Course:", `${meta.courseName} (${meta.courseCode})`],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Academic Year:", meta.academicYear],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Context:", meta.context],
      ["Teacher:", meta.teacherName || "Unassigned"],
      ["Total Assessments:", String(meta.totalAssessments)],
      ["Date Range:", meta.dateRange.displayText],
      ["Generated At:", meta.generatedAt.slice(0, 19).replace("T", " ")],
    ]);

    // Summary of assessments table
    const aHeaders = [
      "Assessment Name",
      "Marks Obtained",
      "Total Marks",
      "Assessment Type",
      "Counts Toward Final",
      "Date",
    ];
    const aHeaderRow = sheet.addRow(aHeaders);
    this.styleTableHeader(aHeaderRow, "E2E8F0");

    for (const a of report.assessments) {
      const aRow = sheet.addRow([
        a.assessmentName,
        a.averageMarksDisplay,
        a.totalMarks,
        a.assessmentType,
        a.countsTowardFinal ? "Yes" : "No",
        a.date || "—",
      ]);
      this.applyCellBorders(aRow);
      aRow.getCell(2).alignment = { horizontal: "center" };
      aRow.getCell(3).alignment = { horizontal: "center" };
      aRow.getCell(4).alignment = { horizontal: "center" };
      aRow.getCell(5).alignment = { horizontal: "center" };
      aRow.getCell(6).alignment = { horizontal: "center" };
    }

    sheet.addRow([]);
    sheet.addRow(["Student Performance Matrix"]).font = { bold: true, size: 12 };

    const studentHeaders = ["Roll", "Student Name"];
    for (const a of report.assessments) {
      studentHeaders.push(`${a.assessmentName} (/${a.totalMarks})`);
    }
    studentHeaders.push("Total Obtained");
    studentHeaders.push("Total Possible");
    studentHeaders.push("Overall %");

    const matrixHeaderRow = sheet.addRow(studentHeaders);
    this.styleTableHeader(matrixHeaderRow);

    sheet.views = [
      { state: "frozen", xSplit: 2, ySplit: matrixHeaderRow.number },
    ];

    for (const student of report.students) {
      const rowVals: (string | number)[] = [
        student.rollNumber ?? "—",
        student.studentName,
      ];
      for (const a of report.assessments) {
        rowVals.push(student.marks[a.assessmentId]?.display || "—");
      }
      rowVals.push(student.totalObtained);
      rowVals.push(student.totalPossible);
      rowVals.push(`${student.overallPercentage}%`);

      const row = sheet.addRow(rowVals);
      this.applyCellBorders(row);
      row.getCell(1).alignment = { horizontal: "center" };
      for (let i = 3; i <= studentHeaders.length; i++) {
        row.getCell(i).alignment = { horizontal: "center" };
      }
    }

    sheet.getColumn(1).width = 10;
    sheet.getColumn(2).width = 26;
    for (let i = 3; i <= studentHeaders.length; i++) {
      sheet.getColumn(i).width = 18;
    }

    sheet.autoFilter = {
      from: { row: matrixHeaderRow.number, column: 1 },
      to: { row: matrixHeaderRow.number, column: studentHeaders.length },
    };
  }

  // -------------------------------------------------------------
  // 4. Student Semester Marks
  // -------------------------------------------------------------
  private buildStudentSemesterMarksSheet(
    wb: ExcelJS.Workbook,
    report: StudentSemesterMarksReportDTO
  ) {
    const sheet = wb.addWorksheet("Semester Marks", {
      pageSetup: {
        orientation: "portrait",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const meta = report.metadata;
    this.styleTitleBlock(sheet, "Student Running-Semester Marks Report", [
      ["Student Name:", meta.studentName],
      ["Student ID:", meta.studentCode],
      ["Roll Number:", meta.rollNumber !== null ? String(meta.rollNumber) : "—"],
      ["Academic Year:", meta.academicYear],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Total Courses:", String(meta.totalCourses)],
      ["Date Range:", meta.dateRange.displayText],
      ["Generated At:", meta.generatedAt.slice(0, 19).replace("T", " ")],
    ]);

    for (const course of report.courses) {
      const courseTitleRow = sheet.addRow([`${course.courseName} (${course.courseCode})`]);
      courseTitleRow.font = { bold: true, size: 12, color: { argb: "1E293B" } };
      sheet.addRow([]);

      if (!course.hasAssessments || course.assessments.length === 0) {
        const noRow = sheet.addRow(["No assessments in selected period"]);
        noRow.font = { italic: true, color: { argb: "64748B" } };
        sheet.addRow([]);
        continue;
      }

      const headers = [
        "Assessment Name",
        "Marks Obtained",
        "Total Marks",
        "Assessment Type",
        "Counts Toward Final",
        "Date",
      ];
      const headerRow = sheet.addRow(headers);
      this.styleTableHeader(headerRow);

      for (const a of course.assessments) {
        const row = sheet.addRow([
          a.assessmentName,
          a.marksDisplay,
          a.totalMarks,
          a.assessmentType,
          a.countsTowardFinal ? "Yes" : "No",
          a.date || "—",
        ]);
        this.applyCellBorders(row);
        row.getCell(2).alignment = { horizontal: "center" };
        row.getCell(3).alignment = { horizontal: "center" };
        row.getCell(4).alignment = { horizontal: "center" };
        row.getCell(5).alignment = { horizontal: "center" };
        row.getCell(6).alignment = { horizontal: "center" };
      }

      if (course.finalSummary) {
        const summary = course.finalSummary;
        const sumRow = sheet.addRow([
          "Course Final Summary:",
          `${summary.totalObtained} / ${summary.totalPossible} (${summary.percentage}%)`,
          `Grade: ${summary.grade}`,
          summary.passed ? "Passed" : "Failed",
        ]);
        sumRow.font = { bold: true, size: 10, color: { argb: "0F172A" } };
      }

      sheet.addRow([]);
    }

    sheet.getColumn(1).width = 30;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 14;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 20;
    sheet.getColumn(6).width = 18;
  }
}
