"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Select, SearchableSelect, Label, Spinner, Breadcrumbs, Badge, Card, Dialog, FieldError } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

const DECISIONS = ["PROMOTED", "REPEAT", "FAILED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"];

export default function PromotionsPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });
  const [preview, setPreview] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<Row | null>(null);

  const { data: history } = useSWR("promo-history", () => get<Row[]>("/promotions/history?limit=10").then((r) => r.data));

  async function evaluate() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await post<Row[]>("/promotions/preview", { academicYearId: f.academicYearId, tradeId: f.tradeId, semesterId: f.semesterId, shiftId: f.shiftId || undefined, sectionId: f.sectionId || undefined });
      setPreview(r.data);
      const d: Record<string, string> = {};
      for (const p of r.data) d[str(p.enrollmentId)] = str(p.suggested);
      setDecisions(d);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Evaluation failed"); }
    finally { setLoading(false); }
  }

  async function execute() {
    if (!preview) return;
    setExecuting(true); setError("");
    try {
      const items = preview.map((p) => ({ enrollmentId: str(p.enrollmentId), decision: (decisions[str(p.enrollmentId)] || str(p.suggested)) as never }));
      const r = await post<Row>("/promotions/execute", { items });
      setResult(r.data); setConfirmOpen(false); setPreview(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Promotion failed"); }
    finally { setExecuting(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Promotions" }]} />
      <PageHeader title="Promotions" subtitle="Preview eligibility, review, then confirm. History is never overwritten." />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div><Label required>Year</Label><SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setF({ ...f, academicYearId: v })} clearLabel="Select..." /></div>
          <div><Label required>Trade</Label><SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setF({ ...f, tradeId: v, semesterId: "", sectionId: "" })} clearLabel="Select..." /></div>
          <div><Label required>Semester</Label><Select value={f.semesterId ?? ""} onChange={(e) => setF({ ...f, semesterId: e.target.value })}><option value="">Select...</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label>Shift</Label><Select value={f.shiftId ?? ""} onChange={(e) => setF({ ...f, shiftId: e.target.value })}><option value="">All</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label>Section</Label><Select value={f.sectionId ?? ""} onChange={(e) => setF({ ...f, sectionId: e.target.value })}><option value="">All</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
        </div>
        <div className="mt-3">
          <Button onClick={evaluate} disabled={loading || !f.academicYearId || !f.tradeId || !f.semesterId}>{loading && <Spinner />} Evaluate eligibility</Button>
        </div>
      </Card>

      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {result && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Promotion complete: {str(result.count)} student(s) processed. Students have been notified.</div>}
      {loading && <LoadingSkeleton />}
      {preview && !loading && (
        preview.length === 0 ? <EmptyState title="No active students in this context" /> : (
          <>
            <Table headers={["Roll", "Student", "Section", "Graded", "Passed", "Suggested", "Decision"]}>
              {preview.map((p) => (
                <tr key={str(p.enrollmentId)} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{str(p.rollNumber)}</td>
                  <td className="px-4 py-3 font-medium">{str(((p.student as Row)?.user as Row)?.name)} <span className="text-xs text-slate-400">{str((p.student as Row)?.studentId)}</span></td>
                  <td className="px-4 py-3">{str((p.section as Row)?.name)}</td>
                  <td className="px-4 py-3">{p.gradedAll ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>}</td>
                  <td className="px-4 py-3">{p.passedAll ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</td>
                  <td className="px-4 py-3"><Badge tone="blue">{str(p.suggested)}</Badge></td>
                  <td className="px-4 py-3">
                    <Select value={decisions[str(p.enrollmentId)] ?? str(p.suggested)} onChange={(e) => setDecisions({ ...decisions, [str(p.enrollmentId)]: e.target.value })} aria-label="Decision">
                      {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setConfirmOpen(true)}>Review & confirm ({preview.length})</Button>
            </div>
          </>
        )
      )}

      <h2 className="mb-2 mt-8 font-semibold text-slate-800">Recent promotion history</h2>
      {(history ?? []).length === 0 ? <p className="text-sm text-slate-500">No promotions yet.</p> : (
        <Table headers={["Student", "From", "To", "Decision", "Date"]}>
          {(history ?? []).map((h) => (
            <tr key={str(h.id)}>
              <td className="px-4 py-3">{str(((h.student as Row)?.user as Row)?.name)}</td>
              <td className="px-4 py-3 text-sm">{str(((h.fromEnrollment as Row)?.semester as Row)?.name)}</td>
              <td className="px-4 py-3 text-sm">{h.toEnrollment ? str(((h.toEnrollment as Row)?.semester as Row)?.name) : "—"}</td>
              <td className="px-4 py-3"><Badge>{str(h.decision)}</Badge></td>
              <td className="px-4 py-3 text-sm text-slate-500">{str(h.decidedAt).slice(0, 10)}</td>
            </tr>
          ))}
        </Table>
      )}

      <Dialog open={confirmOpen} title="Confirm promotion" onClose={() => setConfirmOpen(false)}>
        <p className="text-sm text-slate-600">This will create new enrollments and close current ones in a single transaction. Student IDs remain unchanged. This cannot be undone automatically.</p>
        <FieldError error={error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={execute} disabled={executing}>{executing && <Spinner />} Confirm</Button>
        </div>
      </Dialog>
    </div>
  );
}
