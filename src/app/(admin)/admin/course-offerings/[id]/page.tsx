"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, patch } from "@/lib/api/client";
import { PageHeader, Button, Card, Table, LoadingSkeleton, ErrorState, EmptyState, Breadcrumbs, Tabs, Badge } from "@/components/ui";
import { BarChart3 } from "lucide-react";
import { CourseOfferingBanner } from "@/components/course-offering-context";
import { TeacherAssignmentActions } from "@/components/teacher-assignment";
import { offeringAvailable } from "@/lib/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function OfferingDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const { data, error, isLoading, mutate } = useSWR(`off-${params.id}`, () => get<Row>(`/course-offerings/${params.id}`).then((r) => r.data));
  const { data: assessments } = useSWR(tab === "assessments" ? `off-assess-${params.id}` : null, () => get<Row[]>(`/assessments?courseOfferingId=${params.id}&limit=100`).then((r) => r.data));
  const { data: notices } = useSWR(tab === "notices" ? `off-not-${params.id}` : null, () => get<Row[]>(`/notices?courseOfferingId=${params.id}&limit=50`).then((r) => r.data));

  async function toggle() {
    if (!data) return;
    await patch(`/course-offerings/${params.id}`, { isActive: !data.isActive });
    await mutate();
  }

  if (isLoading) return <><PageHeader title="Course offering" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Course offering" /><ErrorState message="Failed to load offering" onRetry={() => mutate()} /></>;

  const students = (data.students as Row[] | undefined) ?? [];
  const assignments = (data.assignments as Row[] | undefined) ?? [];
  const active = assignments.find((a) => a.isActive);
  const schedules = (data.schedules as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Course Offerings", href: "/admin/course-offerings" }, { label: str((data.course as Row)?.title) }]} />
      <PageHeader
        title={`${str((data.course as Row)?.title)}`}
        subtitle={`${str(data.context)} — ${str((data.academicYear as Row)?.name)} · ${str((data.trade as Row)?.name)} · ${str((data.semester as Row)?.name)} · ${str((data.shift as Row)?.name)} · Section ${str((data.section as Row)?.name)}`}
        actions={<Button variant="outline" onClick={toggle}>{data.isActive ? "Deactivate" : "Activate"}</Button>}
      />
      <CourseOfferingBanner offering={data} eyebrow="Course offering" />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "students", label: `Students (${students.length})` }, { id: "teacher", label: "Teacher" }, { id: "schedule", label: "Schedule" }, { id: "attendance", label: "Attendance" }, { id: "assessments", label: "Assessments" }, { id: "notices", label: "Notices" }]} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm text-slate-500">Status</p>
            <p className="mt-1">
              {offeringAvailable(data) ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
              {(data.academicYear as Row | undefined)?.isActive === false && (
                <span className="ml-2 text-xs text-amber-600">Academic year inactive</span>
              )}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-slate-500">Teacher</p>
            <p className="mt-1 font-semibold">
              {active ? str(((active.teacher as Row)?.user as Row)?.name) : <span className="font-normal text-amber-600">Unassigned</span>}
            </p>
            <div className="mt-2">
              <TeacherAssignmentActions offering={data} compact onSaved={() => mutate()} />
            </div>
          </Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Students</p><p className="mt-1 text-2xl font-bold">{students.length}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Sessions</p><p className="mt-1 text-2xl font-bold">{str((data._count as Row)?.sessions ?? 0)}</p></Card>
        </div>
      )}
      {tab === "students" && (
        <Table headers={["Roll", "Student ID", "Name", "Email"]}>
          {students.map((s) => <tr key={str(s.id)}><td className="px-4 py-3 font-medium">{str(s.rollNumber)}</td><td className="px-4 py-3 font-medium">{str(s.studentId)}</td><td className="px-4 py-3">{str((s.user as Row)?.name)}</td><td className="px-4 py-3 text-sm text-slate-500">{str((s.user as Row)?.email)}</td></tr>)}
        </Table>
      )}
      {tab === "teacher" && (
        <Table headers={["Teacher", "Employee ID", "Since", "Until", "Status"]}>
          {assignments.map((a) => <tr key={str(a.id)}><td className="px-4 py-3">{str(((a.teacher as Row)?.user as Row)?.name)}</td><td className="px-4 py-3">{str((a.teacher as Row)?.employeeId)}</td><td className="px-4 py-3 text-sm">{str(a.assignedAt).slice(0, 10)}</td><td className="px-4 py-3 text-sm">{a.endedAt ? str(a.endedAt).slice(0, 10) : "—"}</td><td className="px-4 py-3">{a.isActive ? <Badge tone="green">Active</Badge> : <Badge>Closed</Badge>}</td></tr>)}
        </Table>
      )}
      {tab === "schedule" && (
        schedules.length === 0 ? <p className="text-sm text-slate-500">No active schedule.</p> : schedules.map((v) => (
          <Card key={str(v.id)} className="mb-3 p-4">
            <p className="mb-2 text-sm font-semibold">Version {str(v.version)} · from {str(v.effectiveFrom).slice(0, 10)}</p>
            <Table headers={["Day", "Start", "End", "Room"]}>
              {((v.items as Row[]) ?? []).map((it, i) => <tr key={i}><td className="px-4 py-2">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(it.weekday)]}</td><td className="px-4 py-2">{str(it.startTime)}</td><td className="px-4 py-2">{str(it.endTime)}</td><td className="px-4 py-2">{str(it.room || it.lab || "—")}</td></tr>)}
            </Table>
          </Card>
        ))
      )}
      {tab === "attendance" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-violet-50 p-2 text-violet-700"><BarChart3 size={20} /></span>
              <div className="flex-1">
                <p className="font-semibold">Attendance Report (read-only)</p>
                <p className="mt-1 text-sm text-slate-500">Browse historical sessions, view summaries, audit changes. Admins cannot take or edit attendance.</p>
                <a
                  href={`/admin/course-offerings/${params.id}/attendance?tab=report`}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Open Attendance Report
                </a>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-amber-50 p-2 text-amber-700"><BarChart3 size={20} /></span>
              <div className="flex-1">
                <p className="font-semibold">Change Requests</p>
                <p className="mt-1 text-sm text-slate-500">Teacher corrections for this offering arrive as approval requests.</p>
                <a
                  href="/admin/attendance?tab=approvals"
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open Approvals
                </a>
              </div>
            </div>
          </Card>
        </div>
      )}
      {tab === "assessments" && (
        <Table headers={["Title", "Type", "Total", "Due"]}>
          {(assessments ?? []).map((a) => <tr key={str(a.id)}><td className="px-4 py-3 font-medium">{str(a.title)}</td><td className="px-4 py-3"><Badge tone="blue">{str(a.type)}</Badge></td><td className="px-4 py-3">{str(a.totalMarks)}</td><td className="px-4 py-3 text-sm">{a.dueDate ? str(a.dueDate).slice(0, 10) : "—"}</td></tr>)}
        </Table>
      )}
      {tab === "notices" && (
        <div className="space-y-2">
          {(notices ?? []).map((n) => (
            <Card key={str(n.id)} className="p-4"><p className="font-semibold">{str(n.title)}</p><p className="mt-1 text-sm text-slate-600">{str(n.content)}</p><p className="mt-1 text-xs text-slate-400">{str(n.publishedAt).slice(0, 10)}</p></Card>
          ))}
          {(notices ?? []).length === 0 && <p className="text-sm text-slate-500">No notices.</p>}
        </div>
      )}
    </div>
  );
}
