"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { del, get, patch, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, Table, LoadingSkeleton, ErrorState, Breadcrumbs, Tabs, StatusBadge, Badge, Dialog, Input, Select, Label, FieldError, Spinner } from "@/components/ui";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`student-${params.id}`, () => get<Row>(`/students/${params.id}`).then((r) => r.data));
  const { data: attendance } = useSWR(tab === "attendance" ? `st-att-${params.id}` : null, () => get<Row[]>(`/students/${params.id}/attendance`).then((r) => r.data));
  const { data: grades } = useSWR(tab === "marks" ? `st-marks-${params.id}` : null, () => get<Row[]>(`/students/${params.id}/marks`).then((r) => r.data));

  function openEdit() {
    if (!data) return;
    setForm({ name: str((data.user as Row)?.name), phone: str(data.phone ?? ""), address: str(data.address ?? ""), guardianName: str(data.guardianName ?? ""), guardianPhone: str(data.guardianPhone ?? ""), isActive: str(data.isActive) });
    setEditOpen(true);
  }
  async function save() {
    setSaving(true); setFormError("");
    try {
      await patch(`/students/${params.id}`, { name: form.name, phone: form.phone || null, address: form.address || null, guardianName: form.guardianName || null, guardianPhone: form.guardianPhone || null, isActive: form.isActive === "true" });
      setEditOpen(false); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function remove() {
    setDeleting(true); setDeleteError("");
    try {
      await del(`/students/${params.id}`);
      router.push("/admin/students");
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : "Delete failed");
    } finally { setDeleting(false); }
  }

  if (isLoading) return <><PageHeader title="Student" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Student" /><ErrorState message="Failed to load student" onRetry={() => mutate()} /></>;

  const enrollments = (data.enrollments as Row[] | undefined) ?? [];
  const promotions = (data.promotions as Row[] | undefined) ?? [];
  const current = enrollments.find((e) => str(e.status) === "ACTIVE");

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Students", href: "/admin/students" }, { label: str(data.studentId) }]} />
      <PageHeader title={`${str((data.user as Row)?.name)}`} subtitle={`Student ID: ${str(data.studentId)} · ${str((data.user as Row)?.email)}`} actions={<><Link href={`/admin/reports/students/${params.id}`}><Button variant="outline">Full report</Button></Link><Button variant="outline" onClick={openEdit}><Pencil size={14} /> Edit</Button><Button variant="danger" onClick={() => { setDeleteError(""); setDeleteOpen(true); }}><Trash2 size={14} /> Delete</Button></>} />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "enrollments", label: `Enrollments (${enrollments.length})` }, { id: "attendance", label: "Attendance" }, { id: "marks", label: "Marks" }, { id: "promotions", label: "Promotion history" }]} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5"><p className="text-sm text-slate-500">Status</p><p className="mt-1">{data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Current enrollment</p><p className="mt-1 text-sm font-medium">{current ? `${str((current.academicYear as Row)?.name)} · ${str((current.trade as Row)?.name)} · ${str((current.semester as Row)?.name)} · ${str((current.section as Row)?.name)} · Roll ${str(current.rollNumber)}` : "None"}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Guardian</p><p className="mt-1 text-sm">{str(data.guardianName ?? "—")} · {str(data.guardianPhone ?? "—")}</p><p className="mt-1 text-sm text-slate-500">Phone: {str(data.phone ?? "—")}</p></Card>
        </div>
      )}
      {tab === "enrollments" && (
        <Table headers={["Roll", "Year", "Trade", "Semester", "Shift", "Section", "Status", "Enrolled"]}>
          {enrollments.map((e) => <tr key={str(e.id)}><td className="px-4 py-3 font-medium">{str(e.rollNumber)}</td><td className="px-4 py-3 text-sm">{str((e.academicYear as Row)?.name)}</td><td className="px-4 py-3 text-sm">{str((e.trade as Row)?.name)}</td><td className="px-4 py-3 text-sm">{str((e.semester as Row)?.name)}</td><td className="px-4 py-3 text-sm">{str((e.shift as Row)?.name)}</td><td className="px-4 py-3 text-sm">{str((e.section as Row)?.name)}</td><td className="px-4 py-3"><StatusBadge status={str(e.status)} /></td><td className="px-4 py-3 text-sm">{str(e.enrolledAt).slice(0, 10)}</td></tr>)}
        </Table>
      )}
      {tab === "attendance" && (
        !attendance ? <LoadingSkeleton rows={3} /> : attendance.length === 0 ? <p className="text-sm text-slate-500">No attendance records.</p> : (
          <Table headers={["Course", "Classes", "Present", "Absent", "Late", "Excused", "%"]}>
            {attendance.map((a) => <tr key={str((a.offering as Row)?.id)}><td className="px-4 py-3">{str(((a.offering as Row)?.course as Row)?.title)}</td><td className="px-4 py-3">{str(a.total)}</td><td className="px-4 py-3">{str(a.present)}</td><td className="px-4 py-3">{str(a.absent)}</td><td className="px-4 py-3">{str(a.late)}</td><td className="px-4 py-3">{str(a.excused)}</td><td className="px-4 py-3 font-bold">{str(a.percentage)}%</td></tr>)}
          </Table>
        )
      )}
      {tab === "marks" && (
        !grades ? <LoadingSkeleton rows={3} /> : grades.length === 0 ? <p className="text-sm text-slate-500">No grades yet.</p> : (
          <div className="space-y-4">
            {grades.map((g) => {
              const fin = g.final as Row;
              return (
                <Card key={str((g.offering as Row)?.id)} className="p-4">
                  <p className="font-semibold">{str(((g.offering as Row)?.course as Row)?.title)} <span className="ml-2 text-sm font-normal text-slate-500">Final: {str(fin.percentage)}% · {str(fin.grade)} {fin.passed ? "· Pass" : "· Fail"}</span></p>
                  <Table headers={["Assessment", "Obtained", "Total", "%"]}>
                    {((g.assessments as Row[]) ?? []).map((a) => <tr key={str(a.id)}><td className="px-4 py-2 text-sm">{str(a.title)}</td><td className="px-4 py-2">{a.marksObtained === null || a.marksObtained === undefined ? "—" : str(a.marksObtained)}</td><td className="px-4 py-2">{str(a.totalMarks)}</td><td className="px-4 py-2">{a.marksObtained === null || a.marksObtained === undefined ? "—" : `${Math.round((Number(a.marksObtained) / Number(a.totalMarks)) * 1000) / 10}%`}</td></tr>)}
                  </Table>
                </Card>
              );
            })}
          </div>
        )
      )}
      {tab === "promotions" && (
        <Table headers={["Decision", "From", "To", "Date"]}>
          {promotions.map((p) => <tr key={str(p.id)}><td className="px-4 py-3"><Badge>{str(p.decision)}</Badge></td><td className="px-4 py-3 text-sm">{str(p.fromEnrollmentId).slice(0, 8)}</td><td className="px-4 py-3 text-sm">{p.toEnrollmentId ? str(p.toEnrollmentId).slice(0, 8) : "—"}</td><td className="px-4 py-3 text-sm">{str(p.decidedAt).slice(0, 10)}</td></tr>)}
        </Table>
      )}

      <Dialog open={editOpen} title="Edit student" onClose={() => setEditOpen(false)}>
        <div className="space-y-3">
          <div><Label required>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Status</Label><Select value={form.isActive ?? "true"} onChange={(e) => setForm({ ...form, isActive: e.target.value })}><option value="true">Active</option><option value="false">Inactive</option></Select></div>
          </div>
          <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Guardian name</Label><Input value={form.guardianName ?? ""} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></div>
            <div><Label>Guardian phone</Label><Input value={form.guardianPhone ?? ""} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} /></div>
          </div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} title="Delete student permanently?" onClose={() => { if (!deleting) setDeleteOpen(false); }}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 shrink-0" size={20} />
            <div>
              <p className="font-semibold">This action cannot be undone.</p>
              <p className="mt-1">The student profile and login account will be permanently removed.</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Students with enrollments, attendance, submissions, marks, promotion history, or uploaded files cannot be deleted. They must be deactivated so academic history remains intact.
          </p>
          <FieldError error={deleteError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={remove} disabled={deleting}>{deleting && <Spinner />} Delete permanently</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
