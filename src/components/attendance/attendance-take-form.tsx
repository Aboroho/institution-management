"use client";

/**
 * Attendance editor for one CourseOffering and one calendar date.
 *
 * The create view is intentionally create-only. Once the session endpoint says
 * a session exists, this component renders the informational report link and
 * no longer renders controls that could create another entry. The report edit
 * route mounts the same component with lockDate=true and receives the
 * authoritative session correction state from the backend.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  Badge, Button, Card, EmptyState, ErrorState, FieldError, Input, LoadingSkeleton,
  Spinner, Textarea,
} from "@/components/ui";
import { Check, ChevronLeft, ChevronRight, Clock3, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { get, post, ApiError } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

type Permissions = {
  directCorrectionLimit: number;
  correctionsUsed: number;
  correctionCapacityRemaining: number;
  canDirectCorrect: boolean;
  canRequestChange: boolean;
  hasPendingChangeRequest: boolean;
};

type SaveResult = {
  sessionId: string;
  isNewSession: boolean;
  createdCount: number;
  updatedCount: number;
  skipped: [];
};

const statusMeta: Record<AttendanceStatus, { label: string; icon: typeof UserCheck; classes: string; selected: string }> = {
  PRESENT: {
    label: "Present",
    icon: UserCheck,
    classes: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    selected: "border-emerald-600 bg-emerald-100 ring-2 ring-emerald-300 dark:border-emerald-400 dark:bg-emerald-900/70 dark:ring-emerald-700",
  },
  ABSENT: {
    label: "Absent",
    icon: UserX,
    classes: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
    selected: "border-rose-600 bg-rose-100 ring-2 ring-rose-300 dark:border-rose-400 dark:bg-rose-900/70 dark:ring-rose-700",
  },
  LATE: {
    label: "Late",
    icon: Clock3,
    classes: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    selected: "border-amber-600 bg-amber-100 ring-2 ring-amber-300 dark:border-amber-400 dark:bg-amber-900/70 dark:ring-amber-700",
  },
  EXCUSED: {
    label: "Excused",
    icon: ShieldCheck,
    classes: "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    selected: "border-sky-600 bg-sky-100 ring-2 ring-sky-300 dark:border-sky-400 dark:bg-sky-900/70 dark:ring-sky-700",
  },
};

const pad2 = (value: number) => String(value).padStart(2, "0");
const todayStr = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};
const shiftDate = (dateString: string, delta: number) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return todayStr();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
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
  offering?: Row;
  initialDate?: string;
  lockDate?: boolean;
  backHref?: string;
  backLabel?: string;
  reportHref?: string;
}) {
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    setStatuses({});
    setReason("");
    setMessage("");
    setErrorMessage("");
  }, [date]);

  const { data: offeringData, error: offeringError, isLoading: offeringLoading } = useSWR(
    offering ? null : `off-${offeringId}`,
    () => get<Row>(`/course-offerings/${offeringId}`).then((response) => response.data),
  );
  const resolvedOffering = offering ?? offeringData;
  const students = useMemo(() => (resolvedOffering?.students as Row[] | undefined) ?? [], [resolvedOffering]);

  const { data: sessionData, error: sessionError, mutate, isLoading: sessionLoading } = useSWR(
    `t-att-${offeringId}-${date}`,
    () => get<Row | null>(`/attendance/sessions?courseOfferingId=${offeringId}&date=${date}`).then((response) => response.data),
  );
  const session = sessionData;
  const records = useMemo(() => (session?.records as Row[] | undefined) ?? [], [session]);
  const existingByStudent = useMemo(() => {
    const map = new Map<string, Row>();
    for (const record of records) map.set(str(record.studentId), record);
    return map;
  }, [records]);
  const permissions = session?.permissions as Permissions | undefined;
  const hasSession = Boolean(session?.id);
  const editing = lockDate && hasSession;

  const effectiveStatus = (studentId: string): AttendanceStatus => {
    const selected = statuses[studentId];
    if (selected) return selected;
    const saved = existingByStudent.get(studentId)?.status;
    return ATTENDANCE_STATUSES.includes(saved as AttendanceStatus) ? saved as AttendanceStatus : "PRESENT";
  };

  const summary = useMemo(() => {
    const counts: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const student of students) counts[effectiveStatus(str(student.id))] += 1;
    return counts;
    // effectiveStatus reads only the values listed in these dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, statuses, session]);

  function setStatus(studentId: string, status: AttendanceStatus) {
    setStatuses((current) => ({ ...current, [studentId]: status }));
    setMessage("");
    setErrorMessage("");
  }

  async function saveNewSession() {
    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const response = await post<SaveResult>("/attendance/sessions", {
        courseOfferingId: offeringId,
        attendanceDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
        mode: "create",
        records: students.map((student) => ({ studentId: str(student.id), status: effectiveStatus(str(student.id)) })),
      });
      setMessage(`Attendance recorded for ${response.data.createdCount} student${response.data.createdCount === 1 ? "" : "s"}.`);
      setStatuses({});
      await mutate();
      await globalMutate(
        (key: unknown) => typeof key === "string" && key.startsWith(`att-report-${offeringId}-`),
        undefined,
        { revalidate: true },
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        await mutate();
        setMessage("Attendance was recorded by another request. The existing attendance entry is shown below.");
      } else {
        setErrorMessage(error instanceof ApiError ? error.message : "Attendance could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveDirectCorrection() {
    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const response = await post<SaveResult>("/attendance/sessions", {
        courseOfferingId: offeringId,
        attendanceDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
        mode: "edit",
        records: students.map((student) => ({ studentId: str(student.id), status: effectiveStatus(str(student.id)) })),
      });
      setMessage(response.data.updatedCount > 0 ? "Direct attendance correction saved." : "No attendance changes to save.");
      setStatuses({});
      await mutate();
      await globalMutate(
        (key: unknown) => typeof key === "string" && key.startsWith(`att-report-${offeringId}-`),
        undefined,
        { revalidate: true },
      );
    } catch (error) {
      if (error instanceof ApiError && (error.code === "APPROVAL_REQUIRED" || error.code === "CONFLICT")) {
        await mutate();
      }
      setErrorMessage(error instanceof ApiError ? error.message : "Attendance could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function submitEntryRequest() {
    if (!session?.id) return;
    const changes = students
      .map((student) => {
        const record = existingByStudent.get(str(student.id));
        const proposed = effectiveStatus(str(student.id));
        if (!record || record.status === proposed) return null;
        return { recordId: str(record.id), newStatus: proposed };
      })
      .filter((change): change is { recordId: string; newStatus: AttendanceStatus } => change !== null);
    if (changes.length === 0) {
      setErrorMessage("Prepare at least one changed student status before requesting approval.");
      return;
    }
    if (!reason.trim()) {
      setErrorMessage("A reason is required for an attendance-entry approval request.");
      return;
    }

    setRequesting(true);
    setMessage("");
    setErrorMessage("");
    try {
      await post("/attendance/change-requests", { sessionId: str(session.id), changes, reason: reason.trim() });
      setMessage("The complete attendance-entry change set was submitted for admin approval.");
      setStatuses({});
      setReason("");
      await mutate();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") await mutate();
      setErrorMessage(error instanceof ApiError ? error.message : "Change request could not be submitted.");
    } finally {
      setRequesting(false);
    }
  }

  if (offeringLoading && !resolvedOffering) return <LoadingSkeleton rows={4} />;
  if (offeringError && !resolvedOffering) return <ErrorState message="Failed to load course offering" />;
  if (sessionError) return <ErrorState message="Failed to load attendance for this date" onRetry={() => mutate()} />;
  if (sessionLoading && sessionData === undefined) return <LoadingSkeleton rows={4} />;

  if (!lockDate && hasSession) {
    return (
      <div className="space-y-4">
        <DateNavigation date={date} setDate={setDate} lockDate={false} />
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 via-sky-50 to-violet-50 p-6 dark:border-emerald-900 dark:from-emerald-950/50 dark:via-sky-950/40 dark:to-violet-950/40">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                Attendance has been recorded for <strong>{date}</strong>.
              </p>
              <a
                href={reportHref ?? `/teacher/course-offerings/${offeringId}/attendance?tab=report`}
                className="mt-2 inline-flex font-semibold text-violet-800 underline decoration-2 underline-offset-2 hover:text-violet-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-200"
              >
                View Attendance Report to edit
              </a>
            </div>
          </div>
          {message && <p className="mt-4 rounded-lg bg-white/70 p-3 text-sm text-emerald-800 dark:bg-slate-950/30 dark:text-emerald-200" role="status">{message}</p>}
        </Card>
      </div>
    );
  }

  if (lockDate && !hasSession) {
    return (
      <div className="space-y-3">
        {backHref && <a href={backHref} className="inline-flex text-sm text-slate-600 underline">← {backLabel ?? "Back"}</a>}
        <ErrorState message={`No attendance entry exists for ${date}. Return to Take Attendance to create it.`} />
      </div>
    );
  }

  const canDirectCorrect = Boolean(permissions?.canDirectCorrect);
  const canRequestChange = Boolean(permissions?.canRequestChange);
  const pendingRequest = Boolean(permissions?.hasPendingChangeRequest);
  const capacityExhausted = permissions?.correctionCapacityRemaining === 0;

  return (
    <div className="space-y-4">
      {backHref && <a href={backHref} className="inline-flex text-sm text-slate-600 underline hover:text-brand-700">← {backLabel ?? "Back"}</a>}
      <DateNavigation date={date} setDate={setDate} lockDate={lockDate} />
      <Card className="p-4">
        {editing ? (
          canDirectCorrect ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" role="status">
              <strong>Direct correction mode.</strong> This attendance entry has {str(permissions?.correctionCapacityRemaining)} direct correction operation{permissions?.correctionCapacityRemaining === 1 ? "" : "s"} remaining. Save changes directly; no approval request is needed.
            </div>
          ) : capacityExhausted ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status">
              <strong>Approval required.</strong> This attendance entry has exhausted its {str(permissions?.directCorrectionLimit || "configured")} direct correction operations. Prepare all student changes below and submit one request for the entire attendance entry.
              {pendingRequest && <p className="mt-1 font-semibold">A request is already pending review. It cannot be submitted again.</p>}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" role="status">
              <strong>Direct editing is closed.</strong> The configured teacher edit window has ended for this attendance entry. No direct correction or approval request can be submitted from this screen.
            </div>
          )
        ) : (
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
            <strong>New attendance entry.</strong> Choose exactly one status for every student, then save the attendance session.
          </div>
        )}
        {message && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
        {errorMessage && <FieldError error={errorMessage} />}
      </Card>

      {students.length === 0 ? (
        <EmptyState title="No students enrolled" hint="Enroll students in this section before taking attendance." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap" aria-label="Attendance summary">
            <Badge tone="green">Present {summary.PRESENT}</Badge>
            <Badge tone="red">Absent {summary.ABSENT}</Badge>
            <Badge tone="amber">Late {summary.LATE}</Badge>
            <Badge tone="blue">Excused {summary.EXCUSED}</Badge>
          </div>
          {!editing && (
            <Button
              variant="secondary"
              onClick={() => {
                const all: Record<string, AttendanceStatus> = {};
                for (const student of students) all[str(student.id)] = "PRESENT";
                setStatuses(all);
              }}
            >
              Mark all present
            </Button>
          )}
          <div className="space-y-3" role="list" aria-label="Student attendance statuses">
            {students.map((student, index) => (
              <StudentStatusCard
                key={str(student.id)}
                student={student}
                index={index}
                value={effectiveStatus(str(student.id))}
                onChange={(status) => setStatus(str(student.id), status)}
              />
            ))}
          </div>
          {editing && capacityExhausted && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <label htmlFor="attendance-entry-reason" className="block text-sm font-semibold text-amber-950 dark:text-amber-100">Reason for the attendance-entry request <span aria-hidden="true">*</span></label>
              <Textarea
                id="attendance-entry-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why these attendance statuses need to change"
                required
                aria-required="true"
              />
              <p className="text-xs text-amber-800 dark:text-amber-200">The reason applies to the complete proposed change set, not to an individual student.</p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {!editing && (
              <Button onClick={saveNewSession} disabled={saving || students.length === 0}>
                {saving && <Spinner />} Save attendance
              </Button>
            )}
            {editing && canDirectCorrect && (
              <Button onClick={saveDirectCorrection} disabled={saving}>
                {saving && <Spinner />} Save attendance
              </Button>
            )}
            {editing && capacityExhausted && (
              <Button onClick={submitEntryRequest} disabled={requesting || !canRequestChange || pendingRequest || !reason.trim()}>
                {requesting && <Spinner />} Request change for attendance entry
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DateNavigation({ date, setDate, lockDate }: { date: string; setDate: (date: string) => void; lockDate: boolean }) {
  return (
    <Card className="flex flex-wrap items-center gap-2 p-4">
      {!lockDate && <Button variant="outline" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></Button>}
      <label htmlFor="attendance-date" className="sr-only">Attendance date</label>
      <Input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-auto" disabled={lockDate} />
      {!lockDate && <>
        <Button variant="outline" onClick={() => setDate(todayStr())}>Today</Button>
        <Button variant="outline" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day"><ChevronRight size={16} /></Button>
      </>}
      {lockDate && <span className="text-sm text-slate-600">Editing attendance for <strong>{date}</strong></span>}
    </Card>
  );
}

function StudentStatusCard({
  student,
  index,
  value,
  onChange,
}: {
  student: Row;
  index: number;
  value: AttendanceStatus;
  onChange: (status: AttendanceStatus) => void;
}) {
  const studentId = str(student.id);
  const name = str((student.user as Row | undefined)?.name);
  const permanentId = str(student.studentId);
  const groupName = `attendance-status-${studentId || index}`;
  return (
    <div role="listitem" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold text-indigo-800 dark:text-indigo-200">{name}</span>
        <span className="text-xs font-medium text-slate-500">Roll {str(student.rollNumber) || "—"} · {permanentId}</span>
      </div>
      <fieldset>
        <legend className="sr-only">Attendance status for {name}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ATTENDANCE_STATUSES.map((status) => {
            const meta = statusMeta[status];
            const Icon = meta.icon;
            const selected = value === status;
            return (
              <label
                key={status}
                className={`relative flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-500 ${meta.classes} ${selected ? meta.selected : ""}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={status}
                  checked={selected}
                  onChange={() => onChange(status)}
                  className="sr-only"
                  aria-label={`${meta.label} for ${name}`}
                />
                <Icon size={17} aria-hidden="true" />
                <span>{meta.label}</span>
                {selected && <Check size={15} className="ml-auto" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
