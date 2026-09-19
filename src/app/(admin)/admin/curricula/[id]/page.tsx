"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, del, patch, ApiError } from "@/lib/api/client";
import { useCourses } from "@/components/academic-options";
import { PageHeader, Button, Table, DetailSkeleton, ErrorState, Breadcrumbs, SearchableSelect, Label, Badge, Card, ConfirmDialog, IconButton, StatusMessage, Tooltip } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function CurriculumDetail({ params }: { params: { id: string } }) {
  const courses = useCourses();
  const [courseId, setCourseId] = useState("");
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Row | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`cur-${params.id}`, () => get<Row>(`/curricula/${params.id}`).then((r) => r.data));

  async function add() {
    if (adding || !courseId) return;
    setErr(""); setAdding(true);
    try { await post(`/curricula/${params.id}/courses`, { courseId }); setCourseId(""); await mutate(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "The course could not be added. Please try again."); }
    finally { setAdding(false); }
  }
  // Removal is destructive and was previously behind a native confirm() whose
  // failure path was silent: the request could reject and the row would simply
  // stay, with no explanation.
  async function remove() {
    if (!removeTarget) return;
    setRemoving(true); setRemoveError("");
    try {
      await del(`/curricula/${params.id}/courses?courseId=${str(removeTarget.id)}`);
      setRemoveTarget(null);
      await mutate();
    } catch (e) {
      setRemoveError(e instanceof ApiError ? e.message : "The course could not be removed. Please try again.");
    } finally { setRemoving(false); }
  }
  async function toggle() {
    if (!data || toggling) return;
    setToggling(true); setErr("");
    try {
      await patch(`/curricula/${params.id}`, { isActive: !data.isActive });
      await mutate();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "The status could not be changed. Please try again.");
    } finally { setToggling(false); }
  }

  if (isLoading) return <><PageHeader title="Curriculum" /><DetailSkeleton fields={6} /></>;
  if (error || !data) return <><PageHeader title="Curriculum" /><ErrorState message="Failed to load curriculum" onRetry={() => mutate()} /></>;
  const list = (data.courses as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Curricula", href: "/admin/curricula" }, { label: str(data.name) }]} />
      <PageHeader title={`${str(data.name)} (v${str(data.version)})`} subtitle={`${str((data.trade as Row)?.name)} · ${str((data.semester as Row)?.name)} · Only one curriculum per trade + semester can be active.`} actions={
        <Tooltip content={data.isActive
          ? "Deactivating frees the trade + semester slot so another curriculum version can be made active."
          : "Activating this version deactivates any other active curriculum for the same trade and semester."}>
          <Button variant="outline" loading={toggling} loadingText="Saving…" onClick={() => void toggle()}>
            {data.isActive ? "Deactivate" : "Activate"}
          </Button>
        </Tooltip>
      } />
      <Card className="mb-4 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Add course</Label>
            <SearchableSelect ariaLabel="Add course" options={courses} value={courseId} onChange={setCourseId} clearLabel="Select..." />
          </div>
          <Button onClick={() => void add()} disabled={!courseId} loading={adding} loadingText="Adding…">
            <Plus size={16} aria-hidden="true" /> Add
          </Button>
        </div>
        {err && <StatusMessage tone="error" className="mt-3 mb-0" onDismiss={() => setErr("")}>{err}</StatusMessage>}
      </Card>
      <Table headers={["Order", "Code", "Title", "Actions"]}>
        {list.map((c) => (
          <tr key={str(c.id)}>
            <td className="px-4 py-3">{str(c.order)}</td>
            <td className="px-4 py-3 font-medium">{str((c.course as Row)?.code)}</td>
            <td className="px-4 py-3">{str((c.course as Row)?.title)}</td>
            <td className="px-4 py-3">
              <IconButton
                variant="danger"
                label={`Remove ${str((c.course as Row)?.title)} from this curriculum`}
                tooltip="Remove this course from the curriculum"
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={() => { setRemoveError(""); setRemoveTarget(c.course as Row); }}
              />
            </td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-sm text-slate-500">Status: {data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove course from curriculum?"
        message={`"${str(removeTarget?.title)}" will no longer be part of this curriculum version. Existing course offerings and their data are not affected.`}
        confirmLabel="Remove course"
        tone="danger"
        busy={removing}
        error={removeError}
        onConfirm={remove}
        onClose={() => { if (!removing) { setRemoveTarget(null); setRemoveError(""); } }}
      />
    </div>
  );
}
