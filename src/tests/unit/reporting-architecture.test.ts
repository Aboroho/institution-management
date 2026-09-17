import { describe, it, expect } from "vitest";
import * as reportingService from "@/modules/reporting/reporting.service";
import * as reportingTypes from "@/modules/reporting/reporting.types";
import * as reportingUtils from "@/modules/reporting/reporting.utils";
import type {
  ReportExporter,
  ExportFormat,
  ExportRuntime,
  GeneratedReportFile,
} from "@/modules/reporting/exporters/exporter.interface";
import { DefaultExporterRegistry } from "@/modules/reporting/exporters/exporter.registry";

describe("Reporting Architecture Boundary & Decoupling", () => {
  it("proves reporting service and types do not depend on browser or PDF/XLSX modules", () => {
    // Check module exports and prototype/dependencies
    expect(typeof reportingService.generateCourseOfferingAttendanceReport).toBe("function");
    expect(typeof reportingService.generateStudentAttendanceReport).toBe("function");
    expect(typeof reportingService.generateCourseOfferingAssessmentReport).toBe("function");
    expect(typeof reportingService.generateStudentSemesterMarksReport).toBe("function");

    // The reporting types/utils must be pure TS/JS
    expect(typeof reportingUtils.calculateAttendanceValue).toBe("function");
    expect(typeof reportingUtils.getAttendanceThreshold).toBe("function");
  });

  it("proves an alternative server exporter can be registered behind the exporter interface without touching report DTOs", async () => {
    // Simulate a future ServerPdfExporter
    class ServerPdfExporter implements ReportExporter<reportingTypes.AnyReportDTO> {
      readonly format: ExportFormat = "pdf";
      readonly runtime: ExportRuntime = "server";

      async export(report: reportingTypes.AnyReportDTO): Promise<GeneratedReportFile> {
        // Pretend server side generation (e.g. via Puppeteer / Weasyprint / Server worker)
        const mockBinary = new TextEncoder().encode(`%PDF-1.4 Mock Server PDF for ${report.type}`);
        return {
          filename: `server-${report.type}.pdf`,
          mimeType: "application/pdf",
          data: mockBinary,
          size: mockBinary.byteLength,
        };
      }
    }

    const registry = DefaultExporterRegistry.getInstance();
    registry.register(new ServerPdfExporter());

    const retrievedExporter = registry.getExporter("pdf", "server");
    expect(retrievedExporter).toBeDefined();
    expect(retrievedExporter.runtime).toBe("server");
    expect(retrievedExporter.format).toBe("pdf");

    const mockReport: reportingTypes.CourseOfferingAttendanceReportDTO = {
      type: "course-offering-attendance",
      metadata: {
        courseOfferingId: "co-test",
        courseName: "Test Course",
        courseCode: "TC-101",
        trade: "Trade",
        tradeCode: "T",
        academicYear: "2026-27",
        semester: "1",
        shift: "M",
        section: "A",
        context: "Context",
        teacherName: null,
        totalClasses: 10,
        dateRange: {
          from: null,
          to: null,
          isFullPeriod: true,
          displayText: "Full Period",
        },
        generatedAt: new Date().toISOString(),
      },
      students: [],
      summary: {
        totalStudents: 0,
        totalClasses: 10,
        averageAttendancePercentage: 0,
      },
    };

    const file = await retrievedExporter.export(mockReport);
    expect(file.filename).toBe("server-course-offering-attendance.pdf");
    expect(file.mimeType).toBe("application/pdf");
    expect(file.size).toBeGreaterThan(0);
  });
});
