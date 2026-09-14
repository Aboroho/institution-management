"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections, searchStudentOptions } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Select, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, StatusBadge } from "@/components/ui";
import { Plus } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function EnrollmentsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const semesters = useSemesters(f.tradeId || undefined);
  const query = qs({ page, limit: 25, ...f });
  const { data, error, isLoading, mutate } = useSWR(`enrollments${query}`, () => get<Row[]>(`/enrollments${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  const formSemesters = useSemesters(form.tradeId || undefined);
  const formSections = useSections({ academicYearId: form.academicYearId || undefined, tradeId: form.tradeId || undefined, semesterId: form.semesterId || undefined, shiftId: form.shiftId || undefined });

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/enrollments", { studentId: form.studentId, academicYearId: form.academicYearId, tradeId: form.tradeId, semesterId: form.semesterId, shiftId: form.shiftId, sectionId: form.sectionId });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function close(id: string, status: "WITHDRAWN" | "TRANSFERRED") {
    if (!confirm(`Mark this enrollment as ${status}? History is preserved.`)) return;
    await post(`/enrollments/${id}/close`, { status });
    await mutate();
  }

  function setFilter(k: string, v: string) {
    const nf = { ...f };
    if (!v) delete nf[k]; else nf[k] = v;
    setPage(1); setF(nf);
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Enrollments" }]} />
      <PageHeader title="Enrollments" subtitle="Placement history is preserved — never overwritten." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> Enroll student</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{["ACTIVE", "PROMOTED", "FAILED", "REPEATING", "COMPLETED", "WITHDRAWN", "TRANSFERRED"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load enrollments" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No enrollments" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> Enroll student</Button>} />
      ) : (
        <>
          <Table headers={["Roll", "Student", "Context", "Section", "Status", "Actions"]}>
            {items.map((r) => (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(r.rollNumber)}</td>
                <td className="px-4 py-3 font-medium">{str(((r.student as Row)?.user as Row)?.name)} <span className="text-xs text-slate-400">{str((r.student as Row)?.studentId)}</span></td>
                <td className="px-4 py-3 text-sm">{str((r.academicYear as Row)?.name)} · {str((r.trade as Row)?.code)} · {str((r.semester as Row)?.name)} · {str((r.shift as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r.section as Row)?.name)}</td>
                <td className="px-4 py-3"><StatusBadge status={str(r.status)} /></td>
                <td className="px-4 py-3">
                  {str(r.status) === "ACTIVE" ? (
                    <span className="flex gap-1">
                      <Button variant="outline" onClick={() => close(str(r.id), "WITHDRAWN")}>Withdraw</Button>
                      <Button variant="outline" onClick={() => close(str(r.id), "TRANSFERRED")}>Transfer</Button>
                    </span>
                  ) : <span className="text-sm text-slate-400">Closed</span>}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="Enroll student" onClose={() => setDialog(false)} wide>
        <div className="space-y-3">
          <div>
            <Label required>Student (search by ID or name)</Label>
            <SearchableSelect loadOptions={searchStudentOptions} minQuery={2} value={form.studentId ?? ""} onChange={(v) => setForm({ ...form, studentId: v })} placeholder="Search student ID or name..." clearLabel="Select..." ariaLabel="Student" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label required>Academic year</Label><SearchableSelect options={years} value={form.academicYearId ?? ""} onChange={(v) => setForm({ ...form, academicYearId: v })} clearLabel="Select..." /></div>
            <div><Label required>Trade</Label><SearchableSelect options={trades} value={form.tradeId ?? ""} onChange={(v) => setForm({ ...form, tradeId: v, semesterId: "", sectionId: "" })} clearLabel="Select..." /></div>
            <div><Label required>Semester</Label><Select value={form.semesterId ?? ""} onChange={(e) => setForm({ ...form, semesterId: e.target.value, sectionId: "" })}><option value="">Select...</option>{formSemesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
            <div><Label required>Shift</Label><Select value={form.shiftId ?? ""} onChange={(e) => setForm({ ...form, shiftId: e.target.value, sectionId: "" })}><option value="">Select...</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
            <div className="col-span-2"><Label required>Section</Label><Select value={form.sectionId ?? ""} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}><option value="">Select...</option>{formSections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          </div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
