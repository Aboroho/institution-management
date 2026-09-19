"use client";

import React, { useState } from "react";
import { Button, Tooltip } from "@/components/ui";
import { CheckCircle2, FileSpreadsheet, FileText } from "lucide-react";
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
    setStatusMessage(null);

    try {
      // The button's own spinner communicates "working"; the status line below
      // is reserved for the terminal outcome. Previously the success message was
      // cleared by a 1s timer, which both invented a delay and left the buttons
      // disabled after the download had already been handed to the browser.
      const file = await exportReport(report, format);
      downloadReportFile(file);
      setStatusMessage(`${file.filename} downloaded.`);
    } catch (err: unknown) {
      console.error("Export error:", err);
      const msg = err instanceof Error ? err.message : "Unable to generate the report. Please try again.";
      setErrorMessage(msg);
    } finally {
      setExportingFormat(null);
    }
  }

  // PDF is unavailable when day-wise attendance is enabled
  const isPdfDisabled = disabled || !report || !!exportingFormat || dayWiseEnabled;
  const isXlsxDisabled = disabled || !report || !!exportingFormat;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Tooltip content="Downloads the rows currently shown, with the filters applied, as a formatted spreadsheet.">
          <Button
            variant="outline"
            onClick={() => void handleExport("xlsx")}
            disabled={isXlsxDisabled}
            loading={exportingFormat === "xlsx"}
            loadingText="Generating XLSX…"
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Export XLSX
          </Button>
        </Tooltip>

        <Tooltip
          content={
            dayWiseEnabled
              ? "PDF export is unavailable while day-wise attendance is on, because the daily grid does not fit the page."
              : "Downloads a printable PDF of the report as currently filtered."
          }
        >
          <Button
            variant="outline"
            onClick={() => void handleExport("pdf")}
            disabled={isPdfDisabled}
            loading={exportingFormat === "pdf"}
            loadingText="Generating PDF…"
          >
            <FileText size={16} aria-hidden="true" />
            Export PDF
          </Button>
        </Tooltip>
      </div>

      {/* Terminal outcomes are announced; they are not on a timer, so a slow
          reader or a screen reader still gets them. */}
      {statusMessage && (
        <span role="status" className="flex items-center gap-1 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={13} aria-hidden="true" /> {statusMessage}
        </span>
      )}
      {errorMessage && (
        <span role="alert" className="text-xs font-medium text-red-600">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
