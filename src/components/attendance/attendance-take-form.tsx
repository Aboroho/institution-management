"use client";
/**
 * AttendanceTakeForm
 *
 * Reusable take/edit attendance UI for a single CourseOffering + date.
 * Used by:
 *   - the "Take Attendance" tab of the unified attendance page (date picker)
 *   - the edit page (.../attendance/edit?date=YYYY-MM-DD, read-only date)
 *   - admin equivalents
 *
 * Records that exhausted their direct corrections are reported back by the
 * API (partial save) instead of aborting the whole edit; this component
 * surfaces them so the teacher can file change requests for those rows.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  Card, Button, Input, Select, Table, LoadingSkeleton, EmptyState, ErrorState,
  Label, Textarea, FieldError, StatusBadge, Spinner, Badge, Dialog,
} from "@/components/ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { get, post, ApiError } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const ATT = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

// Calendar-day arithmetic in UTC so the selected date never drifts with the
// browser timezone or DST transitions.
const pad2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const shiftDate = (d: string, delta: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return todayStr();
  const x = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  x.setUTCDate(x.getUTCDate() + delta);
  return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
};

type SkippedRow = { recordId: string; studentId: string; currentStatus: string; reason: string };
type SaveResult = {
  sessionId: string;
  isNewSession: boolean;
  createdCount: number;
  updatedCount: number;
  skipped: SkippedRow[];
};

export function AttendanceTakeForm({
  offeringId,
  offering,
  initialDate,
  lockDate = false,
  backHref,
  backLabel,
  reportHref,
}: {
  offeringId: string;
  /** Optional offering context (title/section/etc.) for the header. */
  offering?: Row;
  initialDate?: string;
  lockDate?: boolean;
  backHref?: string;
  backLabel?: string;
  /** URL for the report where an existing day's attendance can be edited. */
  reportHref?: string;
}) {
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const [reqDialog, setReqDialog] = useState<Row | null>(null);
  const [reqStatus, setReqStatus] = useState("PRESENT");
  const [reqReason, setReqReason] = useState("");
  const [submittingReq, setSubmittingReq] = useState(false);
  const { mutate: globalMutate } = useSWRConfig();

  // The edit page stays mounted when navigating between dates
  // (.../edit?date=A -> .../edit?date=B), so follow prop changes instead of
  // only using the first value. Without this the form kept showing (and
  // saving!) the previous date's data.
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  // Per-date editing state must not leak into another date.
  useEffect(() => {
    setStatuses({});
    setReason("");
    setMsg("");
    setWarn("");
    setErr("");
  }, [date]);

  // Pull offering details (students) once.
  const { data: offeringData, error: offeringErr, isLoading: offeringLoad } = useSWR(
    offering ? null : `off-${offeringId}`,
    () => get<Row>(`/course-offerings/${offeringId}`).then((r) => r.data),
  );
  const resolvedOffering = offering ?? offeringData;
  const students = useMemo(() => (resolvedOffering?.students as Row[] | undefined) ?? [], [resolvedOffering]);

  const { data: sessionData, mutate, isLoading } = useSWR(
    `t-att-${offeringId}-${date}`,
    () => get<Row | null>(`/attendance/sessions?courseOfferingId=${offeringId}&date=${date}`).then((r) => r.data),
  );
  const session = sessionData as Row | null | undefined;

  const existingByStudent = new Map<string, Row>();
  for (const r of (session?.records as Row[] | undefined) ?? []) existingByStudent.set(str(r.studentId), r);

  const effective = (sid: string) =>
    statuses[sid] ?? (existingByStudent.get(sid) ? str(existingByStudent.get(sid)?.status) : "PRESENT");

  const summary = useMemo(() => {
    const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const s of students) c[effective(str(s.id))] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, statuses, session]);

  async function save() {
    if (lockDate && !reason.trim()) {
      setErr("A reason is required when editing attendance.");
      return;
    }
    setSaving(true); setMsg(""); setWarn(""); setErr("");
    try {
      const records = students.map((s) => ({ studentId: str(s.id), status: effective(str(s.id)) }));
      const res = await post<SaveResult>("/attendance/sessions", {
        courseOfferingId: offeringId,
        attendanceDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
        records,
        reason: reason || undefined,
      });
      const saved = res.data;
      const changed = (saved.createdCount ?? 0) + (saved.updatedCount ?? 0);
      const skipped = saved.skipped ?? [];
      if (changed === 0 && skipped.length === 0) {
        setMsg("No changes to save — attendance is already up to date.");
      } else if (changed > 0) {
        setMsg(
          saved.isNewSession
            ? `Attendance recorded for ${changed} student${changed === 1 ? "" : "s"}.`
            : `Attendance updated (${changed} change${changed === 1 ? "" : "s"} saved).`,
        );
      }
      if (skipped.length > 0) {
        setWarn(
          `${skipped.length} record${skipped.length === 1 ? "" : "s"} reached the direct-correction limit and ` +
          `were not changed — use “Request change” on those rows for admin approval.`,
        );
      }
      setStatuses({}); setReason("");
      await mutate();
      // Keep the Sessions/Report tab in sync (summaries + update counts).
      await globalMutate(
        (k: unknown) => typeof k === "string" && k.startsWith(`att-report-${offeringId}-`),
        undefined,
        { revalidate: true },
      );
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

  const hasSession = Boolean(session && (session as Row).id);

  return (
    <div>
      {backHref && (
        <a href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
          ← {backLabel ?? "Back"}
        </a>
      )}
      <Card className="mb-4 p-4">
        {hasSession && !lockDate && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Attendance has been recorded for <strong>{date}</strong>.{" "}
            <a href={reportHref ?? "#"} className="font-semibold underline hover:text-blue-950">
              View Attendance Report to edit
            </a>
          </div>
        )}
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
          {lockDate && (
            <Input
              required
              placeholder="Reason for editing attendance (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-w-[240px] flex-1"
              aria-label="Reason for editing attendance"
            />
          )}
          <Button onClick={save} disabled={saving || students.length === 0}>
            {saving && <Spinner />} Save attendance
          </Button>
        </div>
        {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
        {warn && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{warn}</p>}
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
