"use client";
/**
 * AttendanceTakeForm
 *
 * Reusable take/edit attendance UI for a single CourseOffering + date.
 * Used by:
 *   - /teacher/course-offerings/[id]/attendance/take  (date picker)
 *   - /teacher/course-offerings/[id]/attendance/edit?date=YYYY-MM-DD (read-only date)
 *   - admin equivalents
 *
 * Backend authority is preserved: this component never overrides the
 * APPROVAL_REQUIRED response, it surfaces it to the user.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Card, Button, Input, Select, Table, LoadingSkeleton, EmptyState, ErrorState,
  Label, Textarea, FieldError, StatusBadge, Spinner, Badge, Dialog,
} from "@/components/ui";
import { ChevronLeft, ChevronRight, History, Plus } from "lucide-react";
import { get, post, ApiError } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const ATT = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
const todayStr = () => new Date().toISOString().slice(0, 10);
const shiftDate = (d: string, delta: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x.toISOString().slice(0, 10);
};

export function AttendanceTakeForm({
  offeringId,
  offering,
  initialDate,
  lockDate = false,
  backHref,
  backLabel,
}: {
  offeringId: string;
  /** Optional offering context (title/section/etc.) for the header. */
  offering?: Row;
  initialDate?: string;
  lockDate?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [reqDialog, setReqDialog] = useState<Row | null>(null);
  const [reqStatus, setReqStatus] = useState("PRESENT");
  const [reqReason, setReqReason] = useState("");
  const [submittingReq, setSubmittingReq] = useState(false);

  // Pull offering details (students) once.
  const { data: offeringData, error: offeringErr, isLoading: offeringLoad } = useSWR(
    offering ? null : `off-${offeringId}`,
    () => get<Row>(`/course-offerings/${offeringId}`).then((r) => r.data),
  );
  const resolvedOffering = offering ?? offeringData;
  const students = useMemo(() => (resolvedOffering?.students as Row[] | undefined) ?? [], [resolvedOffering]);

  const { data: session, mutate, isLoading } = useSWR(
    `t-att-${offeringId}-${date}`,
    () => get<Row | null>(`/attendance/sessions?courseOfferingId=${offeringId}&date=${date}`).then((r) => r.data),
  );

  const existingByStudent = new Map<string, Row>();
  for (const r of (session?.records as Row[] | undefined) ?? []) existingByStudent.set(str(r.studentId), r);

  const effective = (sid: string) =>
    statuses[sid] ?? (existingByStudent.get(sid) ? str(existingByStudent.get(sid)?.status) : "PRESENT");

  const summary = useMemo(() => {
    const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const s of students) c[effective(str(s.id))] += 1;
    return c;
  }, [students, statuses, session]);

  async function save() {
    setSaving(true); setMsg(""); setErr("");
    try {
      const records = students.map((s) => ({ studentId: str(s.id), status: effective(str(s.id)) }));
      await post("/attendance/sessions", {
        courseOfferingId: offeringId,
        attendanceDate: new Date(date).toISOString(),
        records,
        reason: reason || undefined,
      });
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
    setSubmittingReq(true); setErr("");
    try {
      await post("/attendance/change-requests", {
        recordId: str(reqDialog.id),
        newStatus: reqStatus,
        reason: reqReason,
      });
      setReqDialog(null); setReqReason("");
      setMsg("Change request submitted for admin approval.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Request failed");
    } finally { setSubmittingReq(false); }
  }

  if (offeringLoad && !resolvedOffering) return <LoadingSkeleton rows={4} />;
  if (offeringErr && !resolvedOffering) {
    return <ErrorState message="Failed to load course offering" />;
  }

  return (
    <div>
      {backHref && (
        <a href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
          ← {backLabel ?? "Back"}
        </a>
      )}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {!lockDate && (
            <>
              <Button variant="outline" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
                <ChevronLeft size={16} />
              </Button>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto"
                aria-label="Attendance date"
                disabled={lockDate}
              />
              <Button variant="outline" onClick={() => setDate(todayStr())}>Today</Button>
              <Button variant="outline" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
                <ChevronRight size={16} />
              </Button>
            </>
          )}
          {lockDate && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Editing: <strong>{date}</strong>
            </div>
          )}
          <span className="ml-auto flex flex-wrap gap-2 text-sm">
            <Badge tone="green">P {summary.PRESENT}</Badge>
            <Badge tone="red">A {summary.ABSENT}</Badge>
            <Badge tone="amber">L {summary.LATE}</Badge>
            <Badge tone="blue">E {summary.EXCUSED}</Badge>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              const all: Record<string, string> = {};
              for (const s of students) all[str(s.id)] = "PRESENT";
              setStatuses(all);
            }}
          >
            Mark all present
          </Button>
          <Input
            placeholder="Correction reason (required when changing saved attendance)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-[240px] flex-1"
            aria-label="Correction reason"
          />
          <Button onClick={save} disabled={saving || students.length === 0}>
            {saving && <Spinner />} Save attendance
          </Button>
        </div>
        {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
        {err && <FieldError error={err} />}
      </Card>

      {isLoading ? (
        <LoadingSkeleton />
      ) : students.length === 0 ? (
        <EmptyState title="No students enrolled" hint="Enroll students in this section before taking attendance." />
      ) : (
        <Table headers={["Roll", "Student ID", "Name", "Status", "Corrections left", "Actions"]}>
          {students.map((s) => {
            const sid = str(s.id);
            const ex = existingByStudent.get(sid);
            const left = ex ? Math.max(0, 2 - Number(ex.directCorrections ?? 0)) : 2;
            const reachedLimit = Boolean(ex) && left === 0;
            return (
              <tr key={sid} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(s.rollNumber)}</td>
                <td className="px-4 py-3 font-medium">{str(s.studentId)}</td>
                <td className="px-4 py-3">{str((s.user as Row)?.name)}</td>
                <td className="px-4 py-3">
                  <Select
                    value={effective(sid)}
                    onChange={(e) => setStatuses({ ...statuses, [sid]: e.target.value })}
                    className="w-40"
                    aria-label={`Status for ${str(s.studentId)}`}
                  >
                    {ATT.map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-3 text-sm">
                  {ex ? (
                    reachedLimit ? (
                      <span className="font-medium text-amber-700" title="Direct modification limit reached — submit a change request.">
                        {left}/2 direct
                      </span>
                    ) : (
                      `${left}/2 direct`
                    )
                  ) : "New entry"}
                </td>
                <td className="px-4 py-3">
                  {ex ? (
                    <span className="flex gap-1">
                      {reachedLimit && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" aria-label="Approval required">
                          Approval required
                        </span>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => { setReqDialog(ex); setReqStatus(effective(sid)); }}
                      >
                        <Plus size={14} /> Request change
                      </Button>
                    </span>
                  ) : <span className="text-sm text-slate-400">—</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Dialog
        open={reqDialog !== null}
        title="Request attendance change (admin approval)"
        onClose={() => setReqDialog(null)}
      >
        <div className="space-y-3">
          {reqDialog && (
            <p className="text-sm">
              Current: <StatusBadge status={str(reqDialog.status)} />
            </p>
          )}
          <div>
            <Label required>New status</Label>
            <Select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)}>
              {ATT.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
          <div>
            <Label required>Reason</Label>
            <Textarea
              value={reqReason}
              onChange={(e) => setReqReason(e.target.value)}
              placeholder="Why does this attendance entry need to change?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReqDialog(null)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={submittingReq || !reqReason.trim()}>
              {submittingReq && <Spinner />} Submit request
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
