"use client";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { get, post, patch, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections, searchStudentOptions } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Select, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, StatusBadge, Input } from "@/components/ui";
import { validateFields, validationDetails, rollNumberIssue, ROLL_MAX } from "@/lib/validation/form-errors";
import { Plus, Pencil } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

// Mirrors the API contract: every field below is required. The roll number is required
// too and validated by the shared rollNumberIssue rules (see save() below); it must be
// unique inside the chosen section, which the API enforces.
const ENROLLMENT_FIELDS = [
  { name: "studentId", label: "Student", required: true },
  { name: "academicYearId", label: "Academic year", required: true },
  { name: "tradeId", label: "Trade", required: true },
  { name: "semesterId", label: "Semester", required: true },
  { name: "shiftId", label: "Shift", required: true },
  { name: "sectionId", label: "Section", required: true },
];

export default function EnrollmentsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // Once the admin types a roll number it is never overwritten by the suggested one.
  const [rollEdited, setRollEdited] = useState(false);
  const [focusAttempt, setFocusAttempt] = useState(0);
  const formBodyRef = useRef<HTMLDivElement>(null);

  const [rollTarget, setRollTarget] = useState<Row | null>(null);
  const [rollValue, setRollValue] = useState("");
  const [rollError, setRollError] = useState("");
  const [rollSaving, setRollSaving] = useState(false);

  const { mutate: mutateSuggestions } = useSWRConfig();

  const semesters = useSemesters(f.tradeId || undefined);
  const query = qs({ page, limit: 25, ...f });
  const { data, error, isLoading, mutate } = useSWR(`enrollments${query}`, () => get<Row[]>(`/enrollments${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  const formSemesters = useSemesters(form.tradeId || undefined);
  const formSections = useSections({ academicYearId: form.academicYearId || undefined, tradeId: form.tradeId || undefined, semesterId: form.semesterId || undefined, shiftId: form.shiftId || undefined });

  // Suggested roll number for the selected section (roll numbers are unique per section).
  const { data: rollSuggestion } = useSWR(
    dialog && form.sectionId ? `next-roll-${form.sectionId}` : null,
    () => get<{ rollNumber: number }>(`/enrollments/next-roll?sectionId=${form.sectionId}`).then((r) => r.data),
  );

  useEffect(() => {
    if (rollEdited) return;
    const suggested = rollSuggestion ? String(rollSuggestion.rollNumber) : "";
    if (!form.sectionId && !form.rollNumber) return;
    if (form.rollNumber !== suggested) setForm((previous) => ({ ...previous, rollNumber: suggested }));
  }, [rollSuggestion, rollEdited, form.sectionId, form.rollNumber]);

  useEffect(() => {
    if (focusAttempt) formBodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusAttempt]);

  function updateField(name: string, value: string) {
    setForm((previous) => ({ ...previous, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((previous) => { const next = { ...previous }; delete next[name]; return next; });
    setFormError("");
  }

  /** Context selects clear the values (and errors) that no longer belong to the new context. */
  function updateContext(values: Record<string, string>) {
    setForm((previous) => ({ ...previous, ...values }));
    setFieldErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(values)) delete next[key];
      return next;
    });
    setFormError("");
  }

  function openDialog() {
    setForm({}); setFieldErrors({}); setFormError(""); setRollEdited(false); setDialog(true);
  }

  async function save() {
    if (saving) return;
    const errors = validateFields(ENROLLMENT_FIELDS, form);
    // Roll number is required on every enrollment and mirrors the API rules
    // (positive whole number, ≤ 999999). Section-scoped uniqueness stays API/DB-only.
    const rollIssue = rollNumberIssue(form.rollNumber);
    if (rollIssue) errors.rollNumber = [rollIssue];
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      setFormError("Please correct the highlighted fields before enrolling the student.");
      setFocusAttempt((n) => n + 1);
      return;
    }
    const roll = Number(form.rollNumber);
    setSaving(true);
    try {
      await post("/enrollments", {
        studentId: form.studentId, academicYearId: form.academicYearId, tradeId: form.tradeId,
        semesterId: form.semesterId, shiftId: form.shiftId, sectionId: form.sectionId, rollNumber: roll,
      });
      // The suggested next number for that section changed.
      await mutateSuggestions((key) => typeof key === "string" && key.startsWith("next-roll-"));
      setDialog(false); setForm({}); setRollEdited(false); await mutate();
    } catch (e) {
      if (e instanceof ApiError) {
        const details = validationDetails(e.details);
        setFieldErrors(details.fieldErrors);
        if (Object.keys(details.fieldErrors).length) setFocusAttempt((n) => n + 1);
      }
      setFormError(e instanceof ApiError ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function close(id: string, status: "WITHDRAWN" | "TRANSFERRED") {
    if (!confirm(`Mark this enrollment as ${status}? History is preserved.`)) return;
    await post(`/enrollments/${id}/close`, { status });
    await mutate();
  }

  function openRollEdit(row: Row) {
    setRollTarget(row); setRollValue(str(row.rollNumber)); setRollError("");
  }

  async function saveRoll() {
    if (!rollTarget) return;
    const issue = rollNumberIssue(rollValue);
    if (issue) { setRollError(issue); return; }
    const value = Number(rollValue);
    setRollSaving(true); setRollError("");
    try {
      await patch(`/enrollments/${str(rollTarget.id)}`, { rollNumber: value });
      await mutateSuggestions((key) => typeof key === "string" && key.startsWith("next-roll-"));
      setRollTarget(null); await mutate();
    } catch (e) {
      setRollError(e instanceof ApiError ? e.message : "Could not update the roll number.");
    } finally { setRollSaving(false); }
  }

  function setFilter(k: string, v: string) {
    const nf = { ...f };
    if (!v) delete nf[k]; else nf[k] = v;
    setPage(1); setF(nf);
  }

  const rollHint = rollSuggestion
    ? `Unique inside the section — next available is ${rollSuggestion.rollNumber}.`
    : "Unique inside the section.";

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Enrollments" }]} />
      <PageHeader title="Enrollments" subtitle="Placement history is preserved — never overwritten." actions={<Button onClick={openDialog}><Plus size={16} /> Enroll student</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{["ACTIVE", "PROMOTED", "FAILED", "REPEATING", "COMPLETED", "WITHDRAWN", "TRANSFERRED"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load enrollments" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No enrollments" action={<Button onClick={openDialog}><Plus size={16} /> Enroll student</Button>} />
      ) : (
        <>
          <Table headers={["Roll", "Student", "Context", "Section", "Status", "Actions"]}>
            {items.map((r) => (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(r.rollNumber)}</td>
                <td className="px-4 py-3 font-medium">{str(((r.student as Row)?.user as Row)?.name)} <span className="text-xs text-slate-400">{str((r.student as Row)?.studentId)}</span></td>
                <td className="px-4 py-3 text-sm">{str((r.academicYear as Row)?.name)} · {str((r.trade as Row)?.code)} · {str((r.semester as Row)?.name)} · {str((r.shift as Row)?.name)}</td>
                <td className="px-4 py-3">{str((r.section as Row)?.name)}</td>
                <td className="px-4 py-3"><StatusBadge status={str(r.status)} /></td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    <Button variant="outline" onClick={() => openRollEdit(r)}><Pencil size={14} /> Roll</Button>
                    {str(r.status) === "ACTIVE" ? (
                      <>
                        <Button variant="outline" onClick={() => close(str(r.id), "WITHDRAWN")}>Withdraw</Button>
                        <Button variant="outline" onClick={() => close(str(r.id), "TRANSFERRED")}>Transfer</Button>
                      </>
                    ) : <span className="self-center text-sm text-slate-400">Closed</span>}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="Enroll student" onClose={() => setDialog(false)} wide>
        <div className="space-y-3" ref={formBodyRef}>
          <div>
            <Label required>Student (search by ID or name)</Label>
            <SearchableSelect loadOptions={searchStudentOptions} minQuery={2} value={form.studentId ?? ""} onChange={(v) => updateField("studentId", v)} placeholder="Search student ID or name..." clearLabel="Select..." ariaLabel="Student" />
            <FieldError error={fieldErrors.studentId?.[0]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Academic year</Label>
              <SearchableSelect options={years} value={form.academicYearId ?? ""} onChange={(v) => updateField("academicYearId", v)} clearLabel="Select..." ariaLabel="Academic year" />
              <FieldError error={fieldErrors.academicYearId?.[0]} />
            </div>
            <div>
              <Label required>Trade</Label>
              <SearchableSelect options={trades} value={form.tradeId ?? ""} onChange={(v) => updateContext({ tradeId: v, semesterId: "", sectionId: "", rollNumber: "" })} clearLabel="Select..." ariaLabel="Trade" />
              <FieldError error={fieldErrors.tradeId?.[0]} />
            </div>
            <div>
              <Label required>Semester</Label>
              <Select value={form.semesterId ?? ""} onChange={(e) => updateContext({ semesterId: e.target.value, sectionId: "", rollNumber: "" })} aria-label="Semester" aria-invalid={!!fieldErrors.semesterId}><option value="">Select...</option>{formSemesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              <FieldError error={fieldErrors.semesterId?.[0]} />
            </div>
            <div>
              <Label required>Shift</Label>
              <Select value={form.shiftId ?? ""} onChange={(e) => updateContext({ shiftId: e.target.value, sectionId: "", rollNumber: "" })} aria-label="Shift" aria-invalid={!!fieldErrors.shiftId}><option value="">Select...</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              <FieldError error={fieldErrors.shiftId?.[0]} />
            </div>
            <div>
              <Label required>Section</Label>
              <Select value={form.sectionId ?? ""} onChange={(e) => { setRollEdited(false); updateContext({ sectionId: e.target.value, rollNumber: "" }); }} aria-label="Section" aria-invalid={!!fieldErrors.sectionId}><option value="">Select...</option>{formSections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              <FieldError error={fieldErrors.sectionId?.[0]} />
            </div>
            <div>
              <Label required htmlFor="enrollment-roll-number">Roll number</Label>
              <Input
                id="enrollment-roll-number" name="rollNumber" type="number" inputMode="numeric" required min={1} max={ROLL_MAX} step={1}
                value={form.rollNumber ?? ""} placeholder="e.g. 12"
                onChange={(e) => { setRollEdited(true); updateField("rollNumber", e.target.value); }}
                aria-invalid={!!fieldErrors.rollNumber}
                aria-describedby={[fieldErrors.rollNumber ? "enrollment-roll-number-error" : "", "enrollment-roll-number-help"].filter(Boolean).join(" ")}
              />
              <p id="enrollment-roll-number-help" className="mt-1 text-xs text-slate-500">{rollHint}</p>
              <FieldError id="enrollment-roll-number-error" error={fieldErrors.rollNumber?.[0]} />
            </div>
          </div>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!rollTarget} title="Correct roll number" onClose={() => setRollTarget(null)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Roll {str(rollTarget?.rollNumber)} · {str(((rollTarget?.student as Row)?.user as Row)?.name)} · section {str((rollTarget?.section as Row)?.name)}.
            Roll numbers must stay unique inside the section and the change is audit-logged.
          </p>
          <div>
            <Label required htmlFor="roll-edit-input">Roll number</Label>
            <Input id="roll-edit-input" name="rollNumber" type="number" inputMode="numeric" required min={1} max={ROLL_MAX} step={1} value={rollValue} onChange={(e) => setRollValue(e.target.value)} aria-invalid={!!rollError} />
            <FieldError error={rollError} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRollTarget(null)}>Cancel</Button>
            <Button onClick={saveRoll} disabled={rollSaving}>{rollSaving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
