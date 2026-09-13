"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import {
  PageHeader, Button, Card, Table, LoadingSkeleton, EmptyState, ErrorState,
  Breadcrumbs, Tabs, Badge, StatusBadge, Dialog, Input, Select, Textarea,
  Label, FieldError, Spinner,
} from "@/components/ui";
import { Plus, ChevronLeft, ChevronRight, History } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const todayStr = () => new Date().toISOString().slice(0, 10);
const shiftDate = (d: string, delta: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x.toISOString().slice(0, 10);
};

export default function TeacherOfferingDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const { data, error, isLoading, mutate } = useSWR(`t-off-${params.id}`, () => get<Row>(`/course-offerings/${params.id}`).then((r) => r.data));

  if (isLoading) return <><PageHeader title="Course" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Course" /><ErrorState message={error instanceof ApiError ? error.message : "Failed to load"} onRetry={() => mutate()} /></>;

  return (
    <div>
      <Breadcrumbs items={[{ label: "My Courses", href: "/teacher/course-offerings" }, { label: str((data.course as Row)?.title) }]} />
      <PageHeader
        title={str((data.course as Row)?.title)}
        subtitle={`${str((data.course as Row)?.code)} · Section ${str((data.section as Row)?.name)} · ${str((data.semester as Row)?.name)} · ${str((data.shift as Row)?.name)}`}
      />
      <Tabs
        tabs={[
          { id: "overview", label: "Overview" }, { id: "students", label: "Students" },
          { id: "attendance", label: "Attendance" }, { id: "assessments", label: "Assessments" },
          { id: "marks", label: "Marks" }, { id: "schedule", label: "Schedule" }, { id: "notices", label: "Notices" },
        ]}
        active={tab} onChange={setTab}
      />
      {tab === "overview" && <OverviewTab offering={data} />}
      {tab === "students" && <StudentsTab offering={data} />}
      {tab === "attendance" && <AttendanceTab offeringId={params.id} students={(data.students as Row[] | undefined) ?? []} />}
      {tab === "assessments" && <AssessmentsTab offeringId={params.id} />}
      {tab === "marks" && <MarksTab offeringId={params.id} students={(data.students as Row[] | undefined) ?? []} />}
      {tab === "schedule" && <ScheduleTab offering={data} />}
      {tab === "notices" && <NoticesTab offeringId={params.id} />}
    </div>
  );
}

function OverviewTab({ offering }: { offering: Row }) {
  const students = (offering.students as Row[] | undefined) ?? [];
  const assignments = (offering.assignments as Row[] | undefined) ?? [];
  const active = assignments.find((a) => a.isActive);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="p-5"><p className="text-sm text-slate-500">Students enrolled</p><p className="mt-1 text-3xl font-bold">{students.length}</p></Card>
      <Card className="p-5"><p className="text-sm text-slate-500">Assigned teacher</p><p className="mt-1 font-semibold">{active ? str(((active.teacher as Row)?.user as Row)?.name) : "—"}</p></Card>
      <Card className="p-5"><p className="text-sm text-slate-500">Sessions held</p><p className="mt-1 text-3xl font-bold">{str((offering._count as Row)?.sessions ?? 0)}</p></Card>
    </div>
  );
}

function StudentsTab({ offering }: { offering: Row }) {
  const students = (offering.students as Row[] | undefined) ?? [];
  if (!students.length) return <EmptyState title="No enrolled students" />;
  return (
    <Table headers={["Student ID", "Name", "Email"]}>
      {students.map((s) => <tr key={str(s.id)}><td className="px-4 py-3 font-medium">{str(s.studentId)}</td><td className="px-4 py-3">{str((s.user as Row)?.name)}</td><td className="px-4 py-3 text-sm text-slate-500">{str((s.user as Row)?.email)}</td></tr>)}
    </Table>
  );
}

// ---------------- Attendance ----------------
const ATT = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

