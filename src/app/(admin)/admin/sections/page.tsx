"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, patch, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts } from "@/components/academic-options";
import { getFilterDefaults, applyDependentChange, applyFilterChange } from "@/components/filter-defaults";
import { PageHeader, Button, Table, TableSkeleton, EmptyState, ErrorState, Dialog, Input, Select, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge } from "@/components/ui";
import { Plus, Pencil } from "lucide-react";
import Link from "next/link";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function SectionsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const semesters = useSemesters(f.tradeId || undefined);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "edit"; row: Row }>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const query = qs({ page, limit: 25, ...f });
  const { data, error, isLoading, mutate } = useSWR(`sections${query}`, () => get<Row[]>(`/sections${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  function setFilter(k: string, v: string) {
    const nf = applyFilterChange(f, k, v);
    if (["academicYearId", "tradeId", "semesterId", "shiftId"].includes(k)) setPage(1);
    setF(nf);
  }

  function openCreate() {
    const defaults = getFilterDefaults(f, {
      relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId"],
      validOptions: {
        semesterId: semesters,
      },
    });
    setForm(defaults);
    setFormError("");
    setDialog({ mode: "create" });
  }

  async function save() {
    setSaving(true); setFormError("");
    try {
      if (dialog?.mode === "create") {
        await post("/sections", { academicYearId: form.academicYearId, tradeId: form.tradeId, semesterId: form.semesterId, shiftId: form.shiftId, name: form.name, capacity: form.capacity ? Number(form.capacity) : undefined });
      } else if (dialog?.mode === "edit") {
        await patch(`/sections/${dialog.row.id}`, { name: form.name, capacity: form.capacity ? Number(form.capacity) : null, isActive: form.isActive === "true" });
      }
      setDialog(null); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  const formSemesters = useSemesters(form.tradeId || undefined);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Sections" }]} />
      <PageHeader title="Sections" subtitle="A section never mixes years, trades, semesters or shifts." actions={<Button onClick={openCreate}><Plus size={16} /> New</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Academic year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester">
          <option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select value={f.shiftId ?? ""} onChange={(e) => setFilter("shiftId", e.target.value)} aria-label="Shift">
          <option value="">All shifts</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      {isLoading ? <TableSkeleton columns={8} rows={6} label="Loading sections" /> : error ? <ErrorState message="Failed to load sections" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No sections" action={<Button onClick={openCreate}><Plus size={16} /> New</Button>} />
      ) : (
        <>
          <Table headers={["Section", "Year", "Trade", "Semester", "Shift", "Students", "Status", "Actions"]}>
            {items.map((r) => (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/admin/sections/${r.id}`} className="font-medium text-brand-600 hover:underline">{str(r.name)}</Link></td>
                <td className="px-4 py-3">{str((r.academicYear as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r.trade as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r.semester as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r.shift as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r._count as Row)?.enrollments ?? "—")}</td>
                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" onClick={() => { setForm({ name: str(r.name), capacity: str(r.capacity ?? ""), isActive: str(r.isActive) }); setDialog({ mode: "edit", row: r }); }}><Pencil size={16} /></Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog !== null} title={dialog?.mode === "create" ? "New section" : "Edit section"} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          {dialog?.mode === "create" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><Label required>Academic year</Label><SearchableSelect options={years} value={form.academicYearId ?? ""} onChange={(v) => setForm(applyDependentChange(form, "academicYearId", v))} clearLabel="Select..." /></div>
                <div><Label required>Trade</Label><SearchableSelect options={trades} value={form.tradeId ?? ""} onChange={(v) => setForm(applyDependentChange(form, "tradeId", v))} clearLabel="Select..." /></div>
                <div><Label required>Semester</Label><Select value={form.semesterId ?? ""} onChange={(e) => setForm(applyDependentChange(form, "semesterId", e.target.value))}><option value="">Select...</option>{formSemesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
                <div><Label required>Shift</Label><Select value={form.shiftId ?? ""} onChange={(e) => setForm(applyDependentChange(form, "shiftId", e.target.value))}><option value="">Select...</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
              </div>
            </>
          )}
          <div><Label required>Name</Label><Input value={form.name ?? ""} placeholder="Section A" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Capacity</Label><Input type="number" value={form.capacity ?? ""} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          {dialog?.mode === "edit" && (
            <div><Label>Status</Label><Select value={form.isActive ?? "true"} onChange={(e) => setForm({ ...form, isActive: e.target.value })}><option value="true">Active</option><option value="false">Inactive</option></Select></div>
          )}
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={save}  loading={saving} loadingText="Saving…">Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
