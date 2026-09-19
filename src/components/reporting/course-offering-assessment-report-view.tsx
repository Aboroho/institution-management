"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import {
  Card,
  Table,
  CardSkeleton,
  TableSkeleton,
  ErrorState,
  EmptyState,
  Button,
  Badge,
} from "@/components/ui";
import { Calendar, Filter } from "lucide-react";
import type { CourseOfferingAssessmentReportDTO } from "@/modules/reporting/reporting.types";
import { ReportExportControls } from "./report-export-controls";

interface CourseOfferingAssessmentReportViewProps {
  courseOfferingId: string;
}

export function CourseOfferingAssessmentReportView({
  courseOfferingId,
}: CourseOfferingAssessmentReportViewProps) {
  const [dateRangeType, setDateRangeType] = useState<"full" | "custom">("full");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [activeParams, setActiveParams] = useState<{
    from?: string;
    to?: string;
  }>({});

  const queryUrl = `/reports/marks/course-offerings/${courseOfferingId}${qs(activeParams)}`;

  const { data, error, isLoading, mutate } = useSWR(
    `report-marks-co-${courseOfferingId}-${JSON.stringify(activeParams)}`,
    () => get<CourseOfferingAssessmentReportDTO>(queryUrl).then((r) => r.data)
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
  const assessments = data?.assessments || [];
  const students = data?.students || [];

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
        <><CardSkeleton lines={4} /><TableSkeleton columns={6} rows={6} label="Loading assessment report" /></>
      ) : error ? (
        <ErrorState message="Failed to load assessment report" onRetry={() => mutate()} />
      ) : !data ? (
        <EmptyState title="No report data" />
      ) : (
        <div className="space-y-4">
          {/* Metadata */}
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <span className="text-xs text-slate-500">Course</span>
                <p className="font-semibold text-slate-900">{meta?.courseName}</p>
                <p className="text-xs text-slate-500">{meta?.courseCode}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Trade</span>
                <p className="font-semibold text-slate-900">{meta?.trade}</p>
                <p className="text-xs text-slate-500">{meta?.tradeCode}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Academic Context</span>
                <p className="font-medium text-slate-900">
                  {meta?.academicYear} · {meta?.semester}
                </p>
                <p className="text-xs text-slate-500">
                  {meta?.shift} · Section {meta?.section}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Teacher</span>
                <p className="font-medium text-slate-900">{meta?.teacherName || "Unassigned"}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Total Assessments</span>
                <p className="text-xl font-bold text-slate-900">{meta?.totalAssessments}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Date Range</span>
                <p className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Calendar size={14} className="text-slate-400" />
                  {meta?.dateRange.displayText}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Enrolled Students</span>
                <p className="text-xl font-bold text-slate-900">{students.length}</p>
              </div>
            </div>
          </Card>

          {/* Assessments Overview Table */}
          <Card className="p-4">
            <h3 className="mb-3 font-semibold text-slate-900">Assessments Summary</h3>
            {assessments.length === 0 ? (
              <p className="text-sm italic text-slate-500">No assessments in selected period</p>
            ) : (
              <Table
                headers={[
                  "Assessment Name",
                  "Marks Obtained (Avg)",
                  "Total Marks",
                  "Assessment Type",
                  "Counts Toward Final",
                  "Date",
                ]}
              >
                {assessments.map((a) => (
                  <tr key={a.assessmentId}>
                    <td className="px-4 py-3 font-medium text-slate-900">{a.assessmentName}</td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-800">
                      {a.averageMarksDisplay}
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

          {/* Student Performance Matrix */}
          {assessments.length > 0 && students.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 font-semibold text-slate-900">Student Performance Matrix</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 text-center">Roll</th>
                      <th className="px-4 py-2.5">Student Name</th>
                      {assessments.map((a) => (
                        <th
                          key={a.assessmentId}
                          className="whitespace-nowrap px-3 py-2.5 text-center"
                        >
                          {a.assessmentName} (/{a.totalMarks})
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center">Total</th>
                      <th className="px-3 py-2.5 text-center">Overall %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {students.map((st) => (
                      <tr key={st.studentId} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-center font-medium">
                          {st.rollNumber !== null ? st.rollNumber : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {st.studentName}
                        </td>
                        {assessments.map((a) => {
                          const m = st.marks[a.assessmentId];
                          return (
                            <td
                              key={a.assessmentId}
                              className="px-3 py-2.5 text-center text-xs font-medium text-slate-700"
                            >
                              {m?.display || "—"}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">
                          {st.totalObtained} / {st.totalPossible}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-brand-600">
                          {st.overallPercentage}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
