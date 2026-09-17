import type { AnyReportDTO } from "../reporting.types";
import { sanitizeFilename } from "../reporting.utils";

/**
 * Standard filename generator according to specification requirements:
 *
 * attendance-Digital-Electronics-EC-S2-M-A.pdf / .xlsx
 * student-attendance-Rifat-S2.pdf / .xlsx
 * assessment-Digital-Electronics-EC-S2-M-A.pdf / .xlsx
 * student-marks-S2.pdf / .xlsx
 */
export function generateExportFilename(
  report: AnyReportDTO,
  extension: "xlsx" | "pdf"
): string {
  let base = "";

  switch (report.type) {
    case "course-offering-attendance": {
      const meta = report.metadata;
      const course = sanitizeFilename(meta.courseName);
      const trade = sanitizeFilename(meta.tradeCode || meta.trade);
      const sem = sanitizeFilename(meta.semester.replace(/\s+/g, ""));
      const shift = meta.shift.charAt(0).toUpperCase();
      const section = sanitizeFilename(meta.section);
      base = `attendance-${course}-${trade}-${sem}-${shift}-${section}`;
      break;
    }

    case "student-attendance": {
      const meta = report.metadata;
      const name = sanitizeFilename(meta.studentName);
      const sem = sanitizeFilename(meta.semester.replace(/\s+/g, ""));
      base = `student-attendance-${name}-${sem}`;
      break;
    }

    case "course-offering-assessment": {
      const meta = report.metadata;
      const course = sanitizeFilename(meta.courseName);
      const trade = sanitizeFilename(meta.tradeCode || meta.trade);
      const sem = sanitizeFilename(meta.semester.replace(/\s+/g, ""));
      const shift = meta.shift.charAt(0).toUpperCase();
      const section = sanitizeFilename(meta.section);
      base = `assessment-${course}-${trade}-${sem}-${shift}-${section}`;
      break;
    }

    case "student-semester-marks": {
      const meta = report.metadata;
      const sem = sanitizeFilename(meta.semester.replace(/\s+/g, ""));
      base = `student-marks-${sem}`;
      break;
    }
  }

  return `${base}.${extension}`;
}