function AttendanceTab({ offeringId, students }: { offeringId: string; students: Row[] }) {
  const [date, setDate] = useState(todayStr());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [historyRow, setHistoryRow] = useState<Row | null>(null);
  const [reqDialog, setReqDialog] = useState<Row | null>(null);
  const [reqStatus, setReqStatus] = useState("PRESENT");
  const [reqReason, setReqReason] = useState("");

  const { data: session, mutate, isLoading } = useSWR(`t-att-${offeringId}-${date}`, () =>
    get<Row | null>(`/attendance/sessions?courseOfferingId=${offeringId}&date=${date}`).then((r) => r.data));

  const existingByStudent = new Map<string, Row>();
  for (const r of ((session?.records as Row[] | undefined) ?? [])) existingByStudent.set(str((r as Row).studentId), r as Row);

  const effective = (sid: string) => statuses[sid] ?? (existingByStudent.get(sid) ? str(existingByStudent.get(sid)?.status) : "PRESENT");

  function summary() {
    const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const s of students) c[effective(str(s.id))] += 1;
    return c;
  }
  const sum = summary();

  async function save() {
    setSaving(true); setMsg(""); setErr("");
    try {
      const records = students.map((s) => ({ studentId: str(s.id), status: effective(str(s.id)) as never }));
      await post("/attendance/sessions", { courseOfferingId: offeringId, attendanceDate: new Date(date).toISOString(), records, reason: reason || undefined });
      setMsg("Attendance saved.");
      setStatuses({}); setReason("");
      await mutate();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") {
        setErr("Correction limit reached — admin approval required. Use the change-request button on the specific record.");
      } else setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function submitRequest() {
    if (!reqDialog) return;
    setSaving(true); setErr("");
    try {
      await post("/attendance/change-requests", { recordId: str(reqDialog.id), newStatus: reqStatus, reason: reqReason });
      setReqDialog(null); setReqReason("");
      setMsg("Change request submitted for admin approval.");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Request failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft size={16} /></Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Attendance date" />
          <Button variant="outline" onClick={() => setDate(todayStr())}>Today</Button>
          <Button variant="outline" onClick={() => setDate(shiftDate(date, 1))}><ChevronRight size={16} /></Button>
          <span className="ml-auto flex flex-wrap gap-2 text-sm">
            <Badge tone="green">P {sum.PRESENT}</Badge><Badge tone="red">A {sum.ABSENT}</Badge>
            <Badge tone="amber">L {sum.LATE}</Badge><Badge tone="blue">E {sum.EXCUSED}</Badge>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { const all: Record<string, string> = {}; for (const s of students) all[str(s.id)] = "PRESENT"; setStatuses(all); }}>Mark all present</Button>
          <Input placeholder="Correction reason (required when changing saved attendance)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-[240px] flex-1" />
          <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save attendance</Button>
        </div>
        {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      </Card>

      {isLoading ? <LoadingSkeleton /> : students.length === 0 ? <EmptyState title="No students enrolled" /> : (
        <Table headers={["Student ID", "Name", "Status", "Corrections left", "Actions"]}>
          {students.map((s) => {
            const sid = str(s.id);
            const ex = existingByStudent.get(sid);
            const left = ex ? Math.max(0, 2 - Number(ex.directCorrections ?? 0)) : 2;
            return (
              <tr key={sid} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(s.studentId)}</td>
                <td className="px-4 py-3">{str((s.user as Row)?.name)}</td>
                <td className="px-4 py-3">
                  <Select value={effective(sid)} onChange={(e) => setStatuses({ ...statuses, [sid]: e.target.value })} className="w-40" aria-label={`Status for ${str(s.studentId)}`}>
                    {ATT.map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-3 text-sm">{ex ? `${left}/2 direct` : "New entry"}</td>
                <td className="px-4 py-3">
                  {ex ? (
                    <span className="flex gap-1">
                      <Button variant="ghost" onClick={() => setHistoryRow(ex)} aria-label="History"><History size={16} /></Button>
                      <Button variant="outline" onClick={() => { setReqDialog(ex); setReqStatus(effective(sid)); }}>Request change</Button>
                    </span>
                  ) : <span className="text-sm text-slate-400">—</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <HistoryDialog title="Attendance history" recordId={historyRow ? str(historyRow.id) : null} kind="attendance" onClose={() => setHistoryRow(null)} />

      <Dialog open={reqDialog !== null} title="Request attendance change (admin approval)" onClose={() => setReqDialog(null)}>
        <div className="space-y-3">
          <p className="text-sm">Current: {reqDialog && <StatusBadge status={str(reqDialog.status)} />}</p>
          <div><Label required>New status</Label><Select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)}>{ATT.map((a) => <option key={a} value={a}>{a}</option>)}</Select></div>
          <div><Label required>Reason</Label><Textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReqDialog(null)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={saving || !reqReason.trim()}>{saving && <Spinner />} Submit request</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function HistoryDialog({ title, recordId, kind, markId, onClose }: { title: string; recordId?: string | null; kind: "attendance" | "marks"; markId?: string | null; onClose: () => void }) {
  const key = kind === "attendance" ? (recordId ? `hist-att-${recordId}` : null) : markId ? `hist-mark-${markId}` : null;
  const url = kind === "attendance" ? `/attendance/records/${recordId}` : `/marks/history?markId=${markId}`;
  const { data } = useSWR(key, () => get<Row>(url).then((r) => r.data));
  const logs = ((data?.changeLogs as Row[] | undefined) ?? []);
  return (
    <Dialog open={key !== null} title={title} onClose={onClose} wide>
      {logs.length === 0 ? <p className="text-sm text-slate-500">No history yet.</p> : (
        <Table headers={kind === "attendance" ? ["Date", "Old", "New", "By", "Reason"] : ["Date", "Old", "New", "By", "Reason"]}>
          {logs.map((l) => (
            <tr key={str(l.id)}>
              <td className="px-4 py-2 text-sm">{new Date(str(l.createdAt)).toLocaleString()}</td>
              <td className="px-4 py-2 text-sm">{str(l.oldStatus ?? l.oldMarks ?? "—")}</td>
              <td className="px-4 py-2 text-sm font-medium">{str(l.newStatus ?? l.newMarks)}</td>
              <td className="px-4 py-2 text-sm">{str((l.changedBy as Row)?.name)}</td>
              <td className="px-4 py-2 text-sm">{str(l.reason)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Dialog>
  );
}

// ---------------- Assessments ----------------
function AssessmentsTab({ offeringId }: { offeringId: string }) {
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ type: "ASSIGNMENT", submitable: "false", countsTowardFinal: "true" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`t-assess-${offeringId}`, () => get<Row[]>(`/assessments?courseOfferingId=${offeringId}&limit=100`).then((r) => r.data));
  const items = data ?? [];

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/assessments", {
        courseOfferingId: offeringId, title: form.title, description: form.description || undefined, type: form.type,
        totalMarks: Number(form.totalMarks), passMarks: Number(form.passMarks),
        submitable: form.submitable === "true", countsTowardFinal: form.countsTowardFinal === "true",
        weight: form.weight ? Number(form.weight) : null, dueDate: form.dueDate || null,
      });
      setDialog(false); setForm({ type: "ASSIGNMENT", submitable: "false", countsTowardFinal: "true" }); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDialog(true)}><Plus size={16} /> New assessment</Button></div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No assessments" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New assessment</Button>} />
      ) : (
        <Table headers={["Title", "Type", "Total", "Pass", "Due", "Submitable", "Counts", "Submissions", "Marks"]}>
          {items.map((a) => (
            <tr key={str(a.id)}>
              <td className="px-4 py-3 font-medium">{str(a.title)}</td>
              <td className="px-4 py-3"><Badge tone="blue">{str(a.type)}</Badge></td>
              <td className="px-4 py-3">{str(a.totalMarks)}</td>
              <td className="px-4 py-3">{str(a.passMarks)}</td>
              <td className="px-4 py-3 text-sm">{a.dueDate ? str(a.dueDate).slice(0, 10) : "—"}</td>
              <td className="px-4 py-3">{a.submitable ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
              <td className="px-4 py-3">{a.countsTowardFinal ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
              <td className="px-4 py-3">{str((a._count as Row)?.submissions ?? 0)}</td>
              <td className="px-4 py-3">{str((a._count as Row)?.marks ?? 0)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={dialog} title="New assessment" onClose={() => setDialog(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label required>Title</Label><Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="col-span-2"><Label>Description</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><Label required>Type</Label><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{["ASSIGNMENT", "CLASS_TEST", "MIDTERM", "FINAL_EXAM", "PRACTICAL", "QUIZ", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
          <div><Label>Due date</Label><Input type="datetime-local" value={form.dueDate ?? ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div><Label required>Total marks</Label><Input type="number" value={form.totalMarks ?? ""} onChange={(e) => setForm({ ...form, totalMarks: e.target.value })} /></div>
          <div><Label required>Pass marks</Label><Input type="number" value={form.passMarks ?? ""} onChange={(e) => setForm({ ...form, passMarks: e.target.value })} /></div>
          <div><Label>Weight (%)</Label><Input type="number" value={form.weight ?? ""} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
          <div><Label>Accepts PDF submission?</Label><Select value={form.submitable} onChange={(e) => setForm({ ...form, submitable: e.target.value })}><option value="false">No</option><option value="true">Yes</option></Select></div>
          <div><Label>Counts toward final?</Label><Select value={form.countsTowardFinal} onChange={(e) => setForm({ ...form, countsTowardFinal: e.target.value })}><option value="true">Yes</option><option value="false">No</option></Select></div>
        </div>
        <FieldError error={formError} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------- Marks ----------------
function MarksTab({ offeringId, students }: { offeringId: string; students: Row[] }) {
  const [assessmentId, setAssessmentId] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [historyMark, setHistoryMark] = useState<string | null>(null);
  const [reqMark, setReqMark] = useState<Row | null>(null);
  const [reqVal, setReqVal] = useState("");
  const [reqReason, setReqReason] = useState("");

  const { data: assessments } = useSWR(`t-mk-assess-${offeringId}`, () => get<Row[]>(`/assessments?courseOfferingId=${offeringId}&limit=100`).then((r) => r.data));
  const mkKey = assessmentId ? `t-marks-${assessmentId}` : null;
  const { data: marks, mutate, isLoading } = useSWR(mkKey, () => get<Row[]>(`/marks?assessmentId=${assessmentId}`).then((r) => r.data));
  const byStudent = new Map<string, Row>();
  for (const m of (marks ?? [])) byStudent.set(str((m as Row).studentId), m as Row);
  const assessment = (assessments ?? []).find((a) => str(a.id) === assessmentId);

  async function save() {
    setSaving(true); setMsg(""); setErr("");
    try {
      const list = students
        .filter((s) => vals[str(s.id)] !== undefined && vals[str(s.id)] !== "")
        .map((s) => ({ studentId: str(s.id), marksObtained: Number(vals[str(s.id)]) }));
      if (!list.length) { setErr("Enter at least one mark."); setSaving(false); return; }
      await post("/marks", { assessmentId, marks: list, reason: reason || undefined });
      setMsg("Marks saved and students notified."); setVals({}); setReason("");
      await mutate();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") setErr("Correction limit reached — admin approval required. Use the request button on the specific mark.");
      else setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function submitRequest() {
    if (!reqMark) return;
    setSaving(true); setErr("");
    try {
      await post("/marks/change-requests", { markId: str(reqMark.id), newMarks: Number(reqVal), reason: reqReason });
      setReqMark(null); setReqVal(""); setReqReason("");
      setMsg("Change request submitted for admin approval.");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Request failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="md:col-span-1"><Label>Assessment</Label><Select value={assessmentId} onChange={(e) => { setAssessmentId(e.target.value); setVals({}); }}><option value="">Select...</option>{(assessments ?? []).map((a) => <option key={str(a.id)} value={str(a.id)}>{str(a.title)} (/{str(a.totalMarks)})</option>)}</Select></div>
          <div className="md:col-span-2"><Label>Correction reason (required when changing saved marks)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason..." /></div>
        </div>
        {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      </Card>
      {!assessmentId ? <EmptyState title="Select an assessment" /> : isLoading ? <LoadingSkeleton /> : (
        <>
          <Table headers={["Student ID", "Name", "Current", `Enter (max ${assessment ? str(assessment.totalMarks) : ""})`, "Corrections left", "Actions"]}>
            {students.map((s) => {
              const sid = str(s.id);
              const m = byStudent.get(sid);
              const left = m ? Math.max(0, 2 - Number(m.directCorrections ?? 0)) : 2;
              return (
                <tr key={sid}>
                  <td className="px-4 py-3 font-medium">{str(s.studentId)}</td>
                  <td className="px-4 py-3">{str((s.user as Row)?.name)}</td>
                  <td className="px-4 py-3 font-bold">{m ? str(m.marksObtained) : "—"}</td>
                  <td className="px-4 py-3"><Input type="number" className="w-28" value={vals[sid] ?? ""} onChange={(e) => setVals({ ...vals, [sid]: e.target.value })} aria-label={`Marks for ${str(s.studentId)}`} /></td>
                  <td className="px-4 py-3 text-sm">{m ? `${left}/2 direct` : "New entry"}</td>
                  <td className="px-4 py-3">
                    {m ? (
                      <span className="flex gap-1">
                        <Button variant="ghost" onClick={() => setHistoryMark(str(m.id))} aria-label="History"><History size={16} /></Button>
                        <Button variant="outline" onClick={() => { setReqMark(m); setReqVal(""); }}>Request change</Button>
                      </span>
                    ) : <span className="text-sm text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </Table>
          <div className="mt-3 flex justify-end"><Button onClick={save} disabled={saving}>{saving && <Spinner />} Save marks</Button></div>
        </>
      )}
      <HistoryDialog title="Mark history" kind="marks" markId={historyMark} onClose={() => setHistoryMark(null)} />
      <Dialog open={reqMark !== null} title="Request mark change (admin approval)" onClose={() => setReqMark(null)}>
        <div className="space-y-3">
          <p className="text-sm">Current: <strong>{reqMark ? str(reqMark.marksObtained) : ""}</strong></p>
          <div><Label required>New marks</Label><Input type="number" value={reqVal} onChange={(e) => setReqVal(e.target.value)} /></div>
          <div><Label required>Reason</Label><Textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReqMark(null)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={saving || !reqVal || !reqReason.trim()}>{saving && <Spinner />} Submit request</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------- Schedule / Notices ----------------
function ScheduleTab({ offering }: { offering: Row }) {
  const schedules = (offering.schedules as Row[] | undefined) ?? [];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (!schedules.length) return <EmptyState title="No active schedule" hint="Ask your administrator to publish a schedule." />;
  return (
    <div className="space-y-3">
      {schedules.map((v) => (
        <Card key={str(v.id)} className="p-4">
          <p className="mb-2 text-sm font-semibold">Version {str(v.version)} · from {str(v.effectiveFrom).slice(0, 10)}</p>
          <Table headers={["Day", "Start", "End", "Room"]}>
            {((v.items as Row[]) ?? []).map((it, i) => <tr key={i}><td className="px-4 py-2">{DAYS[Number(it.weekday)]}</td><td className="px-4 py-2">{str(it.startTime)}</td><td className="px-4 py-2">{str(it.endTime)}</td><td className="px-4 py-2">{str(it.room || it.lab || "—")}</td></tr>)}
          </Table>
        </Card>
      ))}
    </div>
  );
}

function NoticesTab({ offeringId }: { offeringId: string }) {
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`t-not-${offeringId}`, () => get<Row[]>(`/notices?courseOfferingId=${offeringId}&limit=50`).then((r) => r.data));
  const items = data ?? [];

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/notices", { courseOfferingId: offeringId, title: form.title, content: form.content, expiresAt: form.expiresAt || null });
      setDialog(false); setForm({}); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDialog(true)}><Plus size={16} /> New notice</Button></div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No notices" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New notice</Button>} />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={str(n.id)} className="p-4">
              <p className="font-semibold">{str(n.title)}</p>
              <p className="mt-1 text-sm text-slate-600">{str(n.content)}</p>
              <p className="mt-1 text-xs text-slate-400">{str(n.publishedAt).slice(0, 10)} · by {str(((n.teacher as Row)?.user as Row)?.name)}</p>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialog} title="New notice" onClose={() => setDialog(false)}>
        <div className="space-y-3">
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
