"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get, patch, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, Table, DetailSkeleton, ErrorState, Breadcrumbs, Tabs, Badge, Dialog, Input, Select, Label, FieldError, Spinner } from "@/components/ui";
import { Pencil } from "lucide-react";
import { CourseOfferingBadges } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`teacher-${params.id}`, () => get<Row>(`/teachers/${params.id}`).then((r) => r.data));

  function openEdit() {
    if (!data) return;
    setForm({ name: str((data.user as Row)?.name), department: str(data.department ?? ""), designation: str(data.designation ?? ""), phone: str(data.phone ?? ""), isActive: str(data.isActive) });
    setEditOpen(true);
  }
  async function save() {
    setSaving(true); setFormError("");
    try {
      await patch(`/teachers/${params.id}`, { name: form.name, department: form.department || null, designation: form.designation || null, phone: form.phone || null, isActive: form.isActive === "true" });
      setEditOpen(false); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  if (isLoading) return <><PageHeader title="Teacher" /><DetailSkeleton fields={6} /></>;
  if (error || !data) return <><PageHeader title="Teacher" /><ErrorState message="Failed to load teacher" onRetry={() => mutate()} /></>;

  const assignments = (data.assignments as Row[] | undefined) ?? [];
  const active = assignments.filter((a) => a.isActive);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Teachers", href: "/admin/teachers" }, { label: str(data.employeeId) }]} />
      <PageHeader title={str((data.user as Row)?.name)} subtitle={`Employee ID: ${str(data.employeeId)} · ${str((data.user as Row)?.email)}`} actions={<Button variant="outline" onClick={openEdit}><Pencil size={14} /> Edit</Button>} />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "current", label: `Current offerings (${active.length})` }, { id: "history", label: "Assignment history" }]} active={tab} onChange={setTab} />
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5"><p className="text-sm text-slate-500">Status</p><p className="mt-1">{data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Department</p><p className="mt-1 font-semibold">{str(data.department ?? "—")} · {str(data.designation ?? "—")}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Contact</p><p className="mt-1 text-sm">{str(data.phone ?? "—")}</p></Card>
        </div>
      )}
      {tab === "current" && (
        <Table headers={["Course offering", "Since"]}>
          {active.map((a) => (
            <tr key={str(a.id)}>
              <td className="px-4 py-3">
                <Link href={`/admin/course-offerings/${(a.courseOffering as Row)?.id}`} className="font-medium text-brand-600 hover:underline">{str(((a.courseOffering as Row)?.course as Row)?.title)}</Link>
                <div className="mt-1.5"><CourseOfferingBadges offering={a.courseOffering as Row} /></div>
              </td>
              <td className="px-4 py-3 text-sm">{str(a.assignedAt).slice(0, 10)}</td>
            </tr>
          ))}
        </Table>
      )}
      {tab === "history" && (
        <Table headers={["Course offering", "Since", "Until", "Status"]}>
          {assignments.map((a) => (
            <tr key={str(a.id)}>
              <td className="px-4 py-3">
                <span className="font-medium text-slate-800">{str(((a.courseOffering as Row)?.course as Row)?.title)}</span>
                <div className="mt-1.5"><CourseOfferingBadges offering={a.courseOffering as Row} /></div>
              </td>
              <td className="px-4 py-3 text-sm">{str(a.assignedAt).slice(0, 10)}</td>
              <td className="px-4 py-3 text-sm">{a.endedAt ? str(a.endedAt).slice(0, 10) : "—"}</td>
              <td className="px-4 py-3">{a.isActive ? <Badge tone="green">Active</Badge> : <Badge>Closed</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={editOpen} title="Edit teacher" onClose={() => setEditOpen(false)}>
        <div className="space-y-3">
          <div><Label required>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Department</Label><Input value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
            <div><Label>Designation</Label><Input value={form.designation ?? ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Status</Label><Select value={form.isActive ?? "true"} onChange={(e) => setForm({ ...form, isActive: e.target.value })}><option value="true">Active</option><option value="false">Inactive</option></Select></div>
          </div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={save}  loading={saving} loadingText="Saving…">Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
