"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, patch, ApiError } from "@/lib/api/client";
import { useTrades } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, Label, FieldError, Spinner, Badge, Breadcrumbs } from "@/components/ui";
import { Plus, Pencil } from "lucide-react";

type Row = Record<string, unknown>;

export default function SemestersPage() {
  const trades = useTrades();
  const [tradeId, setTradeId] = useState("");
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "edit"; row: Row }>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const { data, error, isLoading, mutate } = useSWR(`semesters-${tradeId}`, () =>
    get<Row[]>(`/semesters${tradeId ? `?tradeId=${tradeId}` : ""}`).then((r) => r.data));
  const items = data ?? [];

  async function save() {
    setSaving(true); setFormError("");
    try {
      if (dialog?.mode === "create") await post("/semesters", { tradeId: form.tradeId || tradeId, number: Number(form.number), name: form.name });
      else if (dialog?.mode === "edit") await patch(`/semesters/${dialog.row.id}`, { number: Number(form.number), name: form.name, isActive: form.isActive === "true" });
      setDialog(null); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Semesters" }]} />
      <PageHeader title="Semesters" subtitle="Per-trade, dynamic count — never hardcoded." actions={<Button onClick={() => { setForm({ tradeId }); setDialog({ mode: "create" }); }}><Plus size={16} /> New</Button>} />
      <div className="mb-4 max-w-xs">
        <Label>Filter by trade</Label>
        <Select value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
          <option value="">All trades</option>
          {trades.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load semesters" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No semesters" hint="Create semesters per trade." action={<Button onClick={() => { setForm({ tradeId }); setDialog({ mode: "create" }); }}><Plus size={16} /> New</Button>} />
      ) : (
        <Table headers={["Semester", "Trade", "Number", "Status", "Actions"]}>
          {items.map((r) => (
            <tr key={String(r.id)} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium">{String(r.name)}</td>
              <td className="px-4 py-3">{String((r.trade as Row)?.name ?? "—")}</td>
              <td className="px-4 py-3">{String(r.number)}</td>
              <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" onClick={() => { setForm({ number: String(r.number), name: String(r.name), isActive: String(r.isActive) }); setDialog({ mode: "edit", row: r }); }}><Pencil size={16} /></Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={dialog !== null} title={dialog?.mode === "create" ? "New semester" : "Edit semester"} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          {dialog?.mode === "create" && (
            <div>
              <Label required>Trade</Label>
              <Select value={form.tradeId ?? ""} onChange={(e) => setForm({ ...form, tradeId: e.target.value })}>
                <option value="">Select...</option>
                {trades.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
          )}
          <div><Label required>Number</Label><Input type="number" value={form.number ?? ""} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
          <div><Label required>Name</Label><Input value={form.name ?? ""} placeholder="Semester 1" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          {dialog?.mode === "edit" && (
            <div>
              <Label>Status</Label>
              <Select value={form.isActive ?? "true"} onChange={(e) => setForm({ ...form, isActive: e.target.value })}>
                <option value="true">Active</option><option value="false">Inactive</option>
              </Select>
            </div>
          )}
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
