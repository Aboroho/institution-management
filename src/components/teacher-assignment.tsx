"use client";
/**
 * Shared teacher-assignment UI (used by the CourseOffering list/detail pages
 * and the centralized /admin/teacher-assignment page).
 *
 * One active teacher per offering, enforced server-side. The UI only mirrors
 * that state: unassigned -> [Assign Teacher], assigned -> "Teacher: X" +
 * [Substitute]. Availability derives from the offering flag AND its academic
 * year status (see offeringAvailable) — inactive contexts show no actions.
 */
import { useEffect, useState } from "react";
import { post, ApiError } from "@/lib/api/client";
import { useTeachers } from "@/components/academic-options";
import { Button, Dialog, Label, FieldError, Spinner, SearchableSelect, Textarea } from "@/components/ui";
import { UserPlus, ArrowLeftRight } from "lucide-react";
import { offeringAvailable } from "@/lib/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export function activeAssignmentOf(offering: Row | null | undefined): Row | null {
  const list = (offering?.assignments as Row[] | undefined) ?? [];
  return list.find((a) => a.isActive) ?? null;
}

export function assignedTeacherName(offering: Row | null | undefined): string | null {
  const a = activeAssignmentOf(offering);
  if (!a) return null;
  const name = str(((a.teacher as Row)?.user as Row)?.name);
  return name || null;
}

/** Human-readable reason why actions are disabled (empty when available). */
export function offeringUnavailableReason(offering: Row | null | undefined): string {
  if (!offering) return "";
  const year = offering.academicYear as Row | undefined;
  if (year && year.isActive === false) return "Academic year is inactive";
  if (offering.isActive === false) return "Course offering is inactive";
  return "";
}

export function AssignTeacherDialog({
  open,
  offering,
  onClose,
  onSaved,
}: {
  open: boolean;
  offering: Row | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const teachers = useTeachers(true);
  const [teacherId, setTeacherId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTeacherId("");
      setReason("");
      setError("");
    }
  }, [open]);

  async function save() {
    if (!offering || !teacherId) return;
    setSaving(true);
    setError("");
    try {
      await post("/teacher-assignments", {
        courseOfferingId: str(offering.id), // real database ID — never the context string
        teacherId,
        reason: reason || undefined,
      });
      onClose();
      onSaved?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Assignment failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} title="Assign teacher" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label>Course offering</Label>
          {offering ? (
            <p className="text-sm text-slate-700">
              {str((offering.course as Row)?.title)}
              {str(offering.context) && <span className="ml-2 font-mono text-xs text-brand-700">{str(offering.context)}</span>}
            </p>
          ) : null}
        </div>
        <div>
          <Label required>Teacher</Label>
          <SearchableSelect
            options={teachers}
            value={teacherId}
            onChange={setTeacherId}
            ariaLabel="Teacher"
            clearLabel="Select..."
            emptyMessage="No active teachers"
          />
        </div>
        <div>
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" rows={2} />
        </div>
        <FieldError error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !teacherId}>{saving && <Spinner />} Assign Teacher</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function SubstituteDialog({
  open,
  offering,
  currentTeacherName,
  onClose,
  onSaved,
}: {
  open: boolean;
  offering: Row | null;
  /** Shown when the offering payload does not carry its assignments (e.g. assignment history rows). */
  currentTeacherName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const teachers = useTeachers(true);
  const active = activeAssignmentOf(offering);
  const currentName = currentTeacherName ?? assignedTeacherName(offering);
  const currentTeacherId = str((active?.teacher as Row | undefined)?.id);
  const options = teachers.filter((t) => t.value !== currentTeacherId);
  const [teacherId, setTeacherId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTeacherId("");
      setReason("");
      setError("");
    }
  }, [open]);

  async function save() {
    if (!offering || !teacherId) return;
    setSaving(true);
    setError("");
    try {
      await post("/teacher-assignments/substitute", {
        courseOfferingId: str(offering.id),
        newTeacherId: teacherId,
        reason: reason || undefined,
      });
      onClose();
      onSaved?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Substitution failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} title="Substitute teacher" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          The current teacher {currentName ? `(${currentName}) ` : ""}loses access to future attendance, marks and notices.
          Historical records stay attributed to them. The replacement gains access immediately.
        </div>
        <div>
          <Label>Course offering</Label>
          {offering ? (
            <p className="text-sm text-slate-700">
              {str((offering.course as Row)?.title)}
              {str(offering.context) && <span className="ml-2 font-mono text-xs text-brand-700">{str(offering.context)}</span>}
            </p>
          ) : null}
        </div>
        {currentName && (
          <div>
            <Label>Current teacher</Label>
            <p className="text-sm font-medium text-slate-800">{currentName}</p>
          </div>
        )}
        <div>
          <Label required>Replacement teacher</Label>
          <SearchableSelect
            options={options}
            value={teacherId}
            onChange={setTeacherId}
            ariaLabel="Replacement teacher"
            clearLabel="Select..."
            emptyMessage="No eligible teachers"
          />
        </div>
        <div>
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. leave, illness, reassignment" rows={2} />
        </div>
        <FieldError error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !teacherId}>{saving && <Spinner />} Confirm substitution</Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Contextual assignment controls for a CourseOffering row/detail:
 *  - unassigned + available  -> "Unassigned" + [Assign Teacher]
 *  - assigned   + available  -> "Teacher: X"   + [Substitute]
 *  - unavailable (offering or academic year inactive) -> status only, no actions
 * `compact` renders only the action button (for table rows where the teacher
 * name has its own column).
 */
export function TeacherAssignmentActions({
  offering,
  compact = false,
  onSaved,
}: {
  offering: Row | null;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const [mode, setMode] = useState<null | "assign" | "substitute">(null);
  if (!offering) return null;
  const teacherName = assignedTeacherName(offering);
  const available = offeringAvailable(offering);
  const reason = offeringUnavailableReason(offering);

  const status = teacherName ? (
    <span className="font-medium text-slate-800">Teacher: {teacherName}</span>
  ) : (
    <span className="text-amber-600">Unassigned</span>
  );

  return (
    <span className="flex flex-col gap-1">
      {!compact && <span className="text-sm">{status}</span>}
      {available ? (
        teacherName ? (
          <Button variant="outline" onClick={() => setMode("substitute")} title="Replace the current teacher">
            <ArrowLeftRight size={14} /> Substitute
          </Button>
        ) : (
          <Button onClick={() => setMode("assign")} title="Assign the first teacher for this offering">
            <UserPlus size={14} /> Assign Teacher
          </Button>
        )
      ) : (
        <span className="text-xs text-slate-400" title={reason}>
          {reason || "Unavailable"}
        </span>
      )}
      <AssignTeacherDialog open={mode === "assign"} offering={offering} onClose={() => setMode(null)} onSaved={onSaved} />
      <SubstituteDialog open={mode === "substitute"} offering={offering} onClose={() => setMode(null)} onSaved={onSaved} />
    </span>
  );
}
