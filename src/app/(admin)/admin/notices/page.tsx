"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, patch, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, SearchableSelect, Textarea, Label, FieldError, Spinner, Pagination, Breadcrumbs } from "@/components/ui";
import { Plus, Pencil } from "lucide-react";
import { CourseOfferingCell } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminNoticesPage() {
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "edit"; row: Row }>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const query = qs({ page, limit: 25, courseOfferingId: offeringId || undefined });
  const { data, error, isLoading, mutate } = useSWR(`notices${query}`, () => get<Row[]>(`/notices${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  async function save() {
    setSaving(true); setFormError("");
    try {
      if (dialog?.mode === "create") await post("/notices", { courseOfferingId: form.courseOfferingId, title: form.title, content: form.content, expiresAt: form.expiresAt || null });
      else if (dialog?.mode === "edit") await patch(`/notices/${dialog.row.id}`, { title: form.title, content: form.content, expiresAt: form.expiresAt || null });
      setDialog(null); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Notices" }]} />
      <PageHeader title="Notices" subtitle="Course announcements. Students are notified." actions={<Button onClick={() => { setForm({}); setDialog({ mode: "create" }); }}><Plus size={16} /> New</Button>} />
      <div className="mb-4 max-w-md">
        <SearchableSelect options={offerings} value={offeringId} onChange={(v) => { setOfferingId(v); setPage(1); }} ariaLabel="Offering" clearLabel="All offerings" placeholder="All offerings" />
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load notices" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No notices" action={<Button onClick={() => { setForm({}); setDialog({ mode: "create" }); }}><Plus size={16} /> New</Button>} />
      ) : (
        <>
          <Table headers={["Title", "Course", "Author", "Published", "Actions"]}>
            {items.map((n) => (
              <tr key={str(n.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(n.title)}</td>
                <td className="px-4 py-3 text-sm"><CourseOfferingCell offering={n.courseOffering as Row} /></td>
                <td className="px-4 py-3 text-sm">{str(((n.teacher as Row)?.user as Row)?.name)}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{str(n.publishedAt).slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" onClick={() => { setForm({ title: str(n.title), content: str(n.content), expiresAt: n.expiresAt ? str(n.expiresAt).slice(0, 10) : "" }); setDialog({ mode: "edit", row: n }); }}><Pencil size={16} /></Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog !== null} title={dialog?.mode === "create" ? "New notice" : "Edit notice"} onClose={() => setDialog(null)} wide>
        <div className="space-y-4">
          {dialog?.mode === "create" && (
            <div><Label required>Course offering</Label><SearchableSelect options={offerings} value={form.courseOfferingId ?? ""} onChange={(v) => setForm({ ...form, courseOfferingId: v })} clearLabel="Select..." /></div>
          )}
          <div><Label required>Title</Label><Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label required>Content</Label><Textarea rows={4} value={form.content ?? ""} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
          <div><Label>Expires at</Label><Input type="date" value={form.expiresAt ?? ""} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
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
