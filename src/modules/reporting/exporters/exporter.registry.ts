import type {
  ExportFormat,
  ExportRuntime,
  ReportExporter,
  ExporterRegistry,
} from "./exporter.interface";
import type { AnyReportDTO } from "../reporting.types";
import { BrowserXlsxExporter } from "./browser-xlsx-exporter";
import { BrowserPdfExporter } from "./browser-pdf-exporter";

/**
 * Global or configurable default runtime.
 * Can be switched dynamically or via env.
 */
let currentDefaultRuntime: ExportRuntime = "browser";

export function setDefaultExportRuntime(runtime: ExportRuntime) {
  currentDefaultRuntime = runtime;
}

export function getDefaultExportRuntime(): ExportRuntime {
  return currentDefaultRuntime;
}

/**
 * Default Exporter Registry
 */
export class DefaultExporterRegistry implements ExporterRegistry {
  private static instance: DefaultExporterRegistry;
  private exporters = new Map<string, ReportExporter<AnyReportDTO>>();

  constructor() {
    this.register(new BrowserXlsxExporter());
    this.register(new BrowserPdfExporter());
  }

  static getInstance(): DefaultExporterRegistry {
    if (!DefaultExporterRegistry.instance) {
      DefaultExporterRegistry.instance = new DefaultExporterRegistry();
    }
    return DefaultExporterRegistry.instance;
  }

  register(exporter: ReportExporter<AnyReportDTO>) {
    const key = `${exporter.runtime}:${exporter.format}`;
    this.exporters.set(key, exporter);
  }

  getExporter<TReport extends AnyReportDTO>(
    format: ExportFormat,
    runtime: ExportRuntime = currentDefaultRuntime
  ): ReportExporter<TReport> {
    const key = `${runtime}:${format}`;
    const exporter = this.exporters.get(key);
    if (!exporter) {
      throw new Error(`No report exporter registered for runtime: "${runtime}" and format: "${format}"`);
    }
    return exporter as unknown as ReportExporter<TReport>;
  }
}

/**
 * Convenient helper to export a report using the configured runtime
 */
export async function exportReport<TReport extends AnyReportDTO>(
  report: TReport,
  format: ExportFormat,
  runtime?: ExportRuntime
) {
  const exporter = DefaultExporterRegistry.getInstance().getExporter<TReport>(format, runtime);
  return exporter.export(report);
}
