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
import type { StudentSemesterMarksReportDTO } from "@/modules/reporting/reporting.types";
import { ReportExportControls } from "./report-export-controls";

interface StudentSemesterMarksReportViewProps {
  studentId: string;
}

export function StudentSemesterMarksReportView({
  studentId,
}: StudentSemesterMarksReportViewProps) {
  const [dateRangeType, setDateRangeType] = useState<"full" | "custom">("full");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [activeParams, setActiveParams] = useState<{
    from?: string;
    to?: string;
  }>({});

  const queryUrl = `/reports/marks/students/${studentId}${qs(activeParams)}`;

  const { data, error, isLoading, mutate } = useSWR(
    `report-marks-st-${studentId}-${JSON.stringify(activeParams)}`,
    () => get<StudentSemesterMarksReportDTO>(queryUrl).then((r) => r.data)
  );

  function applyFilter() {
    if (dateRangeType === "full") {
      setActiveParams({});
    } else {
      setActiveParams({
        from: from || undefined,
        to: to || undefined,
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

            <Button onClick={applyFilter}>
              <Filter size={15} /> Apply
            </Button>
          </div>

          <ReportExportControls
            report={data || null}
            disabled={isLoading || !!error}
          />
        </div>
      </Card>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorState message="Failed to load semester marks report" onRetry={() => mutate()} />
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
                <p className="text-xl font-bold text-slate-900">{meta?.totalCourses}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Total Assessments</span>
                <p className="text-xl font-bold text-slate-900">
                  {data.summary.totalAssessments}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Date Range</span>
                <p className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Calendar size={14} className="text-slate-400" />
                  {meta?.dateRange.displayText}
                </p>
              </div>
            </div>
          </Card>

          {/* Grouped Courses */}
          {courses.length === 0 ? (
            <EmptyState title="No courses found in active semester" />
          ) : (
            <div className="space-y-4">
              {courses.map((c) => (
                <Card key={c.courseOfferingId} className="p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {c.courseName}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          ({c.courseCode})
                        </span>
                      </h3>
                    </div>
                    {c.finalSummary && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Final: {c.finalSummary.totalObtained} / {c.finalSummary.totalPossible} (
                          {c.finalSummary.percentage}%)
                        </span>
                        <Badge tone="blue">{c.finalSummary.grade}</Badge>
                        {c.finalSummary.passed ? (
                          <Badge tone="green">Pass</Badge>
                        ) : (
                          <Badge tone="red">Fail</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {!c.hasAssessments || c.assessments.length === 0 ? (
                    <p className="py-2 text-sm italic text-slate-500">
                      No assessments in selected period
                    </p>
                  ) : (
                    <Table
                      headers={[
                        "Assessment Name",
                        "Marks Obtained",
                        "Total Marks",
                        "Assessment Type",
                        "Counts Toward Final",
                        "Date",
                      ]}
                    >
                      {c.assessments.map((a) => (
                        <tr key={a.assessmentId}>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {a.assessmentName}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-slate-800">
                            {a.marksDisplay}
                          </td>
                          <td className="px-4 py-3 text-center">{a.totalMarks}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge tone="blue">{a.assessmentType}</Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {a.countsTowardFinal ? (
                              <Badge tone="green">Yes</Badge>
                            ) : (
                              <Badge tone="slate">No</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-slate-600">
                            {a.date || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
