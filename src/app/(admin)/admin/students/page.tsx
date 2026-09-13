"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge } from "@/components/ui";
import { Plus, Search } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });
  const query = qs({ page, limit: 25, search: search || undefined, ...f });
  const { data, error, isLoading, mutate } = useSWR(`students${query}`, () => get<Row[]>(`/students${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  function setFilter(k: string, v: string) {
    const nf = { ...f };
    if (!v) delete nf[k]; else nf[k] = v;
    if (k === "tradeId") { delete nf.semesterId; delete nf.sectionId; }
    setPage(1); setF(nf);
  }

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/students", { name: form.name, email: form.email, password: form.password, studentId: form.studentId, phone: form.phone || undefined, guardianName: form.guardianName || undefined, guardianPhone: form.guardianPhone || undefined });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Students" }]} />
      <PageHeader title="Students" subtitle="Student IDs are permanent and never change." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New student</Button>} />
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by ID, name or email..." className="pl-9" />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Select value={f.academicYearId ?? ""} onChange={(e) => setFilter("academicYearId", e.target.value)} aria-label="Year"><option value="">All years</option>{years.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.tradeId ?? ""} onChange={(e) => setFilter("tradeId", e.target.value)} aria-label="Trade"><option value="">All trades</option>{trades.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.shiftId ?? ""} onChange={(e) => setFilter("shiftId", e.target.value)} aria-label="Shift"><option value="">All shifts</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.sectionId ?? ""} onChange={(e) => setFilter("sectionId", e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{["ACTIVE", "PROMOTED", "FAILED", "REPEATING", "COMPLETED", "WITHDRAWN", "TRANSFERRED"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load students" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No students" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New student</Button>} />
      ) : (
        <>
          <Table headers={["Student ID", "Name", "Email", "Current enrollment", "Status"]}>
            {items.map((r) => {
              const en = (r.enrollments as Row[] | undefined)?.[0];
              return (
                <tr key={str(r.id)} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Link href={`/admin/students/${r.id}`} className="font-medium text-brand-600 hover:underline">{str(r.studentId)}</Link></td>
                  <td className="px-4 py-3">{str((r.user as Row)?.name)}</td>
                  <td className="px-4 py-3 text-slate-500">{str((r.user as Row)?.email)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{en ? `${str((en.trade as Row)?.code)} · ${str((en.semester as Row)?.name)} · ${str((en.section as Row)?.name)}` : "—"}</td>
                  <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="New student" onClose={() => setDialog(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>Full name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label required>Student ID</Label><Input value={form.studentId ?? ""} placeholder="STU-2026-001" onChange={(e) => setForm({ ...form, studentId: e.target.value })} /></div>
          <div><Label required>Email</Label><Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label required>Password</Label><Input type="password" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Guardian name</Label><Input value={form.guardianName ?? ""} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></div>
          <div><Label>Guardian phone</Label><Input value={form.guardianPhone ?? ""} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} /></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Minimum 8 characters for password. Enroll the student from Enrollments afterwards.</p>
        <FieldError error={formError} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
