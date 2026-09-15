"use client";
/**
 * AdminAttendanceBrowser
 *
 * Read-only attendance inspection for admins: pick an academic context
 * through dependent selectors, then inspect the attendance sessions of the
 * selected course offering. No take/edit controls are rendered here (and the
 * API rejects admin writes with 403 as well).
 *
 * The cascade rules and option builders live in
 * `@/modules/attendance/attendance-browser-filters` (pure + unit tested).
 * Dependency model (follows the database relationships — Section and
 * CourseOffering carry the academic context FKs, and Semester is trade-scoped):
 *
 *   Academic Year ────────────────────────────┐
 *   Trade ──► Semester (trade-scoped) ────────┼──► Section ──► Course Offering
 *   Shift ────────────────────────────────────┘
 *
 * Year/trade/shift are independent roots; the semester list is narrowed by the
 * chosen trade, sections by the chosen roots, and offerings by the chosen
 * section plus the same roots. Whenever a parent selection changes, dependent
 * values that are no longer valid are cleared so stale selections are never
 * left active.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import {
  Card, Label, SearchableSelect, EmptyState, LoadingSkeleton, ErrorState,
} from "@/components/ui";
import { AttendanceReportList } from "./attendance-report-list";
import {
  EMPTY_ATTENDANCE_CONTEXT,
  offeringsPath,
  pruneContext,
  sectionsPath,
  semestersPath,
  toOfferingOptions,
  toSectionOptions,
  toSemesterOptions,
  toShiftOptions,
  toTradeOptions,
  toYearOptions,
  withAcademicYear,
  withSection,
  withTrade,
  type AttendanceContext,
} from "@/modules/attendance/attendance-browser-filters";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export function AdminAttendanceBrowser() {
  const [ctx, setCtx] = useState<AttendanceContext>(EMPTY_ATTENDANCE_CONTEXT);

  // ---- Root selectors (independent backend lists)
  const years = useSWR("att-years", () => get<Row[]>("/academic-years?limit=100").then((r) => r.data));
  const trades = useSWR("att-trades", () => get<Row[]>("/trades?limit=100").then((r) => r.data));
  const shifts = useSWR("att-shifts", () => get<Row[]>("/shifts").then((r) => r.data));

  // ---- Dependent: semesters are trade-scoped in the database.
  const semesterQuery = semestersPath(ctx.tradeId);
  const semesters = useSWR(`att-semesters${semesterQuery}`, () =>
    get<Row[]>(semesterQuery).then((r) => r.data));

  // ---- Dependent: sections filtered by the chosen academic context.
  const sectionQuery = sectionsPath(ctx);
  const sections = useSWR(sectionQuery ? `att-sections${sectionQuery}` : null, () =>
    get<Row[]>(sectionQuery ?? "").then((r) => r.data));

  // ---- Dependent: offerings for the chosen section (+ context narrowing).
  const offeringQuery = offeringsPath(ctx);
  const offerings = useSWR(offeringQuery ? `att-offerings${offeringQuery}` : null, () =>
    get<Row[]>(offeringQuery ?? "").then((r) => r.data));

  // ---- Dependent: offering context header (course/section/trade/...).
  const offeringDetail = useSWR(ctx.offeringId ? `att-offering-${ctx.offeringId}` : null, () =>
    get<Row>(`/course-offerings/${ctx.offeringId}`).then((r) => r.data));

  const yearOptions = useMemo(() => toYearOptions(years.data ?? []), [years.data]);
  const tradeOptions = useMemo(() => toTradeOptions(trades.data ?? []), [trades.data]);
  const semesterOptions = useMemo(() => toSemesterOptions(semesters.data ?? []), [semesters.data]);
  const shiftOptions = useMemo(() => toShiftOptions(shifts.data ?? []), [shifts.data]);
  const sectionOptions = useMemo(() => toSectionOptions(sections.data ?? []), [sections.data]);
  const offeringOptions = useMemo(() => toOfferingOptions(offerings.data ?? []), [offerings.data]);

  // ---- Invalidate stale dependents: when a parent changes and the selected
  // child is no longer among the freshly loaded options, clear it (and
  // everything below it). Lists that have not loaded yet (null) never clear a
  // selection — only real API data may.
  useEffect(() => {
    setCtx((current) =>
      pruneContext(current, {
        semesters: semesters.data ? semesterOptions : null,
        sections: sections.data ? sectionOptions : null,
        offerings: offerings.data ? offeringOptions : null,
      }),
    );
  }, [semesters.data, semesterOptions, sections.data, sectionOptions, offerings.data, offeringOptions]);

  const detail = offeringDetail.data;
  const course = detail?.course as Row | undefined;
  const section = detail?.section as Row | undefined;
  const shift = detail?.shift as Row | undefined;
  const semester = detail?.semester as Row | undefined;
  const year = detail?.academicYear as Row | undefined;
  const trade = detail?.trade as Row | undefined;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <Label>Academic Year</Label>
            <SearchableSelect
              options={yearOptions}
              value={ctx.academicYearId}
              onChange={(v) => setCtx((c) => withAcademicYear(c, v))}
              loading={years.isLoading}
              ariaLabel="Academic year"
              clearLabel="Select academic year..."
              placeholder={years.isLoading ? "Loading academic years..." : "Select academic year..."}
              emptyMessage="No academic years available"
            />
          </div>
          <div>
            <Label>Trade</Label>
            <SearchableSelect
              options={tradeOptions}
              value={ctx.tradeId}
              onChange={(v) => setCtx((c) => withTrade(c, v))}
              loading={trades.isLoading}
              ariaLabel="Trade"
              clearLabel="All trades"
              placeholder={trades.isLoading ? "Loading trades..." : "All trades"}
              emptyMessage="No trades available"
            />
          </div>
          <div>
            <Label>Semester</Label>
            <SearchableSelect
              options={semesterOptions}
              value={ctx.semesterId}
              onChange={(v) => setCtx((c) => ({ ...c, semesterId: v }))}
              loading={semesters.isLoading}
              ariaLabel="Semester"
              clearLabel="All semesters"
              placeholder={semesters.isLoading ? "Loading semesters..." : "All semesters"}
              emptyMessage={
                ctx.tradeId ? "No semesters for the selected trade" : "No semesters available"
              }
            />
          </div>
          <div>
            <Label>Shift</Label>
            <SearchableSelect
              options={shiftOptions}
              value={ctx.shiftId}
              onChange={(v) => setCtx((c) => ({ ...c, shiftId: v }))}
              loading={shifts.isLoading}
              ariaLabel="Shift"
              clearLabel="All shifts"
              placeholder={shifts.isLoading ? "Loading shifts..." : "All shifts"}
              emptyMessage="No shifts available"
            />
          </div>
          <div>
            <Label>Section</Label>
            <SearchableSelect
              options={sectionOptions}
              value={ctx.sectionId}
              onChange={(v) => setCtx((c) => withSection(c, v))}
              loading={sections.isLoading}
              disabled={!ctx.academicYearId}
              ariaLabel="Section"
              clearLabel="Select section..."
              placeholder={
                !ctx.academicYearId
                  ? "Select academic year first"
                  : sections.isLoading
                    ? "Loading sections..."
                    : "Select section..."
              }
              emptyMessage={
                !ctx.academicYearId ? "Select academic year first" : "No sections available for this selection"
              }
            />
          </div>
          <div>
            <Label>Course Offering</Label>
            <SearchableSelect
              options={offeringOptions}
              value={ctx.offeringId}
              onChange={(v) => setCtx((c) => ({ ...c, offeringId: v }))}
              loading={offerings.isLoading}
              disabled={!ctx.sectionId}
              ariaLabel="Course offering"
              clearLabel="Select course offering..."
              placeholder={
                !ctx.sectionId
                  ? "Select section first"
                  : offerings.isLoading
                    ? "Loading course offerings..."
                    : "Select course offering..."
              }
              emptyMessage={
                !ctx.sectionId ? "Select section first" : "No course offerings available for this selection"
              }
            />
          </div>
        </div>
      </Card>

      {!ctx.offeringId ? (
        <EmptyState
          title="Select a course offering"
          hint="Choose the academic context above (academic year, trade, semester, shift, section), then pick a course offering to inspect its attendance sessions."
        />
      ) : offeringDetail.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : offeringDetail.error || !detail ? (
        <ErrorState message="Failed to load course offering" onRetry={() => offeringDetail.mutate()} />
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {str(course?.title)} <span className="font-normal text-slate-500">({str(course?.code)})</span>
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Section {str(section?.name)} · {str(shift?.name)} · {str(semester?.name)} · {str(year?.name)}
                  {trade ? ` · ${str(trade.name)}` : ""}
                </p>
              </div>
              <a
                href={`/admin/course-offerings/${ctx.offeringId}/attendance?tab=report`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open dedicated report
              </a>
            </div>
          </Card>

          <AttendanceReportList
            offeringId={ctx.offeringId}
            offeringTitle={[
              str(course?.title),
              `Section ${str(section?.name)}`,
              trade ? str(trade.name) : "",
            ].filter(Boolean).join(" · ")}
            showEdit={false}
          />
        </div>
      )}
    </div>
  );
}
