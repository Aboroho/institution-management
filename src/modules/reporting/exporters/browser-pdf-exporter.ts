import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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

export class BrowserPdfExporter implements ReportExporter<AnyReportDTO> {
  readonly format: ExportFormat = "pdf";
  readonly runtime: ExportRuntime = "browser";

  async export(
    report: AnyReportDTO,
    options?: Partial<ExportOptions>
  ): Promise<GeneratedReportFile> {
    const filename = options?.filename || generateExportFilename(report, "pdf");

    // Guard: Day-wise attendance cannot be exported to PDF (XLSX only)
    if (
      (report.type === "course-offering-attendance" || report.type === "student-attendance") &&
      report.dayColumns &&
      report.dayColumns.length > 0
    ) {
      throw new Error("Day-wise attendance is not supported in PDF format. Please use XLSX export.");
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    switch (report.type) {
      case "course-offering-attendance":
        this.renderCourseOfferingAttendancePdf(doc, report);
        break;
      case "student-attendance":
        this.renderStudentAttendancePdf(doc, report);
        break;
      case "course-offering-assessment":
        this.renderCourseOfferingAssessmentPdf(doc, report);
        break;
      case "student-semester-marks":
        this.renderStudentSemesterMarksPdf(doc, report);
        break;
    }

    // Add page numbers and footers
    this.addPageFooters(doc);

    const buffer = doc.output("arraybuffer");
    const uint8 = new Uint8Array(buffer);

    return {
      filename,
      mimeType: "application/pdf",
      data: uint8,
      size: uint8.byteLength,
    };
  }

  // -------------------------------------------------------------
  // Header / Footer Decorators
  // -------------------------------------------------------------
  private renderHeader(
    doc: jsPDF,
    title: string,
    metadata: [string, string][]
  ): number {
    const pageWidth = doc.internal.pageSize.getWidth();

    // Top primary bar
    doc.setFillColor(37, 99, 235); // #2563EB Brand blue
    doc.rect(0, 0, pageWidth, 5, "F");

    let y = 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text(title, 14, y);

    y += 4;
    doc.setDrawColor(226, 232, 240); // Slate-200
    doc.setLineWidth(0.5);
    doc.line(14, y, pageWidth - 14, y);

    y += 5;
    doc.setFontSize(8.5);

    // 2-column metadata layout
    const col1X = 14;
    const col2X = pageWidth / 2 + 5;
    const half = Math.ceil(metadata.length / 2);

    for (let i = 0; i < metadata.length; i++) {
      const isCol2 = i >= half;
      const x = isCol2 ? col2X : col1X;
      const rowIdx = isCol2 ? i - half : i;
      const rowY = y + rowIdx * 4.5;

      const [label, val] = metadata[i];
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100, 116, 139); // Slate-500
      doc.text(label, x, rowY);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42); // Slate-900
      doc.text(val, x + 35, rowY);
    }

