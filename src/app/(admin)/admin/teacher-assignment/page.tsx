"use client";
/**
 * Centralized teacher-assignment workflow (/admin/teacher-assignment).
 *
 * The admin selects the academic context BEFORE the course offering:
 *
 *   Academic Year -> Trade -> Semester -> Shift -> Section -> Course Offering -> Teacher
 *
 * Every selector is backed by real backend data; dependent selectors refresh
 * when their parent changes and stale dependent selections are cleared. The
 * selected offering is always submitted by its real database ID (the
 * human-readable `context` code is display-only).
 *
 * The same page also lists all assignment history, where active assignments
 * can be substituted directly. History is preserved — substitution closes the
 * old assignment and creates a new one (transactionally, backend-enforced).
 */
import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, qs } from "@/lib/api/client";
import {
  useAcademicYears, useTrades, useSemesters, useShifts, useSections, useOfferings,
} from "@/components/academic-options";
import { applyDependentChange } from "@/components/filter-defaults";
import {
  PageHeader, Button, Table, LoadingSkeleton, ErrorState, EmptyState, SearchableSelect,
  Label, Pagination, Breadcrumbs, Badge, Card,
} from "@/components/ui";
import { CourseOfferingCell, CourseOfferingBadges } from "@/components/course-offering-context";
import {
  AssignTeacherDialog, SubstituteDialog, assignedTeacherName,
} from "@/components/teacher-assignment";
import { offeringAvailable } from "@/lib/course-offering-context";
import { ArrowLeftRight, BookOpenCheck, UserPlus } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Selector dependency chain for this workflow:
 *   Semester       <- Trade
 *   Section        <- Academic Year, Trade, Semester, Shift
 *   CourseOffering <- Academic Year, Trade, Semester, Shift, Section
 * applyDependentChange() clears any stale child when a parent changes.
 */
const CONTEXT_DEPS: Record<string, string[]> = {
  semesterId: ["tradeId"],
  sectionId: ["academicYearId", "tradeId", "semesterId", "shiftId"],
  courseOfferingId: ["academicYearId", "tradeId", "semesterId", "shiftId", "sectionId"],
};

const EMPTY_SELECTION: Record<string, string> = {
  academicYearId: "",
  tradeId: "",
  semesterId: "",
  shiftId: "",
  sectionId: "",
  courseOfferingId: "",
};

