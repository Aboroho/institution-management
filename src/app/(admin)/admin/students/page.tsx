"use client";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections } from "@/components/academic-options";
import { getFilterDefaults, applyDependentChange, applyFilterChange } from "@/components/filter-defaults";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, SearchableSelect, Label, FieldError, Spinner, Pagination, Breadcrumbs, Badge } from "@/components/ui";
import { validateFields, validationDetails, rollNumberIssue, ROLL_MAX } from "@/lib/validation/form-errors";
import { Plus, Search } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

const STUDENT_FIELDS = [
  { name: "name", label: "Full name", required: true },
  { name: "studentId", label: "Student ID", required: true },
  { name: "email", label: "Email", required: true, type: "email" },
  { name: "password", label: "Password", required: true },
  { name: "academicYearId", label: "Academic year", required: true },
  { name: "tradeId", label: "Trade", required: true },
  { name: "semesterId", label: "Semester", required: true },
  { name: "shiftId", label: "Shift", required: true },
  { name: "sectionId", label: "Section", required: true },
];

export default function StudentsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [rollEdited, setRollEdited] = useState(false);
  const [focusAttempt, setFocusAttempt] = useState(0);
  const formBodyRef = useRef<HTMLDivElement>(null);

  const { mutate: mutateSuggestions } = useSWRConfig();

  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });

  const formSemesters = useSemesters(form.tradeId || undefined);
  const formSections = useSections({ academicYearId: form.academicYearId || undefined, tradeId: form.tradeId || undefined, semesterId: form.semesterId || undefined, shiftId: form.shiftId || undefined });

  const query = qs({ page, limit: 25, search: search || undefined, ...f });
  const { data, error, isLoading, mutate } = useSWR(`students${query}`, () => get<Row[]>(`/students${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

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

  function setFilter(k: string, v: string) {
    const nf = applyFilterChange(f, k, v);
    setPage(1); setF(nf);
  }

  function updateField(name: string, value: string) {
    setForm((previous) => ({ ...previous, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((previous) => { const next = { ...previous }; delete next[name]; return next; });
    setFormError("");
  }

  function updateContext(values: Record<string, string>) {
    setForm((previous) => {
      let next = { ...previous };
      for (const [k, v] of Object.entries(values)) {
        next = applyDependentChange(next, k, v);
      }
      return next;
    });
    setFieldErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(values)) delete next[key];
      return next;
    });
    setFormError("");
  }

  function openDialog() {
    const defaults = getFilterDefaults(f, {
      relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId", "sectionId"],
      validOptions: {
        semesterId: semesters,
        sectionId: sections,
      },
    });
    setForm(defaults);
    setFieldErrors({});
    setFormError("");
    setRollEdited(false);
    setDialog(true);
  }

  async function save() {
    if (saving) return;
    const errors = validateFields(STUDENT_FIELDS, form);
    const rollIssue = rollNumberIssue(form.rollNumber);
    if (rollIssue) errors.rollNumber = [rollIssue];
    // Password minimum length UX
    if (form.password && form.password.length < 8) {
      errors.password = ["Password must be at least 8 characters."];
    }
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      setFormError("Please correct the highlighted fields before creating the student.");
      setFocusAttempt((n) => n + 1);
      return;
    }
    const roll = Number(form.rollNumber);
    setSaving(true);
    try {
      await post("/students", {
        name: form.name,
        email: form.email,
        password: form.password,
        studentId: form.studentId,
        phone: form.phone || undefined,
        guardianName: form.guardianName || undefined,
        guardianPhone: form.guardianPhone || undefined,
        academicYearId: form.academicYearId,
        tradeId: form.tradeId,
        semesterId: form.semesterId,
        shiftId: form.shiftId,
        sectionId: form.sectionId,
        rollNumber: roll,
      });
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

  const rollHint = rollSuggestion
    ? `Required and unique inside the section — next available is ${rollSuggestion.rollNumber}.`
    : "Required and unique inside the section.";

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Students" }]} />
      <PageHeader title="Students" subtitle="Student IDs are permanent and never change. Roll number is required and unique inside a section." actions={<Button onClick={openDialog}><Plus size={16} /> New student</Button>} />
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by ID, name, email or roll..." className="pl-9" />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.shiftId ?? ""} onChange={(e) => setFilter("shiftId", e.target.value)} aria-label="Shift"><option value="">All shifts</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.sectionId ?? ""} onChange={(e) => setFilter("sectionId", e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{["ACTIVE", "PROMOTED", "FAILED", "REPEATING", "COMPLETED", "WITHDRAWN", "TRANSFERRED"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load students" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No students" action={<Button onClick={openDialog}><Plus size={16} /> New student</Button>} />
      ) : (
        <>
          <Table headers={["Roll", "Student ID", "Name", "Email", "Current enrollment", "Status"]}>
            {items.map((r) => {
              const en = (r.enrollments as Row[] | undefined)?.[0];
              return (
                <tr key={str(r.id)} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{str(en?.rollNumber)}</td>
                  <td className="px-4 py-3"><Link href={`/admin/students/${r.id}`} className="font-medium text-brand-600 hover:underline">{str(r.studentId)}</Link></td>
                  <td className="px-4 py-3">{str((r.user as Row)?.name)}</td>
                  <td className="px-4 py-3 text-slate-500">{str((r.user as Row)?.email)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{en ? `${str((en.trade as Row)?.code)} · ${str((en.semester as Row)?.name)} · ${str((en.section as Row)?.name)}` : "—"}</td>
                  <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={dialog} title="New student" onClose={() => setDialog(false)} wide>
        <div className="space-y-4" ref={formBodyRef}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Full name</Label>
              <Input value={form.name ?? ""} onChange={(e) => updateField("name", e.target.value)} aria-invalid={!!fieldErrors.name} />
              <FieldError error={fieldErrors.name?.[0]} />
            </div>
            <div>
              <Label required>Student ID</Label>
              <Input value={form.studentId ?? ""} placeholder="STU-2026-001" onChange={(e) => updateField("studentId", e.target.value)} aria-invalid={!!fieldErrors.studentId} />
              <FieldError error={fieldErrors.studentId?.[0]} />
            </div>
            <div>
              <Label required>Email</Label>
              <Input type="email" value={form.email ?? ""} onChange={(e) => updateField("email", e.target.value)} aria-invalid={!!fieldErrors.email} />
              <FieldError error={fieldErrors.email?.[0]} />
            </div>
            <div>
              <Label required>Password</Label>
              <Input type="password" value={form.password ?? ""} onChange={(e) => updateField("password", e.target.value)} aria-invalid={!!fieldErrors.password} />
              <FieldError error={fieldErrors.password?.[0]} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} />
            </div>
            <div>
              <Label>Guardian name</Label>
              <Input value={form.guardianName ?? ""} onChange={(e) => updateField("guardianName", e.target.value)} />
            </div>
            <div>
              <Label>Guardian phone</Label>
              <Input value={form.guardianPhone ?? ""} onChange={(e) => updateField("guardianPhone", e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Enrollment & roll number — required, unique inside the section</p>
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
                <Label required htmlFor="student-roll-number">Roll number</Label>
                <Input
                  id="student-roll-number" name="rollNumber" type="number" inputMode="numeric" required min={1} max={ROLL_MAX} step={1}
                  value={form.rollNumber ?? ""} placeholder="e.g. 12"
                  onChange={(e) => { setRollEdited(true); updateField("rollNumber", e.target.value); }}
                  aria-invalid={!!fieldErrors.rollNumber}
                  aria-describedby={[fieldErrors.rollNumber ? "student-roll-number-error" : "", "student-roll-number-help"].filter(Boolean).join(" ")}
                />
                <p id="student-roll-number-help" className="mt-1 text-xs text-slate-500">{rollHint}</p>
                <FieldError id="student-roll-number-error" error={fieldErrors.rollNumber?.[0]} />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">A student cannot exist without a roll number. The roll is unique inside the selected section.</p>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