    const totalRows = Math.max(half, metadata.length - half);
    return y + totalRows * 4.5 + 4;
  }

  private addPageFooters(doc: jsPDF) {
    const totalPages = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184); // Slate-400

      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      doc.text(`Educational Management System · Generated: ${timestamp}`, 14, pageHeight - 7);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 7, { align: "right" });
    }
  }

  // Draw miniature horizontal percentage indicator bar in table cell
  private drawPercentageBar(
    doc: jsPDF,
    x: number,
    y: number,
    w: number,
    h: number,
    percentage: number
  ) {
    const threshold = getAttendanceThreshold(percentage);
    // Background slot
    doc.setFillColor(241, 245, 249); // slate-100
    doc.roundedRect(x, y, w, h, 1, 1, "F");

    // Fill
    const fillW = Math.max(1, (Math.min(100, percentage) / 100) * w);
    const hex = threshold.hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, fillW, h, 1, 1, "F");
  }

  // -------------------------------------------------------------
  // 1. CourseOffering Attendance
  // -------------------------------------------------------------
  private renderCourseOfferingAttendancePdf(
    doc: jsPDF,
    report: CourseOfferingAttendanceReportDTO
  ) {
    const meta = report.metadata;
    const startY = this.renderHeader(doc, "Course Offering Attendance Report", [
      ["Course:", `${meta.courseName} (${meta.courseCode})`],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Academic Year:", meta.academicYear],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Context:", meta.context],
      ["Teacher:", meta.teacherName || "Unassigned"],
      ["Total Classes:", String(meta.totalClasses)],
      ["Date Range:", meta.dateRange.displayText],
      ["Students:", String(report.students.length)],
    ]);

    const tableData = report.students.map((s) => [
      s.rollNumber !== null ? String(s.rollNumber) : "—",
      s.studentName,
      s.attendanceDisplay,
      "", // Placeholder for visual bar
      String(s.counts.present),
      String(s.counts.absent),
      String(s.counts.late),
      String(s.counts.excused),
    ]);

    autoTable(doc, {
      startY,
      head: [["Roll", "Student Name", "Attendance", "Progress", "Present", "Absent", "Late", "Excused"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "center",
      },
      styles: {
        fontSize: 8,
        cellPadding: 2,
        valign: "middle",
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 12 },
        1: { halign: "left", cellWidth: 46 },
        2: { halign: "center", cellWidth: 26 },
        3: { halign: "center", cellWidth: 26 }, // Progress bar column
        4: { halign: "center", cellWidth: 18 },
        5: { halign: "center", cellWidth: 18 },
        6: { halign: "center", cellWidth: 18 },
        7: { halign: "center", cellWidth: 18 },
      },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const student = report.students[data.row.index];
          if (student) {
            const barW = Math.max(10, data.cell.width - 6);
            const barH = 3.5;
            const barX = data.cell.x + 3;
            const barY = data.cell.y + (data.cell.height - barH) / 2;
            this.drawPercentageBar(doc, barX, barY, barW, barH, student.attendancePercentage);
          }
        }
      },
    });
  }

  // -------------------------------------------------------------
  // 2. Student Attendance
  // -------------------------------------------------------------
  private renderStudentAttendancePdf(
    doc: jsPDF,
    report: StudentAttendanceReportDTO
  ) {
    const meta = report.metadata;
    const startY = this.renderHeader(doc, "Student Attendance Report", [
      ["Student Name:", meta.studentName],
      ["Student ID:", meta.studentCode],
      ["Roll Number:", meta.rollNumber !== null ? String(meta.rollNumber) : "—"],
      ["Academic Year:", meta.academicYear],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Date Range:", meta.dateRange.displayText],
      ["Total Courses:", String(report.courses.length)],
      ["Total Classes:", String(report.summary.totalClasses)],
    ]);

    const tableData = report.courses.map((c) => [
      c.courseName,
      String(c.totalClasses),
      c.attendanceDisplay,
      "", // Bar placeholder
      String(c.counts.present),
      String(c.counts.absent),
      String(c.counts.late),
      String(c.counts.excused),
    ]);

    autoTable(doc, {
      startY,
      head: [["Course Name", "Total Class", "Attendance", "Progress", "Present", "Absent", "Late", "Excused"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "center",
      },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        valign: "middle",
      },
      columnStyles: {
        0: { halign: "left", cellWidth: 50 },
        1: { halign: "center", cellWidth: 20 },
        2: { halign: "center", cellWidth: 26 },
        3: { halign: "center", cellWidth: 28 },
        4: { halign: "center", cellWidth: 15 },
        5: { halign: "center", cellWidth: 15 },
        6: { halign: "center", cellWidth: 15 },
        7: { halign: "center", cellWidth: 15 },
      },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const course = report.courses[data.row.index];
          if (course) {
            const barW = data.cell.width - 6;
            const barH = 3.5;
            const barX = data.cell.x + 3;
            const barY = data.cell.y + (data.cell.height - barH) / 2;
            this.drawPercentageBar(doc, barX, barY, barW, barH, course.attendancePercentage);
          }
        }
      },
    });
  }

  // -------------------------------------------------------------
  // 3. CourseOffering Assessment
  // -------------------------------------------------------------
  private renderCourseOfferingAssessmentPdf(
    doc: jsPDF,
    report: CourseOfferingAssessmentReportDTO
  ) {
    const meta = report.metadata;
    const startY = this.renderHeader(doc, "Course Offering Assessment Report", [
      ["Course:", `${meta.courseName} (${meta.courseCode})`],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Academic Year:", meta.academicYear],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Context:", meta.context],
      ["Teacher:", meta.teacherName || "Unassigned"],
      ["Total Assessments:", String(meta.totalAssessments)],
      ["Date Range:", meta.dateRange.displayText],
      ["Students:", String(report.students.length)],
    ]);

    // Summary of assessments
    const assessmentRows = report.assessments.map((a) => [
      a.assessmentName,
      a.averageMarksDisplay,
      String(a.totalMarks),
      a.assessmentType,
      a.countsTowardFinal ? "Yes" : "No",
      a.date || "—",
    ]);

    autoTable(doc, {
      startY,
      head: [["Assessment Name", "Avg Marks", "Total Marks", "Type", "Counts Toward Final", "Date"]],
      body: assessmentRows,
      theme: "grid",
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontSize: 8.5,
        fontStyle: "bold",
        halign: "center",
      },
      styles: {
        fontSize: 8,
        cellPadding: 2,
        valign: "middle",
      },
      columnStyles: {
        0: { halign: "left" },
        1: { halign: "center" },
        2: { halign: "center" },
        3: { halign: "center" },
        4: { halign: "center" },
        5: { halign: "center" },
      },
    });

    const docAny = doc as unknown as { lastAutoTable?: { finalY: number } };
    const nextY = (docAny.lastAutoTable?.finalY ?? startY) + 6;

    // Student performance rows
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("Student Performance Summary", 14, nextY);

    const studentRows = report.students.map((s) => [
      s.rollNumber !== null ? String(s.rollNumber) : "—",
      s.studentName,
      `${s.totalObtained} / ${s.totalPossible}`,
      `${s.overallPercentage}%`,
    ]);

    autoTable(doc, {
      startY: nextY + 3,
      head: [["Roll", "Student Name", "Total Obtained", "Overall %"]],
      body: studentRows,
      theme: "grid",
      headStyles: {
        fillColor: [71, 85, 105], // slate-600
        textColor: 255,
        fontSize: 8,
        halign: "center",
      },
      styles: {
        fontSize: 8,
        cellPadding: 2,
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 15 },
        1: { halign: "left" },
        2: { halign: "center", cellWidth: 35 },
        3: { halign: "center", cellWidth: 30 },
      },
    });
  }

  // -------------------------------------------------------------
  // 4. Student Semester Marks
  // -------------------------------------------------------------
  private renderStudentSemesterMarksPdf(
    doc: jsPDF,
    report: StudentSemesterMarksReportDTO
  ) {
    const meta = report.metadata;
    let currentY = this.renderHeader(doc, "Student Running-Semester Marks Report", [
      ["Student Name:", meta.studentName],
      ["Student ID:", meta.studentCode],
      ["Roll Number:", meta.rollNumber !== null ? String(meta.rollNumber) : "—"],
      ["Academic Year:", meta.academicYear],
      ["Trade:", `${meta.trade} (${meta.tradeCode})`],
      ["Semester / Shift:", `${meta.semester} · ${meta.shift}`],
      ["Section:", meta.section],
      ["Total Courses:", String(meta.totalCourses)],
      ["Date Range:", meta.dateRange.displayText],
      ["Total Assessments:", String(report.summary.totalAssessments)],
    ]);

    for (let cIdx = 0; cIdx < report.courses.length; cIdx++) {
      const course = report.courses[cIdx];

      // Check if page overflow
      if (currentY > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text(`${course.courseName} (${course.courseCode})`, 14, currentY);
      currentY += 3;

      if (!course.hasAssessments || course.assessments.length === 0) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text("No assessments in selected period", 14, currentY + 4);
        currentY += 10;
        continue;
      }

      const rows = course.assessments.map((a) => [
        a.assessmentName,
        a.marksDisplay,
        String(a.totalMarks),
        a.assessmentType,
        a.countsTowardFinal ? "Yes" : "No",
        a.date || "—",
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [["Assessment Name", "Marks Obtained", "Total Marks", "Type", "Counts Toward Final", "Date"]],
        body: rows,
        theme: "grid",
        headStyles: {
          fillColor: [37, 99, 235],
          textColor: 255,
          fontSize: 8,
          halign: "center",
        },
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "left" },
          1: { halign: "center" },
          2: { halign: "center" },
          3: { halign: "center" },
          4: { halign: "center" },
          5: { halign: "center" },
        },
      });

      const docAny = doc as unknown as { lastAutoTable?: { finalY: number } };
      currentY = (docAny.lastAutoTable?.finalY ?? currentY) + 3;

      if (course.finalSummary) {
        const sum = course.finalSummary;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(
          `Final Result: ${sum.totalObtained} / ${sum.totalPossible} (${sum.percentage}%) · Grade ${sum.grade} (${sum.passed ? "Pass" : "Fail"})`,
          14,
          currentY
        );
        currentY += 6;
      } else {
        currentY += 4;
      }
    }
  }
}
