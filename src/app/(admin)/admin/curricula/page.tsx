"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, post, ApiError } from "@/lib/api/client";
import { useTrades, useSemesters, useCourses } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, SearchableSelect, Label, FieldError, Spinner, Breadcrumbs, Badge } from "@/components/ui";
import { Plus } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function CurriculaPage() {
  const trades = useTrades();
  const [tradeId, setTradeId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const semesters = useSemesters(tradeId || undefined);
  const courses = useCourses();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const q = `${tradeId ? `tradeId=${tradeId}&` : ""}${semesterId ? `semesterId=${semesterId}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR(`curricula-${q}`, () => get<Row[]>(`/curricula?${q}`).then((r) => r.data));
  const items = data ?? [];
  const formSemesters = useSemesters(form.tradeId || undefined);

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/curricula", { tradeId: form.tradeId, semesterId: form.semesterId, name: form.name, courseIds: picked });
      setDialog(false); setPicked([]); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Curricula" }]} />
      <PageHeader title="Curricula" subtitle="Trade + Semester → Courses. New versions preserve history." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      <div className="mb-4 grid max-w-xl grid-cols-2 gap-2">
        <SearchableSelect options={trades} value={tradeId} onChange={(v) => { setTradeId(v); setSemesterId(""); }} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={semesterId} onChange={(e) => setSemesterId(e.target.value)} aria-label="Semester">
          <option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load curricula" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No curricula" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      ) : (
        <Table headers={["Name", "Trade", "Semester", "Version", "Courses", "Status"]}>
          {items.map((r) => (
            <tr key={str(r.id)} className="hover:bg-slate-50">
              <td className="px-4 py-3"><Link href={`/admin/curricula/${r.id}`} className="font-medium text-brand-600 hover:underline">{str(r.name)}</Link></td>
              <td className="px-4 py-3">{str((r.trade as Row)?.name)}</td>
              <td className="px-4 py-3">{str((r.semester as Row)?.name)}</td>
              <td className="px-4 py-3">v{str(r.version)}</td>
              <td className="px-4 py-3">{str((r._count as Row)?.courses ?? 0)}</td>
              <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={dialog} title="New curriculum (creates next version)" onClose={() => setDialog(false)} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label required>Trade</Label><SearchableSelect options={trades} value={form.tradeId ?? ""} onChange={(v) => setForm({ ...form, tradeId: v, semesterId: "" })} clearLabel="Select..." /></div>
            <div><Label required>Semester</Label><Select value={form.semesterId ?? ""} onChange={(e) => setForm({ ...form, semesterId: e.target.value })}><option value="">Select...</option>{formSemesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          </div>
          <div><Label required>Name</Label><Input value={form.name ?? ""} placeholder="2026 Curriculum" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <Label>Courses</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {courses.map((c) => (
                <label key={c.value} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={picked.includes(c.value)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.value] : picked.filter((x) => x !== c.value))} className="accent-brand-600" />
                  {c.label}
                </label>
              ))}
            </div>
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
