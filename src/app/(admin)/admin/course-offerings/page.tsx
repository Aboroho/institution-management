"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections, useCourses } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Select, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge } from "@/components/ui";
import { Plus } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function OfferingsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const courses = useCourses();
  const [f, setF] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });
  const query = qs({ page, limit: 25, ...f });
  const { data, error, isLoading, mutate } = useSWR(`offerings${query}`, () => get<Row[]>(`/course-offerings${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  const formSemesters = useSemesters(form.tradeId || undefined);
  const formSections = useSections({ academicYearId: form.academicYearId || undefined, tradeId: form.tradeId || undefined, semesterId: form.semesterId || undefined, shiftId: form.shiftId || undefined });

  function setFilter(k: string, v: string) {
    const nf = { ...f };
    if (!v) delete nf[k]; else nf[k] = v;
    if (k === "tradeId") { delete nf.semesterId; delete nf.sectionId; }
    setPage(1); setF(nf);
  }

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/course-offerings", { academicYearId: form.academicYearId, tradeId: form.tradeId, semesterId: form.semesterId, shiftId: form.shiftId, sectionId: form.sectionId, courseId: form.courseId });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Course Offerings" }]} />
      <PageHeader title="Course Offerings" subtitle="Class instances of reusable courses." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.shiftId ?? ""} onChange={(e) => setFilter("shiftId", e.target.value)} aria-label="Shift"><option value="">All shifts</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.sectionId ?? ""} onChange={(e) => setFilter("sectionId", e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <SearchableSelect options={courses} value={f.courseId ?? ""} onChange={(v) => setFilter("courseId", v)} ariaLabel="Course" clearLabel="All courses" placeholder="All courses" />
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load offerings" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No course offerings" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      ) : (
        <>
          <Table headers={["Course", "Section", "Semester", "Shift", "Teacher", "Status"]}>
            {items.map((r) => {
              const teacher = (r.assignments as Row[] | undefined)?.[0];
              return (
                <tr key={str(r.id)} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Link href={`/admin/course-offerings/${r.id}`} className="font-medium text-brand-600 hover:underline">{str((r.course as Row)?.title)}</Link><span className="ml-2 text-xs text-slate-400">{str((r.course as Row)?.code)}</span></td>
                  <td className="px-4 py-3">{str((r.section as Row)?.name)}</td>
                  <td className="px-4 py-3">{str((r.semester as Row)?.name)}</td>
                  <td className="px-4 py-3">{str((r.shift as Row)?.name)}</td>
                  <td className="px-4 py-3">{teacher ? str(((teacher.teacher as Row)?.user as Row)?.name) : <span className="text-amber-600">Unassigned</span>}</td>
                  <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="New course offering" onClose={() => setDialog(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>Academic year</Label><SearchableSelect options={years} value={form.academicYearId ?? ""} onChange={(v) => setForm({ ...form, academicYearId: v })} clearLabel="Select..." /></div>
          <div><Label required>Trade</Label><SearchableSelect options={trades} value={form.tradeId ?? ""} onChange={(v) => setForm({ ...form, tradeId: v, semesterId: "", sectionId: "" })} clearLabel="Select..." /></div>
          <div><Label required>Semester</Label><Select value={form.semesterId ?? ""} onChange={(e) => setForm({ ...form, semesterId: e.target.value, sectionId: "" })}><option value="">Select...</option>{formSemesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label required>Shift</Label><Select value={form.shiftId ?? ""} onChange={(e) => setForm({ ...form, shiftId: e.target.value, sectionId: "" })}><option value="">Select...</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label required>Section</Label><Select value={form.sectionId ?? ""} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}><option value="">Select...</option>{formSections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label required>Course</Label><SearchableSelect options={courses} value={form.courseId ?? ""} onChange={(v) => setForm({ ...form, courseId: v })} clearLabel="Select..." /></div>
        </div>
        <FieldError error={formError} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
