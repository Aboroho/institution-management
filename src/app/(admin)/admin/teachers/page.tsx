"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Table, TableSkeleton, EmptyState, ErrorState, Dialog, Input, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge } from "@/components/ui";
import { Plus, Search } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeachersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const query = qs({ page, limit: 25, search: search || undefined });
  const { data, error, isLoading, mutate } = useSWR(`teachers${query}`, () => get<Row[]>(`/teachers${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/teachers", { name: form.name, email: form.email, password: form.password, employeeId: form.employeeId, department: form.department || undefined, designation: form.designation || undefined, phone: form.phone || undefined });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Teachers" }]} />
      <PageHeader title="Teachers" subtitle="Assign teachers to course offerings afterwards." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New teacher</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by ID, name or email..." className="pl-9" />
        </div>
      </div>
      {isLoading ? <TableSkeleton columns={5} rows={6} label="Loading teachers" /> : error ? <ErrorState message="Failed to load teachers" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No teachers" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New teacher</Button>} />
      ) : (
        <>
          <Table headers={["Employee ID", "Name", "Email", "Active offerings", "Status"]}>
            {items.map((r) => (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/admin/teachers/${r.id}`} className="font-medium text-brand-600 hover:underline">{str(r.employeeId)}</Link></td>
                <td className="px-4 py-3">{str((r.user as Row)?.name)}</td>
                <td className="px-4 py-3 text-slate-500">{str((r.user as Row)?.email)}</td>
                <td className="px-4 py-3">{str((r.assignments as Row[] | undefined)?.length ?? 0)}</td>
                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="New teacher" onClose={() => setDialog(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>Full name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label required>Employee ID</Label><Input value={form.employeeId ?? ""} placeholder="TCH-001" onChange={(e) => setForm({ ...form, employeeId: e.target.value })} /></div>
          <div><Label required>Email</Label><Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label required>Password</Label><Input type="password" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div><Label>Designation</Label><Input value={form.designation ?? ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <FieldError error={formError} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
          <Button onClick={save}  loading={saving} loadingText="Saving…">Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
