"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useTeachers, useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge, Textarea } from "@/components/ui";
import { Plus, ArrowLeftRight } from "lucide-react";
import { CourseOfferingCell } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AssignmentsPage() {
  const teachers = useTeachers();
  const offerings = useOfferings();
  const [page, setPage] = useState(1);
  const [assignOpen, setAssignOpen] = useState(false);
  const [subRow, setSubRow] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const query = qs({ page, limit: 25 });
  const { data, error, isLoading, mutate } = useSWR(`assignments${query}`, () => get<Row[]>(`/teacher-assignments${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  async function saveAssign() {
    setSaving(true); setFormError("");
    try {
      await post("/teacher-assignments", { courseOfferingId: form.courseOfferingId, teacherId: form.teacherId, reason: form.reason || undefined });
      setAssignOpen(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function saveSubstitute() {
    if (!subRow) return;
    setSaving(true); setFormError("");
    try {
      await post("/teacher-assignments/substitute", { courseOfferingId: str((subRow.courseOffering as Row)?.id ?? subRow.courseOfferingId), newTeacherId: form.newTeacherId, reason: form.reason || undefined });
      setSubRow(null); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Substitution failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Teacher Assignments" }]} />
      <PageHeader title="Teacher Assignments" subtitle="Exactly one active teacher per offering. Substitution preserves history." actions={<Button onClick={() => setAssignOpen(true)}><Plus size={16} /> Assign</Button>} />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load assignments" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No assignments" action={<Button onClick={() => setAssignOpen(true)}><Plus size={16} /> Assign</Button>} />
      ) : (
        <>
          <Table headers={["Course offering", "Teacher", "Since", "Status", "Actions"]}>
            {items.map((r) => (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3"><CourseOfferingCell offering={r.courseOffering as Row} /></td>
                <td className="px-4 py-3">{str(((r.teacher as Row)?.user as Row)?.name)} <span className="text-xs text-slate-400">({str((r.teacher as Row)?.employeeId)})</span></td>
                <td className="px-4 py-3 text-slate-500">{str(r.assignedAt).slice(0, 10)}</td>
                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Closed</Badge>}</td>
                <td className="px-4 py-3">
                  {r.isActive ? <Button variant="outline" onClick={() => { setForm({}); setSubRow(r); }}><ArrowLeftRight size={14} /> Substitute</Button> : <span className="text-sm text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={assignOpen} title="Assign teacher" onClose={() => setAssignOpen(false)}>
        <div className="space-y-4">
          <div><Label required>Course offering</Label><SearchableSelect options={offerings} value={form.courseOfferingId ?? ""} onChange={(v) => setForm({ ...form, courseOfferingId: v })} clearLabel="Select..." /></div>
          <div><Label required>Teacher</Label><SearchableSelect options={teachers} value={form.teacherId ?? ""} onChange={(v) => setForm({ ...form, teacherId: v })} clearLabel="Select..." /></div>
          <div><Label>Reason</Label><Textarea value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={saveAssign} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={subRow !== null} title="Substitute teacher" onClose={() => setSubRow(null)}>
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Current teacher loses access to attendance, marks and new notices. History stays attributed to them. The replacement gains access immediately.
          </div>
          <div><Label>Course offering</Label>{subRow ? <CourseOfferingCell offering={subRow.courseOffering as Row} /> : null}</div>
          <div><Label required>Replacement teacher</Label><SearchableSelect options={teachers} value={form.newTeacherId ?? ""} onChange={(v) => setForm({ ...form, newTeacherId: v })} clearLabel="Select..." /></div>
          <div><Label>Reason</Label><Textarea value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSubRow(null)}>Cancel</Button>
            <Button onClick={saveSubstitute} disabled={saving}>{saving && <Spinner />} Confirm substitution</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
