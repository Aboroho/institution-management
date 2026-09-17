"use client";

import React, { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { AnyReportDTO } from "@/modules/reporting/reporting.types";
import { exportReport } from "@/modules/reporting/exporters/exporter.registry";
import { downloadReportFile } from "@/modules/reporting/exporters/download";

interface ReportExportControlsProps {
  report: AnyReportDTO | null;
  dayWiseEnabled?: boolean;
  disabled?: boolean;
}

export function ReportExportControls({
  report,
  dayWiseEnabled = false,
  disabled = false,
}: ReportExportControlsProps) {
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "pdf" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleExport(format: "xlsx" | "pdf") {
    if (!report || exportingFormat) return;

    setExportingFormat(format);
    setErrorMessage(null);
    setStatusMessage(`Generating ${format.toUpperCase()}...`);

    try {
      const file = await exportReport(report, format);
      setStatusMessage("Report generated. Downloading...");
      downloadReportFile(file);
      setTimeout(() => {
        setStatusMessage(null);
        setExportingFormat(null);
      }, 1000);
    } catch (err: unknown) {
      console.error("Export error:", err);
      const msg = err instanceof Error ? err.message : "Unable to generate the report. Please try again.";
      setErrorMessage(msg);
      setStatusMessage(null);
      setExportingFormat(null);
    }
  }

  // PDF is unavailable when day-wise attendance is enabled
  const isPdfDisabled = disabled || !report || !!exportingFormat || dayWiseEnabled;
  const isXlsxDisabled = disabled || !report || !!exportingFormat;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => handleExport("xlsx")}
          disabled={isXlsxDisabled}
          title="Export formatted Excel spreadsheet"
        >
          {exportingFormat === "xlsx" ? <Spinner /> : <FileSpreadsheet size={16} />}
          Export XLSX
        </Button>

        <Button
          variant="outline"
          onClick={() => handleExport("pdf")}
          disabled={isPdfDisabled}
          title={
            dayWiseEnabled
              ? "PDF export is unavailable when day-wise attendance is enabled"
              : "Export printable PDF document"
          }
        >
          {exportingFormat === "pdf" ? <Spinner /> : <FileText size={16} />}
          Export PDF
        </Button>
      </div>

      {statusMessage && (
        <span className="text-xs font-medium text-brand-600 animate-pulse">
          {statusMessage}
        </span>
      )}
      {errorMessage && (
        <span className="text-xs font-medium text-red-600">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
