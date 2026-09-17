"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import {
  Card,
  Table,
  LoadingSkeleton,
  ErrorState,
  EmptyState,
  Button,
  Badge,
} from "@/components/ui";
import { Calendar, Filter } from "lucide-react";
import type { StudentAttendanceReportDTO } from "@/modules/reporting/reporting.types";
import { AttendancePercentageBar, AttendanceLegend } from "./attendance-percentage-bar";
import { ReportExportControls } from "./report-export-controls";

interface StudentAttendanceReportViewProps {
  studentId: string;
}

export function StudentAttendanceReportView({
  studentId,
}: StudentAttendanceReportViewProps) {
  const [dateRangeType, setDateRangeType] = useState<"full" | "custom">("full");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeDayWise, setIncludeDayWise] = useState(false);

  const [activeParams, setActiveParams] = useState<{
    from?: string;
    to?: string;
    includeDayWise: boolean;
  }>({ includeDayWise: false });

  const queryUrl = `/reports/attendance/students/${studentId}${qs(activeParams)}`;

  const { data, error, isLoading, mutate } = useSWR(
    `report-att-st-${studentId}-${JSON.stringify(activeParams)}`,
    () => get<StudentAttendanceReportDTO>(queryUrl).then((r) => r.data)
  );

  function applyFilter() {
    if (dateRangeType === "full") {
      setActiveParams({ includeDayWise });
    } else {
      setActiveParams({
        from: from || undefined,
        to: to || undefined,
        includeDayWise,
      });
    }
  }

  const meta = data?.metadata;
  const courses = data?.courses || [];

  return (
    <div className="space-y-4">
      {/* Controls Card */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Date Range
              </label>
              <select
                value={dateRangeType}
                onChange={(e) => setDateRangeType(e.target.value as "full" | "custom")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="full">Full Period</option>
                <option value="custom">Custom From / To</option>
              </select>
            </div>

            {dateRangeType === "custom" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Include Day-wise Attendance
              </label>
              <select
                value={includeDayWise ? "yes" : "no"}
                onChange={(e) => setIncludeDayWise(e.target.value === "yes")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="no">No</option>
                <option value="yes">Yes (XLSX only)</option>
              </select>
            </div>

            <Button onClick={applyFilter}>
              <Filter size={15} /> Apply
            </Button>
          </div>

          <ReportExportControls
            report={data || null}
            dayWiseEnabled={activeParams.includeDayWise}
            disabled={isLoading || !!error}
          />
        </div>
      </Card>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : error ? (
        <ErrorState message="Failed to load attendance report" onRetry={() => mutate()} />
      ) : !data ? (
        <EmptyState title="No report data" />
      ) : (
        <div className="space-y-4">
          {/* Metadata Card */}
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <span className="text-xs text-slate-500">Student Name</span>
                <p className="font-semibold text-slate-900">{meta?.studentName}</p>
                <p className="text-xs text-slate-500">ID: {meta?.studentCode}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Roll Number</span>
                <p className="text-xl font-bold text-slate-900">
                  {meta?.rollNumber !== null ? meta?.rollNumber : "—"}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Trade / Academic Year</span>
                <p className="font-medium text-slate-900">{meta?.trade}</p>
                <p className="text-xs text-slate-500">{meta?.academicYear}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Semester & Section</span>
                <p className="font-medium text-slate-900">
                  {meta?.semester} · {meta?.shift}
                </p>
                <p className="text-xs text-slate-500">Section {meta?.section}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Total Courses</span>
                <p className="text-xl font-bold text-slate-900">{data.summary.totalCourses}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Total Classes</span>
                <p className="text-xl font-bold text-slate-900">{data.summary.totalClasses}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Date Range</span>
                <p className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Calendar size={14} className="text-slate-400" />
                  {meta?.dateRange.displayText}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Avg. Attendance</span>
                <p className="text-xl font-bold text-brand-600">
                  {data.summary.averageAttendancePercentage}%
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <AttendanceLegend />
            </div>
          </Card>

          {/* Table */}
          {courses.length === 0 ? (
            <EmptyState title="No courses found for this student" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Course Name</th>
                    <th className="px-4 py-3 text-center">Total Class</th>
                    <th className="px-4 py-3 text-center">Attendance</th>
                    <th className="min-w-[120px] px-4 py-3">Progress</th>
                    <th className="px-3 py-3 text-center">Present</th>
                    <th className="px-3 py-3 text-center">Absent</th>
                    <th className="px-3 py-3 text-center">Late</th>
                    <th className="px-3 py-3 text-center">Excused</th>
                    {data.dayColumns?.map((col) => (
                      <th
                        key={col.date}
                        className="whitespace-nowrap px-2.5 py-3 text-center text-[11px]"
                      >
                        {col.headerLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {courses.map((c) => (
                    <tr key={c.courseOfferingId} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {c.courseName}
                        <span className="ml-1 text-xs text-slate-500">({c.courseCode})</span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium">{c.totalClasses}</td>
                      <td className="px-4 py-3 text-center font-semibold text-slate-800">
                        {c.attendanceDisplay}
                      </td>
                      <td className="px-4 py-3">
                        <AttendancePercentageBar
                          percentage={c.attendancePercentage}
                          showLabel={false}
                        />
                      </td>
                      <td className="px-3 py-3 text-center text-emerald-700 font-medium">
                        {c.counts.present}
                      </td>
                      <td className="px-3 py-3 text-center text-red-700 font-medium">
                        {c.counts.absent}
                      </td>
                      <td className="px-3 py-3 text-center text-amber-700 font-medium">
                        {c.counts.late}
                      </td>
                      <td className="px-3 py-3 text-center text-blue-700 font-medium">
                        {c.counts.excused}
                      </td>

                      {data.dayColumns?.map((col) => {
                        const status = c.dailyAttendance?.[col.date] || "-";
                        let colorClass = "text-slate-400";
                        if (status === "P") colorClass = "text-emerald-700 font-bold bg-emerald-50";
                        else if (status === "A") colorClass = "text-red-700 font-bold bg-red-50";
                        else if (status === "L") colorClass = "text-amber-700 font-bold bg-amber-50";
                        else if (status === "E") colorClass = "text-blue-700 font-bold bg-blue-50";

                        return (
                          <td
                            key={col.date}
                            className={`px-2 py-3 text-center text-xs ${colorClass}`}
                          >
                            {status}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
