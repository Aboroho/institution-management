"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, del, patch, ApiError } from "@/lib/api/client";
import { useCourses } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, ErrorState, Breadcrumbs, SearchableSelect, Label, FieldError, Badge, Card } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function CurriculumDetail({ params }: { params: { id: string } }) {
  const courses = useCourses();
  const [courseId, setCourseId] = useState("");
  const [err, setErr] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`cur-${params.id}`, () => get<Row>(`/curricula/${params.id}`).then((r) => r.data));

  async function add() {
    setErr("");
    try { await post(`/curricula/${params.id}/courses`, { courseId }); setCourseId(""); await mutate(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Add failed"); }
  }
  async function remove(cid: string) {
    if (!confirm("Remove this course from the curriculum?")) return;
    await del(`/curricula/${params.id}/courses?courseId=${cid}`);
    await mutate();
  }
  async function toggle() {
    if (!data) return;
    await patch(`/curricula/${params.id}`, { isActive: !data.isActive });
    await mutate();
  }

  if (isLoading) return <><PageHeader title="Curriculum" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Curriculum" /><ErrorState message="Failed to load curriculum" onRetry={() => mutate()} /></>;
  const list = (data.courses as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Curricula", href: "/admin/curricula" }, { label: str(data.name) }]} />
      <PageHeader title={`${str(data.name)} (v${str(data.version)})`} subtitle={`${str((data.trade as Row)?.name)} · ${str((data.semester as Row)?.name)}`} actions={<Button variant="outline" onClick={toggle}>{data.isActive ? "Deactivate" : "Activate"}</Button>} />
      <Card className="mb-4 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Label>Add course</Label><SearchableSelect options={courses} value={courseId} onChange={setCourseId} clearLabel="Select..." /></div>
          <Button onClick={add} disabled={!courseId}><Plus size={16} /> Add</Button>
        </div>
        <FieldError error={err} />
      </Card>
      <Table headers={["Order", "Code", "Title", "Actions"]}>
        {list.map((c) => (
          <tr key={str(c.id)}>
            <td className="px-4 py-3">{str(c.order)}</td>
            <td className="px-4 py-3 font-medium">{str((c.course as Row)?.code)}</td>
            <td className="px-4 py-3">{str((c.course as Row)?.title)}</td>
            <td className="px-4 py-3"><Button variant="ghost" onClick={() => remove(str((c.course as Row)?.id))}><Trash2 size={16} /></Button></td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-sm text-slate-500">Status: {data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p>
    </div>
  );
}
