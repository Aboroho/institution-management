/**
 * Export Engine Interfaces and Types
 *
 * Designed so that the export execution environment can easily be switched
 * between Browser and Server in the future without rewriting the report/business logic.
 */

import type { AnyReportDTO } from "../reporting.types";

export type ExportFormat = "xlsx" | "pdf";
export type ExportRuntime = "browser" | "server";

export interface ExportOptions {
  filename?: string;
  format: ExportFormat;
  includeDayWise?: boolean;
}

export interface GeneratedReportFile {
  filename: string;
  mimeType: string;
  data: Uint8Array | ArrayBuffer | Blob;
  size: number;
}

/**
 * Report Exporter Interface
 *
 * Implemented by BrowserXlsxExporter, BrowserPdfExporter,
 * ServerXlsxExporter (future), ServerPdfExporter (future).
 */
export interface ReportExporter<TReport extends AnyReportDTO = AnyReportDTO> {
  readonly format: ExportFormat;
  readonly runtime: ExportRuntime;
  export(report: TReport, options?: Partial<ExportOptions>): Promise<GeneratedReportFile>;
}

/**
 * Registry / Provider for Exporters
 */
export interface ExporterRegistry {
  getExporter<TReport extends AnyReportDTO>(
    format: ExportFormat,
    runtime?: ExportRuntime
  ): ReportExporter<TReport>;
}
