"use client";
/**
 * AdminAttendanceBrowser
 *
 * Read-only attendance inspection for admins: pick an academic context through
 * dependent selectors, then inspect the attendance sessions of the selected
 * course offering. No take/edit controls are rendered here (and the API
 * rejects admin writes with 403 as well).
 *
 * Dependency model (mirrors the database relationships — the Prisma models
 * carry the academic foreign keys):
 *
 *   Academic Year ──┐
 *   Trade ──────────┤
 *   Semester ───────┼──► Section ──► Course Offering ──► Attendance Sessions
 *   Shift ──────────┘
 *
 *   Semester.tradeId                          -> filtered by Trade
 *   Section.{academicYearId,tradeId,semesterId,shiftId}
 *   CourseOffering.{...the same four..., sectionId}
 *
 * Every selector is fed by the backend (`/academic-years`, `/trades`,
 * `/semesters`, `/shifts`, `/sections`, `/course-offerings`); the dependent
 * query string is derived from `attendanceOfferingQuery`. While options load,
 * the select shows an inline spinner (`SearchableSelect loading`); when a parent
 * changes, dependents are cleared so a stale academic context can never be
 * submitted. The pure rules live in `@/modules/attendance/attendance.filters`.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import {
  Card, Label, SearchableSelect, EmptyState, LoadingSkeleton, ErrorState, type SelectOption,
} from "@/components/ui";
import { CourseOfferingBanner } from "@/components/course-offering-context";
import { AttendanceReportList } from "./attendance-report-list";
import {
  ATTENDANCE_FILTER_LABELS,
  applyAttendanceFilterChange,
  attendanceFilterDisabledHint,
  attendanceOfferingQuery,
  emptyAttendanceFilterContext,
  isAttendanceFilterReady,
  type AttendanceFilterContext,
  type AttendanceFilterField,
} from "@/modules/attendance/attendance.filters";

// Row shapes are limited to the fields this screen renders. They are declared
// as type aliases (not interfaces) so they stay assignable to the loosely typed
// context components that read arbitrary API payloads.
type YearRow = { id: string; name: string };
type TradeRow = { id: string; name: string; code: string };
type SemesterRow = { id: string; name: string; tradeId: string };
type ShiftRow = { id: string; name: string; code?: string | null };
type SectionRow = { id: string; name: string; semester?: { name: string } | null; shift?: { name: string } | null };
type OfferingRow = { id: string; course?: { title: string; code: string } | null };
type OfferingDetailRow = {
  id: string;
  course?: { title: string; code: string } | null;
  section?: { name: string } | null;
  semester?: { name: string } | null;
  shift?: { name: string } | null;
  academicYear?: { name: string } | null;
  trade?: { name: string; code?: string } | null;
};

function toYearOptions(rows: YearRow[]): SelectOption[] {
  return rows.map((r) => ({ value: r.id, label: r.name, search: r.name.toLowerCase() }));
}

function toTradeOptions(rows: TradeRow[]): SelectOption[] {
  return rows.map((r) => {
    const label = `${r.name} (${r.code})`;
    return { value: r.id, label, search: `${r.name} ${r.code}`.toLowerCase() };
  });
}

function toSemesterOptions(rows: SemesterRow[]): SelectOption[] {
  return rows.map((r) => ({ value: r.id, label: r.name, search: r.name.toLowerCase() }));
}

function toShiftOptions(rows: ShiftRow[]): SelectOption[] {
  return rows.map((r) => {
    const label = r.name;
    return { value: r.id, label, search: `${label} ${r.code ?? ""}`.toLowerCase() };
  });
}

function toSectionOptions(rows: SectionRow[]): SelectOption[] {
  return rows.map((r) => {
    // Sections are often just named "A"/"B" — include semester + shift so
    // identically-named sections across contexts stay distinguishable.
    const label = `Section ${r.name}${r.semester?.name ? ` · ${r.semester.name}` : ""}${r.shift?.name ? ` · ${r.shift.name}` : ""}`;
    return { value: r.id, label, search: label.toLowerCase() };
  });
}

function toOfferingOptions(rows: OfferingRow[]): SelectOption[] {
  return rows.map((r) => {
    const label = `${r.course?.code ?? ""} — ${r.course?.title ?? ""}`;
    return { value: r.id, label, search: `${r.course?.code ?? ""} ${r.course?.title ?? ""}`.toLowerCase() };
  });
}

export function AdminAttendanceBrowser() {
  const [filters, setFilters] = useState<AttendanceFilterContext>(emptyAttendanceFilterContext);
  const { academicYearId, tradeId, semesterId, shiftId, sectionId, courseOfferingId } = filters;

  function setFilter(field: AttendanceFilterField) {
    return (value: string) => setFilters((current) => applyAttendanceFilterChange(current, field, value));
  }

  // ---- Root selectors (independent backend lists)
  const years = useSWR("att-years", () => get<YearRow[]>("/academic-years?limit=100").then((r) => r.data));
  const trades = useSWR("att-trades", () => get<TradeRow[]>("/trades?limit=100").then((r) => r.data));
  const semesters = useSWR(
    tradeId ? `att-semesters-${tradeId}` : null,
    () => get<SemesterRow[]>(`/semesters?tradeId=${encodeURIComponent(tradeId)}`).then((r) => r.data),
  );
  const shifts = useSWR("att-shifts", () => get<ShiftRow[]>("/shifts").then((r) => r.data));

  // ---- Dependent: sections filtered by the whole academic context.
  const sectionsReady = isAttendanceFilterReady(filters, "sectionId");
  const sectionsQuery = sectionsReady
    ? qs({ limit: 100, academicYearId, tradeId, semesterId, shiftId })
    : null;
  const sections = useSWR(
    sectionsQuery ? `att-sections${sectionsQuery}` : null,
    () => get<SectionRow[]>(`/sections${sectionsQuery}`).then((r) => r.data),
  );

  // ---- Dependent: offerings for the chosen section (+ context narrowing).
  const offeringsQuery = sectionId
    ? qs({ limit: 100, ...attendanceOfferingQuery(filters) })
    : null;
  const offerings = useSWR(
    offeringsQuery ? `att-offerings${offeringsQuery}` : null,
    () => get<OfferingRow[]>(`/course-offerings${offeringsQuery}`).then((r) => r.data),
  );

  // ---- Dependent: offering context header (course/section/shift/...).
  const offeringDetail = useSWR(
    courseOfferingId ? `att-offering-${courseOfferingId}` : null,
    () => get<OfferingDetailRow>(`/course-offerings/${courseOfferingId}`).then((r) => r.data),
  );

  const yearOptions = useMemo(() => toYearOptions(years.data ?? []), [years.data]);
  const tradeOptions = useMemo(() => toTradeOptions(trades.data ?? []), [trades.data]);
  const semesterOptions = useMemo(() => toSemesterOptions(semesters.data ?? []), [semesters.data]);
  const shiftOptions = useMemo(() => toShiftOptions(shifts.data ?? []), [shifts.data]);
  const sectionOptions = useMemo(() => toSectionOptions(sections.data ?? []), [sections.data]);
  const offeringOptions = useMemo(() => toOfferingOptions(offerings.data ?? []), [offerings.data]);

  // ---- Invalidate stale dependents: when a parent changes and the selected
  // child is no longer among the freshly loaded options, clear it (and
  // everything below it). Never clear while the child list is still loading.
  useEffect(() => {
    if (!sectionId) return;
    if (sections.isLoading || sections.data === undefined) return;
    if (!sectionOptions.some((o) => o.value === sectionId)) {
      // Clearing the section clears every dependent (including the offering).
      setFilters((current) => applyAttendanceFilterChange(current, "sectionId", ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.data, sections.isLoading]);

  useEffect(() => {
    if (!courseOfferingId) return;
    if (offerings.isLoading || offerings.data === undefined) return;
    if (!offeringOptions.some((o) => o.value === courseOfferingId)) {
      setFilters((current) => applyAttendanceFilterChange(current, "courseOfferingId", ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerings.data, offerings.isLoading]);

  const detail = offeringDetail.data;

  /** Shared props for one dependent selector. */
  function selectProps(field: AttendanceFilterField) {
    const ready = isAttendanceFilterReady(filters, field);
    const hint = attendanceFilterDisabledHint(filters, field);
    return {
      disabled: !ready,
      placeholder: !ready && hint ? `${hint}...` : `${ATTENDANCE_FILTER_LABELS[field]}...`,
    };
  }

  const semesterProps = selectProps("semesterId");
  const sectionProps = selectProps("sectionId");
  const offeringProps = selectProps("courseOfferingId");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <Label>Academic Year</Label>
            <SearchableSelect
              options={yearOptions}
              value={academicYearId}
              onChange={setFilter("academicYearId")}
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
              value={tradeId}
              onChange={setFilter("tradeId")}
              loading={trades.isLoading}
              ariaLabel="Trade"
              clearLabel="Select trade..."
              placeholder={trades.isLoading ? "Loading trades..." : "Select trade..."}
              emptyMessage="No trades available"
            />
          </div>
          <div>
            <Label>Semester</Label>
            <SearchableSelect
              options={semesterOptions}
              value={semesterId}
              onChange={setFilter("semesterId")}
              loading={semesters.isLoading}
              disabled={semesterProps.disabled}
              ariaLabel="Semester"
              clearLabel="Select semester..."
              placeholder={semesters.isLoading ? "Loading semesters..." : semesterProps.placeholder}
              emptyMessage={semesterProps.disabled ? semesterProps.placeholder : "No semesters available for this trade"}
            />
          </div>
          <div>
            <Label>Shift</Label>
            <SearchableSelect
              options={shiftOptions}
              value={shiftId}
              onChange={setFilter("shiftId")}
              loading={shifts.isLoading}
              ariaLabel="Shift"
              clearLabel="Select shift..."
              placeholder={shifts.isLoading ? "Loading shifts..." : "Select shift..."}
              emptyMessage="No shifts available"
            />
          </div>
          <div>
            <Label>Section</Label>
            <SearchableSelect
              options={sectionOptions}
              value={sectionId}
              onChange={setFilter("sectionId")}
              loading={sections.isLoading}
              disabled={sectionProps.disabled}
              ariaLabel="Section"
              clearLabel="Select section..."
              placeholder={sections.isLoading ? "Loading sections..." : sectionProps.placeholder}
              emptyMessage={sectionProps.disabled ? sectionProps.placeholder : "No sections available for this selection"}
            />
          </div>
          <div>
            <Label>Course Offering</Label>
            <SearchableSelect
              options={offeringOptions}
              value={courseOfferingId}
              onChange={setFilter("courseOfferingId")}
              loading={offerings.isLoading}
              disabled={offeringProps.disabled}
              ariaLabel="Course offering"
              clearLabel="Select course offering..."
              placeholder={offerings.isLoading ? "Loading course offerings..." : offeringProps.placeholder}
              emptyMessage={offeringProps.disabled ? offeringProps.placeholder : "No course offerings available for this selection"}
            />
          </div>
        </div>
      </Card>

      {!courseOfferingId ? (
        <EmptyState
          title="Select a course offering"
          hint="Choose the academic context above, then pick a course offering to inspect its attendance sessions."
        />
      ) : offeringDetail.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : offeringDetail.error || !detail ? (
        <ErrorState message="Failed to load course offering" onRetry={() => offeringDetail.mutate()} />
      ) : (
        <div className="space-y-4">
          <CourseOfferingBanner
            offering={detail}
            eyebrow="Viewing attendance for"
            action={
              <a
                href={`/admin/course-offerings/${courseOfferingId}/attendance?tab=report`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
              >
                Open dedicated report
              </a>
            }
          />

          <AttendanceReportList
            offeringId={courseOfferingId}
            offering={detail}
            showEdit={false}
          />
        </div>
      )}
    </div>
  );
}