export default function TeacherAssignmentPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [sel, setSel] = useState<Record<string, string>>({ ...EMPTY_SELECTION });
  const [substitute, setSubstitute] = useState<{ offering: Row; teacherName: string | null } | null>(null);

  // Assignment history (centralized view). Mutated after assign/substitute.
  const [page, setPage] = useState(1);
  const query = qs({ page, limit: 25 });
  const { data, error, isLoading, mutate } = useSWR(`teacher-assignment-history${query}`, () => get<Row[]>(`/teacher-assignments${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);
  const refresh = () => mutate();

  // Dependent selectors — each hook refetches from the backend when its
  // parent selection changes (SWR key includes the parent IDs).
  const semesters = useSemesters(sel.tradeId || undefined);
  const sections = useSections({
    academicYearId: sel.academicYearId || undefined,
    tradeId: sel.tradeId || undefined,
    semesterId: sel.semesterId || undefined,
    shiftId: sel.shiftId || undefined,
  });
  const offeringParams = qs({
    academicYearId: sel.academicYearId,
    tradeId: sel.tradeId,
    semesterId: sel.semesterId,
    shiftId: sel.shiftId,
    sectionId: sel.sectionId,
  });
  const offerings = useOfferings(offeringParams);

  const selectedOffering = useMemo(
    () => offerings.find((o) => o.value === sel.courseOfferingId)?.row ?? null,
    [offerings, sel.courseOfferingId]
  );

  function setContext(k: string, v: string) {
    setSel((prev) => applyDependentChange(prev, k, v, CONTEXT_DEPS));
  }

  const yearSelected = Boolean(sel.academicYearId);
  const tradeSelected = Boolean(sel.tradeId);
  const semesterSelected = Boolean(sel.semesterId);
  const shiftSelected = Boolean(sel.shiftId);
  const sectionSelected = Boolean(sel.sectionId);
  const allContextSelected = yearSelected && tradeSelected && semesterSelected && shiftSelected && sectionSelected;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Teacher Assignment" }]} />
      <PageHeader
        title="Teacher Assignment"
        subtitle="Centralized assignment & substitution workflow — exactly one active teacher per course offering."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
            <BookOpenCheck size={16} className="text-brand-600" /> 1 · Find the course offering
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Academic year</Label>
              <SearchableSelect options={years} value={sel.academicYearId} onChange={(v) => setContext("academicYearId", v)} clearLabel="All years" ariaLabel="Academic year" />
            </div>
            <div>
              <Label>Trade</Label>
              <SearchableSelect options={trades} value={sel.tradeId} onChange={(v) => setContext("tradeId", v)} clearLabel="All trades" ariaLabel="Trade" />
            </div>
            <div>
              <Label>Semester</Label>
              <SearchableSelect
                options={semesters}
                value={sel.semesterId}
                onChange={(v) => setContext("semesterId", v)}
                clearLabel="All semesters"
                ariaLabel="Semester"
                disabled={!tradeSelected}
                placeholder={tradeSelected ? "Select..." : "Select a trade first"}
                emptyMessage="No semesters for this trade"
              />
            </div>
            <div>
              <Label>Shift</Label>
              <SearchableSelect options={shifts} value={sel.shiftId} onChange={(v) => setContext("shiftId", v)} clearLabel="All shifts" ariaLabel="Shift" />
            </div>
            <div>
              <Label>Section</Label>
              <SearchableSelect
                options={sections}
                value={sel.sectionId}
                onChange={(v) => setContext("sectionId", v)}
                clearLabel="All sections"
                ariaLabel="Section"
                disabled={!(yearSelected && tradeSelected && semesterSelected && shiftSelected)}
                placeholder={yearSelected && tradeSelected && semesterSelected && shiftSelected ? "Select..." : "Complete year, trade, semester and shift first"}
                emptyMessage="No sections for this context"
              />
            </div>
            <div>
              <Label>Course offering</Label>
              <SearchableSelect
                options={offerings}
                value={sel.courseOfferingId}
                onChange={(v) => setContext("courseOfferingId", v)}
                clearLabel="All offerings"
                ariaLabel="Course offering"
                disabled={!sectionSelected}
                placeholder={sectionSelected ? "Select..." : "Complete the academic context first"}
                emptyMessage="No course offerings in this context"
              />
            </div>
          </div>
          {!allContextSelected && (
            <p className="mt-3 text-xs text-slate-500">
              Select the academic context (Year → Trade → Semester → Shift → Section) to narrow the course offerings.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
            <UserPlus size={16} className="text-brand-600" /> 2 · Assign or substitute
          </p>
          {selectedOffering ? (
            <SelectedOfferingPanel offering={selectedOffering} onSaved={refresh} />
          ) : (
            <EmptyState
              title="No course offering selected"
              hint="Use the academic context selectors on the left to find a course offering, then assign a teacher or substitute the current one."
            />
          )}
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-800">Assignment history</p>
          <span className="text-sm text-slate-500">Closed assignments are preserved — history is never overwritten.</span>
        </div>
        {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load assignments" onRetry={() => mutate()} /> : items.length === 0 ? (
          <EmptyState title="No assignments yet" hint="Use the selectors above to assign the first teacher." />
        ) : (
          <>
            <Table headers={["Course offering", "Teacher", "Since", "Until", "Status", "Actions"]}>
              {items.map((r) => (
                <tr key={str(r.id)} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/course-offerings/${str((r.courseOffering as Row)?.id)}`} className="block">
                      <CourseOfferingCell offering={r.courseOffering as Row} />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {str(((r.teacher as Row)?.user as Row)?.name)}{" "}
                    <span className="text-xs text-slate-400">({str((r.teacher as Row)?.employeeId)})</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{str(r.assignedAt).slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.endedAt ? str(r.endedAt).slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Closed</Badge>}</td>
                  <td className="px-4 py-3">
                    {r.isActive ? (
                      <Button variant="outline" onClick={() => setSubstitute({ offering: r.courseOffering as Row, teacherName: str(((r.teacher as Row)?.user as Row)?.name) })}>
                        <ArrowLeftRight size={14} /> Substitute
                      </Button>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={25} total={total} onPage={setPage} />
          </>
        )}
      </div>

      <SubstituteDialog
        open={substitute !== null}
        offering={substitute?.offering ?? null}
        currentTeacherName={substitute?.teacherName ?? null}
        onClose={() => setSubstitute(null)}
        onSaved={() => { setSubstitute(null); refresh(); }}
      />
    </div>
  );
}

function SelectedOfferingPanel({ offering, onSaved }: { offering: Row; onSaved: () => void }) {
  const teacherName = assignedTeacherName(offering);
  const available = offeringAvailable(offering);
  const yearInactive = (offering.academicYear as Row | undefined)?.isActive === false;
  const [assignOpen, setAssignOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">{str((offering.course as Row)?.title)}</p>
            {str(offering.context) && (
              <p className="mt-0.5 font-mono text-sm text-brand-700" title="Course offering context code">{str(offering.context)}</p>
            )}
            <div className="mt-2">
              <CourseOfferingBadges offering={offering} />
            </div>
          </div>
          <Link href={`/admin/course-offerings/${str(offering.id)}`} className="text-sm font-medium text-brand-600 hover:underline">
            Open offering →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm text-slate-500">Status</p>
          <p className="mt-1">
            {available ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            {yearInactive && <span className="ml-2 text-xs text-amber-600">Academic year is inactive</span>}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Teacher</p>
          <p className="mt-1 font-semibold">{teacherName ?? <span className="font-normal text-amber-600">Unassigned</span>}</p>
        </div>
        {available && (
          <div className="ml-auto">
            {teacherName ? (
              <Button variant="outline" onClick={() => setSubOpen(true)}>
                <ArrowLeftRight size={14} /> Substitute
              </Button>
            ) : (
              <Button onClick={() => setAssignOpen(true)}>
                <UserPlus size={14} /> Assign Teacher
              </Button>
            )}
          </div>
        )}
      </div>
      {!available && (
        <p className="text-sm text-amber-600">
          {yearInactive
            ? "New assignments and substitutions are unavailable while the academic year is inactive. Historical records remain accessible."
            : "This course offering is inactive — activate it (and its academic year) before assigning a teacher."}
        </p>
      )}

      <AssignTeacherDialog open={assignOpen} offering={offering} onClose={() => setAssignOpen(false)} onSaved={onSaved} />
      <SubstituteDialog open={subOpen} offering={offering} onClose={() => setSubOpen(false)} onSaved={onSaved} />
    </div>
  );
}
