"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, Label, FieldError, Spinner, Breadcrumbs, Textarea } from "@/components/ui";
import { Plus } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherNotices() {
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const { data, error, isLoading, mutate } = useSWR("t-notices", () => get<Row[]>("/notices?limit=50").then((r) => r.data));
  const { data: offerings } = useSWR("t-not-offs", () => get<Row[]>("/course-offerings?limit=100").then((r) => r.data));
  const items = data ?? [];

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/notices", { courseOfferingId: form.courseOfferingId, title: form.title, content: form.content, expiresAt: form.expiresAt || null });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Teacher", href: "/teacher/dashboard" }, { label: "Notices" }]} />
      <PageHeader title="Notices" subtitle="Only for courses you currently teach." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No notices" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New</Button>} />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={str(n.id)} className="p-4">
              <p className="font-semibold">{str(n.title)}</p>
              <p className="mt-1 text-sm text-slate-600">{str(n.content)}</p>
              <p className="mt-1 text-xs text-slate-400">{str(((n.courseOffering as Row)?.course as Row)?.title)} · {str(n.publishedAt).slice(0, 10)}</p>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialog} title="New notice" onClose={() => setDialog(false)}>
        <div className="space-y-3">
          <div><Label required>Course offering</Label><Select value={form.courseOfferingId ?? ""} onChange={(e) => setForm({ ...form, courseOfferingId: e.target.value })}><option value="">Select...</option>{(offerings ?? []).map((o) => <option key={str(o.id)} value={str(o.id)}>{str((o.course as Row)?.title)} · {str((o.section as Row)?.name)}</option>)}</Select></div>
          <div><Label required>Title</Label><Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label required>Content</Label><Textarea rows={4} value={form.content ?? ""} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
          <div><Label>Expires at</Label><Input type="date" value={form.expiresAt ?? ""} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Publish</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
