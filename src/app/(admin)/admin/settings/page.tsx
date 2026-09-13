"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { get, patch, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, LoadingSkeleton, ErrorState, Input, Label, FieldError, Spinner, Breadcrumbs } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function SettingsPage() {
  const { data, error, isLoading, mutate } = useSWR("institution", () => get<Row>("/institution").then((r) => r.data));
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (data) setForm({ name: str(data.name), logoUrl: str(data.logoUrl ?? ""), address: str(data.address ?? ""), phone: str(data.phone ?? ""), email: str(data.email ?? ""), website: str(data.website ?? ""), semesterCount: str(data.semesterCount), shiftCount: str(data.shiftCount) });
  }, [data]);

  async function save() {
    setSaving(true); setFormError(""); setMsg("");
    try {
      await patch("/institution", { name: form.name, logoUrl: form.logoUrl || null, address: form.address || null, phone: form.phone || null, email: form.email || null, website: form.website || null, semesterCount: Number(form.semesterCount) || 8, shiftCount: Number(form.shiftCount) || 2 });
      setMsg("Settings saved."); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  if (isLoading) return <><PageHeader title="Settings" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Settings" /><ErrorState message="Failed to load settings" onRetry={() => mutate()} /></>;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Settings" }]} />
      <PageHeader title="Settings" subtitle="Institution profile and academic configuration." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Institution</h2>
          <div className="space-y-3">
            <div><Label required>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Logo URL</Label><Input value={form.logoUrl ?? ""} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} /></div>
            <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><Label>Website</Label><Input value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Academic configuration</h2>
          <div className="space-y-3">
            <div><Label required>Default semester count</Label><Input type="number" value={form.semesterCount ?? ""} onChange={(e) => setForm({ ...form, semesterCount: e.target.value })} /><p className="mt-1 text-xs text-slate-500">Guides semester creation; actual semesters are dynamic per trade.</p></div>
            <div><Label required>Default shift count</Label><Input type="number" value={form.shiftCount ?? ""} onChange={(e) => setForm({ ...form, shiftCount: e.target.value })} /><p className="mt-1 text-xs text-slate-500">Actual shifts are fully configurable under Shifts.</p></div>
          </div>
          <h2 className="mb-2 mt-6 font-semibold">Notifications</h2>
          <p className="text-sm text-slate-500">In-app notifications are always on. Email/SMS providers are configured via environment variables (SMTP_*, SMS_*). No push notifications by design.</p>
        </Card>
      </div>
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
      <FieldError error={formError} />
      <div className="mt-3"><Button onClick={save} disabled={saving}>{saving && <Spinner />} Save settings</Button></div>
    </div>
  );
}
