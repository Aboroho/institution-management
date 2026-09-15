"use client";
/**
 * AdminAttendanceBrowser
 *
 * Read-only attendance inspection for admins: pick an academic context
 * through dependent selectors, then inspect the attendance sessions of the
 * selected course offering. No take/edit controls are rendered here (and the
 * API rejects admin writes with 403 as well).
 *
 * Dependency model (follows the database relationships — Section and
 * CourseOffering carry the academic context FKs):
 *
 *   Academic Year ──┐
 *   Semester (trade-scoped, global list) ──┼──► Section ──► Course Offering
 *   Shift (global list) ───────────────────┘
 *
 * Year/semester/shift are independent roots; sections are filtered by the
 * chosen roots; offerings are filtered by section + roots. Whenever a parent
 * selection changes, dependent values that are no longer valid are cleared
 * so stale selections are never left active.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import {
  Card, Label, SearchableSelect, EmptyState, LoadingSkeleton, ErrorState,
} from "@/components/ui";
import { AttendanceReportList } from "./attendance-report-list";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

type Option = { value: string; label: string; search: string };

function toYearOptions(rows: Row[]): Option[] {
  return rows.map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}

function toSemesterOptions(rows: Row[]): Option[] {
  return rows.map((r) => {
    const trade = r.trade as Row | undefined;
    const code = trade ? str(trade.code) : "";
    const label = code ? `${str(r.name)} (${code})` : str(r.name);
    return {
      value: str(r.id),
      label,
      search: `${str(r.name)} ${trade ? `${str(trade.name)} ${code}` : ""}`.toLowerCase(),
    };
  });
}

function toShiftOptions(rows: Row[]): Option[] {
  return rows.map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: `${label} ${str(r.code)}`.toLowerCase() };
  });
}

function toSectionOptions(rows: Row[]): Option[] {
  return rows.map((r) => {
    const sem = r.semester as Row | undefined;
    const shift = r.shift as Row | undefined;
    // Sections are often just named "A"/"B" — include semester + shift so
    // identically-named sections across contexts stay distinguishable.
    const label = `Section ${str(r.name)}${sem ? ` · ${str(sem.name)}` : ""}${shift ? ` · ${str(shift.name)}` : ""}`;
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}

function toOfferingOptions(rows: Row[]): Option[] {
  return rows.map((r) => {
    const course = r.course as Row | undefined;
    const label = `${str(course?.code)} — ${str(course?.title)}`;
    return {
      value: str(r.id),
      label,
      search: `${str(course?.code)} ${str(course?.title)}`.toLowerCase(),
    };
  });
}

export function AdminAttendanceBrowser() {
  const [yearId, setYearId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [offeringId, setOfferingId] = useState("");

  // ---- Root selectors (independent backend lists)
  const years = useSWR("att-years", () => get<Row[]>("/academic-years?limit=100").then((r) => r.data));
  const semesters = useSWR("att-semesters", () => get<Row[]>("/semesters").then((r) => r.data));
  const shifts = useSWR("att-shifts", () => get<Row[]>("/shifts").then((r) => r.data));

  // ---- Dependent: sections filtered by the chosen academic context.
  const sectionsQuery = yearId
    ? qs({ limit: 100, academicYearId: yearId, semesterId: semesterId || undefined, shiftId: shiftId || undefined })
    : null;
  const sections = useSWR(
    sectionsQuery ? `att-sections${sectionsQuery}` : null,
    () => get<Row[]>(`/sections${sectionsQuery}`).then((r) => r.data),
  );

  // ---- Dependent: offerings for the chosen section (+ context narrowing).
  const offeringsQuery = sectionId
    ? qs({
        limit: 100,
        academicYearId: yearId || undefined,
        semesterId: semesterId || undefined,
        shiftId: shiftId || undefined,
        sectionId,
      })
    : null;
  const offerings = useSWR(
    offeringsQuery ? `att-offerings${offeringsQuery}` : null,
    () => get<Row[]>(`/course-offerings${offeringsQuery}`).then((r) => r.data),
  );

  // ---- Dependent: offering context header (course/section/shift/...).
  const offeringDetail = useSWR(
    offeringId ? `att-offering-${offeringId}` : null,
    () => get<Row>(`/course-offerings/${offeringId}`).then((r) => r.data),
  );

  const yearOptions = useMemo(() => toYearOptions(years.data ?? []), [years.data]);
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
      setSectionId("");
      setOfferingId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.data, sections.isLoading]);

  useEffect(() => {
    if (!offeringId) return;
    if (offerings.isLoading || offerings.data === undefined) return;
    if (!offeringOptions.some((o) => o.value === offeringId)) {
      setOfferingId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerings.data, offerings.isLoading]);

  function onYear(v: string) {
    setYearId(v);
    if (!v) {
      // Sections require a year — without it the child chain is meaningless.
      setSectionId("");
      setOfferingId("");
    }
  }
  function onSection(v: string) {
    setSectionId(v);
    setOfferingId("");
  }

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
              value={yearId}
              onChange={onYear}
              loading={years.isLoading}
              ariaLabel="Academic year"
              clearLabel="Select academic year..."
              placeholder={years.isLoading ? "Loading academic years..." : "Select academic year..."}
              emptyMessage="No academic years available"
            />
          </div>
          <div>
            <Label>Semester</Label>
            <SearchableSelect
              options={semesterOptions}
              value={semesterId}
              onChange={setSemesterId}
              loading={semesters.isLoading}
              ariaLabel="Semester"
              clearLabel="All semesters"
              placeholder={semesters.isLoading ? "Loading semesters..." : "All semesters"}
              emptyMessage="No semesters available"
            />
          </div>
          <div>
            <Label>Shift</Label>
            <SearchableSelect
              options={shiftOptions}
              value={shiftId}
              onChange={setShiftId}
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
              value={sectionId}
              onChange={onSection}
              loading={sections.isLoading}
              disabled={!yearId}
              ariaLabel="Section"
              clearLabel="Select section..."
              placeholder={
                !yearId
                  ? "Select academic year first"
                  : sections.isLoading
                    ? "Loading sections..."
                    : "Select section..."
              }
              emptyMessage={
                !yearId ? "Select academic year first" : "No sections available for this selection"
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label>Course Offering</Label>
            <SearchableSelect
              options={offeringOptions}
              value={offeringId}
              onChange={setOfferingId}
              loading={offerings.isLoading}
              disabled={!sectionId}
              ariaLabel="Course offering"
              clearLabel="Select course offering..."
              placeholder={
                !sectionId
                  ? "Select section first"
                  : offerings.isLoading
                    ? "Loading course offerings..."
                    : "Select course offering..."
              }
              emptyMessage={
                !sectionId ? "Select section first" : "No course offerings available for this selection"
              }
            />
          </div>
        </div>
      </Card>

      {!offeringId ? (
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
                href={`/admin/course-offerings/${offeringId}/attendance?tab=report`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open dedicated report
              </a>
            </div>
          </Card>

          <AttendanceReportList
            offeringId={offeringId}
            offeringTitle={`${str(course?.title)} · Section ${str(section?.name)}`}
            showEdit={false}
          />
        </div>
      )}
    </div>
  );
}
