"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections } from "@/components/academic-options";
import { PageHeader, Button, Table, TableSkeleton, EmptyState, ErrorState, Select, SearchableSelect, Label, Breadcrumbs, Card } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AttendanceReportPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const [run, setRun] = useState("");
  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });
  const { data, error, isLoading, mutate } = useSWR(run ? `rep-att${run}` : null, () => get<Row[]>(`/reports/attendance${run}`).then((r) => r.data));
  const rows = data ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Reports", href: "/admin/reports" }, { label: "Attendance" }]} />
      <PageHeader title="Attendance report" />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div><Label>Year</Label><SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setF({ ...f, academicYearId: v })} clearLabel="All" /></div>
          <div><Label>Trade</Label><SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setF({ ...f, tradeId: v, semesterId: "", sectionId: "" })} clearLabel="All" /></div>
          <div><Label>Semester</Label><Select value={f.semesterId ?? ""} onChange={(e) => setF({ ...f, semesterId: e.target.value })}><option value="">All</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label>Shift</Label><Select value={f.shiftId ?? ""} onChange={(e) => setF({ ...f, shiftId: e.target.value })}><option value="">All</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label>Section</Label><Select value={f.sectionId ?? ""} onChange={(e) => setF({ ...f, sectionId: e.target.value })}><option value="">All</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
          <div><Label>From</Label><input type="date" value={f.from ?? ""} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
          <div><Label>To</Label><input type="date" value={f.to ?? ""} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
          <div className="flex items-end"><Button onClick={() => setRun(qs(f))}>Run report</Button></div>
        </div>
      </Card>
      {!run ? <EmptyState title="Configure filters and run the report" /> :
        isLoading ? <TableSkeleton columns={8} rows={6} label="Loading attendance report" /> : error ? <ErrorState message="Report failed" onRetry={() => mutate()} /> : rows.length === 0 ? <EmptyState title="No attendance in this range" /> : (
        <Table headers={["Student ID", "Name", "Classes", "Present", "Absent", "Late", "Excused", "%"]}>
          {rows.map((r) => (
            <tr key={str(r.studentId)} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium">{str(r.studentCode)}</td>
              <td className="px-4 py-3">{str(r.name)}</td>
              <td className="px-4 py-3">{str(r.total)}</td>
              <td className="px-4 py-3">{str(r.present)}</td>
              <td className="px-4 py-3">{str(r.absent)}</td>
              <td className="px-4 py-3">{str(r.late)}</td>
              <td className="px-4 py-3">{str(r.excused)}</td>
              <td className="px-4 py-3 font-bold">{str(r.percentage)}%</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
